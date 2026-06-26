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
 * viewport, then each line is its own <Text>: in this nested flex layout Ink
 * hands a single wrapping Text a near-zero width, collapsing the SQL to one
 * character per line. Computing the wrap ourselves removes that dependency.
 */

import React from 'react';
import { Box, Text } from 'ink';
import stringWidth from 'string-width';
import {
  isDestructive,
  type StatementKind,
} from '../../domain/query/classify.ts';
import { theme } from '../theme/theme.ts';

interface Props {
  queryText: string;
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
}

const PROMPT = 'SQL> ';

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

const QueryEditorImpl: React.FC<Props> = ({
  queryText,
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
}) => {
  // Interior budget: ask row (1) + divider (1) + SQL rows + feedback (1).
  const sqlRows = Math.max(1, height - 5);
  const caret = focused && !nlMode ? '▌' : '';
  const wrapped = wrapText(queryText + caret, Math.max(8, innerWidth - PROMPT.length));
  // Keep the caret end visible: window to the last `sqlRows` lines, pad the rest
  // so the feedback line stays pinned to the bottom.
  const start = Math.max(0, wrapped.length - sqlRows);
  const sql = wrapped.slice(start, start + sqlRows);
  while (sql.length < sqlRows) sql.push('');

  const borderColor = nlMode
    ? theme.magenta
    : focused
      ? theme.borderFocus
      : theme.border;

  return (
    <Box
      flexDirection="column"
      flexShrink={0}
      width="100%"
      height={height}
      borderStyle="round"
      borderColor={borderColor}
      paddingX={1}
    >
      {/* ── ask row (NL→SQL) ── */}
      <Text wrap="truncate">
        <Text color={theme.magenta} bold>
          ✦ ask{' '}
        </Text>
        {nlMode ? (
          <>
            <Text color={theme.cyan}>{nlDraft}</Text>
            <Text color={theme.accent}>▌</Text>
          </>
        ) : nlExplanation ? (
          <Text color={theme.magenta}>
            {nlExplanation}
            {nlKind && isDestructive(nlKind) ? (
              <Text color={theme.red} bold>
                {'  '}⚠ {nlKind.toUpperCase()}
              </Text>
            ) : null}
          </Text>
        ) : (
          <Text color={theme.border}>press ^G to ask in natural language</Text>
        )}
      </Text>

      {/* ── divider ── (truncate guards against any off-by-one overflow) */}
      <Text color={theme.border} wrap="truncate">
        {'─'.repeat(Math.max(0, innerWidth))}
      </Text>

      {/* ── SQL editor ── */}
      {sql.map((ln, i) => (
        <Text key={i} wrap="truncate">
          {start + i === 0 ? (
            <Text bold color={theme.magenta}>
              {PROMPT}
            </Text>
          ) : (
            ' '.repeat(PROMPT.length)
          )}
          {ln}
        </Text>
      ))}

      {/* ── feedback: completions / generating / error / hint ── */}
      {error ? (
        <Text color={theme.red} wrap="truncate">
          error: {error}
        </Text>
      ) : generating ? (
        <Text color={theme.magenta}>✦ Generating SQL…</Text>
      ) : focused && !nlMode && completions.length > 0 ? (
        <Text wrap="truncate">
          <Text color={theme.border}>⇥ </Text>
          <Text color={theme.cyan} bold>
            {completions[0]}
          </Text>
          <Text color={theme.border}>
            {completions.slice(1).map((c) => ` · ${c}`).join('')}
          </Text>
        </Text>
      ) : (
        <Text color={theme.border} wrap="truncate">
          {nlMode
            ? '⏎ generate SQL (review before running) · esc cancel'
            : focused
              ? '⏎ run · ^G ask AI · ↑/↓ history · esc grid'
              : ': focus editor · ⏎ run'}
        </Text>
      )}
    </Box>
  );
};

export const QueryEditor = React.memo(QueryEditorImpl);
