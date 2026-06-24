/**
 * Postgres adapter contract test — the SAME assertions as the SQLite suite,
 * run against a real PostgreSQL server (Docker). That both adapters pass one
 * shared contract is the executable proof of the capability/dialect abstraction
 * (docs/ARCHITECTURE.md §10, adr/0002). Skips automatically when no PG is
 * reachable, so it never breaks a machine without Docker.
 *
 * Bring a server up with:
 *   docker run -d --name lazysql-pg -e POSTGRES_PASSWORD=lazysql \
 *     -e POSTGRES_USER=lazysql -e POSTGRES_DB=lazysql -p 55432:5432 postgres:16-alpine
 */

import { test, expect, beforeAll, afterAll } from 'bun:test';
import { createDataSource } from '../registry.ts';
import type { ConnectionProfile } from '../../../domain/connection/ConnectionProfile.ts';
import type { DataSource } from '../../../domain/datasource/DataSource.ts';
import {
  asIntrospectable,
  asQueryable,
} from '../../../domain/datasource/DataSource.ts';
import { Capability } from '../../../domain/datasource/capabilities.ts';
import { listObjects } from '../../../application/usecases/ListObjects.ts';
import { browseTable } from '../../../application/usecases/BrowseTable.ts';
import { unwrap } from '../../../shared/Result.ts';
import { firstPage, sql } from '../../../domain/query/Query.ts';
import type { ObjectRef } from '../../../domain/datasource/schema.ts';

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
  await exec('DROP TABLE IF EXISTS widget');
  await exec(
    'CREATE TABLE widget (id serial PRIMARY KEY, label text, qty integer)',
  );
  await exec(
    "INSERT INTO widget (label, qty) SELECT 'w' || g, g FROM generate_series(1, 25) g",
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

pgTest('describe reports the primary key and nullability', async () => {
  const introspectable = asIntrospectable(source)!;
  const schema = await introspectable.describe(widget);
  const id = schema.columns.find((c) => c.name === 'id');
  const label = schema.columns.find((c) => c.name === 'label');
  expect(id?.isPrimaryKey).toBe(true);
  expect(id?.nullable).toBe(false);
  expect(label?.isPrimaryKey).toBe(false);
  expect(label?.nullable).toBe(true);
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
