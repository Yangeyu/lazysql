/**
 * Caret — a glyph text-insertion caret for the ONE place a real cursor can't go:
 * the connection form's masked password field. Every other input is a native
 * <input> whose caret the terminal draws (see ADR 0008); OpenTUI's input can't
 * mask, so that secret field is store-rendered as bullets and needs a drawn
 * caret. This `▏` mirrors the native `INPUT_CURSOR` look (thin accent bar) so the
 * two cursor mechanisms read identically.
 *
 * Inline by design: it returns a <span> meant to sit at the end of a <text> run,
 * right after the value it marks.
 */

import { theme, CARET } from '../theme/theme.ts';

export const Caret = ({ focused }: { focused: boolean }) =>
  focused ? <span fg={theme.accent}>{CARET}</span> : null;
