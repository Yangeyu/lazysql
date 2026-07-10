/**
 * Redis adapter contract test — the capability model's litmus test on a
 * key/value store. The interesting assertions are the ABSENCES: Redis declares
 * Browse + SchemaIntrospect + RowEdit but NOT Query (no SQL) and NOT Transaction
 * (no rollback), and the guards reflect that. Browsing returns the 'keyvalue'
 * ResultSet shape. Skips automatically when no Redis is reachable.
 *
 * Bring a server up with:
 *   docker compose -f docker-compose.test.yml up -d --wait redis
 */

import { test, expect, beforeAll, afterAll } from 'bun:test';
import { RedisClient } from 'bun';
import { createDataSource } from '../../registry.ts';
import type { ConnectionProfile } from '../../../../domain/connection/ConnectionProfile.ts';
import type { DataSource } from '../../../../domain/datasource/DataSource.ts';
import {
  asIntrospectable,
  asBrowsable,
  asQueryable,
  asRowEditable,
  asTransactional,
} from '../../../../domain/datasource/DataSource.ts';
import { Capability } from '../../../../domain/datasource/capabilities.ts';
import { browseTable } from '../../../../application/usecases/BrowseTable.ts';
import { updateRow, deleteRow } from '../../../../application/usecases/EditRow.ts';
import { unwrap } from '../../../../shared/Result.ts';
import { firstPage } from '../../../../domain/query/Query.ts';
import type { ObjectRef } from '../../../../domain/datasource/schema.ts';

const REDIS_URL = process.env.LAZYSQL_REDIS_URL ?? 'redis://localhost:6379';

const profile: ConnectionProfile = {
  id: 'redis-test',
  name: 'redis-test',
  driver: 'redis',
  options: { url: REDIS_URL },
};

const userKs: ObjectRef = { name: 'user', kind: 'keyspace' };

const probe = async (): Promise<boolean> => {
  try {
    const c = new RedisClient(REDIS_URL, {
      connectionTimeout: 1500,
      autoReconnect: false,
      enableOfflineQueue: false,
    });
    await c.connect();
    await c.send('PING', []);
    c.close();
    return true;
  } catch {
    return false;
  }
};

const available = await probe();
const redisTest = test.skipIf(!available);
if (!available) {
  console.warn(`⚠ Redis not reachable at ${REDIS_URL} — skipping Redis suite`);
}

let source: DataSource;

beforeAll(async () => {
  if (!available) return;
  // Seed an isolated dataset (FLUSHDB scopes to the selected db only).
  const seed = new RedisClient(REDIS_URL);
  await seed.connect();
  await seed.send('FLUSHDB', []);
  await seed.set('user:1', 'alice');
  await seed.set('user:2', 'bob');
  await seed.set('session:abc', 'token-xyz');
  await seed.set('plainkey', 'hello');
  await seed.send('HSET', ['user:profile', 'name', 'carol', 'age', '30']);
  seed.close();

  source = unwrap(await createDataSource(profile));
  unwrap(await source.connect());
});

afterAll(async () => {
  if (source) await source.disconnect();
});

redisTest('declares Browse/SchemaIntrospect/RowEdit but NOT Query/Transaction', () => {
  const caps = source.capabilities();
  expect(caps.has(Capability.Browse)).toBe(true);
  expect(caps.has(Capability.SchemaIntrospect)).toBe(true);
  expect(caps.has(Capability.RowEdit)).toBe(true);
  expect(caps.has(Capability.Query)).toBe(false);
  expect(caps.has(Capability.Transaction)).toBe(false);
});

redisTest('guards reflect the declared capabilities', () => {
  expect(asBrowsable(source)).not.toBeNull();
  expect(asIntrospectable(source)).not.toBeNull();
  expect(asRowEditable(source)).not.toBeNull();
  // The litmus point: a KV store is neither SQL-queryable nor transactional.
  expect(asQueryable(source)).toBeNull();
  expect(asTransactional(source)).toBeNull();
});

redisTest('introspect groups keys into keyspaces by prefix', async () => {
  const snap = await asIntrospectable(source)!.introspect();
  const names = snap.objects.map((o) => o.name);
  expect(names).toContain('user');
  expect(names).toContain('session');
  expect(names).toContain('(root)'); // 'plainkey' has no ':' prefix
  expect(snap.objects.every((o) => o.kind === 'keyspace')).toBe(true);
});

redisTest('browse returns a keyvalue ResultSet for one keyspace', async () => {
  const res = unwrap(await browseTable(source, userKs, { page: firstPage(100) }));
  expect(res.rows.shape).toBe('keyvalue');
  expect(res.rows.columns.map((c) => c.name)).toEqual(['key', 'type', 'ttl', 'value']);
  const keys = res.rows.rows.map((r) => r[0]).sort();
  expect(keys).toEqual(['user:1', 'user:2', 'user:profile']);
  expect(res.total).toBe(3);
  // a string value previews inline; the hash previews as a summary
  const profileRow = res.rows.rows.find((r) => r[0] === 'user:profile');
  expect(String(profileRow?.[1])).toBe('hash');
  expect(String(profileRow?.[3])).toContain('hash');
});

redisTest('count honours a contains filter on the key', async () => {
  const all = await asBrowsable(source)!.count(userKs);
  expect(all).toBe(3);
  const filtered = await asBrowsable(source)!.count(userKs, {
    conditions: [{ column: 'key', op: 'contains', value: 'profile' }],
  });
  expect(filtered).toBe(1);
});

redisTest('update SETs a string value (RowEdit without a transaction)', async () => {
  const r = unwrap(
    await updateRow(
      source,
      userKs,
      [{ column: 'key', value: 'user:1' }],
      [{ column: 'value', value: 'ALICE' }],
    ),
  );
  expect(r.affected).toBe(1);
  const res = unwrap(await browseTable(source, userKs, { page: firstPage(100) }));
  const row = res.rows.rows.find((x) => x[0] === 'user:1');
  expect(String(row?.[3])).toBe('ALICE');
});

redisTest('delete removes a key by its row key', async () => {
  const r = unwrap(
    await deleteRow(source, userKs, [{ column: 'key', value: 'user:2' }]),
  );
  expect(r.affected).toBe(1);
  expect(await asBrowsable(source)!.count(userKs)).toBe(2);
});
