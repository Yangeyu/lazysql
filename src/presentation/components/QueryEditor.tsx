/**
 * QueryEditor — the free-form SQL view: an input area on top and the result set
 * (reusing DataGrid) below. Two sub-focuses, editor and result, let the user
 * type/run a query, then Tab into the grid to scroll it.
 *
 * The input text is wrapped MANUALLY (wrapText) at a width derived from the
 * known viewport, then each line is rendered as its own <Text>. We do not lean
 * on Ink to measure-and-wrap a single Text inside flex containers: in this
 * nested layout Ink hands the wrapping Text a near-zero width, which collapsed
 * the SQL to one character per line (and only "fixed itself" after a Tab forced
 * a re-measure). Computing the wrap ourselves removes that dependency entirely.
 */

import React from 'react';
import { Box, Text } from 'ink';
import stringWidth from 'string-width';
import { DataGrid } from './DataGrid.tsx';
import type { ResultSet } from '../../domain/datasource/ResultSet.ts';
import {
  isDestructive,
  type StatementKind,
} from '../../domain/query/classify.ts';
import { theme } from '../theme/theme.ts';

interface Props {
  queryText: string;
  editorFocused: boolean;
  resultFocused: boolean;
  result: ResultSet | null;
  error: string | null;
  elapsedMs: number | null;
  gridRow: number;
  completions: string[];
  loading: boolean;
  nlMode: boolean;
  nlDraft: string;
  generating: boolean;
  nlExplanation: string | null;
  nlKind: StatementKind | null;
  viewportRows: number;
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
      // Token longer than a whole line: break it character by character.
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
  editorFocused,
  resultFocused,
  result,
  error,
  elapsedMs,
  gridRow,
  completions,
  loading,
  nlMode,
  nlDraft,
  generating,
  nlExplanation,
  nlKind,
  viewportRows,
  viewportCols,
}) => {
  // Reserve the box border (2), padding (2) and the prompt gutter for content.
  const contentWidth = Math.max(8, viewportCols - 4 - PROMPT.length);
  const shown = queryText + (editorFocused && !nlMode ? '▌' : '');
  const lines = wrapText(shown, contentWidth);

  return (
    <Box flexDirection="column" flexGrow={1} width={viewportCols}>
      <Box
        borderStyle="round"
        borderColor={
          nlMode ? theme.magenta : editorFocused ? theme.borderFocus : theme.border
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
      ) : (
        <>
          {editorFocused && completions.length > 0 ? (
            <Text wrap="truncate">
              <Text color={theme.border}>⇥ </Text>
              <Text color={theme.cyan} bold>
                {completions[0]}
              </Text>
              <Text color={theme.border}>
                {completions.slice(1).map((c) => ` · ${c}`).join('')}
              </Text>
            </Text>
          ) : null}
          {nlExplanation ? (
            <Text wrap="truncate">
              <Text color={theme.magenta}>✦ {nlExplanation}</Text>
              {nlKind && isDestructive(nlKind) ? (
                <Text color={theme.red} bold>
                  {'  '}⚠ {nlKind.toUpperCase()} — review before running
                </Text>
              ) : null}
            </Text>
          ) : null}
        </>
      )}

      {error ? (
        <Text color={theme.red} wrap="truncate">
          error: {error}
        </Text>
      ) : loading ? (
        <Text color={theme.yellow}>Running…</Text>
      ) : result ? (
        <>
          <DataGrid
            result={result}
            cursor={gridRow}
            selectedCol={-1}
            sort={null}
            loading={false}
            hasTable
            viewportRows={viewportRows}
            viewportCols={viewportCols}
            focused={resultFocused}
          />
          <Text color={theme.border}>
            {result.rows.length} rows · {elapsedMs}ms
            {result.truncated ? ' · truncated' : ''}
          </Text>
        </>
      ) : (
        <Text color={theme.border}>
          Type SQL and press ⏎ to run. ↑/↓ history · esc back.
        </Text>
      )}
    </Box>
  );
};

export const QueryEditor = React.memo(QueryEditorImpl);
