/**
 * The layout budget must equal the space the panes actually get: computeLayout's
 * chrome accounting once over-deducted a phantom "gap" row, leaving a blank line
 * inside the results panel that no unit test could see. This drives the real app
 * and asserts the grid fills its panel to the border.
 */

import { test, expect, beforeAll, afterAll } from 'bun:test';
import { Database } from 'bun:sqlite';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rmSync } from 'node:fs';
import { renderTest } from '../../testing/renderTest.ts';
import { Root } from '../Root.tsx';
import { createDataSource } from '../../../adapters/datasource/registry.ts';
import { openConnection } from '../../../application/usecases/OpenConnection.ts';
import type { ConnectionService } from '../../../application/ports/ConnectionService.ts';

const DB = join(tmpdir(), `lazysql-panelfill-${process.pid}.db`);
const noSecrets = { get: async () => null, set: async () => {}, delete: async () => {} } as any;
const profile = { id: 't', name: 'FillDB', driver: 'sqlite' as const, options: { file: DB } };
const svc: ConnectionService = {
  list: async () => [profile],
  open: (p) => openConnection(p, { factory: createDataSource, secrets: noSecrets }),
  save: async () => {},
  remove: async () => {},
};

beforeAll(() => {
  const db = new Database(DB, { create: true });
  db.exec('CREATE TABLE t (id INTEGER);');
  const stmt = db.prepare('INSERT INTO t (id) VALUES (?)');
  for (let i = 1; i <= 60; i++) stmt.run(i);
  db.close();
});
afterAll(() => rmSync(DB, { force: true }));

test('the grid fills the results panel to its border — no blank budget row', async () => {
  const h = await renderTest(<Root connectionService={svc} initial={profile} />, { width: 100, height: 30 });
  await h.until((f) => f.includes('FillDB'));
  await h.until((f) => f.includes('▦ t'));
  await h.type('j');
  await h.type('j');
  await h.type('a'); // browse the table: 60 rows, more than one screen
  await h.until((f) => f.includes('▶ 1'));
  await h.flush();

  // The line directly above the panel's bottom border must be a data row.
  const lines = h.frame().split('\n');
  const bottom = lines.findLastIndex((l) => l.includes('╰') && !l.includes('CONNECTIONS'));
  expect(bottom).toBeGreaterThan(0);
  const lastBodyLine = lines[bottom - 1] ?? '';
  expect(lastBodyLine.replace(/[│\s]/gu, '')).not.toBe('');
  h.cleanup();
});
