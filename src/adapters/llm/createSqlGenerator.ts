/**
 * Provider registry / composition for NL→SQL — the LLM analogue of
 * createDataSource. Maps configuration → a concrete SqlGenerator, keeping the
 * choice of provider out of the application core. (DIP / OCP — ADR-0004)
 *
 * Selection order:
 *   1. LAZYSQL_LLM_PROVIDER=anthropic|bailian|…   explicit choice
 *   2. else auto-detect by which API key is present (Qwen preferred)
 *   3. else null → NL→SQL stays disabled (the ^G hint is hidden)
 *
 * Overrides: LAZYSQL_LLM_MODEL, LAZYSQL_LLM_BASE_URL.
 */

import type { SqlGenerator } from '../../application/ports/SqlGenerator.ts';
import { AnthropicSqlGenerator } from './AnthropicSqlGenerator.ts';
import { OpenAiCompatibleSqlGenerator } from './OpenAiCompatibleSqlGenerator.ts';
import {
  OPENAI_COMPATIBLE_PRESETS,
  BAILIAN,
  type OpenAiCompatiblePreset,
} from './providers.ts';

type Env = Record<string, string | undefined>;

const buildOpenAiCompatible = (
  preset: OpenAiCompatiblePreset,
  apiKey: string,
  env: Env,
): SqlGenerator =>
  new OpenAiCompatibleSqlGenerator({
    apiKey,
    baseURL: env.LAZYSQL_LLM_BASE_URL ?? preset.baseURL,
    model: env.LAZYSQL_LLM_MODEL ?? preset.defaultModel,
    provider: preset.id,
  });

const buildAnthropic = (env: Env): SqlGenerator | null =>
  env.ANTHROPIC_API_KEY
    ? new AnthropicSqlGenerator({
        apiKey: env.ANTHROPIC_API_KEY,
        model: env.LAZYSQL_LLM_MODEL,
      })
    : null;

/**
 * Resolve the configured NL→SQL provider, or null when none is configured.
 * `env` is injectable purely for tests; production passes process.env.
 */
export function createSqlGenerator(env: Env = process.env): SqlGenerator | null {
  const choice = env.LAZYSQL_LLM_PROVIDER?.toLowerCase();

  // 1) explicit provider
  if (choice === 'anthropic') return buildAnthropic(env);
  if (choice) {
    const preset = OPENAI_COMPATIBLE_PRESETS[choice];
    if (!preset) return null; // unknown id → leave NL→SQL disabled
    const key = env[preset.apiKeyEnv];
    return key ? buildOpenAiCompatible(preset, key, env) : null;
  }

  // 2) auto-detect — prefer Qwen (Bailian) when its key is present
  const dashscope = env[BAILIAN.apiKeyEnv];
  if (dashscope) return buildOpenAiCompatible(BAILIAN, dashscope, env);
  if (env.ANTHROPIC_API_KEY) return buildAnthropic(env);

  // 3) nothing configured
  return null;
}
