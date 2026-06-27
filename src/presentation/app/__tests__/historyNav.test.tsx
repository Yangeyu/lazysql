/**
 * SQL editor history navigation: ↑ steps back through past queries and ↓ steps
 * forward again. Regression guard for the bug where the controlled <input>
 * echoed onInput after a history-driven queryText write, resetting historyIndex
 * to null so ↓ (historyNext) could never advance.
 */

import React from 'react';
import { test, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { renderTest } from '../../testing/renderTest.ts';
import { StoreContext } from '../context.ts';
import { App } from '../App.tsx';
import { createAppStore } from '../store.ts';
import { createDataSource } from '../../../adapters/datasource/registry.ts';
import { openConnection } from '../../../application/usecases/OpenConnection.ts';
import type { ConnectionService } from '../../../application/ports/ConnectionService.ts';

const DB = join(tmpdir(), `lazysql-histnav-${process.pid}.db`);
const noSecrets = { get: async () => null, set: async () => {}, delete: async () => {} } as never;
const profile = { id: 't', name: 'HistDB', driver: 'sqlite' as const, options: { file: DB } };
const svc: ConnectionService = {
  list: async () => [profile],
  open: (p) => openConnection(p, { factory: createDataSource, secrets: noSecrets }),
  save: async () => {},
  remove: async () => {},
};

test('↑ steps back through history and ↓ steps forward again', async () => {
  const db = new Database(DB, { create: true });
  db.exec('CREATE TABLE t (id INTEGER);');
  db.close();

  const store = createAppStore({ connectionService: svc, initial: profile });
  const h = await renderTest(
    <StoreContext.Provider value={store}>
      <App clipboard={{ write: () => {} }} />
    </StoreContext.Provider>,
    { width: 100, height: 24 },
  );
  await h.until((f) => f.includes('HistDB'));

  const s = () => store.getState();
  // Two committed queries → history = [q1, q2].
  s().setQuery('SELECT 1 AS a');
  await s().executeQuery();
  s().setQuery('SELECT 2 AS b');
  await s().executeQuery();
  s().focusPane('editor');
  await h.flush();

  h.arrow('up'); // → newest (q2)
  await h.flush();
  expect(s().queryText).toBe('SELECT 2 AS b');

  h.arrow('up'); // → older (q1); historyIndex must survive the input echo
  await h.flush();
  expect(s().queryText).toBe('SELECT 1 AS a');

  h.arrow('down'); // ← forward again to q2 — the bug made this a no-op
  await h.flush();
  expect(s().queryText).toBe('SELECT 2 AS b');

  rmSync(DB, { force: true });
  h.cleanup();
});
