/**
 * Theme — the single palette the whole TUI draws from, so colour choices live in
 * one place instead of being sprinkled as magic strings across components. The
 * hues are a Tokyo-Night-ish set that reads well on both dark and light
 * terminals; truecolor terminals get the exact hex, 256/16-colour ones degrade
 * gracefully via chalk. Keeping this declarative means a re-skin is one edit.
 */

export const theme = {
  /** Primary brand/focus accent. */
  accent: '#7aa2f7',
  /** Readable text colour to lay on top of an accent-filled background. Also the
   *  selection foreground (paired with `accent` as the selection background). */
  onAccent: '#16161e',
  /** Opaque panel background (Tokyo-Night base) — fills floating overlays so the
   *  busy workbench behind them never bleeds through. */
  bg: '#1a1b26',
  magenta: '#bb9af7',
  green: '#9ece6a',
  yellow: '#e0af68',
  orange: '#ff9e64',
  red: '#f7768e',
  cyan: '#7dcfff',
  /** Resting (unfocused) border + secondary text (hints, footers, labels). Kept
   *  readable on the dark base: the old gutter hue (#3b4261) was fine for lines
   *  but too dark to read as text, which was the dominant use. */
  border: '#6b7399',
  /** Muted/secondary text — the explicit colour that replaces a terminal-dependent
   *  "dim" attribute; a touch brighter than `border` for the more prominent spots. */
  muted: '#868fbd',
  /** Focused panel border. */
  borderFocus: '#7aa2f7',
} as const;

/**
 * The text-insertion caret — the ASCII pipe, which renders reliably in every
 * terminal font (the one-eighth block `▏` it replaced draws inconsistently).
 * It resembles the grid's `│` column separator, but the caret is painted in
 * `accent` while separators use `border`, which keeps them apart. One glyph,
 * one source of truth, wherever an input is editable.
 */
export const CARET = '|';

/**
 * The native `<input>` text cursor: a steady (non-blinking) thin vertical bar in
 * the brand accent — the same I-beam look as `CARET`, but drawn by OpenTUI's
 * cursor renderer instead of a glyph. Without this every input falls back to the
 * EditBuffer default (a blinking block in the terminal's own colour); one source
 * of truth here keeps all four inputs (filter / edit / NL ask / SQL) identical.
 * `cursorColor` is a sibling prop (the style's own `color` is for the global
 * renderer cursor); pass `cursorColor={theme.accent}` alongside.
 */
export const INPUT_CURSOR = { style: 'line', blinking: false } as const;

/** A short, per-driver colour for the connection's badge chip. */
export const driverColor = (tag: string): string =>
  ({
    PG: theme.cyan,
    MySQL: theme.orange,
    SQLite: theme.green,
    Mongo: theme.green,
    Redis: theme.red,
  })[tag] ?? theme.accent;
