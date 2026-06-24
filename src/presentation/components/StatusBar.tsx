/**
 * StatusBar — context line (current object, page window, totals) plus a compact,
 * context-aware keybinding hint. Mirrors lazygit's always-present status footer.
 */

import React from 'react';
import { Box, Text } from 'ink';
import type { ObjectRef } from '../../domain/datasource/schema.ts';
import type { Page, Filter } from '../../domain/query/Query.ts';
import type { Focus, Mode } from '../app/store.ts';

interface Props {
  status: string;
  error: string | null;
  current: ObjectRef | null;
  total: number;
  page: Page;
  rowsInPage: number;
  focus: Focus;
  filter: Filter | null;
  mode: Mode;
  filterDraft: string;
  filterColumn: string | null;
}

/** Compact one-line summary of an active filter, e.g. `label~foo`. */
const filterSummary = (filter: Filter | null): string => {
  if (!filter || filter.conditions.length === 0) return '';
  return filter.conditions
    .map((c) => `${c.column}${c.op === 'contains' ? '~' : ` ${c.op} `}${c.value}`)
    .join(' & ');
};

const StatusBarImpl: React.FC<Props> = ({
  status,
  error,
  current,
  total,
  page,
  rowsInPage,
  focus,
  filter,
  mode,
  filterDraft,
  filterColumn,
}) => {
  const from = total === 0 ? 0 : page.offset + 1;
  const to = page.offset + rowsInPage;
  const active = filterSummary(filter);

  // Filter input mode owns the footer: show the live prompt.
  if (mode === 'filter') {
    return (
      <Box flexDirection="column">
        <Box>
          <Text backgroundColor="yellow" color="black">
            {' filter '}
          </Text>
          <Text>
            {' '}
            {filterColumn ?? '?'} contains:{' '}
            <Text color="cyan">{filterDraft}</Text>
            <Text>▌</Text>
          </Text>
        </Box>
        <Text dimColor>⏎ apply · esc cancel · (empty clears)</Text>
      </Box>
    );
  }

  const hints =
    focus === 'sidebar'
      ? '↑/↓ select · ⏎ open · tab grid · q quit'
      : '↑/↓ row · ←/→ col · s sort · / filter · n/p page · tab objects · q quit';

  return (
    <Box flexDirection="column">
      <Box>
        <Text backgroundColor="blue" color="white">
          {' lazysql '}
        </Text>
        <Text> </Text>
        {error ? (
          <Text color="red">error: {error}</Text>
        ) : current ? (
          <Text>
            <Text color="cyan">{current.name}</Text>
            <Text dimColor>
              {'  '}
              {from}–{to} of {total} rows
            </Text>
            {active ? <Text color="yellow">{'  '}⛃ {active}</Text> : null}
          </Text>
        ) : (
          <Text dimColor>{status}</Text>
        )}
      </Box>
      <Text dimColor>{hints}</Text>
    </Box>
  );
};

export const StatusBar = React.memo(StatusBarImpl);
