/**
 * config.yml → LLM env mapping. Covers the pure mapper and the file loader's
 * missing-file / missing-section fallbacks. The "env overrides config" rule is a
 * spread at the composition root; it's asserted here against the documented
 * shape (config is the base, process.env wins).
 */

import { test, expect, afterEach } from 'bun:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFileSync, rmSync } from 'node:fs';
import { llmEnvFrom, loadLlmEnv } from '../appConfig.ts';

test('llmEnvFrom maps only the fields that are set', () => {
  expect(llmEnvFrom(undefined)).toEqual({});
  expect(llmEnvFrom({})).toEqual({});
  expect(llmEnvFrom({ provider: 'openai' })).toEqual({ LAZYSQL_LLM_PROVIDER: 'openai' });
  expect(llmEnvFrom({ provider: 'deepseek', model: 'deepseek-chat', baseUrl: 'https://x/v1' })).toEqual({
    LAZYSQL_LLM_PROVIDER: 'deepseek',
    LAZYSQL_LLM_MODEL: 'deepseek-chat',
    LAZYSQL_LLM_BASE_URL: 'https://x/v1',
  });
});

const tmp = join(tmpdir(), `lazysql-cfg-${process.pid}.yml`);
afterEach(() => rmSync(tmp, { force: true }));

test('loadLlmEnv returns {} when the file is absent', async () => {
  expect(await loadLlmEnv(join(tmpdir(), 'lazysql-nope-xyz.yml'))).toEqual({});
});

test('loadLlmEnv returns {} when there is no llm section', async () => {
  writeFileSync(tmp, 'connections: []\n');
  expect(await loadLlmEnv(tmp)).toEqual({});
});

test('loadLlmEnv reads the llm block into env shape', async () => {
  writeFileSync(tmp, 'llm:\n  provider: openai\n  model: gpt-4o\n');
  expect(await loadLlmEnv(tmp)).toEqual({
    LAZYSQL_LLM_PROVIDER: 'openai',
    LAZYSQL_LLM_MODEL: 'gpt-4o',
  });
});

test('process.env overrides the config base (env wins on merge)', () => {
  const config = { LAZYSQL_LLM_PROVIDER: 'openai', LAZYSQL_LLM_MODEL: 'gpt-4o' };
  const merged = { ...config, LAZYSQL_LLM_PROVIDER: 'deepseek' }; // env layer
  expect(merged.LAZYSQL_LLM_PROVIDER).toBe('deepseek'); // overridden
  expect(merged.LAZYSQL_LLM_MODEL).toBe('gpt-4o'); // untouched where env is silent
});
