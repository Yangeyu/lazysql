/**
 * Result-set typing: the RawResult.columnTypes → Dialect.jsonKindOfType →
 * ColumnMeta.jsonKind chain, hermetically (fake driver, real dialects). This is
 * what lets an ad-hoc query's JSON columns export nested, with no schema
 * describe involved.
 */

import { test, expect } from 'bun:test';
import { SqlDataSource } from '../SqlDataSource.ts';
import { PostgresDialect } from '../dialects/PostgresDialect.ts';
import { MySqlDialect } from '../dialects/MySqlDialect.ts';
import { SqliteDialect } from '../dialects/SqliteDialect.ts';
import type { Dialect } from '../Dialect.ts';
import type { RawResult, SqlDriver } from '../Driver.ts';
import { sql } from '../../../../domain/query/Query.ts';

const driverReturning = (raw: RawResult): SqlDriver => ({
  connect: async () => {},
  disconnect: async () => {},
  ping: async () => true,
  run: async () => raw,
  transaction: async (fn) => fn(async () => raw),
});

const columnsOfQuery = async (raw: RawResult, dialect: Dialect) => {
  const source = new SqlDataSource('t', driverReturning(raw), dialect);
  const rs = await source.execute(sql('SELECT 1', []));
  return rs.columns;
};

test('columns are marked from driver-reported types, per dialect', async () => {
  const pg = await columnsOfQuery(
    { columns: ['a', 'b', 'c'], columnTypes: ['jsonb', 'json', null], rows: [] },
    new PostgresDialect(),
  );
  expect(pg).toEqual([
    { name: 'a', jsonKind: 'canonical' },
    { name: 'b', jsonKind: 'verbatim' },
    { name: 'c' },
  ]);

  const my = await columnsOfQuery(
    { columns: ['a', 'b'], columnTypes: ['json', 'varchar'], rows: [] },
    new MySqlDialect(),
  );
  expect(my).toEqual([{ name: 'a', jsonKind: 'canonical' }, { name: 'b' }]);

  const lite = await columnsOfQuery(
    { columns: ['a', 'b'], columnTypes: ['JSON', 'TEXT'], rows: [] },
    new SqliteDialect(),
  );
  expect(lite).toEqual([{ name: 'a', jsonKind: 'verbatim' }, { name: 'b' }]);
});

test('a driver without result metadata degrades to untyped columns', async () => {
  const cols = await columnsOfQuery(
    { columns: ['a'], rows: [['{"x":1}']] },
    new PostgresDialect(),
  );
  expect(cols).toEqual([{ name: 'a' }]); // no metadata → no marker, never a guess
});
