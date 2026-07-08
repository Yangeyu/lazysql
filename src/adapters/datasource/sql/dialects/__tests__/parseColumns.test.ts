/**
 * Pure parseColumns tests for the dialect-declared `jsonCanonical` marker:
 * only types the database normalizes on write may carry it (Postgres jsonb,
 * MySQL json) — Postgres `json` keeps its text verbatim and must not.
 */

import { test, expect } from 'bun:test';
import { PostgresDialect } from '../PostgresDialect.ts';
import { MySqlDialect } from '../MySqlDialect.ts';

test('Postgres marks jsonb columns jsonCanonical — json stays verbatim', () => {
  const raw = {
    columns: ['column_name', 'data_type', 'is_nullable', 'is_pk'],
    rows: [
      ['id', 'integer', 'NO', true],
      ['doc', 'jsonb', 'YES', false],
      ['doc_text', 'json', 'YES', false],
    ],
  };
  const cols = new PostgresDialect().parseColumns(raw);
  expect(cols.find((c) => c.name === 'doc')?.jsonCanonical).toBe(true);
  expect(cols.find((c) => c.name === 'doc_text')?.jsonCanonical).toBeUndefined();
  expect(cols.find((c) => c.name === 'id')?.jsonCanonical).toBeUndefined();
});

test('MySQL marks json columns jsonCanonical', () => {
  const raw = {
    columns: ['column_name', 'data_type', 'is_nullable', 'column_key'],
    rows: [
      ['id', 'int', 'NO', 'PRI'],
      ['doc', 'json', 'YES', ''],
    ],
  };
  const cols = new MySqlDialect().parseColumns(raw);
  expect(cols.find((c) => c.name === 'doc')?.jsonCanonical).toBe(true);
  expect(cols.find((c) => c.name === 'id')?.jsonCanonical).toBeUndefined();
});

test('Postgres resolves an enum column to its type name + allowed values', () => {
  const raw = {
    columns: ['column_name', 'data_type', 'udt_name', 'is_nullable', 'is_pk', 'enum_values'],
    rows: [
      ['id', 'integer', 'int4', 'NO', true, []],
      ['status', 'USER-DEFINED', 'mood', 'NO', false, ['sad', 'ok', 'happy']],
    ],
  };
  const cols = new PostgresDialect().parseColumns(raw);
  const status = cols.find((c) => c.name === 'status');
  expect(status?.dataType).toBe('mood'); // not the opaque 'USER-DEFINED'
  expect(status?.enumValues).toEqual(['sad', 'ok', 'happy']);
  expect(cols.find((c) => c.name === 'id')?.enumValues).toBeUndefined();
});

test('MySQL extracts ENUM values from column_type, honoring quotes and commas', () => {
  const raw = {
    columns: ['column_name', 'data_type', 'column_type', 'is_nullable', 'column_key'],
    rows: [
      ['id', 'int', 'int', 'NO', 'PRI'],
      ['status', 'enum', "enum('a,b','it''s')", 'NO', ''],
    ],
  };
  const cols = new MySqlDialect().parseColumns(raw);
  expect(cols.find((c) => c.name === 'status')?.enumValues).toEqual(['a,b', "it's"]);
  expect(cols.find((c) => c.name === 'id')?.enumValues).toBeUndefined();
});
