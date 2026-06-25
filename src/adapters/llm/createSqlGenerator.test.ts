/**
 * Provider-selection tests for createSqlGenerator. Pure routing logic — env in,
 * a configured (but un-called) generator out — so no API key, network, or model
 * call is needed. Asserts on each adapter's public diagnostics (provider/model/
 * baseURL).
 */

import { test, expect } from 'bun:test';
import { createSqlGenerator } from './createSqlGenerator.ts';

type Diag = { provider?: string; model?: string; baseURL?: string };
const diag = (g: unknown): Diag => (g ?? {}) as Diag;

const DASHSCOPE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';

test('nothing configured → null (NL→SQL stays disabled)', () => {
  expect(createSqlGenerator({})).toBeNull();
});

test('auto-detect prefers Qwen (Bailian) when DASHSCOPE_API_KEY is set', () => {
  const g = createSqlGenerator({ DASHSCOPE_API_KEY: 'sk-d' });
  expect(diag(g).provider).toBe('bailian');
  expect(diag(g).model).toBe('qwen3.7-plus');
  expect(diag(g).baseURL).toBe(DASHSCOPE_URL);
});

test('auto-detect falls back to Claude when only ANTHROPIC_API_KEY is set', () => {
  const g = createSqlGenerator({ ANTHROPIC_API_KEY: 'sk-a' });
  expect(diag(g).provider).toBe('anthropic');
});

test('with both keys present, Qwen wins by default', () => {
  const g = createSqlGenerator({ DASHSCOPE_API_KEY: 'sk-d', ANTHROPIC_API_KEY: 'sk-a' });
  expect(diag(g).provider).toBe('bailian');
});

test('explicit LAZYSQL_LLM_PROVIDER=anthropic overrides auto-detect', () => {
  const g = createSqlGenerator({
    LAZYSQL_LLM_PROVIDER: 'anthropic',
    DASHSCOPE_API_KEY: 'sk-d',
    ANTHROPIC_API_KEY: 'sk-a',
  });
  expect(diag(g).provider).toBe('anthropic');
});

test('explicit provider without its API key → null', () => {
  expect(createSqlGenerator({ LAZYSQL_LLM_PROVIDER: 'bailian' })).toBeNull();
});

test('unknown provider id → null (even if another key is present)', () => {
  expect(
    createSqlGenerator({ LAZYSQL_LLM_PROVIDER: 'gpt', ANTHROPIC_API_KEY: 'sk-a' }),
  ).toBeNull();
});

test('model and base-URL overrides flow into the active provider', () => {
  const g = createSqlGenerator({
    DASHSCOPE_API_KEY: 'sk-d',
    LAZYSQL_LLM_MODEL: 'qwen-max',
    LAZYSQL_LLM_BASE_URL: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
  });
  expect(diag(g).model).toBe('qwen-max');
  expect(diag(g).baseURL).toBe('https://dashscope-intl.aliyuncs.com/compatible-mode/v1');
});
