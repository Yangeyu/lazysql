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

// Fixed chrome above each pane's first list row, read off the App's render:
//   • a 1-row Header on top of everything;
//   • the sidebar's rounded border (1) + its "CONNECTIONS" title (1);
//   • the grid's border (1) + the Data/DDL (or Result) tab line (1) + the
//     DataGrid column header (1) + its separator rule (1);
//   • plus a 1-row gap below the editor pane when one is present.
// Centralizing them here is the whole point of this module: the mouse and the
// renderer derive row positions from the SAME numbers, so they can't disagree.
const HEADER = 1;
const SIDEBAR_LIST_TOP = HEADER + 2;
const EDITOR_GAP = 1;
const GRID_LIST_CHROME = 4;

/** Layout enriched with the dynamic offsets a click needs to resolve a row. */
export interface HitLayout extends Layout {
  /** Height of the editor pane sitting above the grid (0 when there is none). */
  editorRows: number;
  /** The grid's current vertical scroll offset (the rowWindow `top`). */
  gridTop: number;
  /** Number of selectable rows in the sidebar tree. */
  treeLen: number;
  /** Number of data rows the grid is currently showing (0 if it shows no grid). */
  gridLen: number;
}

/** A resolved click: the pane it lands in, plus the list row when it lands on one
 *  (null when it lands on the pane's chrome or empty space). */
export type Hit =
  | { readonly pane: 'sidebar'; readonly row: number | null }
  | { readonly pane: 'editor'; readonly row: null }
  | { readonly pane: 'grid'; readonly row: number | null };

/**
 * Map a screen coordinate to a pane and the list row under it. The right side is
 * split vertically — the editor pane on top (when present), the grid below — so a
 * grid-side click is disambiguated by `y`. Grid rows account for the vertical
 * scroll offset, so a click selects the row the user actually sees. Pure.
 */
export const hitTest = (l: HitLayout, x: number, y: number): Hit | null => {
  const region = regionAt(l, x, y);
  if (!region) return null;
  if (region === 'sidebar') {
    const i = y - SIDEBAR_LIST_TOP;
    return { pane: 'sidebar', row: i >= 0 && i < l.treeLen ? i : null };
  }
  // Right side: the editor pane occupies the first `editorRows` body rows; a gap
  // row sits below it, then the grid.
  if (l.editorRows > 0 && y < HEADER + l.editorRows) {
    return { pane: 'editor', row: null };
  }
  const gap = l.editorRows > 0 ? EDITOR_GAP : 0;
  const k = y - (HEADER + l.editorRows + gap + GRID_LIST_CHROME);
  const row = k >= 0 ? l.gridTop + k : -1;
  return { pane: 'grid', row: row >= 0 && row < l.gridLen ? row : null };
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
