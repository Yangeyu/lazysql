/**
 * Overlay — a centered floating panel drawn ON TOP of the still-rendered
 * workbench, the way lazygit shows its menus (the background stays visible
 * around it instead of being replaced).
 *
 * OpenTUI gives us real compositing: a `position: "absolute"` box is out of flow
 * and, drawn last in the tree, paints over its siblings. Like lazygit, the frame
 * and the cleared panel interior both use the terminal's DEFAULT background.
 * That matters because a border glyph occupies a whole terminal cell: a custom
 * panel colour makes the part outside a thin `│` look like a dark shadow, while
 * a transparent frame exposes the workbench on the inside and looks detached.
 * One opaque, default-background box keeps the frame joined to its content
 * without introducing a contrasting halo. Fixed size + cell-diff rendering mean
 * scrolling repaints only the changed lines.
 */

import React from 'react';
import { RGBA, type MouseEvent } from '@opentui/core';
import { theme } from '../theme/theme.ts';

/** Preserve the terminal-default colour intent (rather than assuming black).
 * OpenTUI resolves it against the active terminal palette when drawing. */
const panelBackground = RGBA.defaultBackground();

interface Props {
  /** Terminal size — the overlay centers itself within it. */
  termRows: number;
  termCols: number;
  /** Outer size of the panel, including its border (clamped to the screen). */
  width: number;
  height: number;
  borderColor?: string;
  /** Wheel/trackpad scrolled over the panel (e.g. to scroll a tall value). */
  onMouseScroll?: (event: MouseEvent) => void;
  children: React.ReactNode;
}

/** Preferred outer width of the message dialogs (confirm / error): generous
 *  enough for long SQL and driver detail, clamped with a margin on narrow
 *  terminals. Content-sized overlays (help, cell inspector) size themselves. */
export const dialogWidth = (termCols: number): number =>
  Math.max(34, Math.min(termCols - 8, 100));

const OverlayImpl = ({
  termRows,
  termCols,
  width,
  height,
  borderColor = theme.borderFocus,
  onMouseScroll,
  children,
}: Props) => {
  // Clamp to the screen, then center via absolute insets.
  const w = Math.max(4, Math.min(width, termCols));
  const h = Math.max(3, Math.min(height, termRows));
  const left = Math.max(0, Math.floor((termCols - w) / 2));
  const top = Math.max(0, Math.floor((termRows - h) / 2));

  return (
    <box
      position="absolute"
      left={left}
      top={top}
      width={w}
      height={h}
      flexDirection="column"
      border
      borderStyle="rounded"
      borderColor={borderColor}
      backgroundColor={panelBackground}
      paddingX={1}
      onMouseScroll={onMouseScroll}
    >
      {children}
    </box>
  );
};

export const Overlay = React.memo(OverlayImpl);
