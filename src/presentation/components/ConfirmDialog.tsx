/**
 * ConfirmDialog — the single confirmation surface for every staged write. It
 * floats a centered panel OVER the workbench (like lazygit's prompts) showing the
 * headline, the exact SQL about to run, and any supporting lines (e.g. the objects
 * a CASCADE would also drop). `tone: 'danger'` paints the border red for
 * irreversible/bulk operations. Pure projection of the store's `pending` slice;
 * the y/n keys live in the keymap's `confirm` context, not here.
 */

import React from 'react';
import { TextAttributes } from '@opentui/core';
import { theme } from '../theme/theme.ts';
import { Overlay } from './Overlay.tsx';

interface Props {
  title: string;
  statement?: string;
  details?: readonly string[];
  tone: 'normal' | 'danger';
  termRows: number;
  termCols: number;
}

/** Hard-wrap a line into width-w chunks so the panel geometry is exact and the
 *  footer never depends on the renderer's wrapping. */
const wrap = (s: string, w: number): string[] => {
  const out: string[] = [];
  for (let i = 0; i < s.length; i += w) out.push(s.slice(i, i + w));
  return out.length > 0 ? out : [''];
};

const ConfirmDialogImpl = ({ title, statement, details, tone, termRows, termCols }: Props) => {
  const danger = tone === 'danger';
  const accent = danger ? theme.red : theme.accent;

  const width = Math.max(34, Math.min(termCols - 8, 76));
  const innerW = width - 4; // border (2) + paddingX (2)

  const stmtLines = statement ? wrap(statement, innerW) : [];
  const deps = details ?? [];

  // header + (blank + statement) + (blank + "Also drops:" + items) + blank + footer
  const lines =
    1 +
    (statement ? 1 + stmtLines.length : 0) +
    (deps.length > 0 ? 1 + 1 + deps.length : 0) +
    1 +
    1;

  return (
    <Overlay
      termRows={termRows}
      termCols={termCols}
      width={width}
      height={lines + 2}
      borderColor={accent}
    >
      <text wrapMode="none">
        <span bg={accent} fg={theme.onAccent} attributes={TextAttributes.BOLD}>
          {danger ? ' ⚠ confirm ' : ' confirm '}
        </span>
        <b>{` ${title}`}</b>
      </text>

      {statement ? <text> </text> : null}
      {stmtLines.map((ln, i) => (
        <text key={`s${i}`} wrapMode="none" fg={theme.cyan} selectable>
          {ln === '' ? ' ' : ln}
        </text>
      ))}

      {deps.length > 0 ? <text> </text> : null}
      {deps.length > 0 ? (
        <text wrapMode="none" fg={theme.border}>
          also drops:
        </text>
      ) : null}
      {deps.map((d, i) => (
        <text key={`d${i}`} wrapMode="none" fg={theme.yellow}>
          {`  • ${d}`}
        </text>
      ))}

      <text> </text>
      <text wrapMode="none" fg={theme.border}>
        <span fg={theme.green}>y</span> confirm{'  ·  '}
        <span fg={theme.green}>n</span> cancel
      </text>
    </Overlay>
  );
};

export const ConfirmDialog = React.memo(ConfirmDialogImpl);
