/**
 * StatusBar — the bottom bar: a context/mode badge on the left and the compact,
 * context-aware keybinding hints on the right. Inline input modes (filter / edit)
 * take over the bar to show their live prompt; a staged confirm is shown by the
 * floating ConfirmDialog instead, so it isn't handled here. The hint text is
 * rendered from the keymap registry (footerHints) so it never drifts from the
 * `?` overlay or the real bindings. Branding and the data breadcrumb live in the
 * top Header; this bar is purely about *what you can do right now*.
 */

import React from 'react';
import { TextAttributes } from '@opentui/core';
import type { Mode } from '../app/store.ts';
import type { AppError } from '../app/appError.ts';
import { footerHints, type KeyContext, type KeyFlags } from '../keymap/keymap.ts';
import { theme, INPUT_CURSOR } from '../theme/theme.ts';

interface Props {
  width: number;
  status: string;
  error: AppError | null;
  /** Transient info line (e.g. an export result); shown when there's no error. */
  notice: string | null;
  context: KeyContext;
  flags: KeyFlags;
  mode: Mode;
  /** How many tables are marked for a batch export; shown as a chip while resting
   *  on the tree so the (cursor-independent) selection is never invisible. */
  markCount: number;
  /** Seed value for the filter input (existing filter for the column, or ''). */
  filterInitial: string;
  filterColumn: string | null;
  onFilterSubmit: (value: string) => void;
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
    case 'cellEdit':
      return { label: 'EDIT', bg: theme.magenta };
    case 'treeFilter':
      return { label: 'filter', bg: theme.yellow };
    default:
      return { label: 'lazysql', bg: theme.accent };
  }
};

const StatusBarImpl = ({
  width,
  status,
  error,
  notice,
  context,
  flags,
  mode,
  markCount,
  filterInitial,
  filterColumn,
  onFilterSubmit,
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

  // A running export captures input; show the live row count and let the footer
  // advertise `esc cancel` (from the keymap's `exporting` context).
  if (mode === 'exporting') {
    return bar(
      <text wrapMode="none">
        <Badge label="export" bg={theme.magenta} />
        <span fg={theme.border}> {notice ?? 'exporting…'}</span>
      </text>,
    );
  }

  if (error) {
    return bar(
      <text wrapMode="none">
        <Badge label="error" bg={theme.red} fg="#ffffff" />
        <span fg={theme.red}> {error.message}</span>
      </text>,
    );
  }

  if (notice) {
    return bar(
      <text wrapMode="none">
        <Badge label="ok" bg={theme.green} />
        <span fg={theme.border}> {notice}</span>
      </text>,
    );
  }

  const badge = contextBadge(context);
  return bar(
    <text>
      <Badge label={badge.label} bg={badge.bg} />
      {context === 'sidebar' && markCount > 0 ? (
        <span fg={theme.green} attributes={TextAttributes.BOLD}>{` ✓${markCount} marked`}</span>
      ) : null}
      <span fg={theme.border}> {status === 'connecting' ? 'connecting…' : ''}</span>
    </text>,
  );
};

export const StatusBar = React.memo(StatusBarImpl);
