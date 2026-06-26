/**
 * Overlay integration: the `?` help and the cell inspector float OVER the
 * workbench (lazygit-style) instead of replacing it. Driven through the real App
 * so it exercises App's background/overlay split + the Overlay primitive's
 * absolute compositing. The regression this guards: before, an open overlay
 * unmounted the panes entirely; now the sidebar tree stays visible beside it.
 *
 * A wide terminal is forced so the centered panel leaves the fixed-width sidebar
 * (cols 0–27) uncovered, making "is the background still there?" observable.
 */

import React from 'react';
import { test, beforeAll, afterAll, expect } from 'bun:test';
import { render } from 'ink-testing-library';
import { Database } from 'bun:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { Root } from './Root.tsx';
import { createDataSource } from '../../adapters/datasource/registry.ts';
import { openConnection } from '../../application/usecases/OpenConnection.ts';
import type { ConnectionService } from '../../application/ports/ConnectionService.ts';

const DB = join(tmpdir(), `lazysql-overlay-${process.pid}.db`);
const tick = (ms = 100) => Bun.sleep(ms);
const noSecrets = { get: async () => null, set: async () => {}, delete: async () => {} } as any;
const profile = { id: 't', name: 'TestDB', driver: 'sqlite' as const, options: { file: DB } };
const svc: ConnectionService = {
  list: async () => [profile],
  open: (p) => openConnection(p, { factory: createDataSource, secrets: noSecrets }),
  save: async () => {},
  remove: async () => {},
};
const strip = (s: string): string => s.replace(/\[[0-9;]*m/g, '');

beforeAll(() => {
  const db = new Database(DB, { create: true });
  db.exec('CREATE TABLE widgets (id INTEGER PRIMARY KEY, name TEXT);');
  db.exec("INSERT INTO widgets (name) VALUES ('alpha');");
  db.close();
});
afterAll(() => rmSync(DB, { force: true }));

const withSize = async (run: () => Promise<void>): Promise<void> => {
  const cols = process.stdout.columns;
  const rows = process.stdout.rows;
  (process.stdout as { columns: number }).columns = 120;
  (process.stdout as { rows: number }).rows = 30;
  try {
    await run();
  } finally {
    (process.stdout as { columns?: number }).columns = cols;
    (process.stdout as { rows?: number }).rows = rows;
  }
};

test('the ? help floats over the workbench — the sidebar tree stays visible', async () => {
  await withSize(async () => {
    const { lastFrame, stdin } = render(<Root connectionService={svc} initial={profile} />);
    await tick(220);
    expect(strip(lastFrame() ?? '')).toContain('CONNECTIONS'); // sidebar present

    stdin.write('?'); // open the help overlay
    await tick(80);
    const f = strip(lastFrame() ?? '');
    expect(f).toContain('Keybindings'); // the overlay drew…
    expect(f).toContain('CONNECTIONS'); // …and the sidebar is STILL there behind it
    expect(f).toContain('widgets'); // …including the tree item
  });
});

test('the cell inspector floats over the grid — the table stays visible', async () => {
  await withSize(async () => {
    const { lastFrame, stdin } = render(<Root connectionService={svc} initial={profile} />);
    await tick(220);
    stdin.write('\r'); // open the table into the grid
    await tick(140);
    stdin.write('\r'); // ⏎ on the focused cell → inspector
    await tick(80);
    const f = strip(lastFrame() ?? '');
    expect(f).toContain('cell'); // the inspector badge drew…
    expect(f).toContain('CONNECTIONS'); // …and the sidebar is still behind it
  });
});
