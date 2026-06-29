/**
 * Renders the `--help` and `--version` text from the `spec.ts` tables, so the
 * help screen is always in sync with what the parser actually recognises. Pure
 * string builders (no IO): the caller prints them and exits. Config paths are
 * shown as their stable `~`-relative display forms — documentation, not resolved
 * paths — so this stays free of `paths.ts`'s home-dir lookups.
 */

import { OPTIONS, USAGE } from './spec.ts';

const TAGLINE = 'lazysql — a lazygit-style TUI database manager';

const CONFIG_LINES: readonly string[] = [
  '~/.config/lazysql/connections.yml   connections (passwords excluded)',
  '~/.config/lazysql/config.yml        app settings (NL→SQL provider)',
  'API keys via env: OPENAI_API_KEY · DEEPSEEK_API_KEY · DASHSCOPE_API_KEY · ANTHROPIC_API_KEY',
];

const pad = (s: string, width: number): string => s.padEnd(width);

/** The full `--help` screen. */
export const formatHelp = (): string => {
  const usageWidth = Math.max(...USAGE.map((u) => u.form.length));
  const flagForms = OPTIONS.map((o) => o.flags.join(', '));
  const flagWidth = Math.max(...flagForms.map((f) => f.length));

  const usage = USAGE.map((u) => `  ${pad(u.form, usageWidth)}  ${u.summary}`);
  const options = OPTIONS.map(
    (o, i) => `  ${pad(flagForms[i]!, flagWidth)}  ${o.summary}`,
  );
  const config = CONFIG_LINES.map((l) => `  ${l}`);

  return [
    TAGLINE,
    '',
    'USAGE',
    ...usage,
    '',
    'OPTIONS',
    ...options,
    '',
    'CONFIG',
    ...config,
  ].join('\n');
};

/** The `--version` line, e.g. `lazysql 0.1.5`. */
export const formatVersion = (version: string): string => `lazysql ${version}`;
