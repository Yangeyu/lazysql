import { test, expect } from 'bun:test';
import { regionAt } from './layout.ts';

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
