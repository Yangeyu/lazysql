/**
 * Header — the always-present top bar. A branded badge on the left, then a
 * breadcrumb of the live context (connection ▸ open object), with the row
 * window, active filter and AI-availability pinned to the right. It's pure
 * projection of store state; it owns no logic. Together with the bottom
 * StatusBar it frames the workbench like k9s / lazydocker.
 */

import React from 'react';
import { TextAttributes } from '@opentui/core';
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

const HeaderImpl = ({
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
}: Props) => (
  <box flexDirection="row" width={width} justifyContent="space-between" paddingX={1}>
    <box flexDirection="row">
      <text bg={theme.accent} fg={theme.onAccent} attributes={TextAttributes.BOLD}>
        {' ⛁ lazysql '}
      </text>
      <text> </text>
      {connectionName ? (
        <text wrapMode="none">
          <span fg={connected ? theme.green : theme.border}>
            {connected ? '●' : '○'}{' '}
          </span>
          <b>{connectionName} </b>
          {driverTag ? (
            <span bg={driverColor(driverTag)} fg={theme.onAccent}>
              {` ${driverTag} `}
            </span>
          ) : null}
          {objectName ? (
            <span>
              <span fg={theme.border}>{'  ▸  '}</span>
              <b fg={theme.cyan}>{objectName}</b>
            </span>
          ) : null}
        </text>
      ) : (
        <text fg={theme.border}>no connection · press n to add one</text>
      )}
    </box>

    <box flexDirection="row">
      {objectName && total >= 0 ? (
        <text fg={theme.border}>
          {from}–{to}
          <span> of </span>
          <span fg={theme.cyan}>{total}</span>
          <span> rows</span>
        </text>
      ) : null}
      {filterSummary ? (
        <text fg={theme.yellow}>
          {'  ⛃ '}
          {filterSummary}
        </text>
      ) : null}
      {nlAvailable ? <text fg={theme.magenta}>{'  ✦ AI'}</text> : null}
    </box>
  </box>
);

export const Header = React.memo(HeaderImpl);
