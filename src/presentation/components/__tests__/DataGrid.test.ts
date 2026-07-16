/**
 * Unit tests for the grid's horizontal windowing — the pure function that
 * derives which columns are visible from the column cursor and available width.
 * Keeping the scroll position derived (not stored) is what makes this testable
 * without rendering.
 */

import { test, expect } from 'bun:test';
import { columnWindow, cellHighlight, columnAtX } from '../DataGrid.tsx';

test('shows every column when they all fit', () => {
  expect(columnWindow([5, 5, 5], 0, 100)).toEqual({ start: 0, end: 3 });
});

test('an empty table yields an empty window', () => {
  expect(columnWindow([], 0, 50)).toEqual({ start: 0, end: 0 });
});

test('scrolls right to keep the cursor column visible', () => {
  // Four 10-wide columns; sep is 3, so only ~2 fit in 25 cells.
  const { start, end } = columnWindow([10, 10, 10, 10], 3, 25);
  expect(end).toBe(4); // the cursor (last column) is included…
  expect(start).toBeGreaterThan(0); // …by scrolling the left edge in
});

test('a -1 cursor (no column selection) anchors at the first column', () => {
  expect(columnWindow([10, 10, 10], -1, 25).start).toBe(0);
});

test('packs neighbours around the cursor to fill the width', () => {
  // 5-wide columns, generous width → cursor in the middle shows both sides.
  const { start, end } = columnWindow([5, 5, 5, 5, 5], 2, 100);
  expect(start).toBe(0);
  expect(end).toBe(5);
});

// ── cellHighlight: the single, pure cell-selection decision ──────────────────

test('only the cursor row ∩ column-cursor cell is the active cell', () => {
  // cursor row 2, column cursor 1, grid focused.
  expect(cellHighlight(2, 1, 2, 1, true)).toBe('cell');
  expect(cellHighlight(2, 0, 2, 1, true)).toBe('none'); // same row, other column
  expect(cellHighlight(1, 1, 2, 1, true)).toBe('none'); // other row, same column
});

test('an unfocused grid dims the active cell rather than inverting it', () => {
  expect(cellHighlight(0, 0, 0, 0, false)).toBe('cell-dim');
});

test('no column cursor (−1) highlights the whole cursor row, focused only', () => {
  expect(cellHighlight(3, 0, 3, -1, true)).toBe('row');
  expect(cellHighlight(3, 5, 3, -1, true)).toBe('row'); // any column of that row
  expect(cellHighlight(2, 0, 3, -1, true)).toBe('none'); // not the cursor row
  expect(cellHighlight(3, 0, 3, -1, false)).toBe('none'); // unfocused → nothing
});

// ── columnAtX: which column a click landed on (GUTTER_W=2, SEP_W=3) ───────────

test('columnAtX maps a local click x to the column under it', () => {
  // Two columns, widths 5 and 8. Layout cells from the row's left edge:
  //   [0,2) gutter · [2,7) col0 · [7,10) sep · [10,18) col1
  const w = [5, 8];
  expect(columnAtX(0, w, 0, 2)).toBeNull(); // gutter
  expect(columnAtX(1, w, 0, 2)).toBeNull();
  expect(columnAtX(2, w, 0, 2)).toBe(0); // first cell
  expect(columnAtX(6, w, 0, 2)).toBe(0);
  expect(columnAtX(7, w, 0, 2)).toBe(0); // the separator counts as the cell before it
  expect(columnAtX(10, w, 0, 2)).toBe(1); // second cell
  expect(columnAtX(17, w, 0, 2)).toBe(1);
  expect(columnAtX(18, w, 0, 2)).toBeNull(); // past the last column (no trailing sep)
});

test('columnAtX returns absolute column indices when scrolled (start > 0)', () => {
  // Window starts at column 2; first visible cell is 6 wide.
  expect(columnAtX(2, [4, 4, 6, 7], 2, 2)).toBe(2);
  expect(columnAtX(2 + 6 + 3, [4, 4, 6, 7], 2, 2)).toBe(3);
});
