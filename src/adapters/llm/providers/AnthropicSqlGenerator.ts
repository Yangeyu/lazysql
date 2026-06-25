/**
 * SqlGenerator backed by Claude via the official @anthropic-ai/sdk. Uses strict
 * tool use to force a typed { sql, explanation } result — no fragile parsing of
 * free-form text. One of several adapters behind the SqlGenerator port; the
 * provider is chosen by createSqlGenerator. (DIP — docs/ARCHITECTURE.md §5.1)
 *
 * Model defaults to claude-opus-4-8; override with LAZYSQL_LLM_MODEL.
 * Requires ANTHROPIC_API_KEY (or an `ant auth login` profile).
 */

import Anthropic from '@anthropic-ai/sdk';
import type {
  SqlGenerator,
  GenerateInput,
  GeneratedSql,
} from '../../../application/ports/SqlGenerator.ts';
import { buildSystemPrompt, buildUserPrompt } from '../prompt.ts';

const DEFAULT_MODEL = 'claude-opus-4-8';

export class AnthropicSqlGenerator implements SqlGenerator {
  /** Stable id for diagnostics / provider selection. */
  readonly provider = 'anthropic';
  readonly model: string;
  private readonly client: Anthropic;

  constructor(opts: { apiKey?: string; model?: string } = {}) {
    this.client = opts.apiKey
      ? new Anthropic({ apiKey: opts.apiKey })
      : new Anthropic();
    this.model = opts.model ?? process.env.LAZYSQL_LLM_MODEL ?? DEFAULT_MODEL;
  }

  /** True when an API key is available in the environment. */
  static isConfigured(): boolean {
    return Boolean(process.env.ANTHROPIC_API_KEY);
  }

  async generate(input: GenerateInput): Promise<GeneratedSql> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 2000,
      system: buildSystemPrompt(input.dialect),
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
      messages: [{ role: 'user', content: buildUserPrompt(input) }],
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
