/**
 * HelpOverlay — the `?` cheat-sheet. A centered floating panel listing the
 * keybindings for the focused context plus the global keys, rendered entirely
 * from the keymap registry so it never drifts from what actually works. It
 * floats OVER the workbench (via Overlay) at a FIXED width — sized once from
 * the registry's longest description, identical in every context. On a
 * terminal too narrow for that width, descriptions WRAP into indented rows
 * (never a horizontal scroll); when the list outgrows the screen the body
 * scrolls vertically (j/k/↓↑/^d/^u, or the wheel)
 * with `offset` owned by the store (helpScroll) like every other overlay.
 * The overlay reports its scroll range back through `onViewport` so the store
 * can clamp instead of scrolling past the end. Esc or ? closes it.
 */

import React, { useEffect } from 'react';
import { TextAttributes } from '@opentui/core';
import { widestHelpDesc, type KeyGroup } from '../keymap/keymap.ts';
import { theme } from '../theme/theme.ts';
import { Overlay } from './Overlay.tsx';
import { wrapByWidth } from './wrapText.ts';

interface Props {
  groups: KeyGroup[];
  termRows: number;
  termCols: number;
  /** First visible body line (store-owned; clamped there via onViewport). */
  offset: number;
  onScroll: (delta: number) => void;
  onViewport: (maxScroll: number) => void;
}

const KEY_COL = 14;

/** Fixed panel width: sized once from the registry's longest description (the
 *  same in every context — a panel that resizes per context reads as jumpy),
 *  clamped to the terminal at render. +4 = border + paddingX. */
const PANEL_WIDTH = KEY_COL + widestHelpDesc + 4;

/** One renderable body line of the cheat-sheet. A wrapped description's
 *  continuation rows carry an empty `keys`, indenting under the first row. */
type Line =
  | { readonly kind: 'group'; readonly text: string }
  | { readonly kind: 'binding'; readonly keys: string; readonly desc: string }
  | { readonly kind: 'blank' };

const HelpOverlayImpl = ({ groups, termRows, termCols, offset, onScroll, onViewport }: Props) => {
  const width = Math.min(termCols - 2, PANEL_WIDTH);

  // On a terminal narrower than the fixed width a description would clip —
  // wrap it into indented continuation rows instead (vertical scroll is the
  // only scroll; wrapping happens BEFORE slicing so the scroll math counts
  // display rows, not logical bindings). -4 = border + paddingX.
  const descWidth = width - 4 - KEY_COL;
  const body: Line[] = groups.flatMap((g): Line[] => [
    { kind: 'group', text: g.title },
    ...g.bindings.flatMap((b): Line[] =>
      wrapByWidth(b.desc, descWidth).map(
        (row, i): Line => ({ kind: 'binding', keys: i === 0 ? b.keys : '', desc: row }),
      ),
    ),
    { kind: 'blank' },
  ]);

  // Fixed chrome: border (2) + header (title + blank = 2) + footer (1).
  const height = Math.min(termRows, body.length + 5);
  const viewRows = height - 5;
  const maxScroll = Math.max(0, body.length - viewRows);
  useEffect(() => onViewport(maxScroll), [onViewport, maxScroll]);

  const top = Math.min(offset, maxScroll);
  const visible = body.slice(top, top + viewRows);
  const scrollHint =
    maxScroll > 0 ? `  ·  j/k scroll (${top + 1}–${top + visible.length}/${body.length})` : '';

  return (
    <Overlay
      termRows={termRows}
      termCols={termCols}
      width={width}
      height={height}
      onMouseScroll={(e) => onScroll(e.scroll?.direction === 'up' ? -1 : 1)}
    >
      <text attributes={TextAttributes.BOLD} fg={theme.accent}>
        ⌨  Keybindings
      </text>
      <text> </text>
      {visible.map((line, i) =>
        line.kind === 'group' ? (
          <text key={`g${top + i}`} attributes={TextAttributes.BOLD} fg={theme.yellow} wrapMode="none">
            {line.text}
          </text>
        ) : line.kind === 'binding' ? (
          <text key={`b${top + i}`} wrapMode="none">
            <span fg={theme.green}>{line.keys.padEnd(KEY_COL)}</span>
            {line.desc}
          </text>
        ) : (
          <text key={`s${top + i}`}> </text>
        ),
      )}
      <text fg={theme.border} wrapMode="none">
        esc / ? close{scrollHint}
      </text>
    </Overlay>
  );
};

export const HelpOverlay = React.memo(HelpOverlayImpl);
