/**
 * DataGrid — renders a paginated ResultSet with viewport virtualization: only
 * the rows that fit on screen are ever turned into Ink nodes (windowing), and
 * each row is a single <Text> line rather than a tree of boxes. This is the
 * concrete application of the Ink performance discipline (docs/ARCHITECTURE.md
 * §6.4): the DB already paged the data, and we render only the visible window.
 */

import React from 'react';
import { Box, Text } from 'ink';
import type { ResultSet, CellValue } from '../../domain/datasource/ResultSet.ts';
import type { Sort } from '../../domain/query/Query.ts';

interface Props {
  result: ResultSet | null;
  cursor: number;
  /** Index of the column cursor (target of sort). */
  selectedCol: number;
  sort: Sort | null;
  loading: boolean;
  hasTable: boolean;
  /** Rows of vertical space available for the grid body. */
  viewportRows: number;
  focused: boolean;
}

const MAX_COL = 28;

const formatCell = (v: CellValue): string => {
  if (v === null) return '∅';
  if (v instanceof Uint8Array) return `<blob ${v.length}b>`;
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return String(v);
};

const fit = (s: string, w: number): string => {
  if (s.length === w) return s;
  if (s.length > w) return w <= 1 ? s.slice(0, w) : `${s.slice(0, w - 1)}…`;
  return s + ' '.repeat(w - s.length);
};

const arrowFor = (sort: Sort | null, name: string): string => {
  if (!sort || sort.column !== name) return '';
  return sort.direction === 'asc' ? ' ▲' : ' ▼';
};

const DataGridImpl: React.FC<Props> = ({
  result,
  cursor,
  selectedCol,
  sort,
  loading,
  hasTable,
  viewportRows,
  focused,
}) => {
  if (loading) return <Text color="yellow">Loading…</Text>;
  if (!hasTable)
    return <Text dimColor>Select a table in the sidebar and press Enter.</Text>;
  if (!result || result.rows.length === 0)
    return <Text dimColor>(no rows)</Text>;

  const { columns, rows } = result;
  const vh = Math.max(1, viewportRows);

  // Windowing: keep the cursor inside the visible slice.
  const start =
    cursor >= vh ? Math.min(cursor - vh + 1, Math.max(0, rows.length - vh)) : 0;
  const visible = rows.slice(start, start + vh);

  // Column widths from the visible window only — O(viewport), not O(table).
  // The sorted column reserves 2 cells for its ▲/▼ marker so rows stay aligned.
  const widths = columns.map((c, i) => {
    let w = c.name.length + (sort?.column === c.name ? 2 : 0);
    for (const row of visible) w = Math.max(w, formatCell(row[i] ?? null).length);
    return Math.min(Math.max(w, 3), MAX_COL);
  });

  const lineWidth =
    widths.reduce((a, b) => a + b, 0) + Math.max(0, columns.length - 1) * 3;

  return (
    <Box flexDirection="column">
      <Box flexDirection="row">
        {columns.map((c, i) => {
          const label = fit(c.name + arrowFor(sort, c.name), widths[i]!);
          const isSel = i === selectedCol;
          return (
            <React.Fragment key={c.name}>
              {i > 0 ? <Text dimColor>{' │ '}</Text> : null}
              <Text bold underline={isSel} color={isSel ? 'cyan' : undefined}>
                {label}
              </Text>
            </React.Fragment>
          );
        })}
      </Box>
      <Text dimColor>{'─'.repeat(lineWidth)}</Text>
      {visible.map((row, i) => {
        const absolute = start + i;
        const line = columns
          .map((_, ci) => fit(formatCell(row[ci] ?? null), widths[ci]!))
          .join(' │ ');
        const selected = absolute === cursor;
        return (
          <Text key={absolute} inverse={selected && focused} wrap="truncate">
            {line}
          </Text>
        );
      })}
    </Box>
  );
};

export const DataGrid = React.memo(DataGridImpl);
