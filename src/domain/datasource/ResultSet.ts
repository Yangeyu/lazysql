/**
 * Unified result model — the single shape every data source returns, whether
 * the underlying data is tabular (SQL), document (Mongo), or key-value (Redis).
 * The `shape` discriminator lets the presentation layer pick a render strategy
 * without knowing the source type. (See docs/adr/0002.)
 */

import type { JsonKind } from './schema.ts';

export type CellValue = string | number | boolean | null | bigint | Uint8Array;

export interface ColumnMeta {
  readonly name: string;
  /** Source-declared type when known (drives formatting/alignment). */
  readonly dataType?: string;
  /** Declared-JSON marker (see `ColumnDef.jsonKind`), set by the adapter when
   *  it builds the ResultSet — from result metadata for ad-hoc queries, so
   *  browse and query paths carry the same fact. JSON export nests such cells
   *  as native JSON instead of emitting their text as an escaped string. */
  readonly jsonKind?: JsonKind;
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
