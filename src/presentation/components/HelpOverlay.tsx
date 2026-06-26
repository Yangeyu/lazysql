/**
 * HelpOverlay — the `?` cheat-sheet. A centered floating panel listing the
 * keybindings for the focused context plus the global keys, rendered entirely
 * from the keymap registry so it never drifts from what actually works. Unlike
 * before, it floats OVER the workbench (via Overlay) instead of replacing it —
 * the panes stay visible around it, exactly like lazygit. Esc or ? closes it.
 */

import React from 'react';
import { Box, Text } from 'ink';
import type { KeyGroup } from '../keymap/keymap.ts';
import { theme } from '../theme/theme.ts';
import { Overlay } from './Overlay.tsx';

interface Props {
  groups: KeyGroup[];
  termRows: number;
  termCols: number;
}

const KEY_COL = 14;
const PANEL_WIDTH = 58;

const HelpOverlayImpl: React.FC<Props> = ({ groups, termRows, termCols }) => {
  // Height is derived from the (static-while-open) content: header (title +
  // blank), then each group's title + bindings + a trailing blank, then footer.
  const contentLines =
    2 +
    groups.reduce((n, g) => n + 1 + g.bindings.length + 1, 0) +
    1;

  return (
    <Overlay
      termRows={termRows}
      termCols={termCols}
      width={PANEL_WIDTH}
      height={contentLines + 2}
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
            <Text key={b.keys + b.hint} wrap="truncate">
              <Text color={theme.green}>{b.keys.padEnd(KEY_COL)}</Text>
              {b.desc}
            </Text>
          ))}
        </Box>
      ))}
      <Text color={theme.border}>esc / ? close</Text>
    </Overlay>
  );
};

export const HelpOverlay = React.memo(HelpOverlayImpl);
