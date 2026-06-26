/**
 * QueryEditor — the SQL editor pane (top-right of the workbench). It owns ONLY
 * the input box and its inline feedback: completions, the NL→SQL prompt, the
 * generated explanation, and run errors. Running a query sends its result to the
 * shared results grid below — the editor no longer renders results itself, so
 * "edit SQL" and "show data" are cleanly separated (SRP).
 *
 * The input text is wrapped MANUALLY (wrapText) at a width derived from the known
 * viewport, then each line is its own <Text>. We do not lean on Ink to
 * measure-and-wrap a single Text inside flex containers: in this nested layout
 * Ink hands the wrapping Text a near-zero width, collapsing the SQL to one
 * character per line (only "fixing itself" after a re-measure). Computing the
 * wrap ourselves removes that dependency entirely.
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
  /** Whether the editor pane holds focus (shows the caret, accent border). */
  focused: boolean;
  completions: string[];
  nlMode: boolean;
  nlDraft: string;
  generating: boolean;
  nlExplanation: string | null;
  nlKind: StatementKind | null;
  /** The last run's error, surfaced under the input. */
  error: string | null;
  viewportCols: number;
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
  completions,
  nlMode,
  nlDraft,
  generating,
  nlExplanation,
  nlKind,
  error,
  viewportCols,
}) => {
  // Reserve the box border (2), padding (2) and the prompt gutter for content.
  const contentWidth = Math.max(8, viewportCols - 4 - PROMPT.length);
  const shown = queryText + (focused && !nlMode ? '▌' : '');
  const lines = wrapText(shown, contentWidth);

  return (
    <Box flexDirection="column" width={viewportCols}>
      <Box
        borderStyle="round"
        borderColor={
          nlMode ? theme.magenta : focused ? theme.borderFocus : theme.border
        }
        paddingX={1}
        flexDirection="column"
        width={viewportCols}
      >
        {lines.map((ln, i) => (
          <Text key={i} wrap="truncate">
            {i === 0 ? (
              <Text bold color={theme.magenta}>
                {PROMPT}
              </Text>
            ) : (
              ' '.repeat(PROMPT.length)
            )}
            {ln}
          </Text>
        ))}
      </Box>

      {nlMode ? (
        <Box flexDirection="column">
          <Text>
            <Text color={theme.magenta} bold>
              ✦ ask{' '}
            </Text>
            <Text color={theme.cyan}>{nlDraft}</Text>
            <Text color={theme.accent}>▌</Text>
          </Text>
          <Text color={theme.border}>
            ⏎ generate SQL (review before running) · esc cancel
          </Text>
        </Box>
      ) : generating ? (
        <Text color={theme.magenta}>✦ Generating SQL…</Text>
      ) : error ? (
        <Text color={theme.red} wrap="truncate">
          error: {error}
        </Text>
      ) : focused && completions.length > 0 ? (
        <Text wrap="truncate">
          <Text color={theme.border}>⇥ </Text>
          <Text color={theme.cyan} bold>
            {completions[0]}
          </Text>
          <Text color={theme.border}>
            {completions.slice(1).map((c) => ` · ${c}`).join('')}
          </Text>
        </Text>
      ) : nlExplanation ? (
        <Text wrap="truncate">
          <Text color={theme.magenta}>✦ {nlExplanation}</Text>
          {nlKind && isDestructive(nlKind) ? (
            <Text color={theme.red} bold>
              {'  '}⚠ {nlKind.toUpperCase()} — review before running
            </Text>
          ) : null}
        </Text>
      ) : (
        <Text color={theme.border} wrap="truncate">
          {focused
            ? '⏎ run · ^G ask AI · esc grid'
            : ': edit SQL · ⏎ run · ↑/↓ history'}
        </Text>
      )}
    </Box>
  );
};

export const QueryEditor = React.memo(QueryEditorImpl);
