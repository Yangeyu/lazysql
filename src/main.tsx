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
import { StoreContext } from './presentation/app/context.ts';
import { App } from './presentation/app/App.tsx';
import { createAppStore } from './presentation/app/store.ts';
import { createDataSource } from './adapters/datasource/registry.ts';
import { YamlConnectionRepository } from './adapters/persistence/YamlConnectionRepository.ts';
import { FileSecretStore } from './adapters/persistence/FileSecretStore.ts';
import { connectionsFile } from './adapters/persistence/paths.ts';
import { openConnection } from './application/usecases/OpenConnection.ts';
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
`;

const looksLikeFile = (arg: string): boolean =>
  /\.(db|sqlite|sqlite3)$/i.test(arg) || existsSync(arg);

const resolveProfile = (
  arg: string | undefined,
  profiles: ConnectionProfile[],
): ConnectionProfile | null => {
  if (arg) {
    const named = profiles.find((p) => p.id === arg || p.name === arg);
    if (named) return named;
    if (looksLikeFile(arg)) {
      return { id: 'cli', name: arg, driver: 'sqlite', options: { file: arg } };
    }
    return null;
  }
  return profiles.find((p) => p.id === 'default') ?? profiles[0] ?? null;
};

const die = (message: string): never => {
  console.error(`lazysql: ${message}`);
  process.exit(1);
};

// ── boot ──────────────────────────────────────────────────────────────────

const repo = new YamlConnectionRepository();
const secrets = new FileSecretStore();

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

const profile =
  resolveProfile(arg, profiles) ??
  die(`unknown connection "${arg}" (try --list, a saved name, or a .db file)`);

const opened = await openConnection(profile, { factory: createDataSource, secrets });
const source = opened.ok ? opened.value : die(opened.error.message);
const store = createAppStore(source);

const { waitUntilExit } = render(
  <StoreContext.Provider value={store}>
    <App />
  </StoreContext.Provider>,
);

await waitUntilExit();
await source.disconnect();
