/**
 * Mid-string editing: end-to-end proof that the TextField model is wired through
 * the whole input chain — keymap field.edit → store.editQuery → TextField op →
 * QueryEditor renders the caret split into the text. Driven through the real Root
 * so it exercises the dispatcher, the store, and the view together.
 */

import React from 'react';
import { test, beforeAll, afterAll, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { renderTest } from '../../testing/renderTest.ts';
import { Root } from '../Root.tsx';
import { CARET } from '../../theme/theme.ts';
import { createDataSource } from '../../../adapters/datasource/registry.ts';
import { openConnection } from '../../../application/usecases/OpenConnection.ts';
import type { ConnectionService } from '../../../application/ports/ConnectionService.ts';

const DB = join(tmpdir(), `lazysql-editing-${process.pid}.db`);
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
  db.exec('CREATE TABLE t (id INTEGER);');
  db.close();
});
afterAll(() => rmSync(DB, { force: true }));

test('the SQL editor inserts at the cursor, not only at the end', async () => {
  const h = await renderTest(<Root connectionService={svc} initial={profile} />, {
    width: 100,
    height: 24,
  });
  await h.until((f) => f.includes('TestDB'));
  h.press(':'); // focus the editor
  await h.until((f) => f.includes('⏎ run')); // editor-focused hint

  await h.type('ab');
  await h.until((f) => f.includes('ab'));
  h.arrow('left'); // cursor between a and b
  await h.type('X'); // insert there → "aXb"

  // The caret sits BETWEEN X and b — the value is aXb edited mid-string, which a
  // bare append-at-end model could never produce.
  await h.until((f) => f.includes(`aX${CARET}b`));
  expect(h.frame()).toContain(`aX${CARET}b`);
  h.cleanup();
});
