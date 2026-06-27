/**
 * The lazygit-style navigation + write-safety additions, driven end-to-end over
 * a real SQLite source: the row-position indicator (↕), g/G + pane-jump keys,
 * the rows-affected badge, and the unqualified-write confirm guard.
 */

import React from 'react';
import { test, beforeEach, afterAll, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { renderTest } from '../../testing/renderTest.ts';
import { Root } from '../Root.tsx';
import { createDataSource } from '../../../adapters/datasource/registry.ts';
import { openConnection } from '../../../application/usecases/OpenConnection.ts';
import type { ConnectionService } from '../../../application/ports/ConnectionService.ts';

const DB = join(tmpdir(), `lazysql-navguard-${process.pid}.db`);
const noSecrets = { get: async () => null, set: async () => {}, delete: async () => {} } as any;
const profile = { id: 't', name: 'NavDB', driver: 'sqlite' as const, options: { file: DB } };
const svc: ConnectionService = {
  list: async () => [profile],
  open: (p) => openConnection(p, { factory: createDataSource, secrets: noSecrets }),
  save: async () => {},
  remove: async () => {},
};

beforeEach(() => {
  const db = new Database(DB, { create: true });
  db.exec('DROP TABLE IF EXISTS t; CREATE TABLE t (id INTEGER);');
  db.exec('INSERT INTO t (id) VALUES (1), (2), (3);');
  db.close();
});
afterAll(() => rmSync(DB, { force: true }));

const mount = () => renderTest(<Root connectionService={svc} initial={profile} />, { width: 100, height: 24 });

test('row indicator + g/G move the cursor across the loaded rows', async () => {
  const h = await mount();
  await h.until((f) => f.includes('NavDB'));
  h.press(':');
  await h.until((f) => f.includes('⏎ run'));
  await h.type('SELECT id FROM t ORDER BY id');
  h.enter();
  await h.until((f) => f.includes('3 rows')); // query surface, 3 rows

  expect(h.frame()).toContain('↕1'); // cursor starts on the first row
  await h.type('G');
  await h.until((f) => f.includes('↕3')); // jump to last loaded row
  await h.type('g');
  await h.until((f) => f.includes('↕1')); // back to top
  h.cleanup();
});

test('1/2/3 jump straight to a pane', async () => {
  // The active context shows in the bottom status bar's hint line; assert on it
  // (the editor pane carries an always-visible "⏎ run" hint of its own, so the
  // frame as a whole can't tell focus). Number keys are global to the
  // navigational contexts — they fire from the tree/grid, not while typing.
  const status = (f: string) => f.trimEnd().split('\n').at(-1) ?? '';
  const h = await mount();
  await h.until((f) => f.includes('NavDB'));
  h.press('3'); // → grid
  await h.until((f) => status(f).includes('inspect'));
  h.press('1'); // → tree
  await h.until((f) => status(f).includes('k/j move'));
  h.press('2'); // → editor
  await h.until((f) => status(f).includes('tab complete'));
  h.cleanup();
});

test('a qualified UPDATE reports the rows it affected', async () => {
  const h = await mount();
  await h.until((f) => f.includes('NavDB'));
  h.press(':');
  await h.until((f) => f.includes('⏎ run'));
  await h.type('UPDATE t SET id = id + 10 WHERE id <= 2');
  h.enter();
  await h.until((f) => f.includes('2 affected')); // no confirm — runs straight through
  h.cleanup();
});

test('an unqualified DELETE is held behind a confirm; cancel does not run it', async () => {
  const h = await mount();
  await h.until((f) => f.includes('NavDB'));
  h.press(':');
  await h.until((f) => f.includes('⏎ run'));
  await h.type('DELETE FROM t');
  h.enter();
  await h.until((f) => f.includes('affects ALL rows')); // guarded, not run

  h.press('n'); // cancel
  await h.until((f) => !f.includes('affects ALL rows'));
  expect(h.frame()).not.toContain('affected'); // nothing executed
  h.cleanup();
});

test('confirming an unqualified DELETE runs it against every row', async () => {
  const h = await mount(); // beforeEach reseeds the table to three rows
  await h.until((f) => f.includes('NavDB'));
  h.press(':');
  await h.until((f) => f.includes('⏎ run'));
  await h.type('DELETE FROM t');
  h.enter();
  await h.until((f) => f.includes('affects ALL rows'));
  h.press('y'); // apply
  await h.until((f) => f.includes('3 affected')); // all three rows deleted
  h.cleanup();
});
