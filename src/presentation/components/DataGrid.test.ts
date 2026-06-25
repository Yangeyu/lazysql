/**
 * Unit tests for the grid's horizontal windowing — the pure function that
 * derives which columns are visible from the column cursor and available width.
 * Keeping the scroll position derived (not stored) is what makes this testable
 * without rendering Ink.
 */

import { test, expect } from 'bun:test';
import { columnWindow } from './DataGrid.tsx';

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
