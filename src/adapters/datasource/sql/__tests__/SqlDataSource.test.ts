/**
 * SQLite adapter tests: seeds a throwaway file db, runs the shared SQL
 * contract (sqlContract.ts — the SAME assertions PG and MySQL run), then the
 * SQLite-specific extras: sqlite_master introspection of index/trigger kinds,
 * source-only describe, reserved-word DROP quoting, and driver error surfacing.
 */

import { test, expect, beforeAll, afterAll } from 'bun:test';
import { Database } from 'bun:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';

import { createDataSource } from '../../registry.ts';
import { normalizeCell } from '../SqlDataSource.ts';
import { runSqlContract } from './sqlContract.ts';
import type { ConnectionProfile } from '../../../../domain/connection/ConnectionProfile.ts';
import type { DataSource } from '../../../../domain/datasource/DataSource.ts';
import {
  asQueryable,
  asIntrospectable,
  asDdlScriptable,
} from '../../../../domain/datasource/DataSource.ts';
import { columnsOf } from '../../../../domain/datasource/schema.ts';
import { listObjects } from '../../../../application/usecases/ListObjects.ts';
import { unwrap } from '../../../../shared/Result.ts';
import { sql } from '../../../../domain/query/Query.ts';

// A JSON/JSONB column surfaces from pg/mysql as a JS object/array. normalizeCell
// must render it as faithful JSON, never the useless "[object Object]".
test('normalizeCell renders structured values as JSON, not [object Object]', () => {
  expect(normalizeCell([{ a: 1 }, { b: 2 }])).toBe('[{"a":1},{"b":2}]');
  expect(normalizeCell({ x: 'y' })).toBe('{"x":"y"}');
  expect(normalizeCell(new Date('2020-01-02T03:04:05.000Z'))).toBe(
    '2020-01-02T03:04:05.000Z',
  );
  // scalars pass through untouched
  expect(normalizeCell('hi')).toBe('hi');
  expect(normalizeCell(42)).toBe(42);
  expect(normalizeCell(null)).toBe(null);
});

const DB = join(tmpdir(), `lazysql-test-${process.pid}.db`);
let source: DataSource;

beforeAll(async () => {
  const db = new Database(DB, { create: true });
  // NOT NULL is explicit: SQLite's pragma reports notnull=0 for a bare INTEGER
  // PRIMARY KEY (legacy quirk), and the shared contract asserts pk ⇒ not null.
  db.exec(`CREATE TABLE widget (id INTEGER PRIMARY KEY NOT NULL, label TEXT, qty INTEGER);`);
  // A view, a user index and a trigger — the non-table kinds the schema tier and
  // the definition path must surface (part of the adapter contract).
  db.exec(`CREATE VIEW pricey AS SELECT id, label FROM widget WHERE qty > 10;`);
  db.exec(`CREATE INDEX widget_label ON widget(label);`);
  db.exec(
    `CREATE TRIGGER widget_guard BEFORE DELETE ON widget BEGIN SELECT 1; END;`,
  );
  const ins = db.prepare('INSERT INTO widget (label, qty) VALUES (?, ?)');
  for (let i = 1; i <= 25; i++) ins.run(`w${i}`, i);
  db.close();

  const profile: ConnectionProfile = {
    id: 'test',
    name: 'test',
    driver: 'sqlite',
    options: { file: DB },
  };
  source = unwrap(createDataSource(profile));
  unwrap(await source.connect());
});

afterAll(async () => {
  await source?.disconnect();
  rmSync(DB, { force: true });
});

runSqlContract({
  available: true,
  source: () => source,
  widget: { name: 'widget', kind: 'table' },
  ph: () => '?',
});

// ── SQLite-specific ─────────────────────────────────────────────────────────

test('listObjects surfaces views, user indexes and triggers by kind', async () => {
  const objects = unwrap(await listObjects(source));
  const kindOf = (name: string) => objects.find((o) => o.name === name)?.kind;
  expect(kindOf('pricey')).toBe('view');
  expect(kindOf('widget_label')).toBe('index');
  expect(kindOf('widget_guard')).toBe('trigger');
  expect(kindOf('widget')).toBe('table');
});

test('describe gives a source-only object just its definition section', async () => {
  const schema = await asIntrospectable(source)!.describe({
    name: 'widget_label',
    kind: 'index',
  });
  expect(schema.detail.map((d) => d.kind)).toEqual(['source']);
  const source0 = schema.detail[0];
  expect(source0?.kind === 'source' && source0.text).toMatch(/CREATE INDEX/i);
  expect(columnsOf(schema)).toEqual([]); // no rows to browse
});

test('dropStatement quotes the identifier (reserved-word safe)', () => {
  const ddl = asDdlScriptable(source)!;
  expect(ddl.dropStatement({ name: 'order', kind: 'table' })).toBe('DROP TABLE "order";');
  expect(ddl.dropStatement({ name: 'pricey', kind: 'view' })).toBe('DROP VIEW "pricey";');
});

test('a failed query surfaces the driver reason, not the echoed SQL', async () => {
  // The failure must carry the DB's own message (SQLite: `no such table: …`,
  // spaced) — the pre-fix message only restated the SQL (`…no_such_table`).
  const run = asQueryable(source)!.execute(sql('SELECT * FROM no_such_table'));
  await expect(run).rejects.toThrow(/no such table/i);
});
