/**
 * Dialect-level write-refusal classification: a delete/update refused because
 * the row is still referenced (Postgres SQLSTATE 23503) becomes structured
 * facts for the UI; every other failure — and every dialect without the
 * classification — yields null. Pure, no DB.
 */

import { test, expect } from 'bun:test';
import { PostgresDialect } from '../PostgresDialect.ts';
import { MySqlDialect } from '../MySqlDialect.ts';
import { SqliteDialect } from '../SqliteDialect.ts';
import { DataSourceError, QueryError } from '../../../../../domain/errors/errors.ts';

const referenced = new QueryError(
  'update or delete on table "evidence_cards" violates foreign key constraint "insight_card_evidence_cards_evidence_card_id_fkey" on table "insight_card_evidence_cards"',
  {
    code: '23503',
    detail: 'Key (id)=(42) is still referenced from table "insight_card_evidence_cards".',
  },
);

test('Postgres classifies a still-referenced delete, naming table and key', () => {
  expect(new PostgresDialect().explainWriteError(referenced)).toEqual({
    kind: 'stillReferenced',
    table: 'insight_card_evidence_cards',
    key: '(id)=(42)',
  });
});

test('Postgres falls back to the message when the detail is stripped', () => {
  const noDetail = new QueryError(referenced.message, { code: '23503' });
  expect(new PostgresDialect().explainWriteError(noDetail)).toEqual({
    kind: 'stillReferenced',
    table: 'insight_card_evidence_cards',
  });
});

test('Postgres declines the insert face of 23503 (missing parent, not a block)', () => {
  const missingParent = new QueryError(
    'insert or update on table "child" violates foreign key constraint "child_parent_id_fkey"',
    { code: '23503', detail: 'Key (parent_id)=(7) is not present in table "parent".' },
  );
  expect(new PostgresDialect().explainWriteError(missingParent)).toBeNull();
});

test('Postgres declines unrelated errors and non-query failures', () => {
  const pg = new PostgresDialect();
  expect(pg.explainWriteError(new QueryError('syntax error', { code: '42601' }))).toBeNull();
  expect(pg.explainWriteError(new DataSourceError('boom'))).toBeNull();
});

test('MySQL and SQLite never classify write errors', () => {
  expect(new MySqlDialect().explainWriteError()).toBeNull();
  expect(new SqliteDialect().explainWriteError()).toBeNull();
});
