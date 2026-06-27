/**
 * Overlay integration: the `?` help and the cell inspector float OVER the
 * workbench (lazygit-style) instead of replacing it. Driven through the real App
 * so it exercises App's background/overlay split + the Overlay primitive's
 * absolute compositing. The regression this guards: an open overlay must NOT
 * unmount the panes — the sidebar tree stays visible beside it.
 *
 * A wide terminal keeps the centered panel off the fixed-width sidebar (cols
 * 0–27), making "is the background still there?" observable.
 */

import React from 'react';
import { test, beforeAll, afterAll, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { renderTest } from '../testing/renderTest.ts';
import { Root } from './Root.tsx';
import { createDataSource } from '../../adapters/datasource/registry.ts';
import { openConnection } from '../../application/usecases/OpenConnection.ts';
import type { ConnectionService } from '../../application/ports/ConnectionService.ts';

const DB = join(tmpdir(), `lazysql-overlay-${process.pid}.db`);
const noSecrets = { get: async () => null, set: async () => {}, delete: async () => {} } as any;
const profile = { id: 't', name: 'TestDB', driver: 'sqlite' as const, options: { file: DB } };
const svc: ConnectionService = {
  list: async () => [profile],
  open: (p) => openConnection(p, { factory: createDataSource, secrets: noSecrets }),
  save: async () => {},
  remove: async () => {},
};

beforeAll(() => {
  const db = new Database(DB, { create: true });
  db.exec('CREATE TABLE widgets (id INTEGER PRIMARY KEY, name TEXT);');
  db.exec("INSERT INTO widgets (name) VALUES ('alpha');");
  db.close();
});
afterAll(() => rmSync(DB, { force: true }));

test('the ? help floats over the workbench — the sidebar tree stays visible', async () => {
  const h = await renderTest(<Root connectionService={svc} initial={profile} />, {
    width: 120,
    height: 30,
  });
  await h.until((f) => f.includes('CONNECTIONS')); // sidebar present

  h.press('?'); // open the help overlay
  await h.until((f) => f.includes('Keybindings'));
  const f = h.frame();
  expect(f).toContain('Keybindings'); // the overlay drew…
  expect(f).toContain('CONNECTIONS'); // …and the sidebar is STILL there behind it
  expect(f).toContain('widgets'); // …including the tree item
  h.cleanup();
});

test('the cell inspector floats over the grid — the table stays visible', async () => {
  const h = await renderTest(<Root connectionService={svc} initial={profile} />, {
    width: 120,
    height: 30,
  });
  await h.until((f) => f.includes('widgets'));
  h.enter(); // open the table into the grid
  await h.until((f) => f.includes('alpha'));
  h.enter(); // ⏎ on the focused cell → inspector
  await h.until((f) => f.includes('cell')); // the inspector badge drew…
  expect(h.frame()).toContain('CONNECTIONS'); // …and the sidebar is still behind it
  h.cleanup();
});
