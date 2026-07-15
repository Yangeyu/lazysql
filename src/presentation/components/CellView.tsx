/**
 * CellView — the full-cell inspector, which both READS and EDITS a cell in the
 * same floating panel (ADR 0011). It floats a centered panel OVER the grid:
 *
 *   • view mode: the cell's complete value, structurally formatted (pretty JSON),
 *     scrollable when the value is taller than the panel.
 *   • edit mode: a focused <textarea> seeded with the store-computed `seedText` —
 *     the raw value, pretty-printed only on a jsonCanonical column (where the
 *     store normalizes JSON, so saving can't silently reformat a text column).
 *     Enter remains a newline, so multi-line JSON is editable.
 *
 * The panel is a FIXED size (derived once from the terminal, not from the value).
 * Pure projection of the store's `cellView` slice; the store keeps no edit draft
 * — submitEdit reads the widget's text on save. Shortcut behaviour and the
 * rendered footer both come from the keymap; App passes the current `hints`.
 */

import React, { useEffect, useMemo, useRef } from 'react';
import {
  TextAttributes,
  type MouseEvent,
  type TextareaOptions,
  type TextareaRenderable,
} from '@opentui/core';
import type { CellValue } from '../../domain/datasource/ResultSet.ts';
import { formatCellValue } from './cellFormat.ts';
import { wrapByWidth } from './wrapText.ts';
import { theme, INPUT_CURSOR } from '../theme/theme.ts';
import { Overlay } from './Overlay.tsx';

/** ^S saves; Enter stays a newline (the textarea default) so multi-line values
 *  are editable. See ADR 0011. */
const CELL_EDIT_KEYBINDINGS: NonNullable<TextareaOptions['keyBindings']> = [
  { name: 's', ctrl: true, action: 'submit' },
];

interface CommonProps {
  column: string;
  value: CellValue;
  offset: number;
  /** Keymap-generated shortcuts for the active cell context. */
  hints: string;
  termRows: number;
  termCols: number;
  /** Wheel/trackpad scrolled the value (+1 down / −1 up) — view mode only. */
  onScroll: (delta: number) => void;
  /** The edit was saved (^S) — the new text to stage as an update. */
  onEditSubmit: (value: string) => void;
}

type Props = CommonProps &
  (
    | { mode: 'view'; seedText?: never }
    | {
        mode: 'edit';
        /** Raw edit seed, or pretty-printed text for a jsonCanonical column. */
        seedText: string;
      }
  );

const CellViewImpl = ({
  column,
  value,
  offset,
  mode,
  seedText,
  hints,
  termRows,
  termCols,
  onScroll,
  onEditSubmit,
}: Props) => {
  // Fixed panel geometry, derived from the terminal once (not from the value).
  const width = Math.max(24, Math.min(termCols - 8, 100));
  const height = Math.max(8, termRows - 6);
  const innerW = width - 4; // border (2) + paddingX (2)
  const bodyRows = Math.max(1, height - 4); // title + footer inside the border

  const editRef = useRef<TextareaRenderable | null>(null);
  // Seed the caret at the end of the value so typing appends (matching the old
  // inline editor); only relevant while editing.
  useEffect(() => {
    const ta = editRef.current;
    if (mode === 'edit' && ta) ta.cursorOffset = ta.plainText.length;
  }, [mode]);

  // Hooks run unconditionally (before the mode branch); `display` is unused while
  // editing but must stay in a stable hook order.
  const { type, lines } = useMemo(() => formatCellValue(value), [value]);
  const display = useMemo(
    () => lines.flatMap((ln) => wrapByWidth(ln, innerW)),
    [lines, innerW],
  );

  const titleRow = (tag?: React.ReactNode) => (
    <text wrapMode="none">
      <span bg={theme.accent} fg={theme.onAccent} attributes={TextAttributes.BOLD}>
        {' ⊞ cell '}
      </span>
      <b fg={theme.cyan}>
        {' '}
        {column}
      </b>
      {tag}
    </text>
  );

  if (mode === 'edit') {
    return (
      <Overlay termRows={termRows} termCols={termCols} width={width} height={height} borderColor={theme.magenta}>
        {titleRow(
          <span fg={theme.magenta} attributes={TextAttributes.BOLD}>
            {'   edit'}
          </span>,
        )}
        <textarea
          ref={editRef}
          initialValue={seedText}
          focused
          keyBindings={CELL_EDIT_KEYBINDINGS}
          wrapMode="word"
          onSubmit={() => onEditSubmit(editRef.current?.plainText ?? '')}
          textColor={theme.cyan}
          cursorStyle={INPUT_CURSOR}
          cursorColor={theme.accent}
          flexGrow={1}
        />
        <text fg={theme.border} wrapMode="none">
          {hints}
        </text>
      </Overlay>
    );
  }

  // ── view mode ── (`display` wraps each logical line to the panel width by
  // display columns, so CJK wraps instead of clipping and horizontal overflow
  // becomes more rows, not hidden text.)
  const maxOffset = Math.max(0, display.length - bodyRows);
  const top = Math.min(offset, maxOffset);
  // Pad the window to a constant length so the footer never shifts row.
  const window = display.slice(top, top + bodyRows);
  while (window.length < bodyRows) window.push('');

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
      {titleRow(
        <span fg={theme.border}>
          {'  '}
          {type}
          {display.length > bodyRows
            ? `  ·  ${top + 1}-${Math.min(top + bodyRows, display.length)}/${display.length}`
            : ''}
        </span>,
      )}
      {window.map((ln, i) => (
        <text key={top + i} wrapMode="none" selectable>
          {ln === '' ? ' ' : ln}
        </text>
      ))}
      <text fg={theme.border} wrapMode="none">
        {top < maxOffset ? '↓ more  ·  ' : ''}{hints}
      </text>
    </Overlay>
  );
};

export const CellView = React.memo(CellViewImpl);
