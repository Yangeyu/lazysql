/**
 * ErrorOverlay — the error dialog, popped automatically on a failure: the full
 * message plus the driver's own facts (error code, verbatim detail, the
 * original message when the one-liner was reworded), wrapped instead of
 * truncated. Read-only and static — esc / ⏎ dismiss it (dispatched in
 * keymap.ts), so it holds no scroll state of its own.
 */

import React from 'react';
import { TextAttributes } from '@opentui/core';
import type { AppError } from '../app/appError.ts';
import { theme } from '../theme/theme.ts';
import { Overlay, dialogWidth } from './Overlay.tsx';
import { wrapByWidth } from './wrapText.ts';

interface Props {
  error: AppError;
  termRows: number;
  termCols: number;
}

const LABEL_COL = 8;

/** Wrap a possibly multi-line value into display rows of at most `width`. */
const rowsOf = (text: string, width: number): string[] =>
  text.split('\n').flatMap((line) => wrapByWidth(line, width));

/** One labelled fact: the label shows on the first row, continuations indent. */
interface FactRow {
  readonly label: string;
  readonly text: string;
}

const fact = (label: string, text: string, width: number): FactRow[] =>
  rowsOf(text, width).map((row, i) => ({ label: i === 0 ? label : '', text: row }));

const ErrorOverlayImpl = ({ error, termRows, termCols }: Props) => {
  const width = dialogWidth(termCols);
  const bodyWidth = width - 4; // border + paddingX

  const message = rowsOf(error.message, bodyWidth);
  const facts: FactRow[] = [
    ...(error.code !== undefined ? fact('code', error.code, bodyWidth - LABEL_COL) : []),
    ...(error.detail !== undefined ? fact('detail', error.detail, bodyWidth - LABEL_COL) : []),
    ...(error.raw !== undefined ? fact('driver', error.raw, bodyWidth - LABEL_COL) : []),
  ];

  // Chrome: border (2) + header (title + blank = 2) + footer (1); a fact block
  // brings its separating blank line.
  const bodyRows = message.length + (facts.length > 0 ? facts.length + 1 : 0);
  const height = Math.min(termRows, bodyRows + 5);

  return (
    <Overlay
      termRows={termRows}
      termCols={termCols}
      width={width}
      height={height}
      borderColor={theme.red}
    >
      <text attributes={TextAttributes.BOLD} fg={theme.red}>
        ⚠  Error
      </text>
      <text> </text>
      {message.map((row, i) => (
        <text key={`m${i}`} wrapMode="none">
          {row}
        </text>
      ))}
      {facts.length > 0 ? <text> </text> : null}
      {facts.map((row, i) => (
        <text key={`f${i}`} wrapMode="none">
          <span fg={theme.yellow}>{row.label.padEnd(LABEL_COL)}</span>
          {row.text}
        </text>
      ))}
      <text fg={theme.border} wrapMode="none">
        esc/⏎ close
      </text>
    </Overlay>
  );
};

export const ErrorOverlay = React.memo(ErrorOverlayImpl);
