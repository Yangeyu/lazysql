/**
 * CellView — the full-cell inspector overlay. Opened with ⏎ on the focused grid
 * cell, it covers the main pane with the cell's complete value, structurally
 * formatted (pretty-printed JSON for object/array text), and scrolls with j/k
 * for values taller than the viewport. Esc closes. Pure projection of the
 * store's `cellView` slice plus the pure `formatCellValue`.
 */

import React from 'react';
import { Box, Text } from 'ink';
import type { CellValue } from '../../domain/datasource/ResultSet.ts';
import { formatCellValue } from './cellFormat.ts';
import { theme } from '../theme/theme.ts';

interface Props {
  column: string;
  value: CellValue;
  offset: number;
  viewportRows: number;
  viewportCols: number;
}

const CellViewImpl: React.FC<Props> = ({
  column,
  value,
  offset,
  viewportRows,
  viewportCols,
}) => {
  const { type, lines } = formatCellValue(value);
  const bodyRows = Math.max(1, viewportRows - 3); // title + footer chrome
  const maxOffset = Math.max(0, lines.length - bodyRows);
  const top = Math.min(offset, maxOffset);
  const window = lines.slice(top, top + bodyRows);
  const width = Math.max(20, viewportCols);

  return (
    <Box flexDirection="column" flexGrow={1} width={width}>
      <Box>
        <Text backgroundColor={theme.accent} color={theme.onAccent} bold>
          {' ⊞ cell '}
        </Text>
        <Text> </Text>
        <Text bold color={theme.cyan}>
          {column}
        </Text>
        <Text color={theme.border}>
          {'  '}
          {type}
          {lines.length > bodyRows ? `  ·  ${top + 1}-${Math.min(top + bodyRows, lines.length)}/${lines.length}` : ''}
        </Text>
      </Box>
      <Box
        flexDirection="column"
        flexGrow={1}
        borderStyle="round"
        borderColor={theme.borderFocus}
        paddingX={1}
      >
        {window.map((ln, i) => (
          <Text key={top + i} wrap="truncate">
            {ln === '' ? ' ' : ln}
          </Text>
        ))}
      </Box>
      <Text color={theme.border}>
        {top < maxOffset ? '↓ more  ·  ' : ''}esc close · j/k scroll
      </Text>
    </Box>
  );
};

export const CellView = React.memo(CellViewImpl);
