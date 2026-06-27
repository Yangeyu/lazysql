/**
 * Caret — the text-insertion caret, rendered only when its field is focused. The
 * single place that decides how an editable caret looks, so every input (the SQL
 * editor's ask row, the filter and edit prompts, the connection form) draws the
 * exact same mark instead of repeating `<span fg={accent}>{CARET}</span>`. It is
 * also the one seam a hardware-cursor implementation would plug into later —
 * swap the glyph for `renderer.setCursorPosition` here and every field follows.
 *
 * Inline by design: it returns a <span> meant to sit at the end of a <text> run,
 * right after the value it marks.
 */

import { theme, CARET } from '../theme/theme.ts';

export const Caret = ({ focused }: { focused: boolean }) =>
  focused ? <span fg={theme.accent}>{CARET}</span> : null;
