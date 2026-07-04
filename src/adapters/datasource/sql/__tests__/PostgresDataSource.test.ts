/**
 * Postgres adapter tests: probes for a real server (auto-skips when absent),
 * seeds, runs the shared SQL contract (sqlContract.ts — the SAME assertions
 * SQLite and MySQL run), then the PG-specific extras: the full catalog of
 * object kinds (sequence/function/trigger), verbatim definitions, cascade-safe
 * reserved-word DROP, jsonb-vs-json canonicality, and uuid-column filtering.
 *
 * Bring a server up with:
 *   docker compose -f docker-compose.test.yml up -d --wait postgres
 */

import { test, expect, beforeAll, afterAll } from 'bun:test';
import { createDataSource } from '../../registry.ts';
import { runSqlContract } from './sqlContract.ts';
import type { ConnectionProfile } from '../../../../domain/connection/ConnectionProfile.ts';
import type { DataSource } from '../../../../domain/datasource/DataSource.ts';
import {
  asIntrospectable,
  asQueryable,
  asDdlScriptable,
} from '../../../../domain/datasource/DataSource.ts';
import { listObjects } from '../../../../application/usecases/ListObjects.ts';
import { browseTable } from '../../../../application/usecases/BrowseTable.ts';
import { unwrap } from '../../../../shared/Result.ts';
import { firstPage, sql } from '../../../../domain/query/Query.ts';
import type { ObjectRef } from '../../../../domain/datasource/schema.ts';
import { columnsOf } from '../../../../domain/datasource/schema.ts';

const PG_URL =
  process.env.LAZYSQL_PG_URL ??
  'postgres://lazysql:lazysql@localhost:55432/lazysql';

const profile: ConnectionProfile = {
  id: 'pg-test',
  name: 'pg-test',
  driver: 'postgres',
  options: { connectionString: PG_URL },
};

const widget: ObjectRef = { namespace: 'public', name: 'widget', kind: 'table' };

const probe = async (): Promise<boolean> => {
  const created = createDataSource(profile);
  if (!created.ok) return false;
  const connected = await created.value.connect();
  await created.value.disconnect();
  return connected.ok;
};

const available = await probe();
const pgTest = test.skipIf(!available);
if (!available) {
  console.warn(`⚠ Postgres not reachable at ${PG_URL} — skipping PG suite`);
}

let source: DataSource;

beforeAll(async () => {
  if (!available) return;
  source = unwrap(createDataSource(profile));
  unwrap(await source.connect());

  // Seed via the adapter's own Queryable path (also exercises execute()).
  const queryable = asQueryable(source)!;
  const exec = (text: string) => queryable.execute(sql(text));
  await exec('DROP TABLE IF EXISTS widget CASCADE'); // also drops its view/index/trigger
  await exec('DROP SEQUENCE IF EXISTS counter');
  await exec('DROP FUNCTION IF EXISTS inc(integer)');
  await exec('DROP FUNCTION IF EXISTS trg()');
  await exec(
    'CREATE TABLE widget (id serial PRIMARY KEY, label text, qty integer)',
  );
  await exec(
    "INSERT INTO widget (label, qty) SELECT 'w' || g, g FROM generate_series(1, 25) g",
  );
  // The non-table kinds the catalog introspection + definition path must surface.
  await exec('CREATE VIEW pricey AS SELECT id, label FROM widget WHERE qty > 10');
  await exec('CREATE INDEX widget_label ON widget(label)');
  await exec('CREATE SEQUENCE counter START 5');
  await exec("CREATE FUNCTION inc(a integer) RETURNS integer LANGUAGE sql AS 'SELECT a + 1'");
  await exec(
    "CREATE FUNCTION trg() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN RETURN NEW; END'",
  );
  await exec(
    'CREATE TRIGGER widget_guard BEFORE UPDATE ON widget FOR EACH ROW EXECUTE FUNCTION trg()',
  );
});

afterAll(async () => {
  if (available) await source?.disconnect();
});

