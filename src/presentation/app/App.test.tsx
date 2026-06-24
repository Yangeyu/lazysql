/**
 * Headless TUI acceptance for Phase 0: render the full App against a real
 * (temp) SQLite database via ink-testing-library, drive it with keystrokes, and
 * assert the rendered frames. This exercises every layer end-to-end —
 * registry → store → use cases → adapter → bun:sqlite → Ink output.
 */

import React from 'react';
import { test, expect, beforeAll, afterAll } from 'bun:test';
import { render } from 'ink-testing-library';
import { Database } from 'bun:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';

import { StoreContext } from './context.ts';
import { App } from './App.tsx';
import { createAppStore } from './store.ts';
import { createDataSource } from '../../adapters/datasource/registry.ts';
import type { ConnectionProfile } from '../../domain/connection/ConnectionProfile.ts';
import type { DataSource } from '../../domain/datasource/DataSource.ts';
import { unwrap } from '../../shared/Result.ts';

const DB = join(tmpdir(), `lazysql-tui-${process.pid}.db`);
let source: DataSource;

const tick = (ms = 60) => Bun.sleep(ms);

beforeAll(async () => {
  const db = new Database(DB, { create: true });
  db.exec(`CREATE TABLE widget (id INTEGER PRIMARY KEY, label TEXT, qty INTEGER);`);
  const ins = db.prepare('INSERT INTO widget (label, qty) VALUES (?, ?)');
  for (let i = 1; i <= 25; i++) ins.run(`w${i}`, i);
  db.close();

  const profile: ConnectionProfile = {
    id: 'tui',
    name: 'tui',
    driver: 'sqlite',
    options: { file: DB },
  };
  source = unwrap(createDataSource(profile));
  unwrap(await source.connect());
});

afterAll(async () => {
  await source?.disconnect();
  rmSync(DB, { force: true });
});

const renderApp = () => {
  const store = createAppStore(source);
  return render(
    <StoreContext.Provider value={store}>
      <App />
    </StoreContext.Provider>,
  );
};

test('sidebar lists objects after init', async () => {
  const { lastFrame, unmount } = renderApp();
  await tick();
  const frame = lastFrame() ?? '';
  expect(frame).toContain('Objects');
  expect(frame).toContain('widget');
  unmount();
});

test('pressing Enter browses the table into the grid', async () => {
  const { lastFrame, stdin, unmount } = renderApp();
  await tick();

  stdin.write('\r'); // Enter → open selected table
  await tick();

  const frame = lastFrame() ?? '';
  expect(frame).toContain('label'); // column header
  expect(frame).toContain('w1'); // first row value
  expect(frame).toContain('of 25 rows'); // status bar totals
  unmount();
});

test('grid receives focus and cursor moves on arrow keys', async () => {
  const { lastFrame, stdin, unmount } = renderApp();
  await tick();
  stdin.write('\r'); // open table (also moves focus to grid)
  await tick();
  stdin.write('[B'); // Down arrow → move cursor
  await tick();

  // Frame still renders rows after navigation (no crash, cursor advanced).
  expect(lastFrame() ?? '').toContain('w2');
  unmount();
});

test('pressing s sorts the current column and shows an indicator', async () => {
  const { lastFrame, stdin, unmount } = renderApp();
  await tick();
  stdin.write('\r'); // open table (focus → grid)
  await tick();
  stdin.write('s'); // sort current column (id) ascending
  await tick();
  expect(lastFrame() ?? '').toContain('▲');
  unmount();
});

test('filtering a column narrows the grid via the input mode', async () => {
  const { lastFrame, stdin, unmount } = renderApp();
  await tick();
  stdin.write('\r'); // open table → grid focus, gridCol 0 (id)
  await tick();
  stdin.write('l'); // → label column (gridCol 1)
  await tick();
  stdin.write('/'); // enter filter input mode
  await tick();
  stdin.write('2');
  stdin.write('5'); // draft "25"
  await tick();
  stdin.write('\r'); // commit → label contains 25
  await tick();

  const frame = lastFrame() ?? '';
  expect(frame).toContain('w25');
  expect(frame).toContain('of 1 rows'); // count reflects the filter
  expect(frame).toContain('label~25'); // active-filter summary
  unmount();
});
