/**
 * DataGrid — renders a paginated ResultSet inside a fixed viewport with both
 * vertical AND horizontal virtualization:
 *
 *   • rows    — only the row window that fits the viewport height is rendered;
 *   • columns — only the column window that fits the viewport width is rendered,
 *               scrolling to keep the column cursor visible (so a wide table is
 *               never occluded — you page across it with h/l).
 *
 * The whole grid is built from ONE primitive — `line()` — used identically for
 * the header and every data row, from the SAME windowed column set and the SAME
 * display-width-padded cells. Alignment is therefore correct by construction.
 * Data rows carry an `onMouseDown` so a click selects them; the index is known
 * at render time, so there is no coordinate hit-testing.
 */

import React from 'react';
import { TextAttributes, type MouseEvent } from '@opentui/core';
import stringWidth from 'string-width';
import type { ResultSet, CellValue } from '../../domain/datasource/ResultSet.ts';
import type { Sort } from '../../domain/query/Query.ts';
import { theme } from '../theme/theme.ts';
import { rowWindow } from '../app/layout.ts';

interface Props {
  result: ResultSet | null;
  /** Row cursor (absolute index into the result rows). */
  cursor: number;
  /** Column cursor; -1 when the grid has no column selection (query results). */
  selectedCol: number;
  sort: Sort | null;
  loading: boolean;
  hasTable: boolean;
  /** Rows of vertical space available for the grid body. */
  viewportRows: number;
  /** Columns (terminal cells) of horizontal space available. */
  viewportCols: number;
  focused: boolean;
  /** A grid cell was clicked: the row, plus the column when a specific cell was
   *  hit (omitted for a click on the row gutter, which selects the row only). */
  onCellClick: (row: number, col?: number) => void;
}

/** Per-column cap and the inter-column separator (display width 3). */
const MAX_COL = 32;
const SEP = ' │ ';
const SEP_W = 3;
const GUTTER_W = 2;
/**
 * Longest prefix of a cell value the grid ever inspects. A cell can show at most
 * MAX_COL display columns, so measuring/formatting more of a huge value (e.g. a
 * multi-KB JSON blob in a `nodes`/`edges` column) is pure waste that would stall
 * EVERY render — `stringWidth` walks each glyph, on each keystroke. Bounding the
 * preview to 2×MAX_COL keeps that work O(MAX_COL) regardless of value size while
 * still leaving enough to fill the widest cell even when every glyph is wide
 * (CJK). The row keeps the full value untouched — the cell inspector reads it on
 * ⏎ (store.openCell); only this shallow view is bounded.
 */
const PREVIEW_CHARS = MAX_COL * 2;

const dispWidth = (s: string): number => stringWidth(s);

const formatCell = (v: CellValue): string => {
  if (v === null) return '∅';
  if (v instanceof Uint8Array) return `<blob ${v.length}b>`;
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  const s = String(v);
  // Slice BEFORE the newline-collapse + width measurement so neither ever touches
  // more than PREVIEW_CHARS of a large value.
  const head = s.length > PREVIEW_CHARS ? s.slice(0, PREVIEW_CHARS) : s;
  return head.replace(/\s*\n\s*/g, ' ');
};

/** Pad/truncate `s` to an exact *display* width (wide CJK glyphs count as 2). */
const fit = (s: string, w: number): string => {
  const sw = dispWidth(s);
  if (sw === w) return s;
  if (sw < w) return s + ' '.repeat(w - sw);
  const budget = w <= 1 ? w : w - 1;
  let out = '';
  let acc = 0;
  for (const ch of s) {
    const cw = dispWidth(ch);
    if (acc + cw > budget) break;
    out += ch;
    acc += cw;
  }
  if (w > 1) out += '…';
  return out + ' '.repeat(Math.max(0, w - acc - (w > 1 ? 1 : 0)));
};

const arrowFor = (sort: Sort | null, name: string): string => {
  if (!sort || sort.column !== name) return '';
  return sort.direction === 'asc' ? ' ▲' : ' ▼';
};

/**
 * The contiguous range of columns `[start, end)` to show: the widest window
 * that fits `avail` cells and keeps `sel` visible, scrolling as `sel` moves.
 * Pure function of the inputs — the horizontal scroll position is *derived*
 * from the column cursor, not stored. Exported for unit testing.
 */
