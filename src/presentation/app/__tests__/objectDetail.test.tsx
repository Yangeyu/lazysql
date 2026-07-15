/**
 * Opening a source-only object (an index) shows its definition, not a data grid.
 * Driven through the real App + the real SQLite adapter, so the whole chain runs:
 * introspect → describe → store.openObject (browse-vs-definition branch) →
 * StructureView. The DB has just a table and one index, so tree navigation to
 * the index is deterministic.
 */

import { test, beforeAll, afterAll, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { renderTest } from '../../testing/renderTest.ts';
import { Root } from '../Root.tsx';
import { createDataSource } from '../../../adapters/datasource/registry.ts';
import { openConnection } from '../../../application/usecases/OpenConnection.ts';
import type { ConnectionService } from '../../../application/ports/ConnectionService.ts';

const DB = join(tmpdir(), `lazysql-objdetail-${process.pid}.db`);
const noSecrets = { get: async () => null, set: async () => {}, delete: async () => {} } as any;
const profile = { id: 'o', name: 'ObjDB', driver: 'sqlite' as const, options: { file: DB } };
const svc: ConnectionService = {
  list: async () => [profile],
  open: (p) => openConnection(p, { factory: createDataSource, secrets: noSecrets }),
  save: async () => {},
  remove: async () => {},
};

beforeAll(() => {
  const db = new Database(DB, { create: true });
  db.exec('CREATE TABLE widget (id INTEGER PRIMARY KEY, label TEXT);');
  db.exec('CREATE INDEX widget_label ON widget(label);');
  db.close();
});
afterAll(() => rmSync(DB, { force: true }));

test('opening an index shows its definition, not a row grid', async () => {
  const h = await renderTest(<Root connectionService={svc} initial={profile} />, {
    width: 120,
    height: 30,
  });
  await h.until((f) => f.includes('widget')); // tree ready, cursor on the table
  // widget(object) → Indexes(category) → expand → widget_label(object) → open.
  h.press('j'); // → Indexes category header
  h.press('l'); // expand Indexes
  await h.until((f) => f.includes('widget_label'));
  h.press('j'); // → the index object
  h.enter(); // open it
  await h.until((f) => f.includes('CREATE INDEX'));
  const frame = h.frame();
  expect(frame).toContain('CREATE INDEX'); // the verbatim definition is shown
  expect(frame).toContain('widget_label');
  h.cleanup();
});
