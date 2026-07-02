/**
 * Render rows as runnable `INSERT` statements (SqlDumpable) — a data dump that
 * imports by running the file. It reuses the dialect's `insertQuery` for the
 * correct, quoted `INSERT INTO … (cols) VALUES (…)` shape, then inlines the bound
 * values as SQL literals here.
 *
 * Unlike `inlineParams` (display-only), these literals must be RUNNABLE, so they
 * cover the full CellValue set: strings are single-quote-escaped, `Uint8Array`
 * becomes a Postgres-style `'\x…'` bytea literal. (Binary syntax is PG-flavoured;
 * a MySQL/SQLite dump would want `X'…'` — a per-dialect override for later.)
 */

import type { Query } from '../../../domain/query/Query.ts';
import type { ObjectRef } from '../../../domain/datasource/schema.ts';
import type { ColumnMeta, Row } from '../../../domain/datasource/ResultSet.ts';
import type { Dialect } from './Dialect.ts';

const dumpLiteral = (v: unknown): string => {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number' || typeof v === 'bigint') return String(v);
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (v instanceof Uint8Array) {
    return `'\\x${Array.from(v, (b) => b.toString(16).padStart(2, '0')).join('')}'`;
  }
  return `'${String(v).replace(/'/g, "''")}'`;
};

/** Fill a parameterized query's `$n`/`?` placeholders with runnable literals. */
const inlineForDump = (query: Query): string => {
  const params = query.params ?? [];
  let positional = 0;
  return query.text.replace(/\$(\d+)|\?/g, (_m, indexed?: string) =>
    dumpLiteral(indexed !== undefined ? params[Number(indexed) - 1] : params[positional++]),
  );
};

export const renderInsertStatements = (
  dialect: Dialect,
  ref: ObjectRef,
  columns: readonly ColumnMeta[],
  rows: readonly Row[],
): string =>
  rows
    .map((row) => {
      const patch = columns.map((c, i) => ({ column: c.name, value: row[i] ?? null }));
      return inlineForDump(dialect.insertQuery(ref, patch)) + ';';
    })
    .join('\n');
