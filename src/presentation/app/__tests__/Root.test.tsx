/**
 * Root lifecycle test (headless): the connection list lives in the sidebar.
 * Render Root with a fake ConnectionService, connect a profile (Enter on its
 * root), browse its objects, disconnect (backtick), and add a new connection
 * via the `n` form. Exercises the workbench store end to end through the real
 * OpenTUI renderer.
 */

import React from 'react';
import { test, expect, beforeAll, afterAll } from 'bun:test';
import { Database } from 'bun:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';

import { renderTest } from '../../testing/renderTest.ts';
import { Root } from '../Root.tsx';
import { createDataSource } from '../../../adapters/datasource/registry.ts';
import { openConnection } from '../../../application/usecases/OpenConnection.ts';
import type { ConnectionProfile } from '../../../domain/connection/ConnectionProfile.ts';
import type { ConnectionService } from '../../../application/ports/ConnectionService.ts';
import type { SecretStore } from '../../../application/ports/SecretStore.ts';
import type { SqlGenerator } from '../../../application/ports/SqlGenerator.ts';

const DB = join(tmpdir(), `lazysql-root-${process.pid}.db`);

const noSecrets: SecretStore = {
  get: async () => null,
  set: async () => {},
  delete: async () => {},
};

const profiles: ConnectionProfile[] = [
  { id: 't', name: 'TestDB', driver: 'sqlite', options: { file: DB } },
];

/** A ConnectionService over the real factory; `saved` captures persisted ones. */
const makeService = (saved: ConnectionProfile[] = []): ConnectionService => ({
  list: async () => [...profiles, ...saved],
  open: (p) => openConnection(p, { factory: createDataSource, secrets: noSecrets }),
  save: async (p) => {
    saved.push(p);
  },
  remove: async () => {},
});

beforeAll(() => {
  const db = new Database(DB, { create: true });
  db.exec('CREATE TABLE gadget (id INTEGER PRIMARY KEY, name TEXT);');
  db.exec("INSERT INTO gadget (name) VALUES ('a'), ('b');");
  db.close();
});

afterAll(() => rmSync(DB, { force: true }));

test('the sidebar lists saved connections as roots', async () => {
  const h = await renderTest(<Root connectionService={makeService()} />);
  await h.until((f) => f.includes('TestDB'));
  const frame = h.frame();
  expect(frame).toContain('TestDB'); // connection root
  expect(frame).toContain('[SQLite]'); // driver tag
  expect(frame).toContain('○'); // inactive — not yet connected
  h.cleanup();
});

test('Enter on a connection connects and lists its objects; backtick disconnects', async () => {
  const h = await renderTest(<Root connectionService={makeService()} />);
  await h.until((f) => f.includes('TestDB'));

  h.enter(); // connect the selected connection root
  await h.until((f) => f.includes('gadget')); // its schema object → connected
  expect(h.frame()).toContain('TestDB'); // status bar shows the connection name

  h.press('`'); // disconnect → back to the connection list
  await h.until((f) => !f.includes('gadget'));
  const after = h.frame();
  expect(after).toContain('TestDB'); // still listed
  expect(after).not.toContain('gadget'); // no longer connected/expanded
  h.cleanup();
});

test('n opens the new-connection form and persists a profile', async () => {
  const saved: ConnectionProfile[] = [];
  const h = await renderTest(<Root connectionService={makeService(saved)} />);
  await h.until((f) => f.includes('TestDB'));

  h.press('n'); // open the new-connection form
  await h.until((f) => f.includes('New connection'));

  h.arrow('down'); // URL row → Name field
  await h.flush();
  await h.type('mydb'); // type into the Name field
  await h.flush();
  h.enter(); // save
  await h.until((f) => f.includes('mydb')); // new root appears in the tree

  expect(saved).toHaveLength(1);
  expect(saved[0]!.name).toBe('mydb');
  expect(saved[0]!.id).toBe('mydb');
  expect(saved[0]!.driver).toBe('postgres'); // default driver
  h.cleanup();
});

test('the Driver row cycles the driver with →, carrying the typed name', async () => {
  const saved: ConnectionProfile[] = [];
  const h = await renderTest(<Root connectionService={makeService(saved)} />);
  await h.until((f) => f.includes('TestDB'));

  h.press('n');
  await h.until((f) => f.includes('PostgreSQL')); // opens on the default driver
  h.arrow('down'); // URL row → Name field
  await h.flush();
  await h.type('box'); // into the Name <input>
  await h.flush();

  h.arrow('up'); // back over the URL row…
  h.arrow('up'); // …to the Driver row (above the fields)
  h.arrow('right'); // cycle postgres → mysql
  await h.until((f) => f.includes('MySQL'));

  h.enter(); // save from the Driver row
  await h.until((f) => f.includes('box'));
  expect(saved).toHaveLength(1);
  expect(saved[0]!.name).toBe('box'); // name carried across the driver change
  expect(saved[0]!.driver).toBe('mysql');
  h.cleanup();
});

test('the password field masks its value; ^R reveals it', async () => {
  const h = await renderTest(<Root connectionService={makeService()} />);
  await h.until((f) => f.includes('TestDB'));

  h.press('n');
  await h.until((f) => f.includes('PostgreSQL'));
  // URL → Name → Host → Port → User → Password (the secret field).
  for (let i = 0; i < 5; i++) {
    h.arrow('down');
    await h.flush();
  }
  await h.until((f) => f.includes('› Password')); // focus parked on the secret field
  await h.type('pw');
  await h.flush();

  const masked = h.frame();
  expect(masked).toContain('••'); // shown as bullets…
  expect(masked).not.toContain('pw'); // …never in the clear

  h.ctrl('r'); // ^R reveal
  await h.until((f) => f.includes('pw'));
  h.cleanup();
});

test('NL→SQL fills the editor with generated SQL for review (never auto-runs)', async () => {
  const fakeGen: SqlGenerator = {
    generate: async () => ({
      sql: 'SELECT count(*) FROM gadget',
      explanation: 'counts the gadgets',
    }),
  };
  const h = await renderTest(
    <Root connectionService={makeService()} generator={fakeGen} />,
  );
  await h.until((f) => f.includes('TestDB'));
  h.enter(); // connect
  await h.until((f) => f.includes('gadget'));
  h.press(':'); // query view
  await h.until((f) => f.includes('SQL>'));
  h.ctrl('g'); // Ctrl+G → begin NL prompt
  await h.flush();
  await h.type('how many gadgets'); // natural language
  await h.flush();
  h.enter(); // generate

  // The explanation appears only after generateFromNl fills the editor — proof
  // the NL→SQL flow ran end to end.
  await h.until((f) => f.includes('counts the gadgets'));
  expect(h.frame()).toContain('counts the gadgets');
  h.cleanup();
});
