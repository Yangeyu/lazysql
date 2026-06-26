import { test, expect } from 'bun:test';
import { regionAt, rowWindow, hitTest } from './layout.ts';

const L = { rows: 24, cols: 100, sidebarWidth: 28 };

// editorRows 5 → grid border/tab/header/sep put data row 0 at screen y = 1+5+4.
const HL = {
  rows: 24,
  cols: 100,
  sidebarWidth: 28,
  editorRows: 5,
  gridTop: 0,
  treeLen: 3,
  gridLen: 10,
};

test('the header row and status row are not focus targets', () => {
  expect(regionAt(L, 10, 0)).toBeNull(); // header
  expect(regionAt(L, 10, 23)).toBeNull(); // status (rows-1)
});

test('clicks inside the sidebar width focus the sidebar', () => {
  expect(regionAt(L, 0, 5)).toBe('sidebar');
  expect(regionAt(L, 28, 5)).toBe('sidebar');
});

test('clicks past the sidebar focus the main grid', () => {
  expect(regionAt(L, 29, 5)).toBe('grid');
  expect(regionAt(L, 99, 12)).toBe('grid');
});

test('rowWindow anchors at the top until the cursor passes the fold', () => {
  expect(rowWindow(0, 10, 100)).toBe(0);
  expect(rowWindow(9, 10, 100)).toBe(0); // last row that still fits
});

test('rowWindow scrolls to keep the cursor on the last visible row', () => {
  expect(rowWindow(10, 10, 100)).toBe(1);
  expect(rowWindow(50, 10, 100)).toBe(41);
});

test('rowWindow clamps the final page so it never shows empty space', () => {
  expect(rowWindow(99, 10, 100)).toBe(90); // not 90+, the last full page
  expect(rowWindow(5, 10, 3)).toBe(0); // fewer rows than the viewport
});

// ── hitTest: screen coordinate → pane + list row ─────────────────────────────

test('hitTest ignores the header and status rows', () => {
  expect(hitTest(HL, 10, 0)).toBeNull();
  expect(hitTest(HL, 10, 23)).toBeNull();
});

test('hitTest maps a sidebar click to its tree row (border + title above)', () => {
  expect(hitTest(HL, 5, 3)).toEqual({ pane: 'sidebar', row: 0 }); // first row
  expect(hitTest(HL, 5, 5)).toEqual({ pane: 'sidebar', row: 2 }); // third row
  expect(hitTest(HL, 5, 2)).toEqual({ pane: 'sidebar', row: null }); // the title
  expect(hitTest(HL, 5, 6)).toEqual({ pane: 'sidebar', row: null }); // past the tree
});

test('hitTest routes the top-right to the editor pane, the rest to the grid', () => {
  // editorRows 5 + 1-row gap → data row 0 sits at y = 1+5+1+4 = 11.
  expect(hitTest(HL, 60, 2)).toEqual({ pane: 'editor', row: null }); // in the editor
  expect(hitTest(HL, 60, 11)).toEqual({ pane: 'grid', row: 0 }); // first data row
  expect(hitTest(HL, 60, 13)).toEqual({ pane: 'grid', row: 2 });
  expect(hitTest(HL, 60, 10)).toEqual({ pane: 'grid', row: null }); // grid chrome
});

test('hitTest accounts for the grid scroll offset', () => {
  // Scrolled down 20 rows (of 30): the row at the first visible line is row 20.
  expect(hitTest({ ...HL, gridTop: 20, gridLen: 30 }, 60, 11)).toEqual({
    pane: 'grid',
    row: 20,
  });
});

test('hitTest returns a null row past the last data row', () => {
  // gridLen 10, first row at y=11 → rows 0..9 occupy y 11..20; y=21 is past them.
  expect(hitTest(HL, 60, 21)).toEqual({ pane: 'grid', row: null });
});

test('hitTest with no editor pane (editorRows 0, no gap) puts data row 0 at y=5', () => {
  expect(hitTest({ ...HL, editorRows: 0 }, 60, 5)).toEqual({ pane: 'grid', row: 0 });
});
