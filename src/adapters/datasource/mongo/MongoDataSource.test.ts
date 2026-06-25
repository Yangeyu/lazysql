/**
 * Mongo adapter contract test — the capability model's litmus test on a document
 * store. Like Redis, the telling assertions are the ABSENCES: Browse +
 * SchemaIntrospect + RowEdit but NOT Query and NOT Transaction. Browsing returns
 * the 'document' ResultSet shape with heterogeneous docs flattened into a column
 * union. Skips automatically when no Mongo is reachable.
 *
 * Bring a server up with:
 *   docker run -d --name lazysql-mongo -p 27017:27017 mongo:7
 */

import { test, expect, beforeAll, afterAll } from 'bun:test';
import { MongoClient } from 'mongodb';
import { createDataSource } from '../registry.ts';
import type { ConnectionProfile } from '../../../domain/connection/ConnectionProfile.ts';
import type { DataSource } from '../../../domain/datasource/DataSource.ts';
import {
  asIntrospectable,
  asBrowsable,
  asQueryable,
  asRowEditable,
  asTransactional,
} from '../../../domain/datasource/DataSource.ts';
import { Capability } from '../../../domain/datasource/capabilities.ts';
import { browseTable } from '../../../application/usecases/BrowseTable.ts';
import { updateRow, deleteRow } from '../../../application/usecases/EditRow.ts';
import { unwrap } from '../../../shared/Result.ts';
import { firstPage } from '../../../domain/query/Query.ts';
import type { ObjectRef } from '../../../domain/datasource/schema.ts';

const URI = process.env.LAZYSQL_MONGO_URL ?? 'mongodb://localhost:27017';
const DB = 'lazysql_test';

const profile: ConnectionProfile = {
  id: 'mongo-test',
  name: 'mongo-test',
  driver: 'mongodb',
  options: { uri: URI, database: DB },
};

const widget: ObjectRef = { namespace: DB, name: 'widget', kind: 'collection' };

const probe = async (): Promise<boolean> => {
  try {
    const c = new MongoClient(URI, { serverSelectionTimeoutMS: 1500 });
    await c.connect();
    await c.db(DB).command({ ping: 1 });
    await c.close();
    return true;
  } catch {
    return false;
  }
};

const available = await probe();
const mongoTest = test.skipIf(!available);
if (!available) {
  console.warn(`⚠ Mongo not reachable at ${URI} — skipping Mongo suite`);
}

let source: DataSource;

beforeAll(async () => {
  if (!available) return;
  const seed = new MongoClient(URI);
  await seed.connect();
  await seed.db(DB).dropDatabase();
  await seed.db(DB).collection('widget').insertMany([
    { name: 'alpha', qty: 10, tags: ['a', 'b'] },
    { name: 'beta', qty: 5 },
    { name: 'gamma', qty: 20, meta: { color: 'red' } },
  ]);
  await seed.close();

  source = unwrap(createDataSource(profile));
  unwrap(await source.connect());
});

afterAll(async () => {
  if (source) await source.disconnect();
});

const idOf = async (name: string): Promise<string> => {
  const res = unwrap(await browseTable(source, widget, { page: firstPage(100) }));
  const cols = res.rows.columns.map((c) => c.name);
  const row = res.rows.rows.find((r) => r[cols.indexOf('name')] === name);
  return String(row?.[cols.indexOf('_id')]);
};

mongoTest('declares Browse/SchemaIntrospect/RowEdit but NOT Query/Transaction', () => {
  const caps = source.capabilities();
  expect(caps.has(Capability.Browse)).toBe(true);
  expect(caps.has(Capability.SchemaIntrospect)).toBe(true);
  expect(caps.has(Capability.RowEdit)).toBe(true);
  expect(caps.has(Capability.Query)).toBe(false);
  expect(caps.has(Capability.Transaction)).toBe(false);
});

mongoTest('guards reflect the declared capabilities', () => {
  expect(asBrowsable(source)).not.toBeNull();
  expect(asIntrospectable(source)).not.toBeNull();
  expect(asRowEditable(source)).not.toBeNull();
  expect(asQueryable(source)).toBeNull();
  expect(asTransactional(source)).toBeNull();
});

mongoTest('introspect lists collections', async () => {
  const snap = await asIntrospectable(source)!.introspect();
  expect(snap.objects.map((o) => o.name)).toContain('widget');
  expect(snap.objects.every((o) => o.kind === 'collection')).toBe(true);
});

mongoTest('browse returns a document ResultSet with a column union', async () => {
  const res = unwrap(await browseTable(source, widget, { page: firstPage(100) }));
  expect(res.rows.shape).toBe('document');
  const cols = res.rows.columns.map((c) => c.name);
  expect(cols[0]).toBe('_id'); // _id is always first
  // union of heterogeneous docs: name/qty present, plus the sparse tags/meta
  expect(cols).toContain('name');
  expect(cols).toContain('qty');
  expect(cols).toContain('tags');
  expect(res.total).toBe(3);

  // ObjectId stringifies to 24-hex; a nested array stringifies to JSON.
  const alpha = res.rows.rows.find((r) => r[cols.indexOf('name')] === 'alpha');
  expect(String(alpha?.[0])).toMatch(/^[a-f0-9]{24}$/);
  expect(String(alpha?.[cols.indexOf('tags')])).toBe('["a","b"]');
});

mongoTest('count honours a contains filter', async () => {
  expect(await asBrowsable(source)!.count(widget)).toBe(3);
  const filtered = await asBrowsable(source)!.count(widget, {
    conditions: [{ column: 'name', op: 'contains', value: 'et' }],
  });
  expect(filtered).toBe(1); // only 'beta'
});

mongoTest('update by _id changes one document (no transaction)', async () => {
  const id = await idOf('beta');
  const r = unwrap(
    await updateRow(
      source,
      widget,
      [{ column: '_id', value: id }],
      [{ column: 'qty', value: 99 }],
    ),
  );
  expect(r.affected).toBe(1);
  const res = unwrap(await browseTable(source, widget, { page: firstPage(100) }));
  const cols = res.rows.columns.map((c) => c.name);
  const beta = res.rows.rows.find((x) => x[cols.indexOf('name')] === 'beta');
  expect(beta?.[cols.indexOf('qty')]).toBe(99);
});

mongoTest('delete removes one document by _id', async () => {
  const id = await idOf('gamma');
  const r = unwrap(
    await deleteRow(source, widget, [{ column: '_id', value: id }]),
  );
  expect(r.affected).toBe(1);
  expect(await asBrowsable(source)!.count(widget)).toBe(2);
});
