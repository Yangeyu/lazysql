import { test, expect } from 'bun:test';
import { rowWindow, computeLayout, SIDEBAR_WIDTH } from '../layout.ts';

// Screen→pane hit-testing is gone: OpenTUI dispatches native onMouseDown to the
// box under the cursor, so the geometry left to test is the row window and the
// static pane layout.

test('computeLayout reserves the sidebar, its gap, and a panel chrome from the width', () => {
  const { viewportCols } = computeLayout(100, 40, true);
  expect(viewportCols).toBe(100 - SIDEBAR_WIDTH - 1 - 4);
});

test('computeLayout honors a resized sidebar width', () => {
  expect(computeLayout(100, 40, true, 40).viewportCols).toBe(100 - 40 - 1 - 4);
  expect(computeLayout(100, 40, true, 16).viewportCols).toBe(100 - 16 - 1 - 4);
});

test('computeLayout sizes the editor only for query-capable sources', () => {
  expect(computeLayout(100, 40, false).editorRows).toBe(0);
  expect(computeLayout(100, 40, true).editorRows).toBeGreaterThanOrEqual(6);
});

test('computeLayout deducts an extra row for the editor gap when queryable', () => {
  const q = computeLayout(100, 40, true);
  const noEditor = computeLayout(100, 40, false);
  // queryable loses the editor block, the 1-row gap, and one more border row.
  expect(q.gridBodyRows).toBe(40 - q.editorRows - 8);
  expect(noEditor.gridBodyRows).toBe(40 - 7);
});

test('computeLayout floors every pane dimension so a tiny terminal never goes negative', () => {
  const tiny = computeLayout(10, 6, true);
  expect(tiny.viewportCols).toBeGreaterThanOrEqual(24);
  expect(tiny.gridBodyRows).toBeGreaterThanOrEqual(3);
  expect(tiny.sidebarRows).toBeGreaterThanOrEqual(1);
});

test('computeLayout sizes the sidebar body from the column minus header/status + its chrome', () => {
  // 40 rows − header(1) − status(1) − sidebar border(2) − CONNECTIONS title(1).
  expect(computeLayout(100, 40, true).sidebarRows).toBe(35);
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
  expect(rowWindow(99, 10, 100)).toBe(90); // the last full page, not 90+
  expect(rowWindow(5, 10, 3)).toBe(0); // fewer rows than the viewport
});
