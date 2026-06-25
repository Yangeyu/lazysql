/**
 * HelpOverlay — the `?` cheat-sheet. A centered modal listing the keybindings
 * for the focused context plus the global keys, rendered entirely from the
 * keymap registry so it never drifts from what actually works. Shown in place of
 * the main panes while open (Ink has no true z-layering); Esc or ? closes it.
 */

import React from 'react';
import { Box, Text } from 'ink';
import type { KeyGroup } from '../keymap/keymap.ts';
import { theme } from '../theme/theme.ts';

interface Props {
  groups: KeyGroup[];
}

const KEY_COL = 14;

const HelpOverlayImpl: React.FC<Props> = ({ groups }) => (
  <Box flexDirection="column" flexGrow={1} alignItems="center" justifyContent="center">
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.borderFocus}
      paddingX={3}
      paddingY={1}
    >
      <Text bold color={theme.accent}>
        ⌨  Keybindings
      </Text>
      <Text> </Text>
      {groups.map((group) => (
        <Box key={group.title} flexDirection="column" marginBottom={1}>
          <Text bold color={theme.yellow}>
            {group.title}
          </Text>
          {group.bindings.map((b) => (
            <Text key={b.keys + b.hint}>
              <Text color={theme.green}>{b.keys.padEnd(KEY_COL)}</Text>
              {b.desc}
            </Text>
          ))}
        </Box>
      ))}
      <Text color={theme.border}>esc / ? close</Text>
    </Box>
  </Box>
);

export const HelpOverlay = React.memo(HelpOverlayImpl);
