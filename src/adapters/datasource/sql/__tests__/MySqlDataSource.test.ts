/**
 * MySQL adapter tests: probes for a real server (auto-skips when absent),
 * seeds, runs the shared SQL contract (sqlContract.ts — the SAME assertions
 * SQLite and PG run), then the MySQL-specific extras: trigger/procedure
 * introspection with definitions, and json-column canonicality (needs real
 * MySQL 8 — MariaDB's JSON is a LONGTEXT alias that stores text verbatim).
 *
 * Bring one up with:
 *   docker compose -f docker-compose.test.yml up -d --wait mysql
 */

import { test, expect, beforeAll, afterAll } from 'bun:test';
import { createDataSource } from '../../registry.ts';
import { runSqlContract } from './sqlContract.ts';
import type { ConnectionProfile } from '../../../../domain/connection/ConnectionProfile.ts';
import type { DataSource } from '../../../../domain/datasource/DataSource.ts';
import {
  asIntrospectable,
  asQueryable,
} from '../../../../domain/datasource/DataSource.ts';
import { listObjects } from '../../../../application/usecases/ListObjects.ts';
import { unwrap } from '../../../../shared/Result.ts';
import { sql } from '../../../../domain/query/Query.ts';
import type { ObjectRef } from '../../../../domain/datasource/schema.ts';
import { columnsOf } from '../../../../domain/datasource/schema.ts';

const MYSQL_URL =
  process.env.LAZYSQL_MYSQL_URL ??
  'mysql://lazysql:lazysql@localhost:33060/lazysql';

const profile: ConnectionProfile = {
  id: 'mysql-test',
  name: 'mysql-test',
  driver: 'mysql',
  options: { connectionString: MYSQL_URL },
};

const widget: ObjectRef = { namespace: 'lazysql', name: 'widget', kind: 'table' };

const probe = async (): Promise<boolean> => {
  const created = await createDataSource(profile);
  if (!created.ok) return false;
  const connected = await created.value.connect();
  await created.value.disconnect();
  return connected.ok;
};

const available = await probe();
const myTest = test.skipIf(!available);
if (!available) {
  console.warn(`⚠ MySQL not reachable at ${MYSQL_URL} — skipping MySQL suite`);
}

let source: DataSource;

beforeAll(async () => {
  if (!available) return;
  source = unwrap(await createDataSource(profile));
  unwrap(await source.connect());

  const exec = (text: string) => asQueryable(source)!.execute(sql(text));
  await exec('DROP VIEW IF EXISTS pricey');
  await exec('DROP PROCEDURE IF EXISTS inc');
  await exec('DROP TABLE IF EXISTS widget'); // also drops its trigger
  await exec(
    'CREATE TABLE widget (id INT AUTO_INCREMENT PRIMARY KEY, label VARCHAR(255), qty INT)',
  );
  const rows = Array.from({ length: 25 }, (_, i) => `('w${i + 1}', ${i + 1})`).join(',');
  await exec(`INSERT INTO widget (label, qty) VALUES ${rows}`);
  // The non-table kinds MySQL introspects (no indexes — names are per-table).
  await exec('CREATE VIEW pricey AS SELECT id, label FROM widget WHERE qty > 10');
  await exec(
    'CREATE TRIGGER widget_guard BEFORE UPDATE ON widget FOR EACH ROW SET NEW.label = NEW.label',
  );
  // One COM_QUERY carries the whole routine — DELIMITER is a CLI-only concern.
  await exec('CREATE PROCEDURE inc(IN a INT) BEGIN SELECT a + 1; END');
});

afterAll(async () => {
  if (available) await source?.disconnect();
});

runSqlContract({
  available,
  source: () => source,
  widget,
  ph: () => '?',
});

// ── MySQL-specific ──────────────────────────────────────────────────────────

myTest('listObjects surfaces views, triggers and procedures by kind', async () => {
  const objects = unwrap(await listObjects(source));
  const kindOf = (name: string) => objects.find((o) => o.name === name)?.kind;
  expect(kindOf('pricey')).toBe('view');
  expect(kindOf('widget_guard')).toBe('trigger');
  expect(kindOf('inc')).toBe('procedure');
  expect(kindOf('widget')).toBe('table');
});

const mySourceText = async (ref: ObjectRef): Promise<string> => {
  const schema = await asIntrospectable(source)!.describe(ref);
  const s = schema.detail.find((d) => d.kind === 'source');
  return s?.kind === 'source' ? s.text : '';
};

myTest('describe yields triggers and procedures their definition', async () => {
  expect(await mySourceText({ namespace: 'lazysql', name: 'widget_guard', kind: 'trigger' })).toMatch(/UPDATE/i);
  expect(await mySourceText({ namespace: 'lazysql', name: 'inc', kind: 'procedure' })).toMatch(/SELECT/i);
});

myTest('describe marks json columns canonical', async () => {
  const exec = (text: string) => asQueryable(source)!.execute(sql(text));
  await exec('DROP TABLE IF EXISTS jsonshapes');
  await exec('CREATE TABLE jsonshapes (id INT PRIMARY KEY, doc JSON, plain TEXT)');
  try {
    const cols = columnsOf(
      await asIntrospectable(source)!.describe({ namespace: 'lazysql', name: 'jsonshapes', kind: 'table' }),
    );
    expect(cols.find((c) => c.name === 'doc')?.jsonKind).toBe('canonical');
    expect(cols.find((c) => c.name === 'plain')?.jsonKind).toBeUndefined();
  } finally {
    await exec('DROP TABLE jsonshapes');
  }
});
