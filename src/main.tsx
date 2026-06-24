#!/usr/bin/env bun
/**
 * Composition root — the ONLY place concrete adapters are wired to the app.
 * It builds a connection profile, instantiates the data source via the registry,
 * connects, then hands a store (with the source injected) to the Ink tree.
 * Every layer below depends on interfaces; the wiring lives here. (DIP)
 *
 * Usage: bun run src/main.tsx [path/to/database.db]   (default: data/sample.db)
 */

import React from 'react';
import { render } from 'ink';
import { StoreContext } from './presentation/app/context.ts';
import { App } from './presentation/app/App.tsx';
import { createAppStore } from './presentation/app/store.ts';
import { createDataSource } from './adapters/datasource/registry.ts';
import type { ConnectionProfile } from './domain/connection/ConnectionProfile.ts';

const file = process.argv[2] ?? 'data/sample.db';

const profile: ConnectionProfile = {
  id: 'cli',
  name: file,
  driver: 'sqlite',
  options: { file },
};

const created = createDataSource(profile);
if (!created.ok) {
  console.error(`lazysql: ${created.error.message}`);
  process.exit(1);
}

const source = created.value;
const connection = await source.connect();
if (!connection.ok) {
  console.error(`lazysql: ${connection.error.message}`);
  process.exit(1);
}

const store = createAppStore(source);

const { waitUntilExit } = render(
  <StoreContext.Provider value={store}>
    <App />
  </StoreContext.Provider>,
);

await waitUntilExit();
await source.disconnect();
