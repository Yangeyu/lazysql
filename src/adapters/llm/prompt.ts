/**
 * Shared prompt construction for SqlGenerator adapters. Kept provider-neutral so
 * every LLM backend (Claude, Qwen, …) phrases the NL→SQL task identically — the
 * only thing that varies per provider is the transport/SDK, not the instruction.
 */

import type { GenerateInput } from '../../application/ports/SqlGenerator.ts';

export const buildSystemPrompt = (dialect: string): string =>
  `You are a SQL expert for ${dialect}. Given a database schema and a request in
natural language, produce a single correct, runnable ${dialect} SQL statement.
Rules:
- Use only tables and columns present in the provided schema.
- Prefer a read-only SELECT unless the request clearly asks to modify data.
- Do not wrap the SQL in markdown fences.
- Keep the explanation to one or two sentences.`;

const renderSchema = (input: GenerateInput): string =>
  input.schema.tables
    .map((t) => `${t.name}(${t.columns.join(', ')})`)
    .join('\n') || '(no tables)';

export const buildUserPrompt = (input: GenerateInput): string => {
  const focus = input.focus
    ? `\n\nThe user is currently viewing table: ${input.focus}. Favour it when the request is ambiguous about which table, unless the request names another.`
    : '';
  return `Schema:\n${renderSchema(input)}${focus}\n\nRequest: ${input.nl}`;
};
