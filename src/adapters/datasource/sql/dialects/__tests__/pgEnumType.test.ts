/**
 * Postgres enum types as first-class objects: listed for the sidebar, their
 * label set reconstructed as CREATE TYPE for the DDL tab, dropped with a
 * DROP TYPE, and CASCADE-escalated when a column still depends on them — the
 * leftover-enum cleanup a Drizzle teardown misses. Pure, no DB.
 */

import { test, expect } from 'bun:test';
import { PostgresDialect } from '../PostgresDialect.ts';
import type { ObjectRef } from '../../../../../domain/datasource/schema.ts';
import { QueryError } from '../../../../../domain/errors/errors.ts';

const pg = new PostgresDialect();
const moodType: ObjectRef = { namespace: 'public', name: 'mood', kind: 'enum' };

test('listObjectsQuery enumerates enum types (typtype = e) under user schemas', () => {
  const text = pg.listObjectsQuery().text;
  expect(text).toContain("'enum'");
  expect(text).toContain('pg_type');
  expect(text).toContain("t.typtype = 'e'");
});

test('sourceQuery reconstructs CREATE TYPE … AS ENUM from pg_enum, in declared order', () => {
  const q = pg.sourceQuery(moodType);
  expect(q.text).toContain('CREATE TYPE %I.%I AS ENUM');
  expect(q.text).toContain('pg_enum');
  expect(q.text).toContain('e.enumsortorder');
  expect(q.params).toEqual(['public', 'mood']);
});

test('dropQuery emits a quoted, schema-qualified DROP TYPE', () => {
  expect(pg.dropQuery(moodType)?.text).toBe('DROP TYPE "public"."mood";');
});

test('dropQuery returns null for a kind with no standalone DROP (index)', () => {
  expect(pg.dropQuery({ namespace: 'public', name: 'idx_x', kind: 'index' })).toBeNull();
});

test('cascadeDrop escalates a dependents-blocked DROP TYPE to CASCADE', () => {
  const blocked = new QueryError('cannot drop type mood because other objects depend on it', {
    code: '2BP01',
    detail: 'column status of table orders depends on type mood',
  });
  expect(pg.cascadeDrop('DROP TYPE "public"."mood";', blocked)).toEqual({
    sql: 'DROP TYPE "public"."mood" CASCADE;',
    dependents: ['column status of table orders'],
  });
});
