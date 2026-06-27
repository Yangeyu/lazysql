/**
 * Workbench geometry — the pure arithmetic that turns the terminal size into the
 * panes' dimensions, kept out of the view so App stays composition-only and the
 * sizing is unit-testable without a terminal. Two concerns live here: the static
 * pane layout (computeLayout) and the row window for vertical virtualization
 * (rowWindow), which the DataGrid and sidebar share so they scroll identically.
 */

/** Fixed width (cells) of the connections sidebar. */
export const SIDEBAR_WIDTH = 28;

export interface Layout {
  /** Inner content width shared by the editor and results panels. */
  readonly viewportCols: number;
  /** Height (incl. border) of the SQL editor; 0 when the source can't query. */
  readonly editorRows: number;
  /** Grid body rows that fill the results panel exactly. */
  readonly gridBodyRows: number;
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
 */
export const computeLayout = (cols: number, rows: number, queryable: boolean): Layout => {
  const viewportCols = Math.max(24, cols - SIDEBAR_WIDTH - 1 - 4);
  // The editor is a fixed 6 rows: ask + divider + the single-line SQL input +
  // feedback, inside its border. (The SQL input is single-line now, so the panel
  // no longer grows with the query.)
  const editorRows = queryable ? 6 : 0;
  const gridBodyRows = Math.max(3, rows - editorRows - (queryable ? 8 : 7));
  return { viewportCols, editorRows, gridBodyRows };
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
