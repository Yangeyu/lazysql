/**
 * The SQL editor as a live window onto the current result's statement:
 *   • after running a query the editor echoes that query (its placeholder), so
 *     the SQL on screen always matches the grid;
 *   • `a` re-browses the selected table as a clean SELECT *;
 *   • Tab toggles only tree ↔ results (never lands in the editor);
 *   • auto-generated browse statements never enter the ↑/↓ history.
 * Driven end-to-end through the real Root over a SQLite source.
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

const DB = join(tmpdir(), `lazysql-stmt-${process.pid}.db`);
const noSecrets = { get: async () => null, set: async () => {}, delete: async () => {} } as any;
const profile = { id: 't', name: 'StmtDB', driver: 'sqlite' as const, options: { file: DB } };
const svc: ConnectionService = {
  list: async () => [profile],
  open: (p) => openConnection(p, { factory: createDataSource, secrets: noSecrets }),
  save: async () => {},
  remove: async () => {},
};

beforeAll(() => {
  const db = new Database(DB, { create: true });
  db.exec('CREATE TABLE widgets (id INTEGER, name TEXT);');
  db.exec("INSERT INTO widgets VALUES (1,'alpha'),(2,'beta');");
  db.close();
});
afterAll(() => rmSync(DB, { force: true }));

const mount = () => renderTest(<Root connectionService={svc} initial={profile} />, { width: 120, height: 30 });
const status = (f: string) => f.trimEnd().split('\n').at(-1) ?? '';

test('after a run the editor echoes the executed query; `a` returns to a clean browse', async () => {
  const h = await mount();
  await h.until((f) => f.includes('widgets'));
  h.enter(); // browse the table
  await h.until((f) => f.includes('alpha'));
  expect(h.frame()).toContain('SELECT * FROM "widgets" LIMIT 100 OFFSET 0'); // browse echo

  h.press(':');
  await h.until((f) => f.includes('⏎ run'));
  await h.type('SELECT 42 AS answer');
  h.enter();
  // The result shows, and the editor now echoes the query that produced it.
  await h.until((f) => f.includes('answer') && f.includes('42'));
  expect(h.frame()).toContain('SELECT 42 AS answer');

  h.press('a'); // focus is on the grid after a run → browse the selected table
  await h.until((f) => f.includes('SELECT * FROM "widgets" LIMIT 100 OFFSET 0'));
  expect(h.frame()).toContain('alpha'); // back to the table's rows
  h.cleanup();
});

test('Tab toggles tree ↔ results only, never the editor', async () => {
  const h = await mount();
  await h.until((f) => status(f).includes('k/j move')); // starts on the tree
  h.tab();
  await h.until((f) => status(f).includes('inspect')); // → results grid
  h.tab();
  await h.until((f) => status(f).includes('k/j move')); // → back to tree
  expect(status(h.frame())).not.toContain('tab complete'); // editor never in the cycle
  h.cleanup();
});

test('a browse statement never enters the editor history', async () => {
  const h = await mount();
  await h.until((f) => f.includes('widgets'));
  h.press(':');
  await h.until((f) => f.includes('⏎ run'));
  await h.type('SELECT 7 AS lucky');
  h.enter();
  await h.until((f) => f.includes('lucky') && f.includes('7'));

  h.press('a'); // browse the table (generates SELECT * — must NOT be recorded)
  await h.until((f) => f.includes('alpha'));

  h.press(':');
  await h.until((f) => f.includes('⏎ run'));
  h.arrow('up'); // history: the most recent entry must be the typed query, not the browse
  await h.until((f) => f.includes('SELECT 7 AS lucky'));
  expect(h.frame()).not.toContain('SELECT * FROM "widgets" LIMIT');
  h.cleanup();
});
