/**
 * Vertical virtualization geometry. With native mouse hit-testing handled by the
 * renderer (each row carries its own click handler), the only geometry the UI
 * still derives by hand is the row window — which slice of a long list is on
 * screen. Keeping it here, pure and framework-free, lets the DataGrid and the
 * sidebar window their rows identically and lets it be unit-tested without a
 * terminal.
 */

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
