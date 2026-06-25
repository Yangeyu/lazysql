/**
 * SqlGenerator backed by Claude via the official @anthropic-ai/sdk. Uses strict
 * tool use to force a typed { sql, explanation } result — no fragile parsing of
 * free-form text. This is the only module that imports the LLM SDK; swapping in
 * another provider is a new adapter behind the SqlGenerator port. (DIP)
 *
 * Model defaults to claude-opus-4-8; override with LAZYSQL_LLM_MODEL.
 * Requires ANTHROPIC_API_KEY (or an `ant auth login` profile).
 */

import Anthropic from '@anthropic-ai/sdk';
import type {
  SqlGenerator,
  GenerateInput,
  GeneratedSql,
} from '../../application/ports/SqlGenerator.ts';

const MODEL = process.env.LAZYSQL_LLM_MODEL ?? 'claude-opus-4-8';

const SYSTEM = (dialect: string): string =>
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

export class AnthropicSqlGenerator implements SqlGenerator {
  private readonly client: Anthropic;

  constructor(apiKey?: string) {
    this.client = apiKey ? new Anthropic({ apiKey }) : new Anthropic();
  }

  /** True when an API key is available in the environment. */
  static isConfigured(): boolean {
    return Boolean(process.env.ANTHROPIC_API_KEY);
  }

  async generate(input: GenerateInput): Promise<GeneratedSql> {
    const response = await this.client.messages.create({
      model: MODEL,
      max_tokens: 2000,
      system: SYSTEM(input.dialect),
      tools: [
        {
          name: 'emit_sql',
          description: 'Return the generated SQL and a brief explanation.',
          strict: true,
          input_schema: {
            type: 'object',
            properties: {
              sql: { type: 'string', description: 'The SQL statement.' },
              explanation: {
                type: 'string',
                description: 'One or two sentences on what it does.',
              },
            },
            required: ['sql', 'explanation'],
            additionalProperties: false,
          },
        },
      ],
      tool_choice: { type: 'tool', name: 'emit_sql' },
      messages: [
        {
          role: 'user',
          content: `Schema:\n${renderSchema(input)}\n\nRequest: ${input.nl}`,
        },
      ],
    });

    const block = response.content.find((b) => b.type === 'tool_use');
    if (!block || block.type !== 'tool_use') {
      throw new Error('model did not return SQL');
    }
    const out = block.input as { sql?: string; explanation?: string };
    if (!out.sql) throw new Error('model returned an empty SQL statement');
    return { sql: out.sql, explanation: out.explanation ?? '' };
  }
}
