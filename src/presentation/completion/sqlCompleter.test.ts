import { test, expect } from 'bun:test';
import { complete, type SchemaCatalog } from './sqlCompleter.ts';

const catalog: SchemaCatalog = {
  tables: ['users', 'orders'],
  columnsByTable: {
    users: ['id', 'name', 'email'],
    orders: ['id', 'user_id', 'amount'],
  },
};

test('suggests tables after FROM', () => {
  const c = complete('SELECT * FROM us', catalog);
  expect(c.word).toBe('us');
  expect(c.candidates).toContain('users');
  expect(c.candidates).not.toContain('amount'); // not a column context
});

test('lists all tables when FROM has no prefix yet', () => {
  const c = complete('SELECT * FROM ', catalog);
  expect(c.word).toBe('');
  expect(c.candidates).toEqual(['orders', 'users']);
});

test('suggests columns after SELECT', () => {
  const c = complete('SELECT na', catalog);
  expect(c.candidates).toContain('name');
});

test('scopes column suggestions to the referenced table', () => {
  const c = complete('SELECT name FROM users WHERE em', catalog);
  expect(c.candidates).toContain('email'); // users column
  expect(c.candidates).not.toContain('amount'); // orders not referenced
});

test('falls back to keywords at the start', () => {
  const c = complete('SEL', catalog);
  expect(c.candidates).toContain('SELECT');
});

test('columns rank above keywords in a column context (no prefix)', () => {
  const c = complete('SELECT * FROM orders WHERE ', catalog);
  // first suggestion is a column of orders, not an uppercase keyword
  expect(['amount', 'id', 'user_id'].includes(c.candidates[0] ?? '')).toBe(true);
});
