/**
 * The CLI surface as data — the single source of truth for both parsing and the
 * `--help` text, so a flag is defined once and the two can never drift (the same
 * discipline ADR 0007 applies to the keymap: one table feeds matching, display
 * and behaviour). `parse.ts` reads `OPTIONS` to recognise flags; `help.ts` reads
 * `USAGE` + `OPTIONS` to render the help screen. Adding a flag is adding one row.
 *
 * Intentionally tiny: lazysql is a TUI, so the shell surface stays a thin set of
 * bootstrap selectors plus the conventional meta-flags — not a second product.
 */

/** What an option flag resolves to once parsed (the parser maps flag → kind). */
export type OptionKind = 'help' | 'version' | 'list';

/** An option flag: every form it accepts and its one-line help summary. */
export interface CliOption {
  readonly kind: OptionKind;
  /** All accepted spellings, e.g. `['-l', '--list']`. */
  readonly flags: readonly string[];
  readonly summary: string;
}

/** A positional invocation form, shown in the USAGE block of `--help`. */
export interface UsageLine {
  readonly form: string;
  readonly summary: string;
}

export const OPTIONS: readonly CliOption[] = [
  { kind: 'list', flags: ['-l', '--list'], summary: 'list saved connections and exit' },
  { kind: 'help', flags: ['-h', '--help'], summary: 'show this help and exit' },
  { kind: 'version', flags: ['-v', '--version'], summary: 'print version and exit' },
];

export const USAGE: readonly UsageLine[] = [
  { form: 'lazysql [connection]', summary: 'open a saved connection by id or name' },
  { form: 'lazysql <file.db>', summary: 'open an ad-hoc SQLite file' },
  { form: 'lazysql', summary: 'pick from saved connections interactively' },
];

/** Resolve a token to its option spec, or null if it is not a known flag. */
export const optionFor = (token: string): CliOption | null =>
  OPTIONS.find((o) => o.flags.includes(token)) ?? null;
