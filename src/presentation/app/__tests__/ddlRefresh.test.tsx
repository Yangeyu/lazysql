/**
 * A DDL statement run from the editor re-reads the object tree in place, so the
 * sidebar never lies about the schema: CREATE adds the new table, DROP removes
 * it. Driven end-to-end through the real Root over a SQLite source; the tree's
 * `Tables N` count is the refresh signal.
 */

import React from 'react';
import { test, beforeEach, afterAll, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { renderTest } from '../../testing/renderTest.ts';
import { Root } from '../Root.tsx';
import { createDataSource } from '../../../adapters/datasource/registry.ts';
import { openConnection } from '../../../application/usecases/OpenConnection.ts';
import type { ConnectionService } from '../../../application/ports/ConnectionService.ts';

const DB = join(tmpdir(), `lazysql-ddl-${process.pid}.db`);
const noSecrets = { get: async () => null, set: async () => {}, delete: async () => {} } as any;
const profile = { id: 't', name: 'DdlDB', driver: 'sqlite' as const, options: { file: DB } };
const svc: ConnectionService = {
  list: async () => [profile],
  open: (p) => openConnection(p, { factory: createDataSource, secrets: noSecrets }),
  save: async () => {},
  remove: async () => {},
};

beforeEach(() => {
  const db = new Database(DB, { create: true });
  db.exec('DROP TABLE IF EXISTS t; CREATE TABLE t (id INTEGER);');
  db.close();
});
afterAll(() => rmSync(DB, { force: true }));

const mount = () => renderTest(<Root connectionService={svc} initial={profile} />, { width: 100, height: 26 });

test('CREATE and DROP from the editor refresh the object tree', async () => {
  const h = await mount();
  await h.until((f) => f.includes('Tables 1')); // seeded with one table

  // CREATE is DDL but not a danger op → runs straight, then the tree reloads.
  h.press(':');
  await h.until((f) => f.includes('⏎ run'));
  await h.type('CREATE TABLE zzz (id INTEGER)');
  h.enter();
  await h.until((f) => f.includes('Tables 2')); // new table appears in the tree

  // DROP is a danger op → confirm dialog → y → runs, then the tree reloads.
  h.press(':');
  await h.until((f) => f.includes('⏎ run'));
  await h.type('DROP TABLE zzz');
  h.enter();
  await h.until((f) => f.includes('irreversible')); // confirm dialog
  h.press('y');
  await h.until((f) => f.includes('Tables 1')); // dropped table is gone from the tree
  h.cleanup();
});
