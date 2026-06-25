/**
 * Header — the always-present top bar. A branded badge on the left, then a
 * breadcrumb of the live context (connection ▸ open object), with the row
 * window, active filter and AI-availability pinned to the right. It's pure
 * projection of store state; it owns no logic. Together with the bottom
 * StatusBar it frames the workbench like k9s / lazydocker.
 */

import React from 'react';
import { Box, Text } from 'ink';
import { theme, driverColor } from '../theme/theme.ts';

interface Props {
  width: number;
  connectionName: string | null;
  driverTag: string | null;
  connected: boolean;
  objectName: string | null;
  /** 1-based row window, or null when nothing is open. */
  from: number;
  to: number;
  total: number;
  filterSummary: string;
  nlAvailable: boolean;
}

const HeaderImpl: React.FC<Props> = ({
  width,
  connectionName,
  driverTag,
  connected,
  objectName,
  from,
  to,
  total,
  filterSummary,
  nlAvailable,
}) => (
  <Box width={width} justifyContent="space-between" paddingX={1}>
    <Box>
      <Text backgroundColor={theme.accent} color={theme.onAccent} bold>
        {' ⛁ lazysql '}
      </Text>
      <Text> </Text>
      {connectionName ? (
        <Text wrap="truncate">
          <Text color={connected ? theme.green : theme.border}>
            {connected ? '●' : '○'}{' '}
          </Text>
          <Text bold>{connectionName} </Text>
          {driverTag ? (
            <Text backgroundColor={driverColor(driverTag)} color={theme.onAccent}>
              {` ${driverTag} `}
            </Text>
          ) : null}
          {objectName ? (
            <Text>
              <Text color={theme.border}>{'  ▸  '}</Text>
              <Text color={theme.cyan} bold>
                {objectName}
              </Text>
            </Text>
          ) : null}
        </Text>
      ) : (
        <Text color={theme.border}>no connection · press n to add one</Text>
      )}
    </Box>

    <Box>
      {objectName && total >= 0 ? (
        <Text color={theme.border}>
          {from}–{to}
          <Text> of </Text>
          <Text color={theme.cyan}>{total}</Text>
          <Text> rows</Text>
        </Text>
      ) : null}
      {filterSummary ? (
        <Text color={theme.yellow}>
          {'  ⛃ '}
          {filterSummary}
        </Text>
      ) : null}
      {nlAvailable ? <Text color={theme.magenta}>{'  ✦ AI'}</Text> : null}
    </Box>
  </Box>
);

export const Header = React.memo(HeaderImpl);
