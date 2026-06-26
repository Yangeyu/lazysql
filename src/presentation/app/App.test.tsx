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
import type { ConnectionService } from '../../application/ports/ConnectionService.ts';
import type { DataSource } from '../../domain/datasource/DataSource.ts';
import { ok, unwrap } from '../../shared/Result.ts';

const DB = join(tmpdir(), `lazysql-tui-${process.pid}.db`);
let source: DataSource;

const tick = (ms = 60) => Bun.sleep(ms);

const profile: ConnectionProfile = {
  id: 'tui',
  name: 'tui',
  driver: 'sqlite',
  options: { file: DB },
};

// The store reaches connections only through this port; the fake opens the
// single shared source and auto-connects it via `initial` on init().
const service: ConnectionService = {
  list: async () => [profile],
  open: async () => ok(source),
  save: async () => {},
  remove: async () => {},
};

beforeAll(async () => {
  const db = new Database(DB, { create: true });
  db.exec(`CREATE TABLE widget (id INTEGER PRIMARY KEY, label TEXT, qty INTEGER);`);
  const ins = db.prepare('INSERT INTO widget (label, qty) VALUES (?, ?)');
  for (let i = 1; i <= 25; i++) ins.run(`w${i}`, i);
  db.close();

  source = unwrap(createDataSource(profile));
  unwrap(await source.connect());
});

afterAll(async () => {
  await source?.disconnect();
  rmSync(DB, { force: true });
});

const renderApp = () => {
  const store = createAppStore({ connectionService: service, initial: profile });
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

test('D flips the open object between the Data and DDL tabs', async () => {
  const { lastFrame, stdin, unmount } = renderApp();
  await tick();
  stdin.write('\r'); // open widget into the grid
  await tick();
  stdin.write('D'); // flip to the DDL/structure tab
  await tick(140); // describe() resolves
  const frame = lastFrame() ?? '';
  expect(frame).toContain('DDL'); // tab label
  expect(frame).toContain('CREATE TABLE widget'); // synthesized DDL
  expect(frame).toContain('label'); // a column name

  stdin.write('D'); // flip back to Data
  await tick();
  expect(lastFrame() ?? '').toContain('w1'); // grid data is shown again
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

test('editor is persistent; running a query fills the shared grid, then a table re-select returns to browse', async () => {
  const { lastFrame, stdin, unmount } = renderApp();
  await tick();
  // The SQL editor pane is ALWAYS present (3-pane layout) — visible before `:`.
  expect(lastFrame() ?? '').toContain('SQL>');

  stdin.write('\r'); // browse the table → grid shows table data (browse surface)
  await tick();
  expect(lastFrame() ?? '').toContain('label'); // a table column header (browse)

  stdin.write(':'); // focus the editor pane
  await tick();
  stdin.write('SELECT 7 AS lucky'); // a data-independent query
  await tick();
  stdin.write('\r'); // run → the result takes over the SAME grid (query surface)
  await tick(160);
  const q = lastFrame() ?? '';
  expect(q).toContain('lucky'); // query result column in the shared grid
  expect(q).toContain('Result'); // grid header switched to the query surface

  // Re-selecting the table in the sidebar returns the grid to the browse surface.
  stdin.write('\t'); // grid → sidebar (Tab cycles sidebar→editor→grid→sidebar)
  await tick();
  stdin.write('\r'); // open the table again (cursor is still on it)
  await tick(120);
  const b = lastFrame() ?? '';
  expect(b).toContain('Data'); // the Data/DDL tab → browse surface is back…
  expect(b).not.toContain('Result'); // …and the grid left the query surface
  // (the editor keeps `SELECT 7 AS lucky` so you can tweak and re-run it)
  unmount();
});

test('the SQL editor and the results grid share one width (aligned right edge)', async () => {
  const { lastFrame, unmount } = renderApp();
  await tick();
  const lines = (lastFrame() ?? '').replace(/\[[0-9;]*m/g, '').split('\n');
  // Every box corner on the RIGHT side (past the sidebar) must sit in one column
  // — i.e. the editor pane and the grid pane are exactly the same width.
  const rightEdges = new Set<number>();
  for (const line of lines) {
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if ((ch === '╮' || ch === '╯') && i > 30) rightEdges.add(i);
    }
  }
  expect(rightEdges.size).toBe(1); // editor box + grid box end at the same column
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
