/**
 * Layout hit-testing — the single source of truth for mapping a screen
 * coordinate to a pane. Pure and derived from the same constants the renderer
 * lays out with (header on the first row, status on the last, sidebar of a
 * fixed width on the left), so the mouse and the view never disagree. Exported
 * for unit testing without Ink.
 */

import type { Region } from './store.ts';

export interface Layout {
  readonly rows: number;
  readonly cols: number;
  /** Width of the sidebar pane, including its border. */
  readonly sidebarWidth: number;
}

/**
 * Which pane a click at `(x, y)` lands in, or null for the header / status bar
 * (which are not focus targets). The sidebar occupies its width plus the
 * one-column gap before the main pane.
 */
export const regionAt = (
  layout: Layout,
  x: number,
  y: number,
): Region | null => {
  if (y <= 0 || y >= layout.rows - 1) return null; // header row / status row
  return x <= layout.sidebarWidth ? 'sidebar' : 'grid';
};

/**
 * First visible index of a vertically-virtualized list that keeps `cursor` in
 * view: 0 until the cursor passes the fold, then scrolled so the cursor sits on
 * the last visible row, clamped so the final page never shows empty space. The
 * single source of truth for vertical scroll — the renderer draws `slice(top,
 * top+rows)` and hit-testing maps a screen row back through the same `top`, so
 * they can never disagree. Pure; exported for unit testing.
 */
export const rowWindow = (
  cursor: number,
  viewportRows: number,
  total: number,
): number => {
  const vh = Math.max(1, viewportRows);
  return cursor >= vh ? Math.min(cursor - vh + 1, Math.max(0, total - vh)) : 0;
};
