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
  /** Readable text colour to lay on top of an accent-filled background. */
  onAccent: '#16161e',
  magenta: '#bb9af7',
  green: '#9ece6a',
  yellow: '#e0af68',
  orange: '#ff9e64',
  red: '#f7768e',
  cyan: '#7dcfff',
  /** Resting (unfocused) border + secondary text. */
  border: '#3b4261',
  /** Focused panel border. */
  borderFocus: '#7aa2f7',
} as const;

/** A short, per-driver colour for the connection's badge chip. */
export const driverColor = (tag: string): string =>
  ({
    PG: theme.cyan,
    MySQL: theme.orange,
    SQLite: theme.green,
    Mongo: theme.green,
    Redis: theme.red,
  })[tag] ?? theme.accent;
