/**
 * Schema-aware SQL completion — a pure, tokenizer-based engine (no parser, so it
 * stays robust on the half-written SQL you get while typing). Given the text up
 * to the cursor and (optionally) a catalog, it returns the partial word and
 * ranked candidates chosen by what precedes the cursor:
 *   - a dotted qualifier `x.` → `schema.` lists that schema's tables; `table.` /
 *     `alias.` lists that relation's columns; `schema.table.` lists its columns
 *   - after FROM/JOIN/UPDATE/INTO/TABLE → table names + schema names
 *   - after SCHEMA/DATABASE → schema names
 *   - after CREATE/DROP/ALTER → object kinds (TABLE/VIEW/INDEX…) + table names
 *   - after SELECT/WHERE/AND/ON/, → columns of the referenced tables + keywords
 *   - at the start of a statement → leading verbs (SELECT/INSERT/CREATE/DROP…)
 *   - otherwise → keywords + table names
 *
 * Keyword completion does NOT need a catalog: pass `null` (e.g. before schema
 * introspection finishes) and keywords still complete; schema/table/column
 * candidates join in once the catalog is available. The vocabulary is
 * ANSI/standard SQL so it serves every dialect; dialect-specific words
 * (RETURNING, ILIKE, AUTO_INCREMENT, PRAGMA…) are a planned extension that will
 * flow in from the `Dialect` strategy — see docs/ARCHITECTURE.md §4.3.
 */

export interface SchemaCatalog {
  /** Schema/namespace names (e.g. public, mastra). Empty for schemaless sources. */
  readonly schemas: string[];
  /** Every table name (bare), across schemas — for unqualified completion. */
  readonly tables: string[];
  /** schema → its table names, for `schema.` qualified completion. */
  readonly tablesBySchema: Readonly<Record<string, string[]>>;
  /** Columns keyed by BOTH "schema.table" AND bare "table", so a qualified or an
   *  unqualified reference both resolve. The qualified key is the de-collided
   *  source of truth; the bare key is a best-effort fallback (first schema wins
   *  when a name repeats across schemas). */
  readonly columnsByTable: Readonly<Record<string, string[]>>;
}

export interface Completion {
  /** The partial identifier under the cursor (may be empty). */
  readonly word: string;
  readonly candidates: string[];
}

// ── vocabulary (grouped for maintenance; the union is what gets ranked) ──
const DML_VERBS = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'WITH'];
const DDL_VERBS = ['CREATE', 'ALTER', 'DROP', 'TRUNCATE'];
// The objects a CREATE/DROP/ALTER acts on directly — kept short so the common
// kinds all survive the candidate cap. (COLUMN/CONSTRAINT live in CLAUSES: they
// belong to `ALTER … ADD`, not the verb-object slot.)
const OBJECT_KINDS = [
  'TABLE', 'VIEW', 'INDEX', 'SCHEMA', 'DATABASE', 'SEQUENCE', 'TRIGGER',
];
const CLAUSES = [
  'FROM', 'WHERE', 'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'FULL', 'CROSS',
  'ON', 'USING', 'GROUP', 'ORDER', 'BY', 'HAVING', 'LIMIT', 'OFFSET', 'UNION',
  'INTERSECT', 'EXCEPT', 'INTO', 'VALUES', 'SET', 'AS', 'DISTINCT', 'ALL',
  'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'IF', 'EXISTS', 'CASCADE', 'RESTRICT',
  'PRIMARY', 'KEY', 'FOREIGN', 'REFERENCES', 'UNIQUE', 'CHECK', 'DEFAULT',
  'NOT', 'NULL', 'ADD', 'COLUMN', 'CONSTRAINT', 'AND', 'OR', 'IN', 'LIKE',
  'BETWEEN', 'IS', 'ASC', 'DESC',
];
const FUNCTIONS = [
  'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'COALESCE', 'NULLIF', 'CAST', 'LENGTH',
  'LOWER', 'UPPER', 'ROUND', 'ABS', 'NOW',
];

/** Verbs a statement can start with — ranked first on an empty editor so the
 *  most useful next tokens (SELECT/INSERT/CREATE/DROP…) lead. */
const LEADING = [...DML_VERBS, ...DDL_VERBS];
const KEYWORDS = [
  ...DML_VERBS, ...DDL_VERBS, ...OBJECT_KINDS, ...CLAUSES, ...FUNCTIONS,
];
const KEYWORD_SET = new Set(KEYWORDS);

// ── contexts: the preceding keyword that selects what to suggest ──
const TABLE_CTX = new Set(['FROM', 'JOIN', 'INTO', 'UPDATE', 'TABLE', 'TRUNCATE']);
const SCHEMA_CTX = new Set(['SCHEMA', 'DATABASE']);
const DDL_OBJECT_CTX = new Set(['CREATE', 'DROP', 'ALTER']);
const COLUMN_CTX = new Set([
  'SELECT', 'WHERE', 'AND', 'OR', 'ON', 'SET', 'HAVING', 'BY', 'DISTINCT', 'IN',
  'VALUES',
]);

