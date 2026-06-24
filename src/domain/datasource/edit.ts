/**
 * Row-editing value objects. A `RowKey` identifies exactly one row (its primary
 * key columns + values); a `RowPatch` is the set of columns to write. Keeping
 * them as explicit column/value pairs lets adapters bind every value as a
 * parameter and refuse any write without a key. (Safety by construction.)
 */

export interface FieldValue {
  readonly column: string;
  readonly value: unknown;
}

/** Primary-key columns + values that locate a single row. */
export type RowKey = ReadonlyArray<FieldValue>;

/** Columns to assign (UPDATE SET ... / INSERT ... VALUES ...). */
export type RowPatch = ReadonlyArray<FieldValue>;

export interface EditResult {
  readonly affected: number;
}
