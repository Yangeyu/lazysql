import { test, expect } from 'bun:test';
import { complete, type SchemaCatalog } from '../sqlCompleter.ts';

// A schemaless catalog (SQLite-like) — keeps the unqualified-completion cases
// focused; the schema-aware cases below use their own multi-schema catalog.
const catalog: SchemaCatalog = {
  schemas: [],
  tables: ['users', 'orders'],
  tablesBySchema: {},
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

// ── DDL + the catalog-independent keyword set (the "no DROP suggestion" fix) ──

test('suggests DROP (and the DDL verbs) at the start of a statement', () => {
  const c = complete('dro', catalog);
  expect(c.candidates).toContain('DROP');
});

test('keywords complete even without a catalog (before introspection)', () => {
  // null catalog → no tables/columns, but keyword completion must still work.
  expect(complete('dro', null).candidates).toContain('DROP');
  expect(complete('SEL', null).candidates).toContain('SELECT');
});

test('after a DDL verb, suggests object kinds plus tables', () => {
  const c = complete('DROP ', catalog);
  expect(c.candidates).toContain('TABLE');
  expect(c.candidates).toContain('VIEW');
});

test('after DROP TABLE, suggests table names', () => {
  const c = complete('DROP TABLE us', catalog);
  expect(c.candidates).toContain('users');
});

// ── schema-aware completion (multi-schema Postgres-like catalog) ──

const pg: SchemaCatalog = {
  schemas: ['public', 'mastra'],
  tables: ['users', 'orders', 'threads'],
  tablesBySchema: {
    public: ['users', 'orders'],
    mastra: ['threads'],
  },
  columnsByTable: {
    'public.users': ['id', 'name', 'email'],
    'public.orders': ['id', 'amount'],
    'mastra.threads': ['id', 'title'],
    // bare fallbacks (first schema wins)
    users: ['id', 'name', 'email'],
    orders: ['id', 'amount'],
    threads: ['id', 'title'],
  },
};

test('suggests schema names alongside tables after FROM', () => {
  const c = complete('SELECT * FROM pub', pg);
  expect(c.candidates).toContain('public');
});

test('a schema qualifier lists that schema’s tables', () => {
  const c = complete('SELECT * FROM mastra.', pg);
  expect(c.word).toBe('');
  expect(c.candidates).toEqual(['threads']);
});

test('a schema qualifier filters that schema’s tables by prefix', () => {
  const c = complete('SELECT * FROM public.or', pg);
  expect(c.candidates).toEqual(['orders']);
});

test('after DROP SCHEMA, suggests schema names', () => {
  const c = complete('DROP SCHEMA ma', pg);
  expect(c.candidates).toContain('mastra');
});

test('a table qualifier lists that table’s columns (qualified key de-collides)', () => {
  const c = complete('SELECT * FROM mastra.threads WHERE mastra.threads.ti', pg);
  expect(c.candidates).toContain('title');
  expect(c.candidates).not.toContain('email'); // not public.users
});

test('an alias qualifier resolves to its relation’s columns (FROM may follow the cursor)', () => {
  // The cursor sits after `u.na`, before the FROM clause is even typed — the
  // whole-statement relation scan still resolves the alias `u`.
  const text = 'SELECT u.na FROM public.users u';
  const caret = text.indexOf(' FROM');
  const c = complete(text, pg, caret);
  expect(c.word).toBe('na');
  expect(c.candidates).toContain('name');
});

test('column scope honours a schema-qualified FROM reference', () => {
  const c = complete('SELECT  FROM mastra.threads WHERE ti', pg);
  expect(c.candidates).toContain('title');
  expect(c.candidates).not.toContain('amount'); // orders not referenced
});
