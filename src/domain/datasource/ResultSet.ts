/**
 * Unified result model — the single shape every data source returns, whether
 * the underlying data is tabular (SQL), document (Mongo), or key-value (Redis).
 * The `shape` discriminator lets the presentation layer pick a render strategy
 * without knowing the source type. (See docs/adr/0002.)
 */

export type CellValue = string | number | boolean | null | bigint | Uint8Array;

export interface ColumnMeta {
  readonly name: string;
  /** Source-declared type when known (drives formatting/alignment). */
  readonly dataType?: string;
}

/** A row is a positional array of cells aligned to `columns`. */
export type Row = ReadonlyArray<CellValue>;

export type ResultShape = 'tabular' | 'document' | 'keyvalue';

export interface ResultSet {
  readonly shape: ResultShape;
  readonly columns: ColumnMeta[];
  readonly rows: Row[];
  /** Rows affected by a write; undefined for reads. */
  readonly affected?: number;
  /** True if the source returned more rows than requested (paged/cursored). */
  readonly truncated: boolean;
  /** Server-side execution time in ms, when measurable. */
  readonly elapsedMs?: number;
}
