/**
 * Cell edit via the native <input>: e seeds the input with the cell value, typing
 * replaces it, Enter stages a confirm carrying the typed value. Proves the seed +
 * submit path of the native edit input end-to-end.
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

const DB = join(tmpdir(), `lazysql-edit-${process.pid}.db`);
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
  db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT);');
  db.exec("INSERT INTO t VALUES (1,'alpha');");
  db.close();
});
afterAll(() => rmSync(DB, { force: true }));

test('e seeds the input with the cell, typing + Enter stages the new value', async () => {
  const h = await renderTest(<Root connectionService={svc} initial={profile} />, {
    width: 110,
    height: 24,
  });
  await h.until((f) => f.includes('TestDB'));
  h.enter(); // open table
  await h.until((f) => f.includes('alpha'));

  h.press('l'); // move to the name column
  h.press('e'); // begin edit → native input seeded with "alpha"
  await h.until((f) => f.includes('name ='));
  expect(h.frame()).toContain('alpha'); // seeded with the current value

  await h.type('ZZ'); // append → "alphaZZ"
  h.enter(); // submit → confirm carries the value

  await h.until((f) => f.includes('confirm') || f.includes('UPDATE'));
  expect(h.frame()).toContain('alphaZZ');
  h.cleanup();
});
