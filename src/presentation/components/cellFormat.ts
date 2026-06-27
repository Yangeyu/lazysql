/**
 * Pure formatter for the cell inspector: turn a raw cell value into a typed,
 * line-oriented view. JSON text (objects/arrays) is pretty-printed structurally;
 * everything else is shown faithfully. Kept renderer-free so it is unit-testable.
 */

import type { CellValue } from '../../domain/datasource/ResultSet.ts';

export interface FormattedCell {
  /** Human label of the detected type, e.g. `json`, `text (1.2k chars)`. */
  readonly type: string;
  /** The value split into display lines. */
  readonly lines: string[];
}

const looksLikeJson = (s: string): boolean => {
  const t = s.trim();
  return (
    (t.startsWith('{') && t.endsWith('}')) ||
    (t.startsWith('[') && t.endsWith(']'))
  );
};

export const formatCellValue = (value: CellValue): FormattedCell => {
  if (value === null) return { type: 'null', lines: ['∅  (null)'] };

  if (value instanceof Uint8Array) {
    return { type: `blob · ${value.length} bytes`, lines: [hexPreview(value)] };
  }

  if (typeof value === 'string') {
    if (looksLikeJson(value)) {
      try {
        const pretty = JSON.stringify(JSON.parse(value), null, 2);
        return { type: 'json', lines: pretty.split('\n') };
      } catch {
        /* not valid JSON after all → fall through to plain text */
      }
    }
    return { type: `text · ${value.length} chars`, lines: value.split('\n') };
  }

  // number / boolean / bigint
  return { type: typeof value, lines: [String(value)] };
};

/** Compact hex preview of a blob's first bytes. */
const hexPreview = (bytes: Uint8Array): string => {
  const head = Array.from(bytes.slice(0, 64))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join(' ');
  return bytes.length > 64 ? `${head} …` : head;
};
