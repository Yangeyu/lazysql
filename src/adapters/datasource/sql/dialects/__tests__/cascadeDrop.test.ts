/**
 * Dialect-level CASCADE escalation: a DROP refused for `dependent_objects_still
 * _exist` (Postgres SQLSTATE 2BP01) becomes a CASCADE retry; every other failure
 * — and every dialect without the semantics — yields null. Pure, no DB.
 */

import { test, expect } from 'bun:test';
import type { Dialect } from '../../Dialect.ts';
import { PostgresDialect } from '../PostgresDialect.ts';
import { MySqlDialect } from '../MySqlDialect.ts';
import { SqliteDialect } from '../SqliteDialect.ts';
import { QueryError } from '../../../../../domain/errors/errors.ts';

const dependents = new QueryError('cannot drop table widget because other objects depend on it', {
  code: '2BP01',
  detail: 'view order_summary depends on table widget\nview audit depends on table widget',
});

test('Postgres rewrites a dependents-blocked DROP into a CASCADE retry, naming the casualties', () => {
  const pg = new PostgresDialect();
  expect(pg.cascadeDrop('DROP TABLE "public"."widget";', dependents)).toEqual({
    sql: 'DROP TABLE "public"."widget" CASCADE;',
    dependents: ['view order_summary', 'view audit'],
  });
  // Tolerates a missing trailing semicolon.
  expect(pg.cascadeDrop('DROP TABLE "public"."widget"', dependents)?.sql).toBe(
    'DROP TABLE "public"."widget" CASCADE;',
  );
});

test('Postgres declines unrelated errors and non-DROP statements', () => {
  const pg = new PostgresDialect();
  const other = new QueryError('syntax error', { code: '42601' });
  expect(pg.cascadeDrop('DROP TABLE "public"."widget";', other)).toBeNull();
  expect(pg.cascadeDrop('DELETE FROM "widget";', dependents)).toBeNull();
});

test('Postgres still offers the retry when the driver gives no dependent detail', () => {
  const pg = new PostgresDialect();
  const noDetail = new QueryError('cannot drop', { code: '2BP01' });
  expect(pg.cascadeDrop('DROP TABLE "widget";', noDetail)).toEqual({
    sql: 'DROP TABLE "widget" CASCADE;',
    dependents: [],
  });
});

test('MySQL and SQLite never escalate to CASCADE', () => {
  const my: Dialect = new MySqlDialect();
  const lite: Dialect = new SqliteDialect();
  expect(my.cascadeDrop('DROP TABLE `widget`;', dependents)).toBeNull();
  expect(lite.cascadeDrop('DROP TABLE "widget";', dependents)).toBeNull();
});