export const columnWindow = (
  widths: readonly number[],
  sel: number,
  avail: number,
): { start: number; end: number } => {
  const n = widths.length;
  if (n === 0) return { start: 0, end: 0 };
  const s = Math.max(0, Math.min(n - 1, sel));
  let start = s;
  let end = s + 1;
  let used = widths[s]!;
  const fits = (extra: number): boolean => used + SEP_W + extra <= avail;
  while (start > 0 && fits(widths[start - 1]!)) used += SEP_W + widths[--start]!;
  while (end < n && fits(widths[end]!)) used += SEP_W + widths[end++]!;
  while (start > 0 && fits(widths[start - 1]!)) used += SEP_W + widths[--start]!;
  return { start, end };
};

/**
 * Visual selection state of a grid cell — the SINGLE decision the renderer maps
 * to styling, kept pure so the highlight logic is unit-tested directly:
 *
 *   • 'cell'     — the active cell, grid focused → strong inverse
 *   • 'cell-dim' — the active cell, grid unfocused → accent tint (still locatable)
 *   • 'row'      — the cursor row when there is NO column cursor (query results,
 *                  selectedCol < 0) → whole-row inverse
 *   • 'none'     — everything else
 */
export type CellHighlight = 'none' | 'cell' | 'cell-dim' | 'row';

export const cellHighlight = (
  rowIndex: number,
  colIndex: number,
  cursor: number,
  selectedCol: number,
  focused: boolean,
): CellHighlight => {
  if (rowIndex !== cursor) return 'none';
  if (selectedCol < 0) return focused ? 'row' : 'none';
  if (colIndex !== selectedCol) return 'none';
  return focused ? 'cell' : 'cell-dim';
};

/** One styled cell of a rendered line. */
interface Cell {
  text: string;
  color?: string;
  bold?: boolean;
  /** Per-cell highlight — the active grid cell (row ∩ column cursor). */
  inverse?: boolean;
}

/**
 * Which column a click at local x (cells from the row's left edge) landed on, or
 * null for the gutter / past the last visible column. The row is one <text> with
 * a `GUTTER_W` gutter then the windowed cells, each `widths[start+wi]` wide and
 * separated by `SEP_W`; a click on a separator counts as the cell before it.
 * Pure (mirrors the exact render layout); exported for unit testing.
 */
export const columnAtX = (
  localX: number,
  widths: readonly number[],
  start: number,
  count: number,
): number | null => {
  let x = localX - GUTTER_W;
  if (x < 0) return null;
  for (let wi = 0; wi < count; wi++) {
    const w = widths[start + wi]!;
    if (x < w) return start + wi;
    x -= w;
    if (wi === count - 1) break; // no separator after the last column
    if (x < SEP_W) return start + wi; // a click on the separator → the cell before it
    x -= SEP_W;
  }
  return null;
};

/** Combine a cell's bold/inverse flags into an OpenTUI attributes bitmask. */
const cellAttributes = (c: Cell): number | undefined => {
  const a =
    (c.bold ? TextAttributes.BOLD : 0) | (c.inverse ? TextAttributes.INVERSE : 0);
  return a || undefined;
};

/**
 * Render a gutter + windowed cells as a single, non-wrapping line. Highlight is
 * applied PER CELL (so the column cursor lands on one cell, not the whole row);
 * `rowInverse` is the fallback for grids with no column cursor (query results).
 * `onMouseDown`, when given, makes the line clickable (data rows).
 */
const line = (
  key: React.Key,
  gutter: string,
  gutterColor: string,
  cells: Cell[],
  rowInverse: boolean,
  onMouseDown?: (this: { x: number }, event: MouseEvent) => void,
): React.ReactNode => (
  <text
    key={key}
    wrapMode="none"
    attributes={rowInverse ? TextAttributes.INVERSE : undefined}
    onMouseDown={onMouseDown}
  >
    <span fg={gutterColor}>{gutter}</span>
    {cells.map((c, i) => (
      <React.Fragment key={i}>
        {i > 0 ? <span fg={theme.border}>{SEP}</span> : null}
        <span fg={c.color} attributes={cellAttributes(c)}>
          {c.text}
        </span>
      </React.Fragment>
    ))}
  </text>
);

