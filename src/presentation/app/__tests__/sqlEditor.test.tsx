/**
 * SQL editor via the native <input>: : focuses it, typing syncs the store
 * (onInput → setQuery), Enter runs the query (onSubmit → executeQuery) and the
 * result lands in the shared grid. Proves the controlled native input + keymap
 * coexistence for the editor end-to-end.
 */

import React from 'react';
import { test, beforeAll, afterAll, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { renderTest } from '../../testing/renderTest.ts';
import { Root } from '../Root.tsx';
import { createDataSource } from '../../../adapters/datasource/registry.ts';
import { openConnection } from '../../../application/usecases/OpenConnection.ts';
import type { ConnectionService } from '../../../application/ports/ConnectionService.ts';

const DB = join(tmpdir(), `lazysql-sqled-${process.pid}.db`);
const noSecrets = { get: async () => null, set: async () => {}, delete: async () => {} } as any;
const profile = { id: 't', name: 'TestDB', driver: 'sqlite' as const, options: { file: DB } };
const svc: ConnectionService = {
  list: async () => [profile],
  open: (p) => openConnection(p, { factory: createDataSource, secrets: noSecrets }),
  save: async () => {},
  remove: async () => {},
};

beforeAll(() => {
  const db = new Database(DB, { create: true });
  db.exec('CREATE TABLE t (id INTEGER);');
  db.close();
});
afterAll(() => rmSync(DB, { force: true }));

test(': focuses the SQL input; typing + Enter runs the query into the grid', async () => {
  const h = await renderTest(<Root connectionService={svc} initial={profile} />, {
    width: 100,
    height: 24,
  });
  await h.until((f) => f.includes('TestDB'));
  h.press(':'); // focus the editor → SQL input focused
  await h.until((f) => f.includes('⏎ run'));

  await h.type('SELECT 7 AS n'); // onInput → setQuery (store synced)
  await h.until((f) => f.includes('SELECT 7 AS n'));
  h.enter(); // onSubmit → executeQuery

  // The result surface shows the column and value.
  await h.until((f) => f.includes('Result') && f.includes('7'));
  expect(h.frame()).toContain('7');
  h.cleanup();
});
