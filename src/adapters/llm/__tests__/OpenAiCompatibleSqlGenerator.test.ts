import { test, expect } from 'bun:test';
import { OpenAiCompatibleSqlGenerator } from '../providers/OpenAiCompatibleSqlGenerator.ts';

test('forwards the cancellation signal to fetch', async () => {
  const originalFetch = globalThis.fetch;
  let received: AbortSignal | null | undefined;
  globalThis.fetch = (async (_input, init) => {
    received = init?.signal;
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              tool_calls: [
                {
                  function: {
                    arguments: JSON.stringify({ sql: 'SELECT 1', explanation: '' }),
                  },
                },
              ],
            },
          },
        ],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }) as typeof fetch;

  try {
    const generator = new OpenAiCompatibleSqlGenerator({
      apiKey: 'test-key',
      baseURL: 'https://example.test/v1',
      model: 'test-model',
      provider: 'test',
    });
    const controller = new AbortController();

    await generator.generate(
      { nl: 'one row', schema: { tables: [] }, dialect: 'SQLite' },
      controller.signal,
    );

    expect(received).toBe(controller.signal);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
