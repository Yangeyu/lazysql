/**
 * Unit tests for the grid's horizontal windowing — the pure function that
 * derives which columns are visible from the column cursor and available width.
 * Keeping the scroll position derived (not stored) is what makes this testable
 * without rendering Ink.
 */

import { test, expect } from 'bun:test';
import { columnWindow, cellHighlight } from '../DataGrid.tsx';

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

test('the highlight follows the column cursor', () => {
  expect(cellHighlight(0, 2, 0, 2, true)).toBe('cell'); // cursor moved to col 2
  expect(cellHighlight(0, 1, 0, 2, true)).toBe('none'); // col 1 no longer active
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
