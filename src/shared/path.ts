/**
 * Filesystem path helpers for the application's edges (connection forms, CLI
 * args). `resolveUserPath` turns a user-entered path into an absolute one so it
 * stops depending on the process working directory — a relative SQLite path
 * would otherwise bind to a different file each time lazysql starts from another
 * cwd.
 *
 * Contract: a leading `~` expands to the home dir, then the result is made
 * absolute against the current working directory. Empty input and SQLite's
 * `:memory:` sentinel pass through unchanged — they are not filesystem paths.
 */

import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export const resolveUserPath = (input: string): string => {
  if (input === '' || input === ':memory:') return input;
  if (input === '~') return homedir();
  const expanded = input.startsWith('~/') ? join(homedir(), input.slice(2)) : input;
  return resolve(expanded);
};
