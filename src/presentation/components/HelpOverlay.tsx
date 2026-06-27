/**
 * HelpOverlay — the `?` cheat-sheet. A centered floating panel listing the
 * keybindings for the focused context plus the global keys, rendered entirely
 * from the keymap registry so it never drifts from what actually works. Unlike
 * before, it floats OVER the workbench (via Overlay) instead of replacing it —
 * the panes stay visible around it, exactly like lazygit. Esc or ? closes it.
 */

import React from 'react';
import { TextAttributes } from '@opentui/core';
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

const HelpOverlayImpl = ({ groups, termRows, termCols }: Props) => {
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
      <text attributes={TextAttributes.BOLD} fg={theme.accent}>
        ⌨  Keybindings
      </text>
      <text> </text>
      {groups.map((group) => (
        <box key={group.title} flexDirection="column" marginBottom={1}>
          <text attributes={TextAttributes.BOLD} fg={theme.yellow}>
            {group.title}
          </text>
          {group.bindings.map((b) => (
            <text key={b.keys + b.hint} wrapMode="none">
              <span fg={theme.green}>{b.keys.padEnd(KEY_COL)}</span>
              {b.desc}
            </text>
          ))}
        </box>
      ))}
      <text fg={theme.border}>esc / ? close</text>
    </Overlay>
  );
};

export const HelpOverlay = React.memo(HelpOverlayImpl);
