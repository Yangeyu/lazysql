import { test, expect } from 'bun:test';
import { buildUserPrompt } from '../prompt.ts';
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
