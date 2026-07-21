/**
 * Shared prompt construction for SqlGenerator adapters. Kept provider-neutral so
 * every LLM backend (Claude, Qwen, …) phrases the NL→SQL task identically — the
 * only thing that varies per provider is the transport/SDK, not the instruction.
 *
 * Identifiers are rendered pre-quoted so the model copies a runnable token
 * verbatim instead of having to infer a dialect's case-folding rules — a bare
 * `createdAt` fed to Postgres folds to `createdat` and fails. The only dialect
 * signal this path has is the label string; the real `Dialect` strategy (with
 * its own `quoteIdent`) lives in the datasource adapter and isn't reachable here.
 */

import type { GenerateInput } from '../../application/ports/SqlGenerator.ts';

// Identifier delimiters per dialect label. Unknown/absent dialect ("SQL") falls
// back to ANSI double quotes.
const DELIMITERS: Record<string, readonly [open: string, close: string]> = {
  PostgreSQL: ['"', '"'],
  SQLite: ['"', '"'],
  MySQL: ['`', '`'],
};

// An identifier that round-trips unquoted in every supported dialect: lowercase
// initial, then lowercase/digit/underscore. Anything else — mixed case Postgres
// would fold, spaces, dashes — must be quoted to stay runnable. Reserved words
// used as names are left to the model (see the quoting rule in the system
// prompt); rendering them would need a per-dialect word list.
const SAFE_BARE = /^[a-z_][a-z0-9_]*$/;

type Quote = (name: string) => string;

const quoterFor = (dialect: string): Quote => {
  const [open, close] = DELIMITERS[dialect] ?? ['"', '"'];
  return (name) =>
    SAFE_BARE.test(name)
      ? name
      : open + name.split(close).join(close + close) + close;
};

/** Quote each segment of a (possibly schema-qualified) path independently:
 *  `public.User` → `public."User"`, never `"public.User"`. */
const quotePath = (quote: Quote, path: string): string =>
  path.split('.').map(quote).join('.');

export const buildSystemPrompt = (dialect: string): string =>
  `You are a SQL expert for ${dialect}. Given a database schema and a request in
natural language, produce a single correct, runnable ${dialect} SQL statement.
Rules:
- Use only tables and columns present in the provided schema.
- Copy each identifier exactly as it appears in the schema, including its schema
  qualifier and any quote characters — a quoted name is case-sensitive and fails
  if its quotes or case are dropped. Quote any reserved word used as an identifier.
- Prefer a read-only SELECT unless the request clearly asks to modify data.
- Do not wrap the SQL in markdown fences.
- Keep the explanation to one or two sentences.`;

const renderSchema = (
  tables: GenerateInput['schema']['tables'],
  quote: Quote,
): string =>
  tables
    .map((t) => `${quotePath(quote, t.name)}(${t.columns.map(quote).join(', ')})`)
    .join('\n') || '(no tables)';

export const buildUserPrompt = (input: GenerateInput): string => {
  const quote = quoterFor(input.dialect);
  const focus = input.focus
    ? `\n\nThe user is currently viewing table: ${quotePath(quote, input.focus)}. Favour it when the request is ambiguous about which table, unless the request names another.`
    : '';
  return `Schema:\n${renderSchema(input.schema.tables, quote)}${focus}\n\nRequest: ${input.nl}`;
};