runSqlContract({
  available,
  source: () => source,
  widget,
  ph: (i) => `$${i}`,
});

// ── PG-specific ─────────────────────────────────────────────────────────────

pgTest('listObjects surfaces every object kind by kind', async () => {
  const objects = unwrap(await listObjects(source));
  const kindOf = (name: string) => objects.find((o) => o.name === name)?.kind;
  expect(kindOf('pricey')).toBe('view');
  expect(kindOf('widget_label')).toBe('index');
  expect(kindOf('counter')).toBe('sequence');
  expect(kindOf('widget_guard')).toBe('trigger');
  expect(kindOf('inc')).toBe('procedure');
});

const sourceText = async (ref: ObjectRef): Promise<string> => {
  const schema = await asIntrospectable(source)!.describe(ref);
  const s = schema.detail.find((d) => d.kind === 'source');
  return s?.kind === 'source' ? s.text : '';
};

pgTest('describe yields each source-only kind its verbatim definition', async () => {
  expect(await sourceText({ namespace: 'public', name: 'widget_label', kind: 'index' })).toMatch(/CREATE.*INDEX/i);
  expect(await sourceText({ namespace: 'public', name: 'widget_guard', kind: 'trigger' })).toMatch(/CREATE.*TRIGGER/i);
  expect(await sourceText({ namespace: 'public', name: 'inc', kind: 'procedure' })).toMatch(/CREATE.*FUNCTION/i);
  expect(await sourceText({ namespace: 'public', name: 'counter', kind: 'sequence' })).toMatch(/CREATE SEQUENCE/i);
});

pgTest('dropStatement quotes a reserved-word table so it drops for real', async () => {
  const q = asQueryable(source)!;
  await q.execute(sql('CREATE TABLE "window" (id int)'));
  const stmt = asDdlScriptable(source)!.dropStatement({
    namespace: 'public',
    name: 'window',
    kind: 'table',
  });
  expect(stmt).toBe('DROP TABLE "public"."window";');
  await q.execute(sql(stmt));
  const objects = unwrap(await listObjects(source));
  expect(objects.find((o) => o.name === 'window')).toBeUndefined();
});

pgTest('describe marks jsonb columns jsonCanonical — json stays verbatim', async () => {
  const exec = (text: string) => asQueryable(source)!.execute(sql(text));
  await exec('DROP TABLE IF EXISTS jsonshapes');
  await exec('CREATE TABLE jsonshapes (id int PRIMARY KEY, doc jsonb, doc_text json)');
  try {
    const cols = columnsOf(
      await asIntrospectable(source)!.describe({ namespace: 'public', name: 'jsonshapes', kind: 'table' }),
    );
    expect(cols.find((c) => c.name === 'doc')?.jsonCanonical).toBe(true);
    expect(cols.find((c) => c.name === 'doc_text')?.jsonCanonical).toBeUndefined();
    expect(cols.find((c) => c.name === 'id')?.jsonCanonical).toBeUndefined();
  } finally {
    await exec('DROP TABLE jsonshapes');
  }
});

pgTest('contains filter works on a uuid column (cast to text)', async () => {
  const q = asQueryable(source)!;
  await q.execute(sql('DROP TABLE IF EXISTS gadget'));
  await q.execute(sql('CREATE TABLE gadget (id uuid PRIMARY KEY, name text)'));
  await q.execute(
    sql(
      `INSERT INTO gadget VALUES
         ('6c52b8a9-124f-3dc8-ae10-de8844bbd61e', 'target'),
         ('00000000-0000-0000-0000-000000000000', 'other')`,
    ),
  );
  const result = unwrap(
    await browseTable(
      source,
      { namespace: 'public', name: 'gadget', kind: 'table' },
      {
        page: firstPage(10),
        filter: { conditions: [{ column: 'id', op: 'contains', value: '6c52b8a9' }] },
      },
    ),
  );
  expect(result.total).toBe(1);
  expect(result.rows.rows[0]?.[1]).toBe('target');
  await q.execute(sql('DROP TABLE gadget'));
});
