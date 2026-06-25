/**
 * HelpOverlay — the `?` cheat-sheet. A centered modal listing the keybindings
 * for the focused context plus the global keys, rendered entirely from the
 * keymap registry so it never drifts from what actually works. Shown in place of
 * the main panes while open (Ink has no true z-layering); Esc or ? closes it.
 */

import React from 'react';
import { Box, Text } from 'ink';
import type { KeyGroup } from '../keymap/keymap.ts';

interface Props {
  groups: KeyGroup[];
}

const KEY_COL = 12;

const HelpOverlayImpl: React.FC<Props> = ({ groups }) => (
  <Box flexDirection="column" flexGrow={1} alignItems="center">
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="cyan"
      paddingX={2}
      paddingY={1}
    >
      <Text bold color="cyan">
        Keybindings
      </Text>
      <Text> </Text>
      {groups.map((group) => (
        <Box key={group.title} flexDirection="column" marginBottom={1}>
          <Text bold color="yellow">
            {group.title}
          </Text>
          {group.bindings.map((b) => (
            <Text key={b.keys + b.hint}>
              <Text color="green">{b.keys.padEnd(KEY_COL)}</Text>
              {b.desc}
            </Text>
          ))}
        </Box>
      ))}
      <Text dimColor>esc / ? close</Text>
    </Box>
  </Box>
);

export const HelpOverlay = React.memo(HelpOverlayImpl);
