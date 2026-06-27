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
 * The SQL text is wrapped MANUALLY (wrapText) at a width derived from the known
 * viewport, then each line is its own <text>, so layout never collapses the SQL
 * to one character per line. Clicking the pane focuses it via `onPaneClick`.
 */

import React from 'react';
import { TextAttributes } from '@opentui/core';
import stringWidth from 'string-width';
import {
  isDestructive,
  type StatementKind,
} from '../../domain/query/classify.ts';
import { theme, CARET } from '../theme/theme.ts';

interface Props {
  queryText: string;
  /** Read-only echo of the current browse statement, shown dimmed while the
   *  editor is empty so the SQL panel always reflects what the grid shows. Null
   *  when not browsing; the user's first keystroke takes over. */
  browsePreview: string | null;
  /** Editor pane focused; the SQL sub-section is active when not in `nlMode`. */
  focused: boolean;
  /** The ask row is active (capturing the NL prompt). */
  nlMode: boolean;
  nlDraft: string;
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

/** Greedy word-wrap to an exact display width, hard-breaking over-long words. */
const wrapText = (text: string, width: number): string[] => {
  const w = Math.max(1, width);
  const lines: string[] = [];
  let line = '';
  let lineW = 0;
  const flush = () => {
    lines.push(line);
    line = '';
    lineW = 0;
  };
  for (const token of text.split(/(\s+)/)) {
    if (token === '') continue;
    const tw = stringWidth(token);
    if (lineW > 0 && lineW + tw > w) flush();
    if (tw <= w) {
      line += token;
      lineW += tw;
    } else {
      for (const ch of token) {
        const cw = stringWidth(ch);
        if (lineW + cw > w) flush();
        line += ch;
        lineW += cw;
      }
    }
  }
  if (line || lines.length === 0) lines.push(line);
  return lines;
};

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
  const caret = focused && !nlMode ? CARET : '';
  const wrapped = wrapText(queryText + caret, Math.max(8, innerWidth - PROMPT.length));
  // Keep the caret end visible: window to the last `sqlRows` lines, pad the rest
  // so the feedback line stays pinned to the bottom.
  const start = Math.max(0, wrapped.length - sqlRows);
  const sql = wrapped.slice(start, start + sqlRows);
  while (sql.length < sqlRows) sql.push('');

  // With nothing typed, the SQL section echoes the current browse statement
  // (dimmed, read-only) so the panel always shows what produced the grid; the
  // first keystroke (queryText non-empty) replaces it with the user's query.
  const previewMode = !nlMode && queryText.length === 0 && !!browsePreview;

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
          <>
            <span fg={theme.cyan}>{nlDraft}</span>
            <span fg={theme.accent}>{CARET}</span>
          </>
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
                  {focused ? <span fg={theme.accent}>{CARET}</span> : null}
                  <span fg={theme.muted}>{browsePreview}</span>
                </>
              ) : (
                ''
              )}
            </text>
          ))
        : sql.map((ln, i) => (
            <text key={i} wrapMode="none">
              {start + i === 0 ? (
                <b fg={theme.magenta}>{PROMPT}</b>
              ) : (
                ' '.repeat(PROMPT.length)
              )}
              {ln}
            </text>
          ))}

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
