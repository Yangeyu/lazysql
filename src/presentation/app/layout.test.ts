import { test, expect } from 'bun:test';
import { regionAt, rowWindow } from './layout.ts';

const L = { rows: 24, cols: 100, sidebarWidth: 28 };

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
