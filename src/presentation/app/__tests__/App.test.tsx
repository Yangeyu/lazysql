/**
 * Headless TUI acceptance: render the full App against a real (temp) SQLite
 * database through the OpenTUI test renderer, drive it with keystrokes, and
 * assert the rendered frames. This exercises every layer end-to-end —
 * registry → store → use cases → adapter → bun:sqlite → OpenTUI output.
 *
 * The tests share one DB and run in order; the edit test renames a row before
 * the delete test counts the remaining rows.
 */

import { test, expect, beforeAll, afterAll } from 'bun:test';
import { Database } from 'bun:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';

import { renderTest } from '../../testing/renderTest.ts';
import { StoreContext } from '../context.ts';
import { App } from '../App.tsx';
import { createAppStore } from '../store.ts';
import { createDataSource } from '../../../adapters/datasource/registry.ts';
import type { ConnectionProfile } from '../../../domain/connection/ConnectionProfile.ts';
import type { ConnectionService } from '../../../application/ports/ConnectionService.ts';
import type { DataSource } from '../../../domain/datasource/DataSource.ts';
import { ok, unwrap } from '../../../shared/Result.ts';

const DB = join(tmpdir(), `lazysql-tui-${process.pid}.db`);
let source: DataSource;

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

  source = unwrap(await createDataSource(profile));
  unwrap(await source.connect());
});

afterAll(async () => {
  await source?.disconnect();
  rmSync(DB, { force: true });
});

const renderApp = (clipboard: { write: (t: string) => void } = { write: () => {} }) => {
  const store = createAppStore({ connectionService: service, initial: profile });
  return renderTest(
    <StoreContext.Provider value={store}>
      <App clipboard={clipboard} />
    </StoreContext.Provider>,
    { width: 120, height: 40 },
  );
};

test('sidebar shows the connection tree with objects after init', async () => {
  const h = await renderApp();
  await h.until((f) => f.includes('widget'));
  const frame = h.frame();
  expect(frame).toContain('Tables'); // category header
  expect(frame).toContain('widget'); // object under it
  h.cleanup();
});

test('the sidebar tree folds a category with h and reopens it with l', async () => {
  const h = await renderApp();
  await h.until((f) => f.includes('widget'));
  // Cursor starts on the first object (widget). h → parent category (Tables).
  h.press('h');
  h.press('h'); // h again → collapse Tables
  await h.until((f) => !f.includes('widget')); // object hidden when folded

  h.press('l'); // l → expand Tables again
  await h.until((f) => f.includes('widget')); // object visible again
  h.cleanup();
});

test('pressing Enter browses the table into the grid', async () => {
  const h = await renderApp();
  await h.until((f) => f.includes('widget'));
  h.enter(); // Enter → open selected table
  await h.until((f) => f.includes('label'));
  const frame = h.frame();
  expect(frame).toContain('label'); // column header
  expect(frame).toContain('w1'); // first row value
  expect(frame).toContain('of 25 rows'); // status bar totals
  h.cleanup();
});

test('grid receives focus and cursor moves on arrow keys', async () => {
  const h = await renderApp();
  await h.until((f) => f.includes('widget'));
  h.enter(); // open table (also moves focus to grid)
  await h.until((f) => f.includes('w1'));
  h.arrow('down'); // Down arrow → move cursor
  await h.until((f) => f.includes('w2'));
  expect(h.frame()).toContain('w2');
  h.cleanup();
});

test('pressing s sorts the current column and shows an indicator', async () => {
  const h = await renderApp();
  await h.until((f) => f.includes('widget'));
  h.enter(); // open table (focus → grid)
  await h.until((f) => f.includes('w1'));
  h.press('s'); // sort current column (id) ascending
  await h.until((f) => f.includes('▲'));
  expect(h.frame()).toContain('▲');
  h.cleanup();
});

test('filtering a column narrows the grid via the input mode', async () => {
  const h = await renderApp();
  await h.until((f) => f.includes('widget'));
  h.enter(); // open table → grid focus, gridCol 0 (id)
  await h.until((f) => f.includes('w1'));
  h.press('l'); // → label column (gridCol 1)
  h.press('/'); // enter filter input mode
  await h.until((f) => f.includes('contains'));
  await h.type('25'); // draft "25"
  await h.flush();
  h.enter(); // commit → label contains 25
  await h.until((f) => f.includes('of 1 rows'));
  const frame = h.frame();
  expect(frame).toContain('w25');
  expect(frame).toContain('of 1 rows'); // count reflects the filter
  expect(frame).toContain('label~25'); // active-filter summary
  h.cleanup();
});

test('editing a cell updates it after confirmation', async () => {
  const h = await renderApp();
  await h.until((f) => f.includes('widget'));
  h.enter(); // open widget → grid, gridCol 0 (id)
  await h.until((f) => f.includes('w1'));
  h.press('l'); // → label column
  h.enter(); // ⏎ → cell inspector (view mode)
  await h.until((f) => f.includes('⊞ cell'));
  h.press('e'); // e → edit mode, seeded "w1" (single entry: view → e)
  await h.until((f) => f.includes('^S save')); // edit footer proves edit mode
  await h.type('Z'); // draft "w1Z"
  await h.flush();
  h.ctrl('s'); // ^S save → confirm (Enter is a newline in the editor now)
  await h.until((f) => f.includes('confirm')); // confirmation footer
  h.press('y'); // apply the update
  await h.until((f) => f.includes('w1Z')); // grid reflects the write
  h.cleanup();
});

