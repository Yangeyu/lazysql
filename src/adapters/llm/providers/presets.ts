/**
 * OpenAI-compatible LLM provider presets. Adding a provider (DeepSeek, Moonshot,
 * a local Ollama) is a new entry here — no new adapter code, mirroring the
 * datasource registry. This is the open/closed extension point for LLM backends.
 *
 * Per-run overrides (apply to whichever provider is active):
 *   LAZYSQL_LLM_MODEL      → model id
 *   LAZYSQL_LLM_BASE_URL   → base URL
 */

export interface OpenAiCompatiblePreset {
  /** Stable id; also the accepted value of LAZYSQL_LLM_PROVIDER. */
  readonly id: string;
  /** Human-readable label for diagnostics. */
  readonly label: string;
  /** Default chat-completions base URL (up to `/v1`). */
  readonly baseURL: string;
  /** Env var that holds the API key. */
  readonly apiKeyEnv: string;
  /** Default model id. */
  readonly defaultModel: string;
}

/**
 * Alibaba Cloud Bailian (Model Studio) — the Qwen family, served over DashScope's
 * OpenAI-compatible endpoint. Use the `-intl` host from outside mainland China.
 */
export const BAILIAN: OpenAiCompatiblePreset = {
  id: 'bailian',
  label: 'Bailian (Qwen)',
  baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  apiKeyEnv: 'DASHSCOPE_API_KEY',
  defaultModel: 'qwen3.7-plus',
};

/** Registry keyed by provider id — the lookup used by createSqlGenerator. */
export const OPENAI_COMPATIBLE_PRESETS: Readonly<
  Record<string, OpenAiCompatiblePreset>
> = {
  [BAILIAN.id]: BAILIAN,
  // Future: deepseek · moonshot · openai · ollama — each a preset, zero new code.
};
