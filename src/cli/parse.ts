/**
 * Pure argv → intent parser. Maps the raw arguments to one `CliInvocation`, a
 * discriminated union so the boot path switches on a closed set of intents
 * instead of re-deriving "which flag is this" inline (illegal states can't be
 * represented). Pure and IO-free: it never touches the filesystem — deciding
 * whether an `open` target is a saved profile or an ad-hoc file is a separate,
 * edge concern (it needs `repo.list()` + `existsSync`) handled in the composition
 * root. That split keeps this function trivially unit-testable.
 *
 * Precedence: the meta-flags `--help`/`--version` win wherever they appear (so
 * `lazysql foo --help` still prints help), help over version; otherwise the first
 * token decides — a known flag, an unknown `-flag` (an error pointing at --help),
 * or a positional `open` target. No token at all → the interactive picker.
 */

import { optionFor } from './spec.ts';

export type CliInvocation =
  | { readonly kind: 'help' }
  | { readonly kind: 'version' }
  | { readonly kind: 'list' }
  | { readonly kind: 'open'; readonly target: string }
  | { readonly kind: 'default' }
  | { readonly kind: 'unknownOption'; readonly option: string };

/** Parse `process.argv.slice(2)` into a single invocation intent. */
export const parseArgs = (argv: readonly string[]): CliInvocation => {
  let help = false;
  let version = false;
  for (const token of argv) {
    const kind = optionFor(token)?.kind;
    if (kind === 'help') help = true;
    else if (kind === 'version') version = true;
  }
  if (help) return { kind: 'help' };
  if (version) return { kind: 'version' };

  const first = argv[0];
  if (first === undefined) return { kind: 'default' };
  if (optionFor(first)?.kind === 'list') return { kind: 'list' };
  // An unrecognised flag is a usage error, kept distinct from an unknown
  // connection name so the message can point at the right thing (--help vs --list).
  if (first.startsWith('-')) return { kind: 'unknownOption', option: first };
  return { kind: 'open', target: first };
};
