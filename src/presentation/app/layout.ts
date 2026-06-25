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
