/**
 * Store-level tests for NL→SQL — verifies the generated SQL lands in the editor
 * (queryText) and is classified, without depending on Ink rendering. Uses a
 * fake DataSource and a fake SqlGenerator, so no database or API key is needed.
 */

import { test, expect } from 'bun:test';
import { createAppStore } from './store.ts';
import { CapabilitySet } from '../../domain/datasource/capabilities.ts';
import { ok } from '../../shared/Result.ts';
import type { DataSource } from '../../domain/datasource/DataSource.ts';
import type { SqlGenerator } from '../../application/ports/SqlGenerator.ts';

const fakeSource: DataSource = {
  id: 'fake',
  connect: async () => ok(undefined),
  disconnect: async () => {},
  ping: async () => true,
  capabilities: () => new CapabilitySet([]),
};

test('generateFromNl fills the editor and classifies, never executing', async () => {
  const generator: SqlGenerator = {
    generate: async () => ({
      sql: 'UPDATE users SET active = 0 WHERE id = 5',
      explanation: 'deactivates user 5',
    }),
  };
  const store = createAppStore(fakeSource, 'X', generator, 'SQLite');

  store.getState().updateNlDraft('deactivate user 5');
  await store.getState().generateFromNl();

  const s = store.getState();
  expect(s.queryText).toBe('UPDATE users SET active = 0 WHERE id = 5');
  expect(s.nlExplanation).toBe('deactivates user 5');
  expect(s.nlKind).toBe('write'); // flagged destructive
  expect(s.nlMode).toBe(false);
  expect(s.queryResult).toBeNull(); // generation does NOT run the query
});

test('NL is unavailable (and beginNl is a no-op) without a generator', () => {
  const store = createAppStore(fakeSource);
  expect(store.getState().nlAvailable).toBe(false);

  store.getState().beginNl();
  expect(store.getState().nlMode).toBe(false);
  expect(store.getState().queryError).toContain('ANTHROPIC_API_KEY');
});

test('a non-Queryable source gates off the SQL editor and NL→SQL', () => {
  // fakeSource has no execute() → not Queryable (like Mongo/Redis).
  const generator: SqlGenerator = {
    generate: async () => ({ sql: 'SELECT 1', explanation: '' }),
  };
  const store = createAppStore(fakeSource, 'KV', generator, 'Redis');

  expect(store.getState().queryable).toBe(false);
  // NL→SQL needs the Query capability to run, so it's hidden even with a generator.
  expect(store.getState().nlAvailable).toBe(false);

  // Pressing `:` (enterQueryView) is inert — the UI never enters a dead SQL view.
  store.getState().enterQueryView();
  expect(store.getState().view).toBe('browse');
  expect(store.getState().error).toContain('does not support SQL');
});
