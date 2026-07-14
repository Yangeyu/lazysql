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
import type { PendingChoice } from '../app/store.ts';
import { theme } from '../theme/theme.ts';
import { Overlay, dialogWidth } from './Overlay.tsx';

interface Props {
  title: string;
  statement?: string;
  details?: readonly string[];
  tone: 'normal' | 'danger';
  /** An inline single-choice (segmented radio), e.g. the export format; `f` cycles it. */
  choice?: PendingChoice;
  termRows: number;
  termCols: number;
}

/** Hard-wrap into width-w chunks so the panel geometry is exact and the footer
 *  never depends on the renderer's wrapping. Splits on newlines first — a staged
 *  statement can embed a multi-line value (e.g. a pretty-printed JSON edit), and
 *  an embedded '\n' inside one <text> would render extra rows the height math
 *  didn't count. */
const wrap = (s: string, w: number): string[] => {
  const out: string[] = [];
  for (const line of s.split('\n')) {
    if (line.length === 0) out.push('');
    else for (let i = 0; i < line.length; i += w) out.push(line.slice(i, i + w));
  }
  return out.length > 0 ? out : [''];
};

/** Clamp to `max` rows by eliding the MIDDLE: for an UPDATE both the head
 *  (SET column) and the tail (WHERE key) are what the user must see to judge
 *  the write, so neither end may be sacrificed. */
const clampMiddle = (lines: string[], max: number): string[] => {
  if (lines.length <= max) return lines;
  const head = Math.ceil((max - 1) / 2);
  const tail = max - 1 - head;
  return [
    ...lines.slice(0, head),
    `… (+${lines.length - head - tail} lines)`,
    ...lines.slice(lines.length - tail),
  ];
};

const ConfirmDialogImpl = ({ title, statement, details, tone, choice, termRows, termCols }: Props) => {
  const danger = tone === 'danger';
  const accent = danger ? theme.red : theme.accent;

  const width = dialogWidth(termCols);
  const innerW = width - 4; // border (2) + paddingX (2)

  const deps = details ?? [];
  // Rows everything but the statement occupies (incl. the border): header +
  // stmt blank + (blank + choice) + (blank + "also drops:" + items) + blank +
  // footer + border(2). The statement gets whatever the terminal has left.
  const chrome = 1 + 1 + (choice ? 2 : 0) + (deps.length > 0 ? 2 + deps.length : 0) + 2 + 2;
  const stmtLines = statement
    ? clampMiddle(wrap(statement, innerW), Math.max(3, termRows - chrome))
    : [];

  // header + (blank + statement) + (blank + choice) + (blank + "Also drops:" + items) + blank + footer
  const lines =
    1 +
    (statement ? 1 + stmtLines.length : 0) +
    (choice ? 1 + 1 : 0) +
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

      {choice ? <text> </text> : null}
      {choice ? (
        <text wrapMode="none">
          <span fg={theme.border}>{`${choice.label}   `}</span>
          {choice.options.map((o) => (
            <span key={o}>
              {o === choice.selected ? (
                <span attributes={TextAttributes.INVERSE}>{` ${o} `}</span>
              ) : (
                <span fg={theme.border}>{` ${o} `}</span>
              )}
              {'  '}
            </span>
          ))}
        </text>
      ) : null}

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
        {choice ? (
          <span>
            {'  ·  '}
            <span fg={theme.green}>f</span>
            {` ${choice.label}`}
          </span>
        ) : null}
      </text>
    </Overlay>
  );
};

export const ConfirmDialog = React.memo(ConfirmDialogImpl);
