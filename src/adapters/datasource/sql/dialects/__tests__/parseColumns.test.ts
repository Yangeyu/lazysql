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
