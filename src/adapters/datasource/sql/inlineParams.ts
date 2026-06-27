/**
 * Inline a parameterized Query's bound values into its text — for DISPLAY ONLY.
 *
 * The result is NEVER executed (it echoes the browse statement in the SQL panel),
 * so this is not an injection surface; values are quoted just enough to read well.
 * It keeps the dialect's `browseQuery` as the single source of truth for the
 * statement — the preview is that exact query with its placeholders filled, not a
 * second, hand-written copy that could drift.
 *
 * Both placeholder styles dialects emit are handled in one pass: positional `?`
 * (consumed left to right) and indexed `$n` (Postgres). Generated browse SQL
 * never contains `?`/`$n` inside a literal — values are bound, identifiers quoted
 * with `"` — so a lexer is unnecessary here.
 */

import type { Query } from '../../../domain/query/Query.ts';

/** Render one bound value as a readable SQL literal (display only). */
const literal = (v: unknown): string => {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number' || typeof v === 'bigint') return String(v);
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  return `'${String(v).replace(/'/g, "''")}'`;
};

export const inlineParams = (query: Query): string => {
  const params = query.params ?? [];
  let positional = 0;
  return query.text.replace(/\$(\d+)|\?/g, (_match, indexed?: string) =>
    literal(indexed !== undefined ? params[Number(indexed) - 1] : params[positional++]),
  );
};
