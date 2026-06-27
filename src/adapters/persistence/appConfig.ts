/**
 * Reads ~/.config/lazysql/config.yml — the human-edited, non-secret application
 * settings — and exposes its NL→SQL block in the env shape createSqlGenerator
 * already consumes. This frees the LLM provider/model from living only in the
 * shell: pin it once in config.yml instead of exporting LAZYSQL_LLM_* every run.
 *
 * Contract: secrets never live here — API keys stay in the environment /
 * secrets.json and are NOT read from this file. A missing file or `llm` section
 * yields {} (selection falls back to env + key auto-detect, exactly as before).
 * The returned map is meant to be the BASE that process.env overrides, so an
 * ad-hoc env var still wins over the persisted default.
 */

import { parse } from 'yaml';
import { readFile } from 'node:fs/promises';
import { configFile } from './paths.ts';

/** The `llm` block of config.yml. Every field is optional; API key is absent by
 *  design (kept in the environment). */
interface LlmConfig {
  readonly provider?: string;
  readonly model?: string;
  readonly baseUrl?: string;
}

/** Map a parsed `llm` block to createSqlGenerator's env keys, omitting unset
 *  fields so an env override (or key auto-detect) still applies where the file
 *  is silent. Pure; exported for unit testing. */
export const llmEnvFrom = (llm: LlmConfig | undefined): Record<string, string> => {
  const env: Record<string, string> = {};
  if (llm?.provider) env.LAZYSQL_LLM_PROVIDER = llm.provider;
  if (llm?.model) env.LAZYSQL_LLM_MODEL = llm.model;
  if (llm?.baseUrl) env.LAZYSQL_LLM_BASE_URL = llm.baseUrl;
  return env;
};

const isNotFound = (e: unknown): boolean =>
  (e as { code?: string }).code === 'ENOENT';

/** Load config.yml's LLM settings in env shape; {} when the file (or section) is
 *  absent. Throws only on a genuine read/parse failure of an existing file. */
export const loadLlmEnv = async (
  file: string = configFile(),
): Promise<Record<string, string>> => {
  try {
    const doc = parse(await readFile(file, 'utf8')) as { llm?: LlmConfig } | null;
    return llmEnvFrom(doc?.llm);
  } catch (e) {
    if (isNotFound(e)) return {};
    throw e;
  }
};
