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

/** Rows the data grid spends on its own column header + divider — the only chrome
 *  between the raw results-panel body and the grid's scrollable data rows. The
 *  DDL/structure view draws none of it, so it fills the full body. */
export const GRID_CHROME_ROWS = 2;

export interface Layout {
  /** Inner content width shared by the editor and results panels. */
  readonly viewportCols: number;
  /** Height (incl. border) of the SQL editor; 0 when the source can't query. */
  readonly editorRows: number;
  /** The results panel's body height (below the tab, inside the border) — the
   *  view-agnostic budget every body view fills. Each view subtracts its own
   *  chrome from this; nothing reaches into another view's layout. */
  readonly resultsBodyRows: number;
  /** Data grid rows: the body minus the grid's own header + divider. */
  readonly gridBodyRows: number;
  /** Tree rows the sidebar body can show; drives its vertical virtualization. */
  readonly sidebarRows: number;
}

/**
 * Pane dimensions for a `cols`×`rows` terminal. The right column stacks the SQL
 * editor (only for query-capable sources) over the results panel; a 1-row gap
 * separates them, mirroring the 1-cell gap that sets off the sidebar.
 *
 * The deductions are the visible chrome: viewportCols removes the sidebar, its
 * gap, and a panel's border + horizontal padding (4); resultsBodyRows removes the
 * app header (1), status (1), the editor and its gap, and the results panel's own
 * frame — border (2) + tab row (1). That body is view-agnostic; the grid alone
 * spends GRID_CHROME_ROWS more on its header + divider (gridBodyRows), while the
 * DDL view fills resultsBodyRows outright.
 *
 * sidebarRows is the full left column (terminal minus header + status = 2) less
 * the sidebar's own chrome: border (2) + the CONNECTIONS title row (1).
 */
export const computeLayout = (
  cols: number,
  rows: number,
  queryable: boolean,
  sidebarWidth: number = SIDEBAR_WIDTH,
  editorExpanded: boolean = false,
): Layout => {
  const viewportCols = Math.max(24, cols - sidebarWidth - 1 - 4);
  // The editor pane has two gears (ADR 0013), both fixed-height so the grid's
  // share of the column only changes on an explicit toggle, never per keystroke:
  // collapsed (default) it is a 3-row echo bar — border (2) + the one-line SQL
  // readout; expanded it is 10 rows — border (2) + ask + divider + feedback (3)
  // leave ~5 visible SQL rows, within which the <textarea> soft-wraps and
  // scrolls (ADR 0010).
  const editorRows = !queryable ? 0 : editorExpanded ? 10 : 3;
  // The panel body (below the tab, inside the border) is the base truth; the grid
  // then carves out its own header + divider. Floor keeps the grid at ≥3 rows.
  const resultsBodyRows = Math.max(
    3 + GRID_CHROME_ROWS,
    rows - editorRows - (queryable ? 6 : 5),
  );
  const gridBodyRows = resultsBodyRows - GRID_CHROME_ROWS;
  const sidebarRows = Math.max(1, rows - 5);
  return { viewportCols, editorRows, resultsBodyRows, gridBodyRows, sidebarRows };
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
