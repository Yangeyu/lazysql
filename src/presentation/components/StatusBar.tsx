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
import { theme, INPUT_CURSOR } from '../theme/theme.ts';

interface Props {
  width: number;
  status: string;
  error: string | null;
  context: KeyContext;
  flags: KeyFlags;
  mode: Mode;
  /** Seed value for the filter input (existing filter for the column, or ''). */
  filterInitial: string;
  filterColumn: string | null;
  onFilterSubmit: (value: string) => void;
  /** Seed value for the cell-edit input (the current cell's value). */
  editInitial: string;
  editColumn: string | null;
  onEditSubmit: (value: string) => void;
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
  filterInitial,
  filterColumn,
  onFilterSubmit,
  editInitial,
  editColumn,
  onEditSubmit,
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

  // Cell-edit input mode: a native single-line input holds the new value.
  if (mode === 'edit') {
    return bar(
      <box flexDirection="row">
        <text wrapMode="none">
          <Badge label="edit" bg={theme.magenta} />
          <span> </span>
          <span fg={theme.border}>{editColumn ?? '?'} = </span>
        </text>
        <input
          focused
          value={editInitial}
          onSubmit={onEditSubmit as never}
          width={40}
          textColor={theme.cyan}
          cursorStyle={INPUT_CURSOR}
          cursorColor={theme.accent}
        />
      </box>,
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

  // Filter input mode owns the bar: a native single-line input holds the draft.
  if (mode === 'filter') {
    return bar(
      <box flexDirection="row">
        <text wrapMode="none">
          <Badge label="filter" bg={theme.yellow} />
          <span> </span>
          <span fg={theme.border}>{filterColumn ?? '?'} contains </span>
        </text>
        <input
          focused
          value={filterInitial}
          // onSubmit is typed as an upstream intersection quirk; at runtime it
          // delivers the input's string value (verified).
          onSubmit={onFilterSubmit as never}
          width={40}
          textColor={theme.cyan}
          cursorStyle={INPUT_CURSOR}
          cursorColor={theme.accent}
        />
      </box>,
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
