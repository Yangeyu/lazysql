/**
 * CellView — the full-cell inspector. Opened with ⏎ on the focused grid cell, it
 * floats a centered panel OVER the grid (the grid stays visible behind it) with
 * the cell's complete value, structurally formatted (pretty-printed JSON for
 * object/array text), scrolling with j/k for values taller than the panel. Esc
 * closes. Pure projection of the store's `cellView` slice plus `formatCellValue`.
 *
 * The panel is a FIXED size (derived once from the terminal, not from the value)
 * and the scroll window is padded to a constant line count, so moving the cursor
 * repaints only the changed text lines — never the panel's geometry.
 */

import React from 'react';
import { TextAttributes, type MouseEvent } from '@opentui/core';
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
  /** Wheel/trackpad scrolled the value (+1 down / −1 up). */
  onScroll: (delta: number) => void;
}

const CellViewImpl = ({ column, value, offset, termRows, termCols, onScroll }: Props) => {
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
    <Overlay
      termRows={termRows}
      termCols={termCols}
      width={width}
      height={height}
      onMouseScroll={(e: MouseEvent) => {
        if (e.scroll?.direction === 'down') onScroll(1);
        else if (e.scroll?.direction === 'up') onScroll(-1);
      }}
    >
      <text wrapMode="none">
        <span bg={theme.accent} fg={theme.onAccent} attributes={TextAttributes.BOLD}>
          {' ⊞ cell '}
        </span>
        <b fg={theme.cyan}>
          {' '}
          {column}
        </b>
        <span fg={theme.border}>
          {'  '}
          {type}
          {lines.length > bodyRows
            ? `  ·  ${top + 1}-${Math.min(top + bodyRows, lines.length)}/${lines.length}`
            : ''}
        </span>
      </text>
      {window.map((ln, i) => (
        <text key={top + i} wrapMode="none" selectable>
          {ln === '' ? ' ' : truncate(ln)}
        </text>
      ))}
      <text fg={theme.border} wrapMode="none">
        {top < maxOffset ? '↓ more  ·  ' : ''}esc/⏎ close · j/k scroll · y copy
      </text>
    </Overlay>
  );
};

export const CellView = React.memo(CellViewImpl);
