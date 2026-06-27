import { test, expect } from 'bun:test';
import { rowWindow } from './layout.ts';

// Screen→pane hit-testing is gone: OpenTUI dispatches native onMouseDown to the
// box under the cursor, so the only geometry left to test is the row window.

test('rowWindow anchors at the top until the cursor passes the fold', () => {
  expect(rowWindow(0, 10, 100)).toBe(0);
  expect(rowWindow(9, 10, 100)).toBe(0); // last row that still fits
});

test('rowWindow scrolls to keep the cursor on the last visible row', () => {
  expect(rowWindow(10, 10, 100)).toBe(1);
  expect(rowWindow(50, 10, 100)).toBe(41);
});

test('rowWindow clamps the final page so it never shows empty space', () => {
  expect(rowWindow(99, 10, 100)).toBe(90); // the last full page, not 90+
  expect(rowWindow(5, 10, 3)).toBe(0); // fewer rows than the viewport
});
