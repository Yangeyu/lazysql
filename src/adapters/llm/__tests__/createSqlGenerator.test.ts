/**
 * Provider-selection tests for createSqlGenerator. Pure routing logic — env in,
 * a configured (but un-called) generator out — so no API key, network, or model
 * call is needed. Asserts on each adapter's public diagnostics (provider/model/
 * baseURL).
 */

import { test, expect } from 'bun:test';
import { createSqlGenerator } from '../createSqlGenerator.ts';

type Diag = { provider?: string; model?: string; baseURL?: string };
const diag = (g: unknown): Diag => (g ?? {}) as Diag;

const DASHSCOPE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';

test('nothing configured → null (NL→SQL stays disabled)', () => {
  expect(createSqlGenerator({})).toBeNull();
});

test('auto-detect prefers Qwen (Alibaba) when DASHSCOPE_API_KEY is set', () => {
  const g = createSqlGenerator({ DASHSCOPE_API_KEY: 'sk-d' });
  expect(diag(g).provider).toBe('alibaba');
  expect(diag(g).model).toBe('qwen3.7-plus');
  expect(diag(g).baseURL).toBe(DASHSCOPE_URL);
});

test('auto-detect falls back to Claude when only ANTHROPIC_API_KEY is set', () => {
  const g = createSqlGenerator({ ANTHROPIC_API_KEY: 'sk-a' });
  expect(diag(g).provider).toBe('anthropic');
});

test('with both keys present, Qwen wins by default', () => {
  const g = createSqlGenerator({ DASHSCOPE_API_KEY: 'sk-d', ANTHROPIC_API_KEY: 'sk-a' });
  expect(diag(g).provider).toBe('alibaba');
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
  expect(createSqlGenerator({ LAZYSQL_LLM_PROVIDER: 'alibaba' })).toBeNull();
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

test('explicit LAZYSQL_LLM_PROVIDER=openai routes to the OpenAI endpoint', () => {
  const g = createSqlGenerator({ LAZYSQL_LLM_PROVIDER: 'openai', OPENAI_API_KEY: 'sk-o' });
  expect(diag(g).provider).toBe('openai');
  expect(diag(g).model).toBe('gpt-4o');
  expect(diag(g).baseURL).toBe('https://api.openai.com/v1');
});

test('explicit LAZYSQL_LLM_PROVIDER=deepseek routes to the DeepSeek endpoint', () => {
  const g = createSqlGenerator({ LAZYSQL_LLM_PROVIDER: 'deepseek', DEEPSEEK_API_KEY: 'sk-ds' });
  expect(diag(g).provider).toBe('deepseek');
  expect(diag(g).model).toBe('deepseek-chat');
  expect(diag(g).baseURL).toBe('https://api.deepseek.com/v1');
});

test('auto-detect picks OpenAI / DeepSeek when only that key is present', () => {
  expect(diag(createSqlGenerator({ OPENAI_API_KEY: 'sk-o' })).provider).toBe('openai');
  expect(diag(createSqlGenerator({ DEEPSEEK_API_KEY: 'sk-ds' })).provider).toBe('deepseek');
});

test('auto-detect precedence keeps Qwen ahead of OpenAI and DeepSeek', () => {
  const g = createSqlGenerator({
    DASHSCOPE_API_KEY: 'sk-d',
    OPENAI_API_KEY: 'sk-o',
    DEEPSEEK_API_KEY: 'sk-ds',
  });
  expect(diag(g).provider).toBe('alibaba');
});
