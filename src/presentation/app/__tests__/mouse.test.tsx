/**
 * Mouse integration: native OpenTUI events let interactive panes own their
 * click behavior while text selection stays native. Driven through the real App
 * so events resolve to the actual rendered target without coordinate hit-testing.
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

const hasContext = (frame: string, label: string): boolean =>
  frame.split('\n').some((line) => line.trimStart().startsWith(`${label} `));

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

test('dragging over the collapsed SQL echo copies exact text without entering the editor', async () => {
  const copied: string[] = [];
  const clipboard = { write: (t: string) => copied.push(t) };
  const h = await renderTest(
    <Root connectionService={svc} initial={profile} clipboard={clipboard} />,
    { width: 120, height: 30 },
  );
  await h.until((f) => f.includes('Tables'));
  h.enter(); // browse table t → grid focused, SQL pane still collapsed
  await h.until((f) => f.includes('SQL> SELECT') && f.includes('alpha'));

  const y = lineY(h, 'SQL> SELECT');
  const x = h.frame().split('\n')[y]!.indexOf('SELECT');
  await h.drag(x, y, x + 'SELECT'.length, y);
  await h.flush();

  expect(h.selectedText()).toBe('SELECT');
  expect(copied).toContain('SELECT');
  expect(h.frame()).toContain('DATA'); // mouse selection leaves keyboard focus on the grid
  expect(h.frame()).not.toContain('⏎ run'); // and does not expand the echo bar
  h.cleanup();
});

test('clicking the expanded SQL pane focuses the editor and accepts typing', async () => {
  const h = await renderTest(<Root connectionService={svc} initial={profile} />, {
    width: 120,
    height: 30,
  });
  await h.until((f) => f.includes('Tables'));
  h.enter();
  await h.until((f) => f.includes('alpha'));

  h.press(':');
  await h.until((f) => f.includes('⏎ run'));
  await h.type('SELECT 42');
  h.esc();
  await h.until((f) => hasContext(f, 'DATA') && f.includes('SELECT 42'));

  const y = lineY(h, 'SELECT 42');
  const x = h.frame().split('\n')[y]!.indexOf('SELECT 42') + 'SELECT 42'.length;
  await h.click(x, y);
  await h.until((f) => hasContext(f, 'SQL'));

  await h.type('Z');
  await h.until((f) => f.includes('SELECT 42Z'));
  h.cleanup();
});

test('dragging over an expanded SQL draft focuses it while preserving copy', async () => {
  const copied: string[] = [];
  const clipboard = { write: (t: string) => copied.push(t) };
  const h = await renderTest(
    <Root connectionService={svc} initial={profile} clipboard={clipboard} />,
    { width: 120, height: 30 },
  );
  await h.until((f) => f.includes('Tables'));
  h.enter();
  await h.until((f) => f.includes('alpha'));

  h.press(':');
  await h.until((f) => f.includes('⏎ run'));
  await h.type('SELECT 42 AS exact_copy');
  h.esc();
  await h.until((f) => f.includes('DATA') && f.includes('exact_copy'));

  const y = lineY(h, 'exact_copy');
  const x = h.frame().split('\n')[y]!.indexOf('exact_copy');
  await h.drag(x, y, x + 'exact_copy'.length, y);
  await h.flush();

  expect(h.selectedText()).toBe('exact_copy');
  expect(copied).toContain('exact_copy');
  expect(hasContext(h.frame(), 'SQL')).toBe(true);
  expect(h.frame()).toContain('SELECT 42 AS exact_copy');
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
