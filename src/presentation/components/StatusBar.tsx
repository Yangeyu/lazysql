/**
 * StatusBar — context line (current object, page window, totals) plus a compact,
 * context-aware keybinding hint. Mirrors lazygit's always-present status footer.
 * The hint line is rendered from the keymap registry (footerHints) so it never
 * drifts from the `?` overlay or the actual bindings.
 */

import React from 'react';
import { Box, Text } from 'ink';
import type { ObjectRef } from '../../domain/datasource/schema.ts';
import type { Page, Filter } from '../../domain/query/Query.ts';
import type { Mode, View } from '../app/store.ts';
import { footerHints, type KeyContext, type KeyFlags } from '../keymap/keymap.ts';

interface Props {
  status: string;
  error: string | null;
  connectionName: string | null;
  view: View;
  context: KeyContext;
  flags: KeyFlags;
  current: ObjectRef | null;
  total: number;
  page: Page;
  rowsInPage: number;
  filter: Filter | null;
  mode: Mode;
  filterDraft: string;
  filterColumn: string | null;
  editDraft: string;
  editColumn: string | null;
  pendingMessage: string | null;
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
  connectionName,
  view,
  context,
  flags,
  current,
  total,
  page,
  rowsInPage,
  filter,
  mode,
  filterDraft,
  filterColumn,
  editDraft,
  editColumn,
  pendingMessage,
}) => {
  const from = total === 0 ? 0 : page.offset + 1;
  const to = page.offset + rowsInPage;
  const active = filterSummary(filter);
  const hints = <Text dimColor>{footerHints(context, flags)}</Text>;

  // Cell-edit input mode: show the value being typed.
  if (mode === 'edit') {
    return (
      <Box flexDirection="column">
        <Box>
          <Text backgroundColor="magenta" color="black">
            {' edit '}
          </Text>
          <Text>
            {' '}
            {editColumn ?? '?'} ={' '}
            <Text color="cyan">{editDraft}</Text>
            <Text>▌</Text>
          </Text>
        </Box>
        {hints}
      </Box>
    );
  }

  // Confirmation: show the exact statement intent before it runs.
  if (mode === 'confirm') {
    return (
      <Box flexDirection="column">
        <Box>
          <Text backgroundColor="red" color="white">
            {' confirm '}
          </Text>
          <Text wrap="truncate">
            {' '}
            {pendingMessage}
          </Text>
        </Box>
        {hints}
      </Box>
    );
  }

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
        {hints}
      </Box>
    );
  }

  if (view === 'query') {
    return (
      <Box flexDirection="column">
        <Box>
          <Text backgroundColor="blue" color="white">
            {' lazysql '}
          </Text>
          <Text> </Text>
          {connectionName ? (
            <Text color="green">
              {connectionName}
              {'  '}
            </Text>
          ) : null}
          <Text color="magenta">SQL query</Text>
        </Box>
        {hints}
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Box>
        <Text backgroundColor="blue" color="white">
          {' lazysql '}
        </Text>
        <Text> </Text>
        {connectionName ? (
          <Text color="green">{connectionName}{'  '}</Text>
        ) : null}
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
      {hints}
    </Box>
  );
};

export const StatusBar = React.memo(StatusBarImpl);
