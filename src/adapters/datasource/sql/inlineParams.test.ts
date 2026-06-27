/**
 * inlineParams renders a parameterized Query as readable, value-complete SQL for
 * the editor's browse echo. It must handle both placeholder styles dialects emit
 * and quote values safely enough to read (display only — never executed).
 */

import { test, expect } from 'bun:test';
import { inlineParams } from './inlineParams.ts';
import { sql } from '../../../domain/query/Query.ts';

test('inlines positional ? placeholders left to right', () => {
  expect(
    inlineParams(
      sql('SELECT * FROM "t" WHERE "c" LIKE ? LIMIT ? OFFSET ?', ['%foo%', 100, 0]),
    ),
  ).toBe(`SELECT * FROM "t" WHERE "c" LIKE '%foo%' LIMIT 100 OFFSET 0`);
});

test('inlines indexed $n placeholders by their number', () => {
  expect(
    inlineParams(
      sql('SELECT * FROM "t" WHERE "c" ILIKE $1 LIMIT $2 OFFSET $3', ['%bar%', 50, 10]),
    ),
  ).toBe(`SELECT * FROM "t" WHERE "c" ILIKE '%bar%' LIMIT 50 OFFSET 10`);
});

test('escapes single quotes and renders non-strings as literals', () => {
  expect(
    inlineParams(sql('WHERE "c" = ? AND "b" = ? AND "n" = ?', ["O'Brien", true, null])),
  ).toBe(`WHERE "c" = 'O''Brien' AND "b" = TRUE AND "n" = NULL`);
});

test('leaves text untouched when there are no params', () => {
  expect(inlineParams(sql('SELECT 1'))).toBe('SELECT 1');
});
