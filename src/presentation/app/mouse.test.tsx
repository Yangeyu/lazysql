/**
 * Mouse integration: an SGR mouse-press resolves to a pane AND the list row under
 * it (hitTest), then focuses/selects it. Driven through the real App so it
 * exercises useMouse + hitTest + the store click actions against the actual
 * render geometry — the test that catches a drift between the chrome offsets and
 * what's drawn. A fixed terminal size makes the row coordinates deterministic.
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
const strip = (s: string): string => s.replace(/\[[0-9;]*m/g, '');
// SGR press at 1-based (col, row); the hook reports them 0-based (−1 each).
const click = (x: number, y: number) => `\x1b[<0;${x};${y}M`;

// Force a known terminal size so list-row screen coordinates are deterministic:
// rows 30 → editorRows 7, flush (no gap) → grid data row 0 sits at screen y=12 (1+7+4).
const withSize = async (run: () => Promise<void>): Promise<void> => {
  const cols = process.stdout.columns;
  const rows = process.stdout.rows;
  (process.stdout as { columns: number }).columns = 120;
  (process.stdout as { rows: number }).rows = 30;
  try {
    await run();
  } finally {
    (process.stdout as { columns?: number }).columns = cols;
    (process.stdout as { rows?: number }).rows = rows;
  }
};

beforeAll(() => {
  const db = new Database(DB, { create: true });
  db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT);');
  db.exec("INSERT INTO t (name) VALUES ('a'), ('b'), ('c');"); // ids 1,2,3
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
  expect(strip(lastFrame() ?? '')).toContain('TREE');
  stdin.write(click(60, 14)); // click in the main grid pane
  await tick(40);
  expect(strip(lastFrame() ?? '')).toContain('DATA');
});

test('clicking a grid row selects that row (delete confirm shows its key)', async () => {
  await withSize(async () => {
    const { lastFrame, stdin } = render(<Root connectionService={svc} initial={profile} />);
    await tick(220);
    stdin.write('\r'); // open table t → grid, cursor on row 0 (id 1)
    await tick(160);
    stdin.write(click(61, 15)); // 0-based (60, 14) → the 3rd data row (id 3)
    await tick(60);
    stdin.write('d'); // delete → confirmation shows the clicked row's primary key
    await tick(60);
    // id=3 (not id=1) proves the click moved the cursor to the 3rd row.
    expect(strip(lastFrame() ?? '')).toContain('id=3');
    stdin.write('n'); // cancel — do not actually delete
    await tick(40);
  });
});

test('clicking a sidebar row selects that row (Enter then acts on it)', async () => {
  await withSize(async () => {
    const { lastFrame, stdin } = render(<Root connectionService={svc} initial={profile} />);
    await tick(220);
    // Tree: TestDB (row 0), Tables (row 1), t (row 2); the cursor starts on `t`.
    stdin.write(click(5, 4)); // 0-based (4, 3) → the connection root (row 0)
    await tick(40);
    stdin.write('\r'); // Enter on the active root → collapse its schema
    await tick(80);
    // Collapsed: the category/object are hidden — proves row 0 (not `t`) was selected.
    expect(strip(lastFrame() ?? '')).not.toContain('Tables');
  });
});
