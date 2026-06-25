import { test, expect } from 'bun:test';
import { classifyStatement, isDestructive } from './classify.ts';

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
