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

interface Props {
  result: ResultSet | null;
  cursor: number;
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

const DataGridImpl: React.FC<Props> = ({
  result,
  cursor,
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

  // Column widths computed from the visible window only — O(viewport), not O(table).
  const widths = columns.map((c, i) => {
    let w = c.name.length;
    for (const row of visible) w = Math.max(w, formatCell(row[i] ?? null).length);
    return Math.min(Math.max(w, 3), MAX_COL);
  });

  const header = columns.map((c, i) => fit(c.name, widths[i]!)).join(' │ ');

  return (
    <Box flexDirection="column">
      <Text bold color={focused ? 'cyan' : undefined}>
        {header}
      </Text>
      <Text dimColor>{'─'.repeat(header.length)}</Text>
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
