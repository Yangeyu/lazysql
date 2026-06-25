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
 * display-width-padded cells. Alignment is therefore correct by construction:
 * there is no separate "header" layout that can drift from the rows (the bug a
 * Box-row-of-Texts header had, where the header wrapped while rows truncated).
 */

import React from 'react';
import { Text } from 'ink';
import stringWidth from 'string-width';
import type { ResultSet, CellValue } from '../../domain/datasource/ResultSet.ts';
import type { Sort } from '../../domain/query/Query.ts';
import { theme } from '../theme/theme.ts';

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
}

/** Per-column cap and the inter-column separator (display width 3). */
const MAX_COL = 32;
const SEP = ' │ ';
const SEP_W = 3;
const GUTTER_W = 2;

const dispWidth = (s: string): number => stringWidth(s);

const formatCell = (v: CellValue): string => {
  if (v === null) return '∅';
  if (v instanceof Uint8Array) return `<blob ${v.length}b>`;
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  // Collapse newlines so a multi-line value never breaks the row grid.
  return String(v).replace(/\s*\n\s*/g, ' ');
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

/** One styled cell of a rendered line. */
interface Cell {
  text: string;
  color?: string;
  bold?: boolean;
}

/** Render a gutter + windowed cells as a single, non-wrapping line. */
const line = (
  key: React.Key,
  gutter: string,
  gutterColor: string,
  cells: Cell[],
  inverse: boolean,
): React.ReactNode => (
  <Text key={key} wrap="truncate" inverse={inverse}>
    <Text color={gutterColor}>{gutter}</Text>
    {cells.map((c, i) => (
      <React.Fragment key={i}>
        {i > 0 ? <Text color={theme.border}>{SEP}</Text> : null}
        <Text color={c.color} bold={c.bold}>
          {c.text}
        </Text>
      </React.Fragment>
    ))}
  </Text>
);

const DataGridImpl: React.FC<Props> = ({
  result,
  cursor,
  selectedCol,
  sort,
  loading,
  hasTable,
  viewportRows,
  viewportCols,
  focused,
}) => {
  if (loading) return <Text color={theme.yellow}>Loading…</Text>;
  if (!hasTable)
    return (
      <Text color={theme.border}>
        Select a table in the sidebar and press Enter.
      </Text>
    );
  if (!result || result.rows.length === 0)
    return <Text color={theme.border}>(no rows)</Text>;

  const { columns, rows } = result;
  const vh = Math.max(1, viewportRows);

  // Vertical window: keep the row cursor inside the visible slice.
  const top =
    cursor >= vh ? Math.min(cursor - vh + 1, Math.max(0, rows.length - vh)) : 0;
  const visible = rows.slice(top, top + vh);

  // Column widths from the visible window only — O(viewport), not O(table).
  // The sorted column reserves 2 cells for its ▲/▼ marker so rows stay aligned.
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
      <Text color={theme.border}>
        {'─'.repeat(sepWidth)}
        {moreRight ? <Text color={theme.accent}>{` › +${columns.length - end}`}</Text> : null}
      </Text>
      {visible.map((row, i) => {
        const absolute = top + i;
        const selected = absolute === cursor;
        const active = selected && focused;
        return line(
          absolute,
          selected ? (focused ? '▶ ' : '▎ ') : '  ',
          theme.accent,
          win.map((_, wi) => {
            const ci = start + wi;
            const raw = row[ci] ?? null;
            return {
              text: fit(formatCell(raw), widths[ci]!),
              color: raw === null && !active ? theme.border : undefined,
            };
          }),
          active,
        );
      })}
    </>
  );
};

export const DataGrid = React.memo(DataGridImpl);
