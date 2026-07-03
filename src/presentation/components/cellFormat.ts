/**
 * Pure formatters for the cell inspector: turn a raw cell value into a typed,
 * line-oriented view, and pretty-print JSON text WITHOUT altering its tokens
 * (`prettyJson`). Kept renderer-free so it is unit-testable.
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

/** True when the text parses as JSON (any value, not just object/array). */
export const isJsonText = (s: string): boolean => {
  try {
    JSON.parse(s);
    return true;
  } catch {
    return false;
  }
};

/**
 * Whitespace-only JSON pretty-printer. Returns the re-laid-out text when the
 * input is a valid JSON object/array, or null when it isn't (callers keep the
 * raw text). Tokens are copied VERBATIM — never through JSON.parse→stringify —
 * so numbers beyond 2^53 keep their digits and escapes stay as written; only
 * the whitespace BETWEEN tokens changes. Idempotent.
 */
export const prettyJson = (text: string): string | null => {
  const t = text.trim();
  if (!looksLikeJson(t) || !isJsonText(t)) return null;
  return layoutTokens(tokenize(t));
};

/** Split valid JSON into verbatim tokens: strings, atoms, and `{}[]:,`. */
const tokenize = (t: string): string[] => {
  const tokens: string[] = [];
  let i = 0;
  while (i < t.length) {
    const c = t.charAt(i);
    if (c === '"') {
      let j = i + 1;
      while (j < t.length && t.charAt(j) !== '"') j += t.charAt(j) === '\\' ? 2 : 1;
      tokens.push(t.slice(i, j + 1));
      i = j + 1;
    } else if ('{}[]:,'.includes(c)) {
      tokens.push(c);
      i += 1;
    } else if (/\s/.test(c)) {
      i += 1;
    } else {
      let j = i;
      while (j < t.length && !'{}[]:,"'.includes(t.charAt(j)) && !/\s/.test(t.charAt(j))) j += 1;
      tokens.push(t.slice(i, j));
      i = j;
    }
  }
  return tokens;
};

const layoutTokens = (tokens: readonly string[]): string => {
  const lines: string[] = [];
  let depth = 0;
  let line = '';
  const flush = (): void => {
    lines.push(line);
    line = '  '.repeat(depth);
  };
  for (let i = 0; i < tokens.length; i += 1) {
    const tok = tokens[i] ?? '';
    if (tok === '{' || tok === '[') {
      const close = tok === '{' ? '}' : ']';
      if (tokens[i + 1] === close) {
        line += tok + close; // empty container stays compact
        i += 1;
      } else {
        line += tok;
        depth += 1;
        flush();
      }
    } else if (tok === '}' || tok === ']') {
      depth = Math.max(0, depth - 1);
      flush();
      line += tok;
    } else if (tok === ',') {
      line += tok;
      flush();
    } else if (tok === ':') {
      line += ': ';
    } else {
      line += tok;
    }
  }
  lines.push(line);
  return lines.join('\n');
};

export const formatCellValue = (value: CellValue): FormattedCell => {
  if (value === null) return { type: 'null', lines: ['∅  (null)'] };

  if (value instanceof Uint8Array) {
    return { type: `blob · ${value.length} bytes`, lines: [hexPreview(value)] };
  }

  if (typeof value === 'string') {
    const pretty = prettyJson(value);
    if (pretty !== null) return { type: 'json', lines: pretty.split('\n') };
    return { type: `text · ${value.length} chars`, lines: value.split('\n') };
  }

  // number / boolean / bigint
  return { type: typeof value, lines: [String(value)] };
};

/**
 * The RAW editable text for a cell — what seeds the edit <textarea>. Unlike
 * `formatCellValue`, it does NOT pretty-print: JSON text is kept verbatim so
 * saving never silently reformats a text column's bytes (ADR 0011). `null`
 * becomes an empty draft (the null/empty-string distinction is not preserved —
 * a known limitation, as with the previous inline editor). Callers gate out
 * binary values before editing; a blob here degrades to its hex preview.
 */
export const cellEditText = (value: CellValue): string => {
  if (value === null) return '';
  if (value instanceof Uint8Array) return hexPreview(value);
  return String(value);
};

/** Compact hex preview of a blob's first bytes. */
const hexPreview = (bytes: Uint8Array): string => {
  const head = Array.from(bytes.slice(0, 64))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join(' ');
  return bytes.length > 64 ? `${head} …` : head;
};
