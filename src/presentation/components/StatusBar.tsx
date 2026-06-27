/**
 * StatusBar — the bottom bar: a context/mode badge on the left and the compact,
 * context-aware keybinding hints on the right. Input modes (filter / edit /
 * confirm) take over the bar to show their live prompt. The hint text is
 * rendered from the keymap registry (footerHints) so it never drifts from the
 * `?` overlay or the real bindings. Branding and the data breadcrumb live in the
 * top Header; this bar is purely about *what you can do right now*.
 */

import React from 'react';
import { TextAttributes } from '@opentui/core';
import type { Mode } from '../app/store.ts';
import { footerHints, type KeyContext, type KeyFlags } from '../keymap/keymap.ts';
import { theme } from '../theme/theme.ts';
import { Caret } from './Caret.tsx';

interface Props {
  width: number;
  status: string;
  error: string | null;
  context: KeyContext;
  flags: KeyFlags;
  mode: Mode;
  filterDraft: string;
  filterColumn: string | null;
  editDraft: string;
  editColumn: string | null;
  pendingMessage: string | null;
}

const Badge = ({
  label,
  bg,
  fg = theme.onAccent,
}: {
  label: string;
  bg: string;
  fg?: string;
}) => (
  <span bg={bg} fg={fg} attributes={TextAttributes.BOLD}>
    {` ${label} `}
  </span>
);

const CURSOR = <Caret focused />;

/** Short label for the resting context badge. */
const contextBadge = (context: KeyContext): { label: string; bg: string } => {
  switch (context) {
    case 'sidebar':
      return { label: 'TREE', bg: theme.accent };
    case 'grid':
      return { label: 'DATA', bg: theme.cyan };
    case 'editor':
      return { label: 'SQL', bg: theme.magenta };
    case 'cell':
      return { label: 'CELL', bg: theme.cyan };
    default:
      return { label: 'lazysql', bg: theme.accent };
  }
};

const StatusBarImpl = ({
  width,
  status,
  error,
  context,
  flags,
  mode,
  filterDraft,
  filterColumn,
  editDraft,
  editColumn,
  pendingMessage,
}: Props) => {
  // The hint list stays on ONE line: it truncates from the right, so the active
  // context's keys (listed first) always survive.
  const bar = (left: React.ReactNode): React.ReactNode => (
    <box flexDirection="row" width={width} justifyContent="space-between" paddingX={1}>
      <box flexShrink={0}>{left}</box>
      <box flexShrink={1} marginLeft={2}>
        <text wrapMode="none" fg={theme.border}>
          {footerHints(context, flags)}
        </text>
      </box>
    </box>
  );

  // Cell-edit input mode: show the value being typed.
  if (mode === 'edit') {
    return bar(
      <text>
        <Badge label="edit" bg={theme.magenta} />
        <span> </span>
        <span fg={theme.border}>{editColumn ?? '?'} = </span>
        <span fg={theme.cyan}>{editDraft}</span>
        {CURSOR}
      </text>,
    );
  }

  // Confirmation: show the exact statement intent before it runs.
  if (mode === 'confirm') {
    return bar(
      <text wrapMode="none">
        <Badge label="confirm" bg={theme.red} fg="#ffffff" />
        <span> </span>
        <span fg={theme.yellow}>{pendingMessage}</span>
      </text>,
    );
  }

  // Filter input mode owns the bar: live prompt.
  if (mode === 'filter') {
    return bar(
      <text>
        <Badge label="filter" bg={theme.yellow} />
        <span> </span>
        <span fg={theme.border}>{filterColumn ?? '?'} contains </span>
        <span fg={theme.cyan}>{filterDraft}</span>
        {CURSOR}
      </text>,
    );
  }

  if (error) {
    return bar(
      <text wrapMode="none">
        <Badge label="error" bg={theme.red} fg="#ffffff" />
        <span fg={theme.red}> {error}</span>
      </text>,
    );
  }

  const badge = contextBadge(context);
  return bar(
    <text>
      <Badge label={badge.label} bg={badge.bg} />
      <span fg={theme.border}> {status === 'connecting' ? 'connecting…' : ''}</span>
    </text>,
  );
};

export const StatusBar = React.memo(StatusBarImpl);
