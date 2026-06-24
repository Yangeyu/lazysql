/**
 * Shared WHERE-clause builder for SQL dialects. Conditions are AND-combined and
 * every value is bound as a parameter (never interpolated), so this is the
 * injection-safe path. Dialects differ only in placeholder style (`?` vs `$n`)
 * and the case-insensitive substring keyword (LIKE vs ILIKE), which they pass
 * in — keeping the operator mapping in one place (DRY across dialects).
 */

import type { Filter } from '../../../domain/query/Query.ts';

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
  containsKeyword: 'LIKE' | 'ILIKE',
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
      return `${col} ${containsKeyword} ${ph}`;
    }
    params.push(c.value);
    return `${col} ${COMPARISON[c.op] ?? '='} ${ph}`;
  });
  return { clause: ` WHERE ${parts.join(' AND ')}`, params };
};