const DataGridImpl = ({
  result,
  cursor,
  selectedCol,
  sort,
  loading,
  hasTable,
  viewportRows,
  viewportCols,
  focused,
  onCellClick,
}: Props) => {
  if (loading) return <text fg={theme.yellow}>Loading…</text>;
  if (!hasTable)
    return (
      <text fg={theme.border}>
        Select a table in the sidebar and press Enter.
      </text>
    );
  if (!result || result.rows.length === 0)
    return <text fg={theme.border}>(no rows)</text>;

  const { columns, rows } = result;
  const vh = Math.max(1, viewportRows);

  // Vertical window: keep the row cursor inside the visible slice.
  const top = rowWindow(cursor, vh, rows.length);
  const visible = rows.slice(top, top + vh);

  // Column widths from the visible window only — O(viewport), not O(table).
  const widths = columns.map((c, i) => {
    let w = dispWidth(c.name) + (sort?.column === c.name ? 2 : 0);
    for (const row of visible) w = Math.max(w, dispWidth(formatCell(row[i] ?? null)));
    return Math.min(Math.max(w, 3), MAX_COL);
  });

  // Horizontal window: the columns that fit, scrolled to keep the cursor shown.
  const avail = Math.max(1, viewportCols - GUTTER_W);
  const { start, end } = columnWindow(widths, selectedCol, avail);
  const win = columns.slice(start, end);
  const moreLeft = start > 0;
  const moreRight = end < columns.length;

  const sepWidth =
    GUTTER_W +
    win.reduce((a, c, i) => a + widths[start + i]!, 0) +
    Math.max(0, win.length - 1) * SEP_W;

  // The "more columns to the right" indicator sits at the END of the divider rule,
  // on the SAME line. The rule is trimmed to leave room for it within the viewport
  // so the pair never overflows and wraps onto a second row (which would steal a
  // data row). `wrapMode="none"` on the divider is the hard guard.
  const moreRightLabel = moreRight ? ` › +${columns.length - end}` : '';
  const ruleWidth = Math.max(0, Math.min(sepWidth, viewportCols - dispWidth(moreRightLabel)));

  return (
    <>
      {line(
        'head',
        moreLeft ? '‹ ' : '  ',
        theme.accent,
        win.map((c, i) => ({
          text: fit(c.name + arrowFor(sort, c.name), widths[start + i]!),
          color: start + i === selectedCol ? theme.accent : theme.cyan,
          bold: true,
        })),
        false,
      )}
      <text fg={theme.border} wrapMode="none">
        {'─'.repeat(ruleWidth)}
        {moreRightLabel ? <span fg={theme.accent}>{moreRightLabel}</span> : null}
      </text>
      {visible.map((row, i) => {
        const absolute = top + i;
        const onCursor = absolute === cursor;
        const rowInverse =
          cellHighlight(absolute, 0, cursor, selectedCol, focused) === 'row';
        return line(
          absolute,
          onCursor ? (focused ? '▶ ' : '▎ ') : '  ',
          theme.accent,
          win.map((_, wi) => {
            const ci = start + wi;
            const raw = row[ci] ?? null;
            const hi = cellHighlight(absolute, ci, cursor, selectedCol, focused);
            return {
              text: fit(formatCell(raw), widths[ci]!),
              // 'cell' inverts; 'cell-dim' keeps an accent tint so the cursor is
              // still visible when the grid loses focus.
              inverse: hi === 'cell',
              color:
                hi === 'cell-dim'
                  ? theme.accent
                  : raw === null && !rowInverse
                    ? theme.border
                    : undefined,
              bold: hi === 'cell-dim',
            };
          }),
          rowInverse,
          // A regular function so `this` is the row's <text> renderable: its `.x`
          // is the row's absolute left, so `event.x - this.x` is the local cell
          // offset → the exact column clicked (null on the gutter = row only).
          function (this: { x: number }, e: MouseEvent) {
            e.stopPropagation();
            const col = columnAtX(e.x - this.x, widths, start, win.length);
            onCellClick(absolute, col ?? undefined);
          },
        );
      })}
    </>
  );
};

export const DataGrid = React.memo(DataGridImpl);