test('deleting a row removes it after confirmation', async () => {
  const h = await renderApp();
  await h.until((f) => f.includes('widget'));
  h.enter(); // open widget (25 rows after the edit test)
  await h.until((f) => f.includes('of 25 rows'));
  h.press('d'); // delete row under cursor → confirm
  await h.until((f) => f.includes('DELETE'));
  h.press('y'); // apply the delete
  await h.until((f) => f.includes('of 24 rows')); // one fewer row
  h.cleanup();
});

test('D flips the open object between the Data and DDL tabs', async () => {
  const h = await renderApp();
  await h.until((f) => f.includes('widget'));
  h.enter(); // open widget into the grid
  await h.until((f) => f.includes('label'));
  h.press('D'); // flip to the DDL/structure tab
  await h.until((f) => f.includes('CREATE TABLE "widget"')); // synthesized DDL (quoted)
  const frame = h.frame();
  expect(frame).toContain('DDL'); // tab label
  expect(frame).toContain('CREATE TABLE "widget"');
  expect(frame).toContain('label'); // a column name

  h.press('D'); // flip back to Data
  await h.until((f) => f.includes('w1')); // grid data is shown again
  h.cleanup();
});

test('editor is persistent; a query fills the shared grid, then re-selecting a table returns to browse', async () => {
  const h = await renderApp();
  await h.until((f) => f.includes('SQL>')); // editor always present (3-pane layout)

  h.enter(); // browse the table → grid shows table data (browse surface)
  await h.until((f) => f.includes('label'));

  h.press(':'); // focus the editor pane
  await h.flush();
  await h.type('SELECT 7 AS lucky'); // a data-independent query
  await h.flush();
  h.enter(); // run → the result takes over the SAME grid (query surface)
  await h.until((f) => f.includes('lucky'));
  expect(h.frame()).toContain('Result'); // grid header switched to the query surface

  // Re-selecting the table in the sidebar returns the grid to the browse surface.
  h.tab(); // grid → sidebar
  h.enter(); // open the table again (cursor still on it)
  await h.until((f) => f.includes('Data') && !f.includes('Result'));
  const b = h.frame();
  expect(b).toContain('Data'); // the Data/DDL tab → browse surface is back…
  expect(b).not.toContain('Result'); // …and the grid left the query surface
  h.cleanup();
});

test('the SQL editor and the results grid share one width (aligned right edge)', async () => {
  const h = await renderApp();
  await h.until((f) => f.includes('SQL>'));
  const lines = h.frame().split('\n');
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
  h.cleanup();
});

test('a query error keeps the ask row pinned, not scrolled off the top', async () => {
  const h = await renderApp();
  await h.until((f) => f.includes('SQL>'));
  h.press(':'); // focus the editor
  await h.flush();
  await h.type('NOT VALID SQL');
  await h.flush();
  h.enter(); // run → error in the feedback line
  await h.until((f) => f.includes('error'));
  const f = h.frame();
  expect(f).toContain('ask'); // the ask row survives above the SQL + error
  expect(f).toContain('error'); // and the (single-line) error is shown
  h.cleanup();
});

test('? opens the keybindings help overlay and toggles it off again', async () => {
  const h = await renderApp();
  await h.until((f) => f.includes('widget'));
  h.press('?'); // open help
  await h.until((f) => f.includes('Keybindings'));
  const frame = h.frame();
  expect(frame).toContain('Keybindings');
  expect(frame).toContain('Global'); // global group is listed
  expect(frame).toContain('Move the selection'); // sidebar binding description

  h.press('?'); // close help
  await h.until((f) => !f.includes('Keybindings'));
  expect(h.frame()).toContain('widget'); // back to the object list
  h.cleanup();
});

test('d on a sidebar table drafts a DROP into the editor (does not run it)', async () => {
  const h = await renderApp();
  await h.until((f) => f.includes('widget')); // cursor seated on the table object
  h.press('d'); // draft the DROP, focus the editor
  await h.until((f) => f.includes('DROP TABLE "widget"'));
  const frame = h.frame();
  expect(frame).toContain('DROP TABLE "widget"'); // quoted draft, awaiting review
  expect(frame).toContain('SQL>'); // editor is focused
  expect(frame).toContain('widget'); // the table still exists — nothing ran
  h.cleanup();
});

test('schema-aware completion completes a table name on Tab', async () => {
  const h = await renderApp();
  await h.until((f) => f.includes('widget'));
  h.press(':'); // query view → catalog builds (introspect + describe)
  await h.until((f) => f.includes('SQL>'));
  await h.type('SELECT * FROM wi'); // partial table name
  await h.until((f) => f.includes('⇥')); // completion hint is shown
  h.tab(); // Tab → accept the top candidate
  await h.until((f) => f.includes('FROM widget')); // completed to "widget"
  expect(h.frame()).toContain('FROM widget');
  h.cleanup();
});

test('y in the cell inspector copies the full value to the clipboard', async () => {
  const copied: string[] = [];
  const h = await renderApp({ write: (t) => copied.push(t) });
  await h.until((f) => f.includes('widget'));
  h.enter(); // open widget → grid, cursor on row 0 col 0 (id)
  await h.until((f) => f.includes('label')); // grid populated
  h.press('l'); // → the label column (values are w2..w25)
  h.enter(); // ⏎ on the focused cell → cell inspector
  await h.until((f) => f.includes('⊞ cell'));
  h.press('y'); // yank the full value
  await h.flush();
  // The DB is shared and mutated by earlier tests, so assert the shape, not a
  // fixed value: exactly one copy, and it's a `w…` label, proving y yanked the
  // inspected cell's real value through the injected clipboard.
  expect(copied.length).toBe(1);
  expect(copied[0]).toMatch(/^w\d+$/);
  h.cleanup();
});
