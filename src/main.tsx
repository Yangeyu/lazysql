#!/usr/bin/env bun
/**
 * Composition root — wires concrete adapters (registry, YAML repo, file secret
 * store) to the application and TUI. It decides which connection to open
 * (by name, by ad-hoc SQLite file, or the default), resolves its secret, and
 * hands a connected store to Ink. Everything below depends only on ports. (DIP)
 *
 * Usage:
 *   bun start                 open the default saved connection
 *   bun start <name>          open a saved connection by id/name
 *   bun start <file.db>       open an ad-hoc SQLite file
 *   bun start --list          list saved connections and exit
 */

import React from 'react';
import { render } from 'ink';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Root } from './presentation/app/Root.tsx';
import { enableSynchronizedOutput } from './presentation/term/synchronizedOutput.ts';
import { createDataSource } from './adapters/datasource/registry.ts';
import { YamlConnectionRepository } from './adapters/persistence/YamlConnectionRepository.ts';
import { FileSecretStore } from './adapters/persistence/FileSecretStore.ts';
import { KeychainSecretStore } from './adapters/persistence/KeychainSecretStore.ts';
import { connectionsFile } from './adapters/persistence/paths.ts';
import { openConnection } from './application/usecases/OpenConnection.ts';
import { createSqlGenerator } from './adapters/llm/createSqlGenerator.ts';
import type { SecretStore } from './application/ports/SecretStore.ts';
import type { ConnectionService } from './application/ports/ConnectionService.ts';
import type { SqlGenerator } from './application/ports/SqlGenerator.ts';
import type { ConnectionProfile } from './domain/connection/ConnectionProfile.ts';

const DEFAULT_CONFIG = `# lazysql connections.
# Passwords are NOT stored here — they live in secrets.json (chmod 600).
# Edit this file to add connections; uncomment an example to get started.
connections:
  - id: sample
    name: Sample (SQLite)
    driver: sqlite
    options:
      file: data/sample.db

  # - id: local-pg
  #   name: Local Postgres
  #   driver: postgres
  #   options:
  #     host: localhost
  #     port: 5432
  #     user: postgres
  #     database: postgres

  # - id: local-mysql
  #   name: Local MySQL
  #   driver: mysql
  #   options:
  #     host: localhost
  #     port: 3306
  #     user: root
  #     database: mysql

  # - id: local-mongo
  #   name: Local MongoDB
  #   driver: mongodb
  #   options:
  #     host: localhost
  #     port: 27017
  #     database: test

  # - id: local-redis
  #   name: Local Redis
  #   driver: redis
  #   options:
  #     host: localhost
  #     port: 6379
  #     db: 0
`;

const looksLikeFile = (arg: string): boolean =>
  /\.(db|sqlite|sqlite3)$/i.test(arg) || existsSync(arg);

const resolveProfile = (
  arg: string,
  profiles: ConnectionProfile[],
): ConnectionProfile | null => {
  const named = profiles.find((p) => p.id === arg || p.name === arg);
  if (named) return named;
  if (looksLikeFile(arg)) {
    return { id: 'cli', name: arg, driver: 'sqlite', options: { file: arg } };
  }
  return null;
};

const die = (message: string): never => {
  console.error(`lazysql: ${message}`);
  process.exit(1);
};

// ── boot ──────────────────────────────────────────────────────────────────

const repo = new YamlConnectionRepository();
const secrets: SecretStore =
  process.env.LAZYSQL_SECRETS === 'keychain' && KeychainSecretStore.isSupported()
    ? new KeychainSecretStore()
    : new FileSecretStore();

const file = connectionsFile();
if (!existsSync(file)) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, DEFAULT_CONFIG, 'utf8');
}

const arg = process.argv[2];
const profiles = await repo.list();

if (arg === '--list' || arg === '-l') {
  if (profiles.length === 0) console.log('(no saved connections)');
  for (const p of profiles) console.log(`${p.id}\t${p.driver}\t${p.name}`);
  process.exit(0);
}

// With an explicit arg we connect straight in; with none we show the picker.
let initial: ConnectionProfile | null = null;
if (arg) {
  initial = resolveProfile(arg, profiles);
  if (!initial) {
    die(`unknown connection "${arg}" (try --list, a saved name, or a .db file)`);
  }
}

// The single port the UI store uses for all connection work. It wires the
// repository, secret store and factory; the password goes to the SecretStore
// under the profile id and never touches the YAML.
const connectionService: ConnectionService = {
  list: () => repo.list(),
  open: (profile) =>
    openConnection(profile, { factory: createDataSource, secrets }),
  save: async (profile, password) => {
    await repo.save(profile);
    if (password) await secrets.set(profile.id, password);
  },
  remove: async (id) => {
    await repo.remove(id);
    await secrets.delete(id).catch(() => {});
  },
};

// NL→SQL is enabled only when a provider is configured; otherwise it stays off.
// Provider is picked by createSqlGenerator (LAZYSQL_LLM_PROVIDER, else by key).
const generator: SqlGenerator | null = createSqlGenerator();

// Fullscreen: switch to the terminal's alternate screen buffer so lazysql owns
// the whole window (like vim/lazygit) and leaves the user's scrollback intact
// on exit. `?1049h` enters + clears; `?1049l` restores the prior screen. Guarded
// to a TTY so piped/CI runs are unaffected.
// `?1049h` alt screen + `?1000h`/`?1006h` SGR mouse click reporting (decoded by
// the useMouse hook). The composition root owns these terminal modes so they are
// always paired with a restore on exit.
const isTty = Boolean(process.stdout.isTTY);
const enterAltScreen = (): void => {
  if (isTty) process.stdout.write('\x1b[?1049h\x1b[2J\x1b[H\x1b[?1000h\x1b[?1006h');
};
const leaveAltScreen = (): void => {
  if (isTty) process.stdout.write('\x1b[?1000l\x1b[?1006l\x1b[?1049l');
};

// Synchronized output (DEC mode 2026) — the flicker fix. Ink repaints the whole
// frame on every render with no cell diffing, so a scroll's erase→repaint flashes
// the blank intermediate state. Wrapping each frame so the terminal applies it
// atomically removes the flash. See ./presentation/term/synchronizedOutput.ts.
let restoreSynchronizedOutput: (() => void) | null = null;

enterAltScreen();
if (isTty) restoreSynchronizedOutput = enableSynchronizedOutput(process.stdout);
// Belt-and-braces: restore the screen however the process ends (clean exit,
// ^C, or an unexpected throw), so the terminal is never left in alt mode.
process.on('exit', leaveAltScreen);

const { waitUntilExit } = render(
  <Root
    connectionService={connectionService}
    initial={initial}
    generator={generator}
  />,
);

try {
  await waitUntilExit();
} finally {
  process.off('exit', leaveAltScreen);
  restoreSynchronizedOutput?.();
  leaveAltScreen();
}
