/**
 * RowFormatter — serialize a ResultSet incrementally so exports stream: `begin`
 * once (header / opening), `rows` per chunk, `end` once (closing). Pure over the
 * domain ResultSet types (no IO); an Exporter port writes the returned strings.
 *
 * Instances are SINGLE-USE and STATEFUL across their begin → rows* → end
 * lifecycle (JSON tracks whether a separating comma is due). Take a fresh one per
 * export from `formatterFor`; a new output format is a new formatter and callers
 * don't change (Strategy). See docs/adr/0012.
 */

import type { CellValue, ColumnMeta, Row } from '../datasource/ResultSet.ts';
import type { ObjectRef } from '../datasource/schema.ts';

export type ExportFormat = 'csv' | 'json' | 'sql';

export interface RowFormatter {
  /** File extension for the format, without the dot (e.g. 'csv'). */
  readonly extension: string;
  begin(columns: readonly ColumnMeta[]): string;
  rows(chunk: readonly Row[], columns: readonly ColumnMeta[]): string;
  end(): string;
}

/**
 * CombinedFormatter — serialize SEVERAL tables into ONE file (a batch export of
 * a whole schema / a marked set). Same single-use/stateful lifecycle as
 * RowFormatter but with a table tier: `fileBegin` once, then per table
 * `tableBegin → rows* → tableEnd`, then `fileEnd`. `first` gates the leading
 * separator (e.g. the comma between JSON tables). CSV has none — its columns
 * differ per table so it can't share a file (exported one-file-per-table
 * instead); JSON nests tables in an object, SQL concatenates INSERT blocks.
 */
export interface CombinedFormatter {
  readonly extension: string;
  fileBegin(): string;
  tableBegin(ref: ObjectRef, columns: readonly ColumnMeta[], first: boolean): string;
  rows(chunk: readonly Row[], columns: readonly ColumnMeta[]): string;
  tableEnd(): string;
  fileEnd(): string;
}

/** Dotted, schema-qualified table name for a combined file's section label. */
const qualified = (ref: ObjectRef): string =>
  ref.namespace ? `${ref.namespace}.${ref.name}` : ref.name;

/** Full lowercase hex of a byte value — export keeps the whole value (unlike the
 *  UI's truncated preview), so a round-trip never silently drops bytes. */
const hex = (b: Uint8Array): string =>
  Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

/** RFC 4180 field: quote when it contains a comma, quote or newline; escape
 *  embedded quotes by doubling. `null` is the empty field (distinct from ""). */
const csvCell = (v: CellValue): string => {
  if (v === null) return '';
  if (v instanceof Uint8Array) return hex(v);
  const s = typeof v === 'bigint' ? v.toString() : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** A JSON-safe scalar: bigint → string (avoid precision loss / JSON throwing),
 *  binary → hex string; string/number/boolean/null pass through. */
const jsonScalar = (v: CellValue): string | number | boolean | null => {
  if (v === null) return null;
  if (v instanceof Uint8Array) return hex(v);
  if (typeof v === 'bigint') return v.toString();
  return v;
};

const csvFormatter = (): RowFormatter => ({
  extension: 'csv',
  begin: (columns) => columns.map((c) => csvCell(c.name)).join(',') + '\n',
  rows: (chunk, columns) =>
    chunk
      .map((row) => columns.map((_, i) => csvCell(row[i] ?? null)).join(','))
      .join('\n') + (chunk.length > 0 ? '\n' : ''),
  end: () => '',
});

/** Parse a declared-JSON cell's text so it exports as a nested document rather
 *  than an escaped string. Malformed text (possible under SQLite's loose
 *  typing) stays a plain string, so the export file is always valid JSON. */
const jsonDocument = (s: string): unknown => {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
};

/** One row as a JSON object keyed by column name — the shared serialization for
 *  the single-table array and the combined per-table arrays. Only a column
 *  DECLARED as JSON (`ColumnMeta.jsonKind`) nests; text that merely looks like
 *  JSON stays a string, so round-trips never change data semantics. */
const jsonObject = (row: Row, columns: readonly ColumnMeta[]): string => {
  const obj: Record<string, unknown> = {};
  columns.forEach((c, i) => {
    const v = row[i] ?? null;
    obj[c.name] = c.jsonKind && typeof v === 'string' ? jsonDocument(v) : jsonScalar(v);
  });
  return JSON.stringify(obj);
};

const jsonFormatter = (): RowFormatter => {
  let wrote = false; // a comma precedes every object after the first
  return {
    extension: 'json',
    begin: () => '[',
    rows: (chunk, columns) => {
      let out = '';
      for (const row of chunk) {
        out += (wrote ? ',' : '') + '\n  ' + jsonObject(row, columns);
        wrote = true;
      }
      return out;
    },
    end: () => (wrote ? '\n]\n' : ']\n'),
  };
};

/** CSV/JSON come from a fixed pure formatter. SQL is dialect-driven, so it's
 *  built separately via `sqlFormatter` (fed the source's `insertDump`). */
export const formatterFor = (format: 'csv' | 'json'): RowFormatter =>
  format === 'json' ? jsonFormatter() : csvFormatter();

/** SQL dump formatter: each chunk becomes `INSERT` statements via `dump` (the
 *  source's dialect-driven renderer). No header/footer — a flat statement list,
 *  so multiple tables concatenate into one runnable file. */
export const sqlFormatter = (
  dump: (columns: readonly ColumnMeta[], rows: readonly Row[]) => string,
): RowFormatter => ({
  extension: 'sql',
  begin: () => '',
  rows: (chunk, columns) => (chunk.length > 0 ? dump(columns, chunk) + '\n' : ''),
  end: () => '',
});

/** Combined JSON: a top-level object keyed by qualified table name, each holding
 *  that table's row array — `{ "public.users": [ {…}, … ], "public.orders": [ … ] }`. */
export const jsonCombinedFormatter = (): CombinedFormatter => {
  let firstRow = true; // reset at each table; gates the comma between rows
  return {
    extension: 'json',
    fileBegin: () => '{',
    tableBegin: (ref, _columns, first) => {
      firstRow = true;
      return `${first ? '' : ','}\n  ${JSON.stringify(qualified(ref))}: [`;
    },
    rows: (chunk, columns) => {
      let out = '';
      for (const row of chunk) {
        out += (firstRow ? '' : ',') + '\n    ' + jsonObject(row, columns);
        firstRow = false;
      }
      return out;
    },
    tableEnd: () => '\n  ]',
    fileEnd: () => '\n}\n',
  };
};

/** Combined SQL: each table's `INSERT` block, concatenated under a `-- name`
 *  comment. Statements are independent, so no wrapper/separators — the file runs
 *  as-is against a DB that already has the tables. `dump` is the source's
 *  dialect-driven renderer (per table, so it takes the ref). */
export const sqlCombinedFormatter = (
  dump: (ref: ObjectRef, columns: readonly ColumnMeta[], rows: readonly Row[]) => string,
): CombinedFormatter => {
  let current: ObjectRef | null = null;
  return {
    extension: 'sql',
    fileBegin: () => '',
    tableBegin: (ref, _columns, first) => {
      current = ref;
      return `${first ? '' : '\n'}-- ${qualified(ref)}\n`;
    },
    rows: (chunk, columns) =>
      chunk.length > 0 && current ? dump(current, columns, chunk) + '\n' : '',
    tableEnd: () => '',
    fileEnd: () => '',
  };
};
