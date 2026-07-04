/**
 * Shared WHERE / ORDER BY builders for SQL dialects. Conditions are
 * AND-combined and every value is bound as a parameter (never interpolated),
 * so this is the injection-safe path. Dialects differ only in placeholder
 * style (`?` vs `$n`) and how a case-insensitive substring predicate is
 * rendered, which they pass in — keeping the operator mapping in one place
 * (DRY across dialects).
 */

import type { Filter, Sort } from '../../../domain/query/Query.ts';

const COMPARISON: Record<string, string> = {
  eq: '=',
  ne: '<>',
  lt: '<',
  lte: '<=',
  gt: '>',
  gte: '>=',
};

export interface Where {
  /** Includes the leading ` WHERE `, or empty string when no conditions. */
  readonly clause: string;
  readonly params: unknown[];
}

export const buildWhere = (
  filter: Filter | null | undefined,
  quoteIdent: (name: string) => string,
  /** Render the placeholder for the i-th (1-based) bound parameter. */
  placeholder: (index: number) => string,
  /** Render the substring predicate for a quoted column + placeholder, e.g.
   *  `` `col` LIKE ? ``. Postgres casts the column to text first, so non-text
   *  columns (uuid, numeric, jsonb…) accept a substring filter too. */
  contains: (column: string, placeholder: string) => string,
): Where => {
  if (!filter || filter.conditions.length === 0) {
    return { clause: '', params: [] };
  }
  const params: unknown[] = [];
  const parts = filter.conditions.map((c) => {
    const ph = placeholder(params.length + 1);
    const col = quoteIdent(c.column);
    if (c.op === 'contains') {
      params.push(`%${c.value}%`);
      return contains(col, ph);
    }
    params.push(c.value);
    return `${col} ${COMPARISON[c.op] ?? '='} ${ph}`;
  });
  return { clause: ` WHERE ${parts.join(' AND ')}`, params };
};

/** ` ORDER BY …` for a browse window: the user's sort first, then the stable-key
 *  columns (minus the sorted one) ascending as a deterministic tiebreaker — so
 *  paging windows and post-write reloads keep a stable row order. Empty when
 *  there is nothing to order by. */
export const buildOrderBy = (
  sort: Sort | null | undefined,
  stableKey: readonly string[] | undefined,
  quoteIdent: (name: string) => string,
): string => {
  const terms: string[] = [];
  if (sort) terms.push(`${quoteIdent(sort.column)} ${sort.direction.toUpperCase()}`);
  for (const column of stableKey ?? []) {
    if (sort?.column !== column) terms.push(quoteIdent(column));
  }
  return terms.length > 0 ? ` ORDER BY ${terms.join(', ')}` : '';
};
