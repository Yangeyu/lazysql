/**
 * Classify a SQL statement by its leading keyword. The TUI uses this to flag
 * generated SQL as a read vs a write vs DDL — the basis for requiring extra
 * care before running anything the LLM produced. (docs/ARCHITECTURE.md §5.2)
 */

export type StatementKind = 'read' | 'write' | 'ddl' | 'other';

const READ = new Set([
  'select', 'with', 'show', 'explain', 'pragma', 'describe', 'desc',
]);
const WRITE = new Set(['insert', 'update', 'delete', 'merge', 'replace', 'upsert']);
const DDL = new Set([
  'create', 'alter', 'drop', 'truncate', 'rename', 'grant', 'revoke', 'comment',
]);

export const classifyStatement = (sql: string): StatementKind => {
  const keyword = sql
    .trim()
    .replace(/^\(+/, '') // strip leading parens of a wrapped SELECT
    .match(/^([a-z]+)/i)?.[1]
    ?.toLowerCase();

  if (!keyword) return 'other';
  if (READ.has(keyword)) return 'read';
  if (WRITE.has(keyword)) return 'write';
  if (DDL.has(keyword)) return 'ddl';
  return 'other';
};

/** Writes and DDL change data/schema — surface a stronger warning for these. */
export const isDestructive = (kind: StatementKind): boolean =>
  kind === 'write' || kind === 'ddl';

/**
 * An UPDATE/DELETE with no WHERE — it rewrites or removes EVERY row, the classic
 * footgun worth a confirm before it runs. Heuristic (not a parser): the leading
 * keyword is update/delete and no `where` token appears. Biased to fail-open — a
 * `where` inside a string literal suppresses the prompt rather than risk nagging
 * on a statement that is in fact qualified.
 */
export const isUnqualifiedWrite = (sql: string): boolean => {
  const keyword = sql
    .trim()
    .match(/^([a-z]+)/i)?.[1]
    ?.toLowerCase();
  if (keyword !== 'update' && keyword !== 'delete') return false;
  return !/\bwhere\b/i.test(sql);
};

/** Why a statement deserves a confirm before it runs from the editor. */
export type DangerKind = 'unqualified-write' | 'drop' | 'truncate';

/**
 * Classify the footgun in a statement, or null if it can run straight off ⏎: an
 * unqualified UPDATE/DELETE (rewrites every row), or a DROP/TRUNCATE (destroys an
 * object or all its data, irreversibly). Returns the structured kind, not prose —
 * the presentation layer owns the wording.
 */
export const dangerKind = (sql: string): DangerKind | null => {
  if (isUnqualifiedWrite(sql)) return 'unqualified-write';
  const keyword = sql
    .trim()
    .match(/^([a-z]+)/i)?.[1]
    ?.toLowerCase();
  if (keyword === 'drop') return 'drop';
  if (keyword === 'truncate') return 'truncate';
  return null;
};
