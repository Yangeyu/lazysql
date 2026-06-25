/**
 * Mouse focus integration: an SGR mouse-press in the main pane focuses the grid,
 * a press in the sidebar focuses the tree. Driven through the real App so it
 * exercises useMouse + regionAt + focusRegion together. The status-bar context
 * badge (TREE vs DATA) reflects the focused pane.
 */

import React from 'react';
import { test, beforeAll, afterAll, expect } from 'bun:test';
import { render } from 'ink-testing-library';
import { Database } from 'bun:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { Root } from './Root.tsx';
import { createDataSource } from '../../adapters/datasource/registry.ts';
import { openConnection } from '../../application/usecases/OpenConnection.ts';
import type { ConnectionService } from '../../application/ports/ConnectionService.ts';

const DB = join(tmpdir(), `lazysql-mouse-${process.pid}.db`);
const tick = (ms = 100) => Bun.sleep(ms);
const noSecrets = { get: async () => null, set: async () => {}, delete: async () => {} } as any;
const profile = { id: 't', name: 'TestDB', driver: 'sqlite' as const, options: { file: DB } };
const svc: ConnectionService = {
  list: async () => [profile],
  open: (p) => openConnection(p, { factory: createDataSource, secrets: noSecrets }),
  save: async () => {},
  remove: async () => {},
};
// SGR press at (col, row), 1-based as terminals report.
const click = (x: number, y: number) => `\x1b[<0;${x};${y}M`;

beforeAll(() => {
  const db = new Database(DB, { create: true });
  db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT);');
  db.exec("INSERT INTO t (name) VALUES ('a');");
  db.close();
});
afterAll(() => rmSync(DB, { force: true }));

test('clicking the main pane focuses the grid; clicking the sidebar refocuses it', async () => {
  const { lastFrame, stdin } = render(<Root connectionService={svc} initial={profile} />);
  await tick(200);
  stdin.write('\r'); // open the object → grid populated, focus on grid
  await tick(120);
  stdin.write(click(5, 8)); // click inside the sidebar
  await tick(40);
  expect((lastFrame() ?? '').replace(/\[[0-9;]*m/g, '')).toContain('TREE');
  stdin.write(click(60, 8)); // click in the main grid pane
  await tick(40);
  expect((lastFrame() ?? '').replace(/\[[0-9;]*m/g, '')).toContain('DATA');
});
