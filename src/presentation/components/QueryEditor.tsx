/**
 * QueryEditor — the SQL editor pane (top-right of the workbench): ONE bordered
 * panel with two stacked sections, an "ask" row on top and the SQL editor below,
 * split by a divider:
 *
 *   ╭─────────────────────────────────╮
 *   │ ✦ ask   how many active users?  │   ← NL→SQL input (active on ^G)
 *   │ ─────────────────────────────── │   ← divider
 *   │ SQL>    SELECT count(*) …        │   ← SQL editor (multi-line)
 *   │ ⇥ users · user_id …             │   ← completions / explanation / error
 *   ╰─────────────────────────────────╯
 *
 * The panel stretches to the full right-column width (no fixed width of its own),
 * so it aligns exactly with the results grid below it. Running a query sends its
 * result to the shared grid — the editor never renders results itself (SRP).
 *
 * The SQL is laid out by wrapWithCursor (a width from the known viewport), which
 * also reports the caret's line/column so it can be drawn mid-string; each line
 * is its own <text>, so layout never collapses the SQL to one character per line.
 * Clicking the pane focuses it via `onPaneClick`.
 */

import React from 'react';
import { TextAttributes } from '@opentui/core';
import {
  isDestructive,
  type StatementKind,
} from '../../domain/query/classify.ts';
import { theme } from '../theme/theme.ts';
import { Caret } from './Caret.tsx';
import { TextInput } from './TextInput.tsx';
import { wrapWithCursor } from '../input/wrap.ts';
import { rowWindow } from '../app/layout.ts';
import type { TextField } from '../input/textField.ts';

interface Props {
  queryText: TextField;
  /** Read-only echo of the current browse statement, shown dimmed while the
   *  editor is empty so the SQL panel always reflects what the grid shows. Null
   *  when not browsing; the user's first keystroke takes over. */
  browsePreview: string | null;
  /** Editor pane focused; the SQL sub-section is active when not in `nlMode`. */
  focused: boolean;
  /** The ask row is active (capturing the NL prompt). */
  nlMode: boolean;
  nlDraft: TextField;
  completions: string[];
  generating: boolean;
  nlExplanation: string | null;
  nlKind: StatementKind | null;
  error: string | null;
  /** Fixed panel height, including its border. */
  height: number;
  /** Content width (panel inner width) — drives the wrap and the divider. */
  innerWidth: number;
  /** The pane was clicked — focus the editor. */
  onPaneClick: () => void;
}

const PROMPT = 'SQL> ';

/** Collapse newlines so a value stays on a SINGLE feedback line — otherwise a
 *  multi-line error would overflow the fixed-height pane and push the (pinned)
 *  ask row off the top. */
const oneLine = (s: string): string => s.replace(/\s*\n\s*/g, ' ');

const QueryEditorImpl = ({
  queryText,
  browsePreview,
  focused,
  nlMode,
  nlDraft,
  completions,
  generating,
  nlExplanation,
  nlKind,
  error,
  height,
  innerWidth,
  onPaneClick,
}: Props) => {
  // Interior budget: ask row (1) + divider (1) + SQL rows + feedback (1).
  const sqlRows = Math.max(1, height - 5);
  // Lay the query out and locate the caret, then window so the caret line stays
  // visible (keeps the bottom feedback line pinned). The caret renders on its
  // line below, so it isn't part of the wrapped text.
  const { lines, caretLine, caretCol } = wrapWithCursor(
    queryText.value,
    queryText.cursor,
    Math.max(8, innerWidth - PROMPT.length),
  );
  const start = rowWindow(caretLine, sqlRows, lines.length);
  const sql = lines.slice(start, start + sqlRows);
  while (sql.length < sqlRows) sql.push('');
  const showCaret = focused && !nlMode;

  // With nothing typed, the SQL section echoes the current browse statement
  // (dimmed, read-only) so the panel always shows what produced the grid; the
  // first keystroke (queryText non-empty) replaces it with the user's query.
  const previewMode = !nlMode && queryText.value.length === 0 && !!browsePreview;

  const borderColor = nlMode
    ? theme.magenta
    : focused
      ? theme.borderFocus
      : theme.border;

  return (
    <box
      flexDirection="column"
      flexShrink={0}
      width="100%"
      height={height}
      border
      borderStyle="rounded"
      borderColor={borderColor}
      paddingX={1}
      onMouseDown={onPaneClick}
    >
      {/* ── ask row (NL→SQL) ── */}
      <text wrapMode="none">
        <b fg={theme.magenta}>✦ ask </b>
        {nlMode ? (
          <TextInput field={nlDraft} focused fg={theme.cyan} />
        ) : nlExplanation ? (
          <span fg={theme.magenta}>
            {oneLine(nlExplanation)}
            {nlKind && isDestructive(nlKind) ? (
              <b fg={theme.red}>
                {'  '}⚠ {nlKind.toUpperCase()}
              </b>
            ) : null}
          </span>
        ) : (
          <span fg={theme.border}>press ^G to ask in natural language</span>
        )}
      </text>

      {/* ── divider ── (truncate guards against any off-by-one overflow) */}
      <text fg={theme.border} wrapMode="none">
        {'─'.repeat(Math.max(0, innerWidth))}
      </text>

      {/* ── SQL editor: the live query, or — while empty — a dim echo of the
          current browse statement ── */}
      {previewMode
        ? Array.from({ length: sqlRows }, (_, i) => (
            <text key={i} wrapMode="none">
              {i === 0 ? (
                <>
                  <b fg={theme.magenta}>{PROMPT}</b>
                  <Caret focused={focused} />
                  <span fg={theme.muted}>{browsePreview}</span>
                </>
              ) : (
                ''
              )}
            </text>
          ))
        : sql.map((ln, i) => {
            const abs = start + i;
            const onCaretLine = showCaret && abs === caretLine;
            return (
              <text key={i} wrapMode="none">
                {abs === 0 ? (
                  <b fg={theme.magenta}>{PROMPT}</b>
                ) : (
                  ' '.repeat(PROMPT.length)
                )}
                {onCaretLine ? (
                  <>
                    {ln.slice(0, caretCol)}
                    <Caret focused />
                    {ln.slice(caretCol)}
                  </>
                ) : (
                  ln
                )}
              </text>
            );
          })}

      {/* ── feedback: completions / generating / error / hint ── */}
      {error ? (
        <text fg={theme.red} wrapMode="none">
          error: {oneLine(error)}
        </text>
      ) : generating ? (
        <text fg={theme.magenta}>✦ Generating SQL…</text>
      ) : focused && !nlMode && completions.length > 0 ? (
        <text wrapMode="none">
          <span fg={theme.border}>⇥ </span>
          <b fg={theme.cyan}>{completions[0]}</b>
          <span fg={theme.border}>
            {completions.slice(1).map((c) => ` · ${c}`).join('')}
          </span>
        </text>
      ) : (
        <text fg={theme.border} wrapMode="none">
          {nlMode
            ? '⏎ generate SQL (review before running) · esc cancel'
            : focused
              ? '⏎ run · ^G ask AI · ↑/↓ history · esc grid'
              : ': focus editor · ⏎ run'}
        </text>
      )}
    </box>
  );
};

export const QueryEditor = React.memo(QueryEditorImpl);
