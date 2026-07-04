/**
 * Dialect browse-SQL generation — pure unit tests (no database) for the two
 * browse-window guarantees: a `contains` filter must work on non-text columns
 * (Postgres casts to text; LIKE dialects coerce natively), and `stableKey`
 * must append a deterministic ORDER BY tiebreaker.
 */

import { test, expect } from 'bun:test';
import { PostgresDialect } from '../dialects/PostgresDialect.ts';
import { MySqlDialect } from '../dialects/MySqlDialect.ts';
import { SqliteDialect } from '../dialects/SqliteDialect.ts';
import { firstPage } from '../../../../domain/query/Query.ts';
import type { ObjectRef } from '../../../../domain/datasource/schema.ts';

const ref: ObjectRef = { namespace: 'public', name: 't', kind: 'table' };
const containsId = {
  conditions: [{ column: 'id', op: 'contains' as const, value: '6c52' }],
};

test('postgres contains filter casts the column to text for ILIKE', () => {
  const q = new PostgresDialect().browseQuery(ref, {
    page: firstPage(10),
    filter: containsId,
  });
  expect(q.text).toContain('"id"::text ILIKE $1');
  expect(q.params?.[0]).toBe('%6c52%');
});

test('mysql and sqlite contains filters stay plain LIKE', () => {
  const my = new MySqlDialect().browseQuery(ref, { page: firstPage(10), filter: containsId });
  expect(my.text).toContain('`id` LIKE ?');
  const lite = new SqliteDialect().browseQuery({ name: 't', kind: 'table' }, { page: firstPage(10), filter: containsId });
  expect(lite.text).toContain('"id" LIKE ?');
});

test('stableKey alone orders an unsorted browse by the key', () => {
  const q = new PostgresDialect().browseQuery(ref, {
    page: firstPage(10),
    stableKey: ['id'],
  });
  expect(q.text).toContain(' ORDER BY "id" LIMIT');
});

test('stableKey appends as tiebreaker after the sort, skipping the sorted column', () => {
  const q = new PostgresDialect().browseQuery(ref, {
    page: firstPage(10),
    sort: { column: 'qty', direction: 'desc' },
    stableKey: ['qty', 'id'],
  });
  expect(q.text).toContain(' ORDER BY "qty" DESC, "id" LIMIT');
});

test('no sort and no stableKey emits no ORDER BY', () => {
  const q = new MySqlDialect().browseQuery(ref, { page: firstPage(10) });
  expect(q.text).not.toContain('ORDER BY');
});
