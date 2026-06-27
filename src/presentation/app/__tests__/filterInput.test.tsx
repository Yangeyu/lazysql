/**
 * Filter via the native <input>: pressing / focuses a real OpenTUI input; typing
 * goes to it (not the grid keymap), and Enter submits its value to commitFilter,
 * which reloads the grid filtered. Proves the native-widget + keymap coexistence
 * end-to-end through the real Root.
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

const DB = join(tmpdir(), `lazysql-filter-${process.pid}.db`);
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
  db.exec('CREATE TABLE t (id TEXT, name TEXT);');
  db.exec("INSERT INTO t VALUES ('a','alpha'),('b','beta');");
  db.close();
});
afterAll(() => rmSync(DB, { force: true }));

test('/ focuses the native input; typing + Enter filters the grid', async () => {
  const h = await renderTest(<Root connectionService={svc} initial={profile} />, {
    width: 100,
    height: 24,
  });
  await h.until((f) => f.includes('TestDB'));
  h.enter(); // open the table
  await h.until((f) => f.includes('alpha') && f.includes('beta'));

  h.press('/'); // begin filter on the id column → native input mounts, focused
  await h.until((f) => f.includes('contains'));
  await h.type('a'); // goes to the input, not the grid
  h.enter(); // submit → commitFilter('a')

  // id 'a' contains 'a' (kept); id 'b' does not (dropped).
  await h.until((f) => f.includes('alpha') && !f.includes('beta'));
  expect(h.frame()).toContain('alpha');
  expect(h.frame()).not.toContain('beta');
  h.cleanup();
});