const WORD_AT_END = /([A-Za-z_][A-Za-z0-9_]*)$/;
// A dotted reference ending at the cursor: the qualifier path (may itself contain
// dots, e.g. `schema.table`) and the partial identifier after the final dot.
const QUALIFIED_AT_END = /([A-Za-z_][A-Za-z0-9_.]*)\.([A-Za-z_][A-Za-z0-9_]*)?$/;
const TOKEN = /[A-Za-z_][A-Za-z0-9_]*|[(),]/g;
// FROM/JOIN <schema.>table [AS] alias — the relation references in scope.
const FROM_RELATION = /\b(?:FROM|JOIN)\s+([A-Za-z_][A-Za-z0-9_.]*)(?:\s+(?:AS\s+)?([A-Za-z_][A-Za-z0-9_]*))?/gi;

const isKeyword = (w: string): boolean => KEYWORD_SET.has(w.toUpperCase());

/** The columnsByTable key for a FROM ref (`schema.table` or `table`): prefer the
 *  ref as-is (de-collided qualified key), else its bare table part. Null if the
 *  relation has no known columns. */
const columnKeyFor = (
  ref: string,
  columnsByTable: Readonly<Record<string, string[]>>,
): string | null => {
  if (columnsByTable[ref]) return ref;
  const bare = ref.includes('.') ? ref.slice(ref.lastIndexOf('.') + 1) : ref;
  return columnsByTable[bare] ? bare : null;
};

/** Relations named in FROM/JOIN: each one's column-key plus any alias. Drives
 *  both column scoping and `alias.`/`table.` column completion. */
const fromRelations = (
  text: string,
  columnsByTable: Readonly<Record<string, string[]>>,
): { key: string; alias?: string }[] => {
  const rels: { key: string; alias?: string }[] = [];
  const re = new RegExp(FROM_RELATION.source, 'gi');
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const key = columnKeyFor(m[1]!, columnsByTable);
    if (!key) continue;
    const alias = m[2] && !isKeyword(m[2]) ? m[2] : undefined;
    rels.push(alias ? { key, alias } : { key });
  }
  return rels;
};

/** Resolve `<path>.` to its candidates: `schema.` → that schema's tables;
 *  `table.` / `schema.table.` → that relation's columns; `alias.` → the aliased
 *  relation's columns. */
const qualifiedCandidates = (
  path: string,
  text: string,
  cat: SchemaCatalog,
): string[] => {
  // `schema.table.` (the path itself is dotted) → that relation's columns.
  if (path.includes('.')) {
    const key = columnKeyFor(path, cat.columnsByTable);
    return key ? (cat.columnsByTable[key] ?? []) : [];
  }
  // A bare qualifier is a schema, a table, or an alias — tried in that order.
  const schemaHit = cat.schemas.find((s) => s.toLowerCase() === path.toLowerCase());
  if (schemaHit) return cat.tablesBySchema[schemaHit] ?? [];
  if (cat.columnsByTable[path]) return cat.columnsByTable[path]!;
  const aliased = fromRelations(text, cat.columnsByTable).find(
    (r) => r.alias?.toLowerCase() === path.toLowerCase(),
  );
  return aliased ? (cat.columnsByTable[aliased.key] ?? []) : [];
};

const finish = (word: string, groups: string[][]): Completion => {
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

const EMPTY: SchemaCatalog = { schemas: [], tables: [], tablesBySchema: {}, columnsByTable: {} };

/**
 * Candidates for the cursor at `caret` in `text` (defaults to end-of-text). The
 * qualifier / partial word / preceding-keyword context come from the text BEFORE
 * the caret, but relation references (FROM/JOIN, for column scoping and alias
 * resolution) are scanned across the WHOLE statement — so `SELECT u.<col> FROM t u`
 * resolves `u` even though its FROM clause sits after the cursor.
 */
export const complete = (
  text: string,
  catalog: SchemaCatalog | null,
  caret: number = text.length,
): Completion => {
  const cat = catalog ?? EMPTY;
  const head = text.slice(0, caret);

  // 1) A dotted qualifier wins — it pins the candidate kind precisely.
  const q = head.match(QUALIFIED_AT_END);
  if (q) {
    return finish(q[2] ?? '', [qualifiedCandidates(q[1]!, text, cat)]);
  }

  // 2) Unqualified: pick the group by the preceding keyword.
  const word = head.match(WORD_AT_END)?.[1] ?? '';
  const before = head.slice(0, head.length - word.length);
  const tokens = before.toUpperCase().match(TOKEN) ?? [];
  const last = tokens[tokens.length - 1];

  let groups: string[][];
  if (last && SCHEMA_CTX.has(last)) {
    groups = [cat.schemas];
  } else if (last && TABLE_CTX.has(last)) {
    // A table OR a schema can follow FROM/JOIN/… — offer both.
    groups = [cat.tables, cat.schemas];
  } else if (last && DDL_OBJECT_CTX.has(last)) {
    groups = [OBJECT_KINDS, cat.tables];
  } else if (last && (COLUMN_CTX.has(last) || last === ',' || last === '(')) {
    const rels = fromRelations(text, cat.columnsByTable);
    const scope = rels.length > 0 ? rels.map((r) => r.key) : cat.tables;
    groups = [scope.flatMap((k) => cat.columnsByTable[k] ?? []), KEYWORDS];
  } else if (tokens.length === 0) {
    // Start of a statement: lead with the verbs a query can open with.
    groups = [LEADING, KEYWORDS, cat.tables];
  } else {
    groups = [KEYWORDS, cat.tables];
  }
  return finish(word, groups);
};
