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
 * Alibaba Cloud (Model Studio / Bailian) — the Qwen family, served over
 * DashScope's OpenAI-compatible endpoint. Use the `-intl` host from outside
 * mainland China.
 */
export const ALIBABA: OpenAiCompatiblePreset = {
  id: 'alibaba',
  label: 'Alibaba Cloud (Qwen)',
  baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  apiKeyEnv: 'DASHSCOPE_API_KEY',
  defaultModel: 'qwen3.7-plus',
};

/** OpenAI — the reference chat-completions API the others emulate. */
export const OPENAI: OpenAiCompatiblePreset = {
  id: 'openai',
  label: 'OpenAI',
  baseURL: 'https://api.openai.com/v1',
  apiKeyEnv: 'OPENAI_API_KEY',
  defaultModel: 'gpt-4o',
};

/** DeepSeek — OpenAI-compatible; `deepseek-chat` is the general-purpose model. */
export const DEEPSEEK: OpenAiCompatiblePreset = {
  id: 'deepseek',
  label: 'DeepSeek',
  baseURL: 'https://api.deepseek.com/v1',
  apiKeyEnv: 'DEEPSEEK_API_KEY',
  defaultModel: 'deepseek-chat',
};

/** Registry keyed by provider id — the lookup used by createSqlGenerator. */
export const OPENAI_COMPATIBLE_PRESETS: Readonly<
  Record<string, OpenAiCompatiblePreset>
> = {
  [ALIBABA.id]: ALIBABA,
  [OPENAI.id]: OPENAI,
  [DEEPSEEK.id]: DEEPSEEK,
};
