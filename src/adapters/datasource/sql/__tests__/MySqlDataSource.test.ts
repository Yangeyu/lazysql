/**
 * MySQL/MariaDB adapter contract test — the SAME assertions as the SQLite and
 * Postgres suites, against a real server (Docker MariaDB). Three engines passing
 * one contract is the strongest evidence the capability/dialect abstraction
 * holds. Auto-skips when no server is reachable.
 *
 * Bring one up with:
 *   docker run -d --name lazysql-mysql -e MARIADB_ROOT_PASSWORD=root \
 *     -e MARIADB_DATABASE=lazysql -e MARIADB_USER=lazysql -e MARIADB_PASSWORD=lazysql \
 *     -p 33060:3306 mariadb:11
 */

import { test, expect, beforeAll, afterAll } from 'bun:test';
import { createDataSource } from '../../registry.ts';
import type { ConnectionProfile } from '../../../../domain/connection/ConnectionProfile.ts';
import type { DataSource } from '../../../../domain/datasource/DataSource.ts';
import {
  asIntrospectable,
  asQueryable,
  asRowEditable,
} from '../../../../domain/datasource/DataSource.ts';
import { Capability } from '../../../../domain/datasource/capabilities.ts';
import { listObjects } from '../../../../application/usecases/ListObjects.ts';
import { browseTable } from '../../../../application/usecases/BrowseTable.ts';
import { unwrap } from '../../../../shared/Result.ts';
import { firstPage, sql } from '../../../../domain/query/Query.ts';
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
  const created = createDataSource(profile);
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
  source = unwrap(createDataSource(profile));
  unwrap(await source.connect());

  const exec = (text: string) => asQueryable(source)!.execute(sql(text));
  await exec('DROP TABLE IF EXISTS widget');
  await exec(
    'CREATE TABLE widget (id INT AUTO_INCREMENT PRIMARY KEY, label VARCHAR(255), qty INT)',
  );
  const rows = Array.from({ length: 25 }, (_, i) => `('w${i + 1}', ${i + 1})`).join(',');
  await exec(`INSERT INTO widget (label, qty) VALUES ${rows}`);
});

afterAll(async () => {
  if (available) await source?.disconnect();
});

myTest('declares Query/SchemaIntrospect/Browse capabilities', () => {
  const caps = source.capabilities();
  expect(caps.has(Capability.SchemaIntrospect)).toBe(true);
  expect(caps.has(Capability.Browse)).toBe(true);
});

myTest('listObjects finds the table in the current database', async () => {
  const objects = unwrap(await listObjects(source));
  const found = objects.find((o) => o.name === 'widget');
  expect(found).toBeDefined();
  expect(found?.namespace).toBe('lazysql');
});

myTest('describe reports the primary key via COLUMN_KEY', async () => {
  const cols = columnsOf(await asIntrospectable(source)!.describe(widget));
  const id = cols.find((c) => c.name === 'id');
  const label = cols.find((c) => c.name === 'label');
  expect(id?.isPrimaryKey).toBe(true);
  expect(id?.nullable).toBe(false);
  expect(label?.isPrimaryKey).toBe(false);
  expect(label?.nullable).toBe(true);
});

myTest('browse paginates with backtick quoting and counts', async () => {
  const result = unwrap(await browseTable(source, widget, { page: firstPage(10) }));
  expect(result.total).toBe(25);
  expect(result.rows.rows.length).toBe(10);
  expect(result.rows.truncated).toBe(true);
  expect(result.rows.columns.map((c) => c.name)).toEqual(['id', 'label', 'qty']);
});

myTest('descending sort orders by the column', async () => {
  const result = unwrap(
    await browseTable(source, widget, {
      page: firstPage(5),
      sort: { column: 'qty', direction: 'desc' },
    }),
  );
  expect(Number(result.rows.rows[0]?.[2])).toBe(25);
  expect(Number(result.rows.rows[4]?.[2])).toBe(21);
});

myTest('contains filter narrows rows and count (bound value)', async () => {
  const result = unwrap(
    await browseTable(source, widget, {
      page: firstPage(50),
      filter: { conditions: [{ column: 'label', op: 'contains', value: '25' }] },
    }),
  );
  expect(result.total).toBe(1);
  expect(result.rows.rows[0]?.[1]).toBe('w25');
});

const myValueAt = async (id: number, column: string): Promise<unknown> => {
  const rs = await asQueryable(source)!.execute(
    sql(`SELECT ${column} FROM widget WHERE id = ?`, [id]),
  );
  return rs.rows[0]?.[0] ?? null;
};

myTest('update writes one row in a transaction', async () => {
  const r = await asRowEditable(source)!.update(
    widget,
    [{ column: 'id', value: 1 }],
    [{ column: 'label', value: 'updated-1' }],
  );
  expect(r.affected).toBe(1);
  expect(await myValueAt(1, 'label')).toBe('updated-1');
});

myTest('non-matching update rolls back (0 rows)', async () => {
  await expect(
    asRowEditable(source)!.update(
      widget,
      [{ column: 'id', value: 99999 }],
      [{ column: 'label', value: 'nope' }],
    ),
  ).rejects.toThrow(/affected 0/);
});

myTest('insert then delete round-trips a row', async () => {
  const ins = await asRowEditable(source)!.insert(widget, [
    { column: 'label', value: 'temp' },
    { column: 'qty', value: 999 },
  ]);
  expect(ins.affected).toBe(1);

  const created = await asQueryable(source)!.execute(
    sql('SELECT id FROM widget WHERE qty = ?', [999]),
  );
  const id = Number(created.rows[0]?.[0]);
  const del = await asRowEditable(source)!.delete(widget, [
    { column: 'id', value: id },
  ]);
  expect(del.affected).toBe(1);
  expect(await myValueAt(id, 'label')).toBeNull();
});
