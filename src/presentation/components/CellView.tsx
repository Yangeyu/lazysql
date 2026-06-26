/**
 * CellView — the full-cell inspector. Opened with ⏎ on the focused grid cell, it
 * floats a centered panel OVER the grid (the grid stays visible behind it) with
 * the cell's complete value, structurally formatted (pretty-printed JSON for
 * object/array text), scrolling with j/k for values taller than the panel. Esc
 * closes. Pure projection of the store's `cellView` slice plus `formatCellValue`.
 *
 * The panel is a FIXED size (derived once from the terminal, not from the value)
 * and the scroll window is padded to a constant line count, so moving the cursor
 * repaints only the changed text lines — never the panel's geometry. That is what
 * removes the flicker the old full-height, content-sized inspector had.
 */

import React from 'react';
import { Text } from 'ink';
import type { CellValue } from '../../domain/datasource/ResultSet.ts';
import { formatCellValue } from './cellFormat.ts';
import { theme } from '../theme/theme.ts';
import { Overlay } from './Overlay.tsx';

interface Props {
  column: string;
  value: CellValue;
  offset: number;
  termRows: number;
  termCols: number;
}

const CellViewImpl: React.FC<Props> = ({
  column,
  value,
  offset,
  termRows,
  termCols,
}) => {
  const { type, lines } = formatCellValue(value);

  // Fixed panel geometry, derived from the terminal once (not from the value).
  const width = Math.max(24, Math.min(termCols - 8, 100));
  const height = Math.max(8, termRows - 6);
  const innerW = width - 4; // border (2) + paddingX (2)
  const bodyRows = Math.max(1, height - 4); // title + footer inside the border

  const maxOffset = Math.max(0, lines.length - bodyRows);
  const top = Math.min(offset, maxOffset);
  // Pad the window to a constant length so the footer never shifts row.
  const window = lines.slice(top, top + bodyRows);
  while (window.length < bodyRows) window.push('');

  const truncate = (s: string): string =>
    s.length > innerW ? s.slice(0, innerW) : s;

  return (
    <Overlay termRows={termRows} termCols={termCols} width={width} height={height}>
      <Text wrap="truncate">
        <Text backgroundColor={theme.accent} color={theme.onAccent} bold>
          {' ⊞ cell '}
        </Text>
        <Text bold color={theme.cyan}>
          {' '}
          {column}
        </Text>
        <Text color={theme.border}>
          {'  '}
          {type}
          {lines.length > bodyRows
            ? `  ·  ${top + 1}-${Math.min(top + bodyRows, lines.length)}/${lines.length}`
            : ''}
        </Text>
      </Text>
      {window.map((ln, i) => (
        <Text key={top + i} wrap="truncate">
          {ln === '' ? ' ' : truncate(ln)}
        </Text>
      ))}
      <Text color={theme.border} wrap="truncate">
        {top < maxOffset ? '↓ more  ·  ' : ''}esc/⏎ close · j/k scroll
      </Text>
    </Overlay>
  );
};

export const CellView = React.memo(CellViewImpl);
