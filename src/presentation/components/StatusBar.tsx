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
import stringWidth from 'string-width';
import type { Mode } from '../app/store.ts';
import type { AppError } from '../app/appError.ts';
import { footerHints, type KeyContext, type KeyFlags } from '../keymap/keymap.ts';
import { theme, INPUT_CURSOR } from '../theme/theme.ts';
import { truncateByWidth } from './wrapText.ts';

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
  const hints = footerHints(context, flags);
  const innerWidth = Math.max(0, width - 2); // paddingX={1}
  const desiredGap = innerWidth >= 3 && hints !== '' ? 2 : 0;
  const filterPrefixWidth = stringWidth(` filter  ${filterColumn ?? '?'} contains `);
  // A filter reserves sixteen cells for the native input (twelve visible text
  // cells plus its cursor/chrome) before its hints grow; other modes reserve at
  // least half the row for the left side. Both sides own explicit paint bounds.
  const minLeftWidth =
    mode === 'filter'
      ? Math.min(innerWidth, filterPrefixWidth + 16)
      : Math.ceil((innerWidth - desiredGap) / 2);
  const hintWidth = Math.min(
    stringWidth(hints),
    Math.max(0, innerWidth - desiredGap - minLeftWidth),
  );
  const gap = hintWidth > 0 ? desiredGap : 0;
  const leftWidth = Math.max(0, innerWidth - gap - hintWidth);
  const filterInputWidth = Math.max(1, Math.min(40, leftWidth - filterPrefixWidth));

  // The hint list stays on ONE line and clips from the right, so the
  // highest-priority keys (listed first) always survive.
  const bar = (left: React.ReactNode): React.ReactNode => (
    <box flexDirection="row" width={width} paddingX={1}>
      <box width={leftWidth} height={1} overflow="hidden">
        {left}
      </box>
      {gap > 0 ? <box width={gap} height={1} /> : null}
      <box width={hintWidth} height={1} overflow="hidden">
        <text wrapMode="none" fg={theme.border}>
          {hints}
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
          width={filterInputWidth}
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
    // Badge (" error ") + the separating space consume eight cells. The full
    // message remains available in ErrorOverlay; this one-line summary is the
    // only content that should be shortened.
    const message = truncateByWidth(error.message, Math.max(0, leftWidth - 8));
    return bar(
      <text wrapMode="none">
        <Badge label="error" bg={theme.red} fg="#ffffff" />
        <span fg={theme.red}> {message}</span>
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
