/**
 * StatusBar — the bottom bar: a context/mode badge on the left and the compact,
 * context-aware keybinding hints on the right. Input modes (filter / edit /
 * confirm) take over the bar to show their live prompt. The hint text is
 * rendered from the keymap registry (footerHints) so it never drifts from the
 * `?` overlay or the real bindings. Branding and the data breadcrumb live in the
 * top Header; this bar is purely about *what you can do right now*.
 */

import React from 'react';
import { Box, Text } from 'ink';
import type { Mode } from '../app/store.ts';
import { footerHints, type KeyContext, type KeyFlags } from '../keymap/keymap.ts';
import { theme } from '../theme/theme.ts';

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

const Badge: React.FC<{ label: string; bg: string; fg?: string }> = ({
  label,
  bg,
  fg = theme.onAccent,
}) => (
  <Text backgroundColor={bg} color={fg} bold>
    {` ${label} `}
  </Text>
);

const CURSOR = <Text color={theme.accent}>▌</Text>;

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

const StatusBarImpl: React.FC<Props> = ({
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
}) => {
  const hints = <Text color={theme.border}>{footerHints(context, flags)}</Text>;
  const bar = (left: React.ReactNode): React.ReactNode => (
    <Box width={width} justifyContent="space-between" paddingX={1}>
      <Box>{left}</Box>
      <Box>{hints}</Box>
    </Box>
  );

  // Cell-edit input mode: show the value being typed.
  if (mode === 'edit') {
    return bar(
      <Text>
        <Badge label="edit" bg={theme.magenta} />
        <Text> </Text>
        <Text color={theme.border}>{editColumn ?? '?'} = </Text>
        <Text color={theme.cyan}>{editDraft}</Text>
        {CURSOR}
      </Text>,
    );
  }

  // Confirmation: show the exact statement intent before it runs.
  if (mode === 'confirm') {
    return bar(
      <Text wrap="truncate">
        <Badge label="confirm" bg={theme.red} fg="#ffffff" />
        <Text> </Text>
        <Text color={theme.yellow}>{pendingMessage}</Text>
      </Text>,
    );
  }

  // Filter input mode owns the bar: live prompt.
  if (mode === 'filter') {
    return bar(
      <Text>
        <Badge label="filter" bg={theme.yellow} />
        <Text> </Text>
        <Text color={theme.border}>{filterColumn ?? '?'} contains </Text>
        <Text color={theme.cyan}>{filterDraft}</Text>
        {CURSOR}
      </Text>,
    );
  }

  if (error) {
    return bar(
      <Text wrap="truncate">
        <Badge label="error" bg={theme.red} fg="#ffffff" />
        <Text color={theme.red}> {error}</Text>
      </Text>,
    );
  }

  const badge = contextBadge(context);
  return bar(
    <Text>
      <Badge label={badge.label} bg={badge.bg} />
      <Text color={theme.border}> {status === 'connecting' ? 'connecting…' : ''}</Text>
    </Text>,
  );
};

export const StatusBar = React.memo(StatusBarImpl);
