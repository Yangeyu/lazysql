import { test, expect } from 'bun:test';
import {
  classifyStatement,
  dangerKind,
  isDestructive,
  isUnqualifiedWrite,
} from '../classify.ts';

test('classifies reads', () => {
  expect(classifyStatement('SELECT * FROM t')).toBe('read');
  expect(classifyStatement('  with x as (select 1) select * from x')).toBe('read');
  expect(classifyStatement('PRAGMA table_info(t)')).toBe('read');
});

test('classifies writes', () => {
  expect(classifyStatement('UPDATE t SET a = 1')).toBe('write');
  expect(classifyStatement('delete from t where id = 1')).toBe('write');
  expect(classifyStatement('INSERT INTO t VALUES (1)')).toBe('write');
});

test('classifies DDL', () => {
  expect(classifyStatement('DROP TABLE t')).toBe('ddl');
  expect(classifyStatement('create table t (id int)')).toBe('ddl');
  expect(classifyStatement('ALTER TABLE t ADD COLUMN x int')).toBe('ddl');
});

test('isDestructive flags writes and DDL', () => {
  expect(isDestructive('write')).toBe(true);
  expect(isDestructive('ddl')).toBe(true);
  expect(isDestructive('read')).toBe(false);
  expect(isDestructive('other')).toBe(false);
});

test('isUnqualifiedWrite flags UPDATE/DELETE without a WHERE', () => {
  expect(isUnqualifiedWrite('DELETE FROM t')).toBe(true);
  expect(isUnqualifiedWrite('delete from t')).toBe(true);
  expect(isUnqualifiedWrite('UPDATE t SET a = 1')).toBe(true);
  expect(isUnqualifiedWrite('  update t set a = 1  ')).toBe(true);
});

test('isUnqualifiedWrite clears a qualified write', () => {
  expect(isUnqualifiedWrite('DELETE FROM t WHERE id = 1')).toBe(false);
  expect(isUnqualifiedWrite('update t set a = 1 where id = 2')).toBe(false);
});

test('isUnqualifiedWrite ignores non-writes', () => {
  expect(isUnqualifiedWrite('SELECT * FROM t')).toBe(false);
  expect(isUnqualifiedWrite('INSERT INTO t VALUES (1)')).toBe(false);
  expect(isUnqualifiedWrite('TRUNCATE TABLE t')).toBe(false);
});

test('isUnqualifiedWrite fails open when "where" appears as a literal', () => {
  // Heuristic, not a parser: a `where` token anywhere suppresses the prompt
  // rather than risk nagging on a statement that may in fact be qualified.
  expect(isUnqualifiedWrite("UPDATE t SET note = 'go where you like'")).toBe(false);
});

test('dangerKind flags DROP and TRUNCATE', () => {
  expect(dangerKind('DROP TABLE "public"."widget";')).toBe('drop');
  expect(dangerKind('truncate table t')).toBe('truncate');
});

test('dangerKind flags an unqualified write but clears a qualified one', () => {
  expect(dangerKind('DELETE FROM t')).toBe('unqualified-write');
  expect(dangerKind('UPDATE t SET a = 1')).toBe('unqualified-write');
  expect(dangerKind('DELETE FROM t WHERE id = 1')).toBeNull();
});

test('dangerKind clears reads and non-destructive DDL/writes', () => {
  expect(dangerKind('SELECT * FROM t')).toBeNull();
  expect(dangerKind('INSERT INTO t VALUES (1)')).toBeNull();
  expect(dangerKind('CREATE TABLE t (id int)')).toBeNull();
  expect(dangerKind('ALTER TABLE t ADD COLUMN c int')).toBeNull();
});
