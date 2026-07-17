/**
 * Pure parseColumns tests for the dialect-declared `jsonKind` marker: presence
 * = the column's declared type is JSON; 'canonical' only for types the
 * database normalizes on write (Postgres jsonb, MySQL json) — Postgres `json`
 * and SQLite declared JSON keep their text verbatim.
 */

import { test, expect } from 'bun:test';
import { PostgresDialect } from '../PostgresDialect.ts';
import { MySqlDialect } from '../MySqlDialect.ts';
import { SqliteDialect } from '../SqliteDialect.ts';

test('Postgres marks jsonb columns canonical — json is verbatim JSON', () => {
  const raw = {
    columns: ['column_name', 'data_type', 'is_nullable', 'is_pk'],
    rows: [
      ['id', 'integer', 'NO', true],
      ['doc', 'jsonb', 'YES', false],
      ['doc_text', 'json', 'YES', false],
    ],
  };
  const cols = new PostgresDialect().parseColumns(raw);
  expect(cols.find((c) => c.name === 'doc')?.jsonKind).toBe('canonical');
  expect(cols.find((c) => c.name === 'doc_text')?.jsonKind).toBe('verbatim');
  expect(cols.find((c) => c.name === 'id')?.jsonKind).toBeUndefined();
});

test('MySQL marks json columns canonical', () => {
  const raw = {
    columns: ['column_name', 'data_type', 'is_nullable', 'column_key'],
    rows: [
      ['id', 'int', 'NO', 'PRI'],
      ['doc', 'json', 'YES', ''],
    ],
  };
  const cols = new MySqlDialect().parseColumns(raw);
  expect(cols.find((c) => c.name === 'doc')?.jsonKind).toBe('canonical');
  expect(cols.find((c) => c.name === 'id')?.jsonKind).toBeUndefined();
});

test('SQLite marks declared JSON/JSONB columns verbatim — TEXT is not JSON', () => {
  const raw = {
    columns: ['name', 'type', 'notnull', 'pk'],
    rows: [
      ['id', 'INTEGER', 1, 1],
      ['doc', 'JSON', 0, 0],
      ['doc_b', 'jsonb', 0, 0],
      ['label', 'TEXT', 0, 0],
    ],
  };
  const cols = new SqliteDialect().parseColumns(raw);
  expect(cols.find((c) => c.name === 'doc')?.jsonKind).toBe('verbatim');
  expect(cols.find((c) => c.name === 'doc_b')?.jsonKind).toBe('verbatim');
  expect(cols.find((c) => c.name === 'label')?.jsonKind).toBeUndefined();
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
