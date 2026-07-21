import { test, expect } from 'bun:test';
import { buildUserPrompt, buildSystemPrompt } from '../prompt.ts';
import type { GenerateInput } from '../../../application/ports/SqlGenerator.ts';

const base: GenerateInput = {
  nl: 'latest 10 rows',
  dialect: 'PostgreSQL',
  schema: {
    tables: [
      { name: 'orders', columns: ['id', 'total'] },
      { name: 'users', columns: ['id', 'name'] },
    ],
  },
};

test('renders the schema and the request', () => {
  const p = buildUserPrompt(base);
  expect(p).toContain('orders(id, total)');
  expect(p).toContain('users(id, name)');
  expect(p).toContain('Request: latest 10 rows');
});

test('a focus table is surfaced as a hint the model should favour', () => {
  const p = buildUserPrompt({ ...base, focus: 'public.orders' });
  expect(p).toContain('currently viewing table: public.orders');
});

test('without a focus, no current-table line is emitted', () => {
  expect(buildUserPrompt(base)).not.toContain('currently viewing');
});

test('mixed-case identifiers are quoted so the model keeps their exact case', () => {
  const p = buildUserPrompt({
    ...base,
    schema: { tables: [{ name: 'mastra_messages', columns: ['content', 'createdAt'] }] },
  });
  // A bare `createdAt` would fold to `createdat` in Postgres and fail.
  expect(p).toContain('mastra_messages(content, "createdAt")');
});

test('a mixed-case table name is quoted too', () => {
  const p = buildUserPrompt({
    ...base,
    schema: { tables: [{ name: 'User', columns: ['id'] }] },
  });
  expect(p).toContain('"User"(id)');
});

test('MySQL quotes with backticks', () => {
  const p = buildUserPrompt({
    ...base,
    dialect: 'MySQL',
    schema: { tables: [{ name: 'orders', columns: ['id', 'createdAt'] }] },
  });
  expect(p).toContain('orders(id, `createdAt`)');
});

test('a schema-qualified focus is quoted per segment, not as a whole', () => {
  const p = buildUserPrompt({ ...base, focus: 'public.User' });
  expect(p).toContain('currently viewing table: public."User"');
});

test('the system prompt instructs the model to preserve identifier quoting', () => {
  expect(buildSystemPrompt('PostgreSQL')).toContain(
    'Copy each identifier exactly as it appears in the schema',
  );
});
