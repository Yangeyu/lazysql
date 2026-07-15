/**
 * The SQL editor's two gears (ADR 0013): collapsed by default to a one-line
 * echo bar, expanded via `:`/^O into the full editing pane — and STICKY:
 * running a query or moving focus never flips the gear, so the edit→run→inspect
 * loop causes no layout jumps.
 */

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

const DB = join(tmpdir(), `lazysql-editorgear-${process.pid}.db`);
const noSecrets = { get: async () => null, set: async () => {}, delete: async () => {} } as any;
const profile = { id: 't', name: 'GearDB', driver: 'sqlite' as const, options: { file: DB } };
const svc: ConnectionService = {
  list: async () => [profile],
  open: (p) => openConnection(p, { factory: createDataSource, secrets: noSecrets }),
  save: async () => {},
  remove: async () => {},
};

beforeEach(() => {
  const db = new Database(DB, { create: true });
  db.exec('DROP TABLE IF EXISTS t; CREATE TABLE t (id INTEGER);');
  db.exec('INSERT INTO t (id) VALUES (1), (2);');
  db.close();
});
afterAll(() => rmSync(DB, { force: true }));

const mount = () => renderTest(<Root connectionService={svc} initial={profile} />, { width: 100, height: 30 });

test('collapsed by default; `:` expands into the editing pane', async () => {
  const h = await mount();
  await h.until((f) => f.includes('GearDB'));

  expect(h.frame()).toContain('SQL>'); // the echo bar
  expect(h.frame()).not.toContain('⏎ run'); // no editing chrome while collapsed

  h.press(':');
  await h.until((f) => f.includes('⏎ run'));
  h.cleanup();
});

test('the gear is sticky: running a query and esc keep the pane open; ^O closes it', async () => {
  const h = await mount();
  await h.until((f) => f.includes('GearDB'));

  h.press(':');
  await h.until((f) => f.includes('⏎ run'));
  await h.type('SELECT id FROM t ORDER BY id');
  h.enter();
  await h.until((f) => f.includes('2 rows'));

  // Ran + focus moved to the grid — the pane must still be the full editor.
  expect(h.frame()).toContain('⏎ run');

  h.ctrl('o'); // collapse from the grid
  await h.until((f) => !f.includes('⏎ run'));
  // The echo bar reports the statement behind the grid — the executed query.
  expect(h.frame()).toContain('SQL> SELECT id FROM t ORDER BY id');

  h.ctrl('o'); // and back
  await h.until((f) => f.includes('⏎ run'));
  h.cleanup();
});

test('collapsing from inside the editor keeps the draft and flags it in the bar', async () => {
  const h = await mount();
  await h.until((f) => f.includes('GearDB'));

  h.press(':');
  await h.until((f) => f.includes('⏎ run'));
  await h.type('SELECT 1 + 1');

  h.ctrl('o'); // collapse while composing — focus must land in the grid
  await h.until((f) => f.includes('(draft)'));
  expect(h.frame()).not.toContain('SELECT 1 + 1'); // the draft itself is hidden

  h.press(':'); // re-entering restores the kept draft
  await h.until((f) => f.includes('SELECT 1 + 1'));
  h.cleanup();
});

test('collapse-expand keeps the caret: typing resumes where the draft was left', async () => {
  const h = await mount();
  await h.until((f) => f.includes('GearDB'));

  h.press(':');
  await h.until((f) => f.includes('⏎ run'));
  await h.type('SELECT 12345');
  h.arrow('left');
  h.arrow('left');
  h.arrow('left'); // caret between 2 and 3

  h.ctrl('o');
  await h.until((f) => f.includes('(draft)'));
  h.press(':');
  await h.until((f) => f.includes('⏎ run'));
  await h.flush();

  // The widget survives the gear flip (display:none, not unmount), so the
  // caret is its own — a remount would boot it at 0 or the end instead.
  await h.type('x');
  await h.until((f) => f.includes('SELECT 12x345'));
  h.cleanup();
});

test('completion follows the caret when editing in the middle of SQL', async () => {
  const h = await mount();
  await h.until((f) => f.includes('GearDB'));

  h.press(':');
  await h.until((f) => f.includes('⏎ run'));
  await h.type("SELECT '中文'  t");
  h.arrow('left');
  h.arrow('left');
  await h.type('FRO');
  await h.until((f) => f.includes('⇥ FROM'));

  h.tab();
  await h.until((f) => f.includes("SELECT '中文' FROM t"));
  h.cleanup();
});
