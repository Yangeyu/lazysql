/**
 * Store-level tests for NL→SQL and capability gating. The store reaches its
 * connection only through a fake ConnectionService (no DB, no API key): the
 * service opens a fake DataSource and the store connects to it on init().
 */

import { test, expect } from 'bun:test';
import { createAppStore } from '../store.ts';
import { Capability, CapabilitySet } from '../../../domain/datasource/capabilities.ts';
import { ok } from '../../../shared/Result.ts';
import { QueryError } from '../../../domain/errors/errors.ts';
import { PostgresDialect } from '../../../adapters/datasource/sql/dialects/PostgresDialect.ts';
import type {
  DataSource,
  DdlScriptable,
  Queryable,
} from '../../../domain/datasource/DataSource.ts';
import type { ResultSet } from '../../../domain/datasource/ResultSet.ts';
import type { ConnectionService } from '../../../application/ports/ConnectionService.ts';
import type { ConnectionProfile } from '../../../domain/connection/ConnectionProfile.ts';
import type { SqlGenerator } from '../../../application/ports/SqlGenerator.ts';

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

  await store.getState().generateFromNl('deactivate user 5');

  const s = store.getState();
  expect(s.queryText).toBe('UPDATE users SET active = 0 WHERE id = 5');
  expect(s.nlExplanation).toBe('deactivates user 5');
  expect(s.nlKind).toBe('write'); // flagged destructive
  expect(s.nlMode).toBe(false);
  expect(s.result).toBeNull(); // generation does NOT run the query (no result)
  expect(s.surface).toBe('browse'); // …and never flips the grid to a query surface
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

test('a dependents-blocked DROP escalates to a CASCADE confirm, then runs it', async () => {
  // A Postgres-shaped fake: the plain DROP raises SQLSTATE 2BP01; the CASCADE
  // retry succeeds. cascadeRetry reuses the real dialect so the wiring is exercised
  // end-to-end (executeQuery's danger guard → confirm → failure → CASCADE confirm).
  const dialect = new PostgresDialect();
  const executed: string[] = [];
  const okResult: ResultSet = {
    shape: 'tabular',
    columns: [],
    rows: [],
    affected: 0,
    truncated: false,
  };
  const source: DataSource & Queryable & DdlScriptable = {
    id: 'pg-fake',
    connect: async () => ok(undefined),
    disconnect: async () => {},
    ping: async () => true,
    capabilities: () => new CapabilitySet([Capability.Query, Capability.DdlScript]),
    execute: async (query) => {
      executed.push(query.text);
      if (/\bdrop\b/i.test(query.text) && !/\bcascade\b/i.test(query.text)) {
        throw new QueryError('cannot drop table widget because other objects depend on it', {
          code: '2BP01',
          detail: 'view order_summary depends on table widget',
        });
      }
      return okResult;
    },
    dropStatement: (ref) => dialect.dropQuery(ref).text,
    cascadeRetry: (sql, error) => dialect.cascadeDrop(sql, error),
  };
  const profile: ConnectionProfile = { id: 'pg', name: 'PG', driver: 'postgres', options: {} };
  const store = createAppStore({
    connectionService: {
      list: async () => [profile],
      open: async () => ok(source),
      save: async () => {},
      remove: async () => {},
    },
    initial: profile,
  });
  await store.getState().init();

  store.getState().setQuery('DROP TABLE "public"."widget";');
  await store.getState().executeQuery(); // DROP is destructive → first confirm
  expect(store.getState().mode).toBe('confirm');
  expect(store.getState().pending?.title).toContain('irreversible');
  expect(store.getState().pending?.tone).toBe('danger');

  await store.getState().confirmPending(); // runs the DROP → 2BP01 → CASCADE confirm
  expect(store.getState().mode).toBe('confirm');
  expect(store.getState().pending?.statement).toContain('CASCADE'); // exact SQL echoed
  expect(store.getState().pending?.details).toContain('view order_summary'); // names the casualty

  await store.getState().confirmPending(); // runs the CASCADE retry → succeeds
  expect(executed.some((s) => /CASCADE/i.test(s))).toBe(true);
  expect(store.getState().mode).toBe('normal');
  expect(store.getState().pending).toBeNull();
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

  // Pressing `:` (focusPane 'editor') is inert — the editor pane never activates
  // for a non-SQL source.
  store.getState().focusPane('editor');
  expect(store.getState().focus).not.toBe('editor');
  expect(store.getState().error).toContain('does not support SQL');
});
