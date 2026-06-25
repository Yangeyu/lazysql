/**
 * Store-level tests for NL→SQL and capability gating. The store reaches its
 * connection only through a fake ConnectionService (no DB, no API key): the
 * service opens a fake DataSource and the store connects to it on init().
 */

import { test, expect } from 'bun:test';
import { createAppStore } from './store.ts';
import { CapabilitySet } from '../../domain/datasource/capabilities.ts';
import { ok } from '../../shared/Result.ts';
import type { DataSource } from '../../domain/datasource/DataSource.ts';
import type { ConnectionService } from '../../application/ports/ConnectionService.ts';
import type { ConnectionProfile } from '../../domain/connection/ConnectionProfile.ts';
import type { SqlGenerator } from '../../application/ports/SqlGenerator.ts';

const fakeSource: DataSource = {
  id: 'fake',
  connect: async () => ok(undefined),
  disconnect: async () => {},
  ping: async () => true,
  capabilities: () => new CapabilitySet([]),
};

const serviceFor = (profile: ConnectionProfile): ConnectionService => ({
  list: async () => [profile],
  open: async () => ok(fakeSource),
  save: async () => {},
  remove: async () => {},
});

test('generateFromNl fills the editor and classifies, never executing', async () => {
  const generator: SqlGenerator = {
    generate: async () => ({
      sql: 'UPDATE users SET active = 0 WHERE id = 5',
      explanation: 'deactivates user 5',
    }),
  };
  // The dialect ('SQLite') is now derived from the active profile's driver.
  const profile: ConnectionProfile = {
    id: 'x',
    name: 'X',
    driver: 'sqlite',
    options: {},
  };
  const store = createAppStore({
    connectionService: serviceFor(profile),
    generator,
    initial: profile,
  });
  await store.getState().init();

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
  const profile: ConnectionProfile = {
    id: 'x',
    name: 'X',
    driver: 'sqlite',
    options: {},
  };
  const store = createAppStore({ connectionService: serviceFor(profile) });
  expect(store.getState().nlAvailable).toBe(false);

  store.getState().beginNl();
  expect(store.getState().nlMode).toBe(false);
  expect(store.getState().queryError).toContain('ANTHROPIC_API_KEY');
});

test('a non-Queryable source gates off the SQL editor and NL→SQL', async () => {
  // fakeSource has no execute() → not Queryable (like Mongo/Redis).
  const generator: SqlGenerator = {
    generate: async () => ({ sql: 'SELECT 1', explanation: '' }),
  };
  const profile: ConnectionProfile = {
    id: 'kv',
    name: 'KV',
    driver: 'redis',
    options: {},
  };
  const store = createAppStore({
    connectionService: serviceFor(profile),
    generator,
    initial: profile,
  });
  await store.getState().init();

  expect(store.getState().queryable).toBe(false);
  // NL→SQL needs the Query capability to run, so it's hidden even with a generator.
  expect(store.getState().nlAvailable).toBe(false);

  // Pressing `:` (enterQueryView) is inert — the UI never enters a dead SQL view.
  store.getState().enterQueryView();
  expect(store.getState().view).toBe('browse');
  expect(store.getState().error).toContain('does not support SQL');
});
