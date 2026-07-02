/**
 * Workbench geometry — the pure arithmetic that turns the terminal size into the
 * panes' dimensions, kept out of the view so App stays composition-only and the
 * sizing is unit-testable without a terminal. Two concerns live here: the static
 * pane layout (computeLayout) and the row window for vertical virtualization
 * (rowWindow), which the DataGrid and sidebar share so they scroll identically.
 */

/** Default width (cells) of the connections sidebar — the resize baseline. */
export const SIDEBAR_WIDTH = 28;
/** Bounds and step for the user-adjustable sidebar width (^⇧-/^⇧+). */
export const SIDEBAR_MIN = 16;
export const SIDEBAR_MAX = 60;
export const SIDEBAR_STEP = 3;

/** Clamp a requested sidebar width to the allowed range. */
export const clampSidebarWidth = (w: number): number =>
  Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, w));

export interface Layout {
  /** Inner content width shared by the editor and results panels. */
  readonly viewportCols: number;
  /** Height (incl. border) of the SQL editor; 0 when the source can't query. */
  readonly editorRows: number;
  /** Grid body rows that fill the results panel exactly. */
  readonly gridBodyRows: number;
  /** Tree rows the sidebar body can show; drives its vertical virtualization. */
  readonly sidebarRows: number;
}

/**
 * Pane dimensions for a `cols`×`rows` terminal. The right column stacks the SQL
 * editor (~1/4, only for query-capable sources) over the results panel; a 1-row
 * gap separates them, mirroring the 1-cell gap that sets off the sidebar.
 *
 * The deductions are the visible chrome: viewportCols removes the sidebar, its
 * gap, and a panel's border + horizontal padding (4); gridBodyRows removes the
 * header (1), status (1), the editor and its gap, and the results panel's own
 * chrome — full border (2) + tab row (1) + grid header (1) + grid divider (1).
 *
 * sidebarRows is the full left column (terminal minus header + status = 2) less
 * the sidebar's own chrome: border (2) + the CONNECTIONS title row (1).
 */
export const computeLayout = (
  cols: number,
  rows: number,
  queryable: boolean,
  sidebarWidth: number = SIDEBAR_WIDTH,
): Layout => {
  const viewportCols = Math.max(24, cols - sidebarWidth - 1 - 4);
  // The editor is a fixed 10 rows: border (2) + ask + divider + feedback (3) leave
  // ~5 visible SQL rows. The SQL input is a multi-line <textarea> (ADR 0010) that
  // soft-wraps and scrolls WITHIN this fixed height, so the panel never grows with
  // the query — the grid's share of the column stays predictable.
  const editorRows = queryable ? 10 : 0;
  const gridBodyRows = Math.max(3, rows - editorRows - (queryable ? 8 : 7));
  const sidebarRows = Math.max(1, rows - 5);
  return { viewportCols, editorRows, gridBodyRows, sidebarRows };
};

/**
 * First visible index of a vertically-virtualized list that keeps `cursor` in
 * view: 0 until the cursor passes the fold, then scrolled so the cursor sits on
 * the last visible row, clamped so the final page never shows empty space. The
 * renderer draws `slice(top, top + rows)`. Pure; exported for unit testing.
 */
export const rowWindow = (
  cursor: number,
  viewportRows: number,
  total: number,
): number => {
  const vh = Math.max(1, viewportRows);
  return cursor >= vh ? Math.min(cursor - vh + 1, Math.max(0, total - vh)) : 0;
};
