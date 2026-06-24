/**
 * End-to-end test of the lower three layers: registry → use cases → adapter.
 * Creates its own throwaway SQLite file so it is self-contained. This is the
 * seed of the "adapter contract suite" described in docs/ARCHITECTURE.md §10 —
 * any future SQL dialect/driver must pass an equivalent run.
 */

import { test, expect, beforeAll, afterAll } from 'bun:test';
import { Database } from 'bun:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';

import { createDataSource } from '../registry.ts';
import type { ConnectionProfile } from '../../../domain/connection/ConnectionProfile.ts';
import type { DataSource } from '../../../domain/datasource/DataSource.ts';
import { Capability } from '../../../domain/datasource/capabilities.ts';
import { listObjects } from '../../../application/usecases/ListObjects.ts';
import { browseTable } from '../../../application/usecases/BrowseTable.ts';
import { unwrap } from '../../../shared/Result.ts';
import { firstPage } from '../../../domain/query/Query.ts';

const DB = join(tmpdir(), `lazysql-test-${process.pid}.db`);
let source: DataSource;

beforeAll(async () => {
  const db = new Database(DB, { create: true });
  db.exec(
    `CREATE TABLE widget (id INTEGER PRIMARY KEY, label TEXT NOT NULL, qty INTEGER);`,
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

test('declares Query/SchemaIntrospect/Browse capabilities', () => {
  const caps = source.capabilities();
  expect(caps.has(Capability.SchemaIntrospect)).toBe(true);
  expect(caps.has(Capability.Browse)).toBe(true);
  expect(caps.has(Capability.RowEdit)).toBe(false); // not yet implemented
});

test('listObjects returns the table', async () => {
  const objects = unwrap(await listObjects(source));
  expect(objects.map((o) => o.name)).toContain('widget');
});

test('browseTable paginates and counts', async () => {
  const ref = { name: 'widget', kind: 'table' as const };
  const result = unwrap(await browseTable(source, ref, { page: firstPage(10) }));

  expect(result.total).toBe(25);
  expect(result.rows.rows.length).toBe(10);
  expect(result.rows.truncated).toBe(true);
  expect(result.rows.columns.map((c) => c.name)).toEqual(['id', 'label', 'qty']);
  expect(result.rows.shape).toBe('tabular');
});

test('second page returns the remainder window', async () => {
  const ref = { name: 'widget', kind: 'table' as const };
  const result = unwrap(
    await browseTable(source, ref, { page: { offset: 20, limit: 10 } }),
  );
  expect(result.rows.rows.length).toBe(5);
  expect(result.rows.truncated).toBe(false);
});

test('browse with descending sort orders by the column', async () => {
  const ref = { name: 'widget', kind: 'table' as const };
  const result = unwrap(
    await browseTable(source, ref, {
      page: firstPage(5),
      sort: { column: 'qty', direction: 'desc' },
    }),
  );
  // qty is the 3rd column; descending → first row holds the max (25).
  expect(result.rows.rows[0]?.[2]).toBe(25);
  expect(result.rows.rows[4]?.[2]).toBe(21);
});

test('numeric filter narrows rows and the count matches', async () => {
  const ref = { name: 'widget', kind: 'table' as const };
  const result = unwrap(
    await browseTable(source, ref, {
      page: firstPage(50),
      filter: { conditions: [{ column: 'qty', op: 'gt', value: '20' }] },
    }),
  );
  expect(result.total).toBe(5); // qty 21..25
  expect(result.rows.rows.length).toBe(5);
});

test('contains filter binds the value (no interpolation)', async () => {
  const ref = { name: 'widget', kind: 'table' as const };
  const result = unwrap(
    await browseTable(source, ref, {
      page: firstPage(50),
      filter: { conditions: [{ column: 'label', op: 'contains', value: '25' }] },
    }),
  );
  expect(result.total).toBe(1);
  expect(result.rows.rows[0]?.[1]).toBe('w25');
});
