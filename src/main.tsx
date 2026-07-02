#!/usr/bin/env bun
/**
 * Composition root — wires concrete adapters (registry, YAML repo, file secret
 * store) to the application and TUI. It decides which connection to open
 * (by name, by ad-hoc SQLite file, or the default), resolves its secret, and
 * hands a connected store to the TUI. Everything below depends only on ports. (DIP)
 *
 * Usage:
 *   lazysql                   pick from saved connections interactively
 *   lazysql <name>            open a saved connection by id/name
 *   lazysql <file.db>         open an ad-hoc SQLite file
 *   lazysql -l, --list        list saved connections and exit
 *   lazysql -h, --help        show help and exit
 *   lazysql -v, --version     print version and exit
 *
 * Argv parsing lives in `cli/` (pure `parseArgs` → intent union); this root maps
 * the intent to side effects. Meta commands (help/version) short-circuit before
 * any filesystem write or renderer init, so they stay pure and fast.
 */

import { createCliRenderer } from '@opentui/core';
import { createRoot } from '@opentui/react';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Root } from './presentation/app/Root.tsx';
import { createDataSource } from './adapters/datasource/registry.ts';
import { createSystemClipboard } from './adapters/clipboard/SystemClipboard.ts';
import { FileExporter } from './adapters/export/FileExporter.ts';
import { YamlConnectionRepository } from './adapters/persistence/YamlConnectionRepository.ts';
import { JsonQueryHistoryStore } from './adapters/persistence/JsonQueryHistoryStore.ts';
import { FileSecretStore } from './adapters/persistence/FileSecretStore.ts';
import { KeychainSecretStore } from './adapters/persistence/KeychainSecretStore.ts';
import { connectionsFile, configFile } from './adapters/persistence/paths.ts';
import { loadLlmEnv } from './adapters/persistence/appConfig.ts';
import { openConnection } from './application/usecases/OpenConnection.ts';
import { createSqlGenerator } from './adapters/llm/createSqlGenerator.ts';
import { parseArgs } from './cli/parse.ts';
import { formatHelp, formatVersion } from './cli/help.ts';
import pkg from '../package.json';
import type { SecretStore } from './application/ports/SecretStore.ts';
import type { ConnectionService } from './application/ports/ConnectionService.ts';
import type { SqlGenerator } from './application/ports/SqlGenerator.ts';
import type { ConnectionProfile } from './domain/connection/ConnectionProfile.ts';

const DEFAULT_CONFIG = `# lazysql connections.
# Passwords are NOT stored here — they live in secrets.json (chmod 600).
# Add a connection below, or press n in the app to create one. Uncomment an
# example to get started (use an absolute path for a sqlite file).
connections:
  # - id: local-sqlite
  #   name: Local SQLite
  #   driver: sqlite
  #   options:
  #     file: /absolute/path/to/your.db

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

const DEFAULT_APP_CONFIG = `# lazysql application settings (non-secret).
# API keys are NOT stored here — keep them in the environment:
#   OPENAI_API_KEY · DEEPSEEK_API_KEY · DASHSCOPE_API_KEY · ANTHROPIC_API_KEY
#
# NL→SQL provider. Uncomment to pin one; otherwise it is auto-detected from
# whichever API key is present. An exported LAZYSQL_LLM_* var overrides this.
# llm:
#   provider: openai        # alibaba | openai | deepseek | anthropic
#   model: gpt-4o           # optional model override
#   baseUrl: https://api.openai.com/v1   # optional endpoint override
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

const invocation = parseArgs(process.argv.slice(2));

// Meta commands are pure: they print and exit before any config file is written
// or the renderer boots. Kept ahead of all side effects on purpose.
if (invocation.kind === 'help') {
  console.log(formatHelp());
  process.exit(0);
}
if (invocation.kind === 'version') {
  console.log(formatVersion(pkg.version));
  process.exit(0);
}
if (invocation.kind === 'unknownOption') {
  die(`unknown option "${invocation.option}" (try --help)`);
}

const repo = new YamlConnectionRepository();
const history = new JsonQueryHistoryStore();
const secrets: SecretStore =
  process.env.LAZYSQL_SECRETS === 'keychain' && KeychainSecretStore.isSupported()
    ? new KeychainSecretStore()
    : new FileSecretStore();

const file = connectionsFile();
if (!existsSync(file)) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, DEFAULT_CONFIG, 'utf8');
}

const cfgFile = configFile();
if (!existsSync(cfgFile)) {
  await mkdir(dirname(cfgFile), { recursive: true });
  await writeFile(cfgFile, DEFAULT_APP_CONFIG, 'utf8');
}

const profiles = await repo.list();

if (invocation.kind === 'list') {
  if (profiles.length === 0) console.log('(no saved connections)');
  for (const p of profiles) console.log(`${p.id}\t${p.driver}\t${p.name}`);
  process.exit(0);
}

// `open` connects straight in; resolving the target to a saved profile or an
// ad-hoc file is the edge step parseArgs deliberately left out (it needs IO).
// `default` leaves `initial` null → the interactive picker.
let initial: ConnectionProfile | null = null;
if (invocation.kind === 'open') {
  initial = resolveProfile(invocation.target, profiles);
  if (!initial) {
    die(`unknown connection "${invocation.target}" (try --list, a saved name, or a .db file)`);
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
// config.yml supplies the persisted provider/model; process.env overrides it (so
// an ad-hoc LAZYSQL_LLM_* or an API key still wins) — createSqlGenerator then
// picks the provider from the merged settings.
const generator: SqlGenerator | null = createSqlGenerator({
  ...(await loadLlmEnv()),
  ...process.env,
});

// OpenTUI owns the terminal: createCliRenderer sets up the alternate screen,
// mouse reporting and the double-buffered (cell-diffed) render loop, and restores
// everything on destroy() — so there is no manual ANSI here, and no flicker. We
// only disable its built-in ^C so the app decides what ^C means in context
// (cancel a modal vs. quit). The single exit path is renderer.destroy(), reached
// from App's `q`/^C handler and from SIGINT/SIGTERM.
const renderer = await createCliRenderer({ exitOnCtrlC: false });

// Exit once teardown has run. Deferred to a microtask so the 'destroy'
// subscribers (Root releases the DB connection) run first, in the same emit.
renderer.on('destroy', () => {
  queueMicrotask(() => process.exit(0));
});

createRoot(renderer).render(
  <Root
    connectionService={connectionService}
    initial={initial}
    generator={generator}
    clipboard={createSystemClipboard()}
    historyStore={history}
    exporter={new FileExporter()}
  />,
);
