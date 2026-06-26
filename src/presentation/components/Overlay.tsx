/**
 * Overlay — a centered floating panel drawn ON TOP of the still-rendered
 * workbench, the way lazygit shows its menus (the background stays visible
 * around it instead of being replaced).
 *
 * Terminals have no z-buffer, so we composite by hand with TWO absolutely
 * positioned layers at the same rect: an opaque space-fill behind, then the
 * bordered content in front. Ink's renderer writes later siblings over earlier
 * ones but leaves untouched cells transparent — so the fill is what stops the
 * busy background from bleeding through the panel's gaps.
 *
 * Being out of flow, the overlay adds NO height to the base frame: Ink keeps
 * doing incremental redraws (never a full-screen clear), and because the panel
 * is a FIXED size its geometry is identical every frame — so scrolling content
 * inside it repaints only the changed lines and never flickers. (Both the
 * lazygit-background and the no-flicker properties depend on this.)
 */

import React from 'react';
import { Box, Text } from 'ink';
import { theme } from '../theme/theme.ts';

interface Props {
  /** Terminal size — the overlay centers itself within it. */
  termRows: number;
  termCols: number;
  /** Outer size of the panel, including its border (clamped to the screen). */
  width: number;
  height: number;
  borderColor?: string;
  children: React.ReactNode;
}

const OverlayImpl: React.FC<Props> = ({
  termRows,
  termCols,
  width,
  height,
  borderColor = theme.borderFocus,
  children,
}) => {
  // Clamp to the screen, then center. Height stays ≤ termRows-1 so the absolute
  // layer never reaches the terminal height (which would trip Ink's full clear).
  const w = Math.max(4, Math.min(width, termCols));
  const h = Math.max(3, Math.min(height, termRows - 1));
  const mx = Math.max(0, Math.floor((termCols - w) / 2));
  const my = Math.max(0, Math.floor((termRows - h) / 2));

  return (
    <>
      {/* layer 1 — opaque background, so the panel is solid */}
      <Box
        position="absolute"
        marginLeft={mx}
        marginTop={my}
        flexDirection="column"
      >
        {Array.from({ length: h }, (_, i) => (
          <Text key={i}>{' '.repeat(w)}</Text>
        ))}
      </Box>
      {/* layer 2 — the bordered content, same rect, drawn on top */}
      <Box
        position="absolute"
        marginLeft={mx}
        marginTop={my}
        width={w}
        height={h}
        borderStyle="round"
        borderColor={borderColor}
        paddingX={1}
        flexDirection="column"
      >
        {children}
      </Box>
    </>
  );
};

export const Overlay = React.memo(OverlayImpl);
