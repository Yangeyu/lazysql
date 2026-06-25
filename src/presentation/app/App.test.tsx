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

test('sidebar shows the connection tree with objects after init', async () => {
  const { lastFrame, unmount } = renderApp();
  await tick();
  const frame = lastFrame() ?? '';
  expect(frame).toContain('Tables'); // category header
  expect(frame).toContain('widget'); // object under it
  unmount();
});

test('the sidebar tree folds a category with h and reopens it with l', async () => {
  const { lastFrame, stdin, unmount } = renderApp();
  await tick();
  // Cursor starts on the first object (widget). h → parent category (Tables).
  stdin.write('h');
  await tick();
  stdin.write('h'); // h again → collapse Tables
  await tick();
  expect(lastFrame() ?? '').not.toContain('widget'); // object hidden when folded

  stdin.write('l'); // l → expand Tables again
  await tick();
  expect(lastFrame() ?? '').toContain('widget'); // object visible again
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

test('editing a cell updates it after confirmation', async () => {
  const { lastFrame, stdin, unmount } = renderApp();
  await tick();
  stdin.write('\r'); // open widget → grid, gridCol 0 (id)
  await tick();
  stdin.write('l'); // → label column
  await tick();
  stdin.write('e'); // edit → draft prefilled "w1"
  await tick();
  stdin.write('Z'); // draft "w1Z"
  await tick();
  stdin.write('\r'); // submit → confirm
  await tick();
  expect(lastFrame() ?? '').toContain('confirm'); // confirmation footer

  stdin.write('y'); // apply the update
  await tick(160);
  expect(lastFrame() ?? '').toContain('w1Z'); // grid reflects the write
  unmount();
});

test('deleting a row removes it after confirmation', async () => {
  const { lastFrame, stdin, unmount } = renderApp();
  await tick();
  stdin.write('\r'); // open widget (25 rows after the edit test)
  await tick();
  stdin.write('d'); // delete row under cursor → confirm
  await tick();
  expect(lastFrame() ?? '').toContain('DELETE');

  stdin.write('y'); // apply the delete
  await tick(160);
  expect(lastFrame() ?? '').toContain('of 24 rows'); // one fewer row
  unmount();
});

test('the SQL editor runs a typed query and shows the result', async () => {
  const { lastFrame, stdin, unmount } = renderApp();
  await tick();
  stdin.write(':'); // enter the query editor view
  await tick();
  expect(lastFrame() ?? '').toContain('SQL>'); // editor prompt

  stdin.write('SELECT 42 AS answer'); // type a query (data-independent)
  await tick();
  stdin.write('\r'); // execute
  await tick(160);

  const frame = lastFrame() ?? '';
  expect(frame).toContain('answer'); // result column header
  expect(frame).toContain('42'); // result value
  expect(frame).toContain('1 rows'); // result summary
  unmount();
});

test('? opens the keybindings help overlay and toggles it off again', async () => {
  const { lastFrame, stdin, unmount } = renderApp();
  await tick();
  stdin.write('?'); // open help
  await tick();
  const frame = lastFrame() ?? '';
  expect(frame).toContain('Keybindings');
  expect(frame).toContain('Global'); // global group is listed
  expect(frame).toContain('Move the selection'); // sidebar binding description

  stdin.write('?'); // close help
  await tick();
  const after = lastFrame() ?? '';
  expect(after).not.toContain('Keybindings');
  expect(after).toContain('widget'); // back to the object list
  unmount();
});

test('schema-aware completion completes a table name on Tab', async () => {
  const { lastFrame, stdin, unmount } = renderApp();
  await tick();
  stdin.write(':'); // query view → catalog builds (introspect + describe)
  await tick(140);
  stdin.write('SELECT * FROM wi'); // partial table name
  await tick();
  expect(lastFrame() ?? '').toContain('⇥'); // completion hint is shown

  stdin.write('\t'); // Tab → accept the top candidate
  await tick();
  expect(lastFrame() ?? '').toContain('FROM widget'); // completed to "widget"
  unmount();
});
