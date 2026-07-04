/**
 * Postgres adapter contract test — the SAME assertions as the SQLite suite,
 * run against a real PostgreSQL server (Docker). That both adapters pass one
 * shared contract is the executable proof of the capability/dialect abstraction
 * (docs/ARCHITECTURE.md §10, adr/0002). Skips automatically when no PG is
 * reachable, so it never breaks a machine without Docker.
 *
 * Bring a server up with:
 *   docker compose -f docker-compose.test.yml up -d --wait postgres
 */

import { test, expect, beforeAll, afterAll } from 'bun:test';
import { createDataSource } from '../../registry.ts';
import type { ConnectionProfile } from '../../../../domain/connection/ConnectionProfile.ts';
import type { DataSource } from '../../../../domain/datasource/DataSource.ts';
import {
  asIntrospectable,
  asQueryable,
  asRowEditable,
  asDdlScriptable,
} from '../../../../domain/datasource/DataSource.ts';
import { Capability } from '../../../../domain/datasource/capabilities.ts';
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

pgTest('declares Query/SchemaIntrospect/Browse capabilities', () => {
  const caps = source.capabilities();
  expect(caps.has(Capability.SchemaIntrospect)).toBe(true);
  expect(caps.has(Capability.Browse)).toBe(true);
});

pgTest('listObjects finds the table in the public schema', async () => {
  const objects = unwrap(await listObjects(source));
  const found = objects.find((o) => o.name === 'widget');
  expect(found).toBeDefined();
  expect(found?.namespace).toBe('public');
});

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
  await q.execute(sql(stmt)); // runs without a syntax error — the whole point
  const objects = unwrap(await listObjects(source));
  expect(objects.find((o) => o.name === 'window')).toBeUndefined();
});

pgTest('describe gives a view both its columns and its defining source', async () => {
  const view: ObjectRef = { namespace: 'public', name: 'pricey', kind: 'view' };
  const schema = await asIntrospectable(source)!.describe(view);
  expect(schema.detail.map((d) => d.kind)).toEqual(['columns', 'source']);
  expect(columnsOf(schema).map((c) => c.name)).toEqual(['id', 'label']);
  expect(await sourceText(view)).toMatch(/SELECT/i);
});

pgTest('describe reports the primary key and nullability', async () => {
  const introspectable = asIntrospectable(source)!;
  const cols = columnsOf(await introspectable.describe(widget));
  const id = cols.find((c) => c.name === 'id');
  const label = cols.find((c) => c.name === 'label');
  expect(id?.isPrimaryKey).toBe(true);
  expect(id?.nullable).toBe(false);
  expect(label?.isPrimaryKey).toBe(false);
  expect(label?.nullable).toBe(true);
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

pgTest('browseTable paginates with $-placeholders and counts', async () => {
  const result = unwrap(await browseTable(source, widget, { page: firstPage(10) }));
  expect(result.total).toBe(25);
  expect(result.rows.rows.length).toBe(10);
  expect(result.rows.truncated).toBe(true);
  expect(result.rows.columns.map((c) => c.name)).toEqual(['id', 'label', 'qty']);
});

pgTest('second page returns the remainder window', async () => {
  const result = unwrap(
    await browseTable(source, widget, { page: { offset: 20, limit: 10 } }),
  );
  expect(result.rows.rows.length).toBe(5);
  expect(result.rows.truncated).toBe(false);
});

pgTest('browse with descending sort orders by the column', async () => {
  const result = unwrap(
    await browseTable(source, widget, {
      page: firstPage(5),
      sort: { column: 'qty', direction: 'desc' },
    }),
  );
  expect(result.rows.rows[0]?.[2]).toBe(25);
  expect(result.rows.rows[4]?.[2]).toBe(21);
});

pgTest('numeric filter narrows rows ($-bound) and count matches', async () => {
  const result = unwrap(
    await browseTable(source, widget, {
      page: firstPage(50),
      filter: { conditions: [{ column: 'qty', op: 'gt', value: '20' }] },
    }),
  );
  expect(result.total).toBe(5);
  expect(result.rows.rows.length).toBe(5);
});

pgTest('contains filter uses ILIKE with a bound value', async () => {
  const result = unwrap(
    await browseTable(source, widget, {
      page: firstPage(50),
      filter: { conditions: [{ column: 'label', op: 'contains', value: '25' }] },
    }),
  );
  expect(result.total).toBe(1);
  expect(result.rows.rows[0]?.[1]).toBe('w25');
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

pgTest('stableKey keeps an unsorted browse in key order across an update', async () => {
  // Without the tiebreaker Postgres returns heap order, where an updated row
  // migrates to the end — the grid row would jump after every save.
  await asRowEditable(source)!.update(
    widget,
    [{ column: 'id', value: 3 }],
    [{ column: 'label', value: 'w3-touched' }],
  );
  const result = unwrap(
    await browseTable(source, widget, { page: firstPage(10), stableKey: ['id'] }),
  );
  expect(result.rows.rows.map((r) => r[0])).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
});

const pgValueAt = async (id: number, column: string): Promise<unknown> => {
  const rs = await asQueryable(source)!.execute(
    sql(`SELECT ${column} FROM widget WHERE id = $1`, [id]),
  );
  return rs.rows[0]?.[0] ?? null;
};

pgTest('update writes one row in a transaction', async () => {
  const r = await asRowEditable(source)!.update(
    widget,
    [{ column: 'id', value: 1 }],
    [{ column: 'label', value: 'updated-1' }],
  );
  expect(r.affected).toBe(1);
  expect(await pgValueAt(1, 'label')).toBe('updated-1');
});

pgTest('non-matching update rolls back (0 rows)', async () => {
  await expect(
    asRowEditable(source)!.update(
      widget,
      [{ column: 'id', value: 99999 }],
      [{ column: 'label', value: 'nope' }],
    ),
  ).rejects.toThrow(/affected 0/);
});

pgTest('insert then delete round-trips a row', async () => {
  const ins = await asRowEditable(source)!.insert(widget, [
    { column: 'label', value: 'temp' },
    { column: 'qty', value: 999 },
  ]);
  expect(ins.affected).toBe(1);

  const created = await asQueryable(source)!.execute(
    sql('SELECT id FROM widget WHERE qty = $1', [999]),
  );
  const id = Number(created.rows[0]?.[0]);
  const del = await asRowEditable(source)!.delete(widget, [
    { column: 'id', value: id },
  ]);
  expect(del.affected).toBe(1);
  expect(await pgValueAt(id, 'label')).toBeNull();
});
