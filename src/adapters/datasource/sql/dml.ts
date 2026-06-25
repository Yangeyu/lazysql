/**
 * Shared, parameter-bound DML builder for INSERT/UPDATE/DELETE. Like
 * whereBuilder, dialects supply identifier quoting and placeholder style; the
 * statement shape lives here once (DRY). Every value is bound — and an UPDATE
 * or DELETE without a key throws, so a stray full-table write is impossible to
 * generate. (Safety by construction.)
 */

import type { RowKey, RowPatch } from '../../../domain/datasource/edit.ts';

export interface Dml {
  readonly text: string;
  readonly params: unknown[];
}

type Quote = (name: string) => string;
type Placeholder = (index: number) => string;

const equals = (
  fields: RowKey | RowPatch,
  params: unknown[],
  quote: Quote,
  ph: Placeholder,
): string[] =>
  fields.map((f) => {
    params.push(f.value);
    return `${quote(f.column)} = ${ph(params.length)}`;
  });

export const buildInsert = (
  qualified: string,
  row: RowPatch,
  quote: Quote,
  ph: Placeholder,
): Dml => {
  if (row.length === 0) throw new Error('cannot INSERT an empty row');
  const params: unknown[] = [];
  const cols = row.map((f) => quote(f.column));
  const vals = row.map((f) => {
    params.push(f.value);
    return ph(params.length);
  });
  return {
    text: `INSERT INTO ${qualified} (${cols.join(', ')}) VALUES (${vals.join(', ')})`,
    params,
  };
};

export const buildUpdate = (
  qualified: string,
  patch: RowPatch,
  key: RowKey,
  quote: Quote,
  ph: Placeholder,
): Dml => {
  if (patch.length === 0) throw new Error('cannot UPDATE with an empty patch');
  if (key.length === 0) throw new Error('refusing to UPDATE without a key');
  const params: unknown[] = [];
  const sets = equals(patch, params, quote, ph);
  const wheres = equals(key, params, quote, ph);
  return {
    text: `UPDATE ${qualified} SET ${sets.join(', ')} WHERE ${wheres.join(' AND ')}`,
    params,
  };
};

export const buildDelete = (
  qualified: string,
  key: RowKey,
  quote: Quote,
  ph: Placeholder,
): Dml => {
  if (key.length === 0) throw new Error('refusing to DELETE without a key');
  const params: unknown[] = [];
  const wheres = equals(key, params, quote, ph);
  return {
    text: `DELETE FROM ${qualified} WHERE ${wheres.join(' AND ')}`,
    params,
  };
};
