/**
 * Mouse integration: with native OpenTUI mouse events, each rendered row carries
 * its own onMouseDown — there is no coordinate hit-testing to drift. Driven
 * through the real App so a click resolves to the actual pane/row under it. Rows
 * are located by their rendered content (robust to layout shifts), then clicked.
 */

import { test, beforeAll, afterAll, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { renderTest, type TestHandle } from '../../testing/renderTest.ts';
import { Root } from '../Root.tsx';
import { createDataSource } from '../../../adapters/datasource/registry.ts';
import { openConnection } from '../../../application/usecases/OpenConnection.ts';
import type { ConnectionService } from '../../../application/ports/ConnectionService.ts';

const DB = join(tmpdir(), `lazysql-mouse-${process.pid}.db`);
const noSecrets = { get: async () => null, set: async () => {}, delete: async () => {} } as any;
const profile = { id: 't', name: 'TestDB', driver: 'sqlite' as const, options: { file: DB } };
const svc: ConnectionService = {
  list: async () => [profile],
  open: (p) => openConnection(p, { factory: createDataSource, secrets: noSecrets }),
  save: async () => {},
  remove: async () => {},
};

/** Screen row (0-based) of the first frame line containing `needle`, or -1. */
const lineY = (h: TestHandle, needle: string): number =>
  h.frame().split('\n').findIndex((l) => l.includes(needle));

beforeAll(() => {
  const db = new Database(DB, { create: true });
  db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT);');
  db.exec("INSERT INTO t (name) VALUES ('alpha'), ('beta'), ('gamma');"); // ids 1,2,3
  db.close();
});
afterAll(() => rmSync(DB, { force: true }));

test('clicking the main pane focuses the grid; clicking the sidebar refocuses it', async () => {
  const h = await renderTest(<Root connectionService={svc} initial={profile} />, {
    width: 120,
    height: 30,
  });
  await h.until((f) => f.includes('Tables')); // tree ready, cursor on object `t`
  h.enter(); // open the object → grid populated, focus on grid
  await h.until((f) => f.includes('alpha'));

  await h.click(5, lineY(h, '[SQLite]')); // a sidebar tree row
  await h.until((f) => f.includes('TREE')); // sidebar context badge
  expect(h.frame()).toContain('TREE');

  await h.click(50, lineY(h, 'alpha')); // a grid data row
  await h.until((f) => f.includes('DATA')); // grid context badge
  expect(h.frame()).toContain('DATA');
  h.cleanup();
});

test('clicking a grid row selects that row (delete confirm shows its key)', async () => {
  const h = await renderTest(<Root connectionService={svc} initial={profile} />, {
    width: 120,
    height: 30,
  });
  await h.until((f) => f.includes('Tables')); // tree ready, cursor on object `t`
  h.enter(); // open table t → grid, cursor on row 0 (id 1)
  await h.until((f) => f.includes('gamma'));

  await h.click(50, lineY(h, 'gamma')); // the 3rd data row (id 3)
  await h.flush();
  h.press('d'); // delete → confirmation shows the clicked row's primary key
  await h.until((f) => f.includes('DELETE'));
  // id 3 (not 1) proves the click moved the cursor to the 3rd row; the preview
  // is now the dialect's own quoted SQL.
  expect(h.frame()).toContain('"id" = 3');
  h.press('n'); // cancel — do not actually delete
  h.cleanup();
});

test('clicking a cell selects its column, not just its row', async () => {
  const h = await renderTest(<Root connectionService={svc} initial={profile} />, {
    width: 120,
    height: 30,
  });
  await h.until((f) => f.includes('Tables'));
  h.enter(); // open table t (columns: id, name) → cursor on row 0, col 0 (id)
  await h.until((f) => f.includes('beta'));

  // Click the `name` cell of the `beta` row — a different row AND a different
  // column than the starting (row 0, id) cursor.
  const y = lineY(h, 'beta');
  const x = h.frame().split('\n')[y]!.indexOf('beta');
  await h.click(x, y);
  await h.flush();

  h.enter(); // open the cell inspector on the cell under the cursor
  await h.until((f) => f.includes('⊞ cell'));
  // The inspector titles itself with the selected column — `name`, not `id`,
  // proves the click moved the COLUMN cursor (and the value is beta's name).
  expect(h.frame()).toMatch(/⊞ cell\s+name/);
  h.esc();
  h.cleanup();
});

test('dragging over grid text selects it and copies to the clipboard', async () => {
  const copied: string[] = [];
  const clipboard = { write: (t: string) => copied.push(t) };
  const h = await renderTest(
    <Root connectionService={svc} initial={profile} clipboard={clipboard} />,
    { width: 120, height: 30 },
  );
  await h.until((f) => f.includes('Tables'));
  h.enter(); // open table t → grid with rows
  await h.until((f) => f.includes('gamma'));

  // Drag across the `name` cell of the gamma row — selectable text builds a
  // selection the renderer hands to the injected clipboard via Root.
  const y = lineY(h, 'gamma');
  const x = h.frame().split('\n')[y]!.indexOf('gamma');
  await h.drag(x, y, x + 5, y);
  await h.flush();

  expect(h.selectedText()).toContain('gamma'); // selection formed…
  expect(copied.some((t) => t.includes('gamma'))).toBe(true); // …and was copied
  h.cleanup();
});

test('clicking a sidebar row selects that row (Enter then acts on it)', async () => {
  const h = await renderTest(<Root connectionService={svc} initial={profile} />, {
    width: 120,
    height: 30,
  });
  await h.until((f) => f.includes('Tables'));

  await h.click(5, lineY(h, '[SQLite]')); // the connection root (row 0)
  await h.flush();
  h.enter(); // Enter on the active root → collapse its schema
  // Collapsed: the category is hidden — proves row 0 (not `t`) was selected.
  await h.until((f) => !f.includes('Tables'));
  expect(h.frame()).not.toContain('Tables');
  h.cleanup();
});
