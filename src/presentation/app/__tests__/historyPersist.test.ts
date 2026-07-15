/**
 * SQL history persistence at the store seam: on connect the store restores the
 * connection's saved history, each run appends + persists it, and the list is
 * capped to HISTORY_LIMIT. A real SQLite source runs the queries; history is
 * captured by an in-memory QueryHistoryStore fake.
 */

import { test, expect, afterAll } from 'bun:test';
import { Database } from 'bun:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { createAppStore, HISTORY_LIMIT } from '../store.ts';
import { createDataSource } from '../../../adapters/datasource/registry.ts';
import { openConnection } from '../../../application/usecases/OpenConnection.ts';
import type { ConnectionService } from '../../../application/ports/ConnectionService.ts';
import type { QueryHistoryStore } from '../../../application/ports/QueryHistoryStore.ts';

const DB = join(tmpdir(), `lazysql-histp-${process.pid}.db`);
new Database(DB, { create: true }).close();
afterAll(() => rmSync(DB, { force: true }));

const noSecrets = { get: async () => null, set: async () => {}, delete: async () => {} } as any;
const profile = { id: 'h', name: 'HistDB', driver: 'sqlite' as const, options: { file: DB } };
const svc: ConnectionService = {
  list: async () => [profile],
  open: (p) => openConnection(p, { factory: createDataSource, secrets: noSecrets }),
  save: async () => {},
  remove: async () => {},
};

/** In-memory stand-in for the durable store, seeded per test. */
const fakeHistory = (seed: Record<string, string[]> = {}): QueryHistoryStore & { saved: Record<string, string[]> } => {
  const saved: Record<string, string[]> = { ...seed };
  return {
    saved,
    load: async (id) => saved[id] ?? [],
    save: async (id, h) => {
      saved[id] = [...h];
    },
  };
};

/** Poll the store until `pred` holds (the history load on attach is async). */
const until = async (pred: () => boolean) => {
  for (let i = 0; i < 200 && !pred(); i++) await Bun.sleep(5);
  if (!pred()) throw new Error('condition not met in time');
};

test('connecting restores the saved history', async () => {
  const history = fakeHistory({ h: ['SELECT 42'] });
  const store = createAppStore({ connectionService: svc, initial: profile, historyStore: history });
  await store.getState().init();
  await until(() => store.getState().history.length > 0);
  expect(store.getState().history).toEqual(['SELECT 42']);
});

test('running a query appends and persists it', async () => {
  const history = fakeHistory();
  const store = createAppStore({ connectionService: svc, initial: profile, historyStore: history });
  await store.getState().init();
  await until(() => store.getState().queryable);

  store.getState().setQuery('SELECT 1');
  await store.getState().executeQuery();

  expect(store.getState().history).toEqual(['SELECT 1']);
  expect(history.saved.h).toEqual(['SELECT 1']); // persisted under the connection id
});

test('history is capped to HISTORY_LIMIT, dropping the oldest', async () => {
  const seed = Array.from({ length: HISTORY_LIMIT }, (_, i) => `SELECT ${i}`);
  const history = fakeHistory({ h: seed });
  const store = createAppStore({ connectionService: svc, initial: profile, historyStore: history });
  await store.getState().init();
  await until(() => store.getState().history.length === HISTORY_LIMIT);

  store.getState().setQuery('SELECT 9999');
  await store.getState().executeQuery();

  const h = store.getState().history;
  expect(h.length).toBe(HISTORY_LIMIT);
  expect(h.at(-1)).toBe('SELECT 9999');
  expect(h[0]).toBe('SELECT 1'); // the original 'SELECT 0' fell off the front
  expect(history.saved.h ?? []).toHaveLength(HISTORY_LIMIT);
});
