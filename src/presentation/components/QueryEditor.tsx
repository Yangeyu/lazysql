/**
 * QueryEditor — the free-form SQL view: an input line on top and the result set
 * (reusing DataGrid) below. Two sub-focuses, editor and result, let the user
 * type/run a query, then Tab into the grid to scroll it.
 */

import React from 'react';
import { Box, Text } from 'ink';
import { DataGrid } from './DataGrid.tsx';
import type { ResultSet } from '../../domain/datasource/ResultSet.ts';

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
  viewportRows: number;
}

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
  viewportRows,
}) => (
  <Box flexDirection="column" flexGrow={1}>
    <Box
      borderStyle="round"
      borderColor={editorFocused ? 'cyan' : 'gray'}
      paddingX={1}
    >
      <Text bold color="magenta">
        SQL&gt;{' '}
      </Text>
      <Text wrap="wrap">
        {queryText}
        {editorFocused ? <Text>▌</Text> : null}
      </Text>
    </Box>

    {editorFocused && completions.length > 0 ? (
      <Text wrap="truncate">
        <Text dimColor>⇥ </Text>
        <Text color="cyan" bold>
          {completions[0]}
        </Text>
        <Text dimColor>{completions.slice(1).map((c) => ` · ${c}`).join('')}</Text>
      </Text>
    ) : null}

    {error ? (
      <Text color="red" wrap="truncate">
        error: {error}
      </Text>
    ) : loading ? (
      <Text color="yellow">Running…</Text>
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
          focused={resultFocused}
        />
        <Text dimColor>
          {result.rows.length} rows · {elapsedMs}ms
          {result.truncated ? ' · truncated' : ''}
        </Text>
      </>
    ) : (
      <Text dimColor>Type SQL and press ⏎ to run. ↑/↓ history · esc back.</Text>
    )}
  </Box>
);

export const QueryEditor = React.memo(QueryEditorImpl);
