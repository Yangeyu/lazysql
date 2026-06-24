/**
 * StatusBar — context line (current object, page window, totals) plus a compact,
 * context-aware keybinding hint. Mirrors lazygit's always-present status footer.
 */

import React from 'react';
import { Box, Text } from 'ink';
import type { ObjectRef } from '../../domain/datasource/schema.ts';
import type { Page } from '../../domain/query/Query.ts';
import type { Focus } from '../app/store.ts';

interface Props {
  status: string;
  error: string | null;
  current: ObjectRef | null;
  total: number;
  page: Page;
  rowsInPage: number;
  focus: Focus;
}

const StatusBarImpl: React.FC<Props> = ({
  status,
  error,
  current,
  total,
  page,
  rowsInPage,
  focus,
}) => {
  const from = total === 0 ? 0 : page.offset + 1;
  const to = page.offset + rowsInPage;

  const hints =
    focus === 'sidebar'
      ? '↑/↓ select · ⏎ open · tab grid · q quit'
      : '↑/↓ row · ←/→ col · s sort · n/p page · tab objects · q quit';

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
