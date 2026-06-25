import { test, expect } from 'bun:test';
import { generateSql } from './GenerateSql.ts';
import type { SqlGenerator } from '../ports/SqlGenerator.ts';
import { unwrap } from '../../shared/Result.ts';

const fakeGen = (sql: string): SqlGenerator => ({
  generate: async () => ({ sql, explanation: 'because reasons' }),
});

const input = { nl: 'anything', schema: { tables: [] }, dialect: 'SQLite' };

test('generates SQL and classifies a read', async () => {
  const r = unwrap(await generateSql(fakeGen('SELECT 1'), input));
  expect(r.sql).toBe('SELECT 1');
  expect(r.kind).toBe('read');
  expect(r.explanation).toBe('because reasons');
});

test('classifies a generated write', async () => {
  const r = unwrap(await generateSql(fakeGen('UPDATE t SET a = 1'), input));
  expect(r.kind).toBe('write');
});

test('a generator failure becomes an err Result, not a throw', async () => {
  const boom: SqlGenerator = {
    generate: async () => {
      throw new Error('no API key');
    },
  };
  const r = await generateSql(boom, input);
  expect(r.ok).toBe(false);
});
