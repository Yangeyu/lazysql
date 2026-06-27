/**
 * SqlGenerator backed by any OpenAI-compatible /chat/completions endpoint.
 * ONE adapter serves every OpenAI-compatible provider — Alibaba (Qwen),
 * DeepSeek, Moonshot/Kimi, a local Ollama/vLLM — each is just a different
 * { baseURL, model, apiKey } preset (see presets.ts). Uses forced function
 * calling to get a typed { sql, explanation } back, with a defensive fallback
 * to plain content for models that ignore (or cannot honour) tool_choice.
 *
 * Talks raw HTTP (the wire format is small, stable, and dependency-free) so the
 * binary stays lean; swapping in the official `openai` SDK later is internal to
 * this file. Behind the SqlGenerator port per DIP. (ADR-0004)
 */

import type {
  SqlGenerator,
  GenerateInput,
  GeneratedSql,
} from '../../../application/ports/SqlGenerator.ts';
import { buildSystemPrompt, buildUserPrompt } from '../prompt.ts';

export interface OpenAiCompatibleConfig {
  readonly apiKey: string;
  /** Base URL up to and including `/v1` (no trailing slash). */
  readonly baseURL: string;
  readonly model: string;
  /** Stable id for diagnostics / tests, e.g. 'alibaba'. */
  readonly provider: string;
}

/** Minimal shape of the bits of the chat-completions response we read. */
interface ChatCompletion {
  readonly choices?: ReadonlyArray<{
    readonly message?: {
      readonly content?: string | null;
      readonly tool_calls?: ReadonlyArray<{
        readonly function?: { readonly arguments?: string };
      }>;
    };
  }>;
}

const EMIT_SQL_TOOL = {
  type: 'function',
  function: {
    name: 'emit_sql',
    description: 'Return the generated SQL and a brief explanation.',
    parameters: {
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
} as const;

const stripFences = (s: string): string =>
  s
    .replace(/^```(?:sql)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

export class OpenAiCompatibleSqlGenerator implements SqlGenerator {
  // Public diagnostics (provider/model/baseURL); the apiKey stays private.
  readonly provider: string;
  readonly model: string;
  readonly baseURL: string;
  private readonly apiKey: string;

  constructor(cfg: OpenAiCompatibleConfig) {
    this.provider = cfg.provider;
    this.model = cfg.model;
    this.baseURL = cfg.baseURL.replace(/\/+$/, '');
    this.apiKey = cfg.apiKey;
  }

  async generate(input: GenerateInput): Promise<GeneratedSql> {
    const res = await fetch(`${this.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: buildSystemPrompt(input.dialect) },
          { role: 'user', content: buildUserPrompt(input) },
        ],
        tools: [EMIT_SQL_TOOL],
        // `auto`, not a forced object: reasoning/"thinking" models (e.g. Qwen3
        // on DashScope) reject `tool_choice: required|object` with HTTP 400
        // ("does not support being set to required or object in thinking mode").
        // With a single tool the model still calls it reliably, and the content
        // fallback below salvages the rare case where it answers in prose.
        tool_choice: 'auto',
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(
        `${this.provider} request failed (${res.status}): ${detail.slice(0, 300)}`,
      );
    }

    const data = (await res.json()) as ChatCompletion;
    const message = data.choices?.[0]?.message;

    const args = message?.tool_calls?.[0]?.function?.arguments;
    if (args) {
      const out = JSON.parse(args) as { sql?: string; explanation?: string };
      if (!out.sql) throw new Error('model returned an empty SQL statement');
      return { sql: out.sql, explanation: out.explanation ?? '' };
    }

    // Fallback: some OpenAI-compatible models ignore forced tool_choice and put
    // the SQL straight in the message content. Salvage it rather than fail hard.
    const content = message?.content?.trim();
    if (content) return { sql: stripFences(content), explanation: '' };

    throw new Error(`${this.provider} did not return SQL`);
  }
}
