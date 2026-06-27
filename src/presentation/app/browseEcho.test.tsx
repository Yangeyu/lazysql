/**
 * Browse echo: while a table is open and the editor is empty, the SQL panel
 * echoes the exact statement the adapter ran (value-inlined, read-only), and it
 * tracks the browse state — sorting updates the ORDER BY. Driven through the real
 * Root so it exercises the whole chain: store.load → BrowsePreviewable →
 * dialect.browseQuery → inlineParams → QueryEditor.
 */

import React from 'react';
import { test, beforeAll, afterAll, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { renderTest } from '../testing/renderTest.ts';
import { Root } from './Root.tsx';
import { createDataSource } from '../../adapters/datasource/registry.ts';
import { openConnection } from '../../application/usecases/OpenConnection.ts';
import type { ConnectionService } from '../../application/ports/ConnectionService.ts';

const DB = join(tmpdir(), `lazysql-echo-${process.pid}.db`);
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
  db.exec('CREATE TABLE board_data (id TEXT, name TEXT);');
  db.exec("INSERT INTO board_data VALUES ('a','alpha'),('b','beta');");
  db.close();
});
afterAll(() => rmSync(DB, { force: true }));

test('the SQL panel echoes the browse statement and tracks sorting', async () => {
  const h = await renderTest(<Root connectionService={svc} initial={profile} />, {
    width: 120,
    height: 30,
  });
  await h.until((f) => f.includes('board_data'));
  h.enter(); // open the table → browse
  await h.until((f) => f.includes('alpha'));

  // Opening echoes the exact statement the adapter ran (value-inlined), unsorted.
  expect(h.frame()).toContain('SELECT * FROM "board_data" LIMIT 100 OFFSET 0');

  h.press('s'); // sort the cursor column (ascending)
  await h.until((f) => f.includes('ORDER BY'));
  expect(h.frame()).toContain('SELECT * FROM "board_data" ORDER BY "id" ASC LIMIT 100 OFFSET 0');
  h.cleanup();
});

test('a typed query takes over the SQL line (echo only shows while empty)', async () => {
  const h = await renderTest(<Root connectionService={svc} initial={profile} />, {
    width: 120,
    height: 30,
  });
  await h.until((f) => f.includes('board_data'));
  h.enter();
  await h.until((f) => f.includes('alpha'));
  expect(h.frame()).toContain('SELECT * FROM "board_data" LIMIT 100 OFFSET 0'); // echo shown

  h.press(':'); // focus the editor
  await h.until((f) => f.includes('⏎ run')); // editor hint = focused
  h.type('SELECT 42'); // start typing — the user's query replaces the echo
  await h.until((f) => f.includes('SELECT 42'));
  expect(h.frame()).not.toContain('FROM "board_data" LIMIT 100'); // echo gone
  h.cleanup();
});
