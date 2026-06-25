/**
 * Schema-aware SQL completion — a pure, tokenizer-based engine (no parser, so it
 * stays robust on the half-written SQL you get while typing). Given the text up
 * to the cursor and a catalog of tables/columns, it returns the partial word and
 * ranked candidates, chosen by the preceding keyword:
 *   - after FROM/JOIN/UPDATE/INTO → table names
 *   - after SELECT/WHERE/AND/ON/, → columns of the referenced tables + keywords
 *   - otherwise → keywords + table names
 */

export interface SchemaCatalog {
  readonly tables: string[];
  readonly columnsByTable: Readonly<Record<string, string[]>>;
}

export interface Completion {
  /** The partial identifier under the cursor (may be empty). */
  readonly word: string;
  readonly candidates: string[];
}

const KEYWORDS = [
  'SELECT', 'FROM', 'WHERE', 'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'ON',
  'GROUP', 'ORDER', 'BY', 'HAVING', 'LIMIT', 'OFFSET', 'INSERT', 'INTO',
  'VALUES', 'UPDATE', 'SET', 'DELETE', 'AND', 'OR', 'NOT', 'NULL', 'AS',
  'DISTINCT', 'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'LIKE', 'IN', 'BETWEEN',
  'ASC', 'DESC', 'IS',
];

const TABLE_CTX = new Set(['FROM', 'JOIN', 'INTO', 'UPDATE', 'TABLE']);
const COLUMN_CTX = new Set([
  'SELECT', 'WHERE', 'AND', 'OR', 'ON', 'SET', 'HAVING', 'BY', 'DISTINCT', 'IN',
]);

const WORD_AT_END = /([A-Za-z_][A-Za-z0-9_]*)$/;
const TOKEN = /[A-Za-z_][A-Za-z0-9_]*|[(),]/g;
const IDENT = /[A-Za-z_][A-Za-z0-9_]*/g;

/** Tables named after FROM/JOIN — used to scope column suggestions. */
const referencedTables = (text: string, catalog: SchemaCatalog): string[] => {
  const idents = text.match(IDENT) ?? [];
  const refs: string[] = [];
  for (let i = 0; i < idents.length - 1; i++) {
    const kw = idents[i]!.toUpperCase();
    const next = idents[i + 1]!;
    if ((kw === 'FROM' || kw === 'JOIN') && catalog.tables.includes(next)) {
      refs.push(next);
    }
  }
  return refs;
};

export const complete = (
  text: string,
  catalog: SchemaCatalog,
): Completion => {
  const wordMatch = text.match(WORD_AT_END);
  const word = wordMatch?.[1] ?? '';
  const before = text.slice(0, text.length - word.length);
  const tokens = before.toUpperCase().match(TOKEN) ?? [];
  const last = tokens[tokens.length - 1];

  // Ranked groups: earlier groups win. In a column context, schema columns rank
  // above keywords so they aren't buried by case-sensitive alphabetical sort.
  let groups: string[][];
  if (last && TABLE_CTX.has(last)) {
    groups = [catalog.tables];
  } else if (last && (COLUMN_CTX.has(last) || last === ',' || last === '(')) {
    const refs = referencedTables(text, catalog);
    const scope = refs.length > 0 ? refs : catalog.tables;
    groups = [scope.flatMap((t) => catalog.columnsByTable[t] ?? []), KEYWORDS];
  } else {
    groups = [KEYWORDS, catalog.tables];
  }

  const prefix = word.toLowerCase();
  const rank = (list: string[]): string[] => {
    const sorted = [...new Set(list)].sort((a, b) =>
      a.toLowerCase().localeCompare(b.toLowerCase()),
    );
    return prefix
      ? sorted.filter(
          (c) => c.toLowerCase().startsWith(prefix) && c.toLowerCase() !== prefix,
        )
      : sorted;
  };

  const candidates = groups.flatMap(rank);
  return { word, candidates: [...new Set(candidates)].slice(0, 8) };
};
