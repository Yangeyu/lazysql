/**
 * Root lifecycle test (headless): the connection list lives in the sidebar.
 * Render Root with a fake ConnectionService, connect a profile (Enter on its
 * root), browse its objects, disconnect (backtick), and add a new connection
 * via the `n` form. Exercises the workbench store end to end.
 */

import React from 'react';
import { test, expect, beforeAll, afterAll } from 'bun:test';
import { render } from 'ink-testing-library';
import { Database } from 'bun:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';

import { Root } from './Root.tsx';
import { createDataSource } from '../../adapters/datasource/registry.ts';
import { openConnection } from '../../application/usecases/OpenConnection.ts';
import type { ConnectionProfile } from '../../domain/connection/ConnectionProfile.ts';
import type { ConnectionService } from '../../application/ports/ConnectionService.ts';
import type { SecretStore } from '../../application/ports/SecretStore.ts';
import type { SqlGenerator } from '../../application/ports/SqlGenerator.ts';

const DB = join(tmpdir(), `lazysql-root-${process.pid}.db`);
const tick = (ms = 80) => Bun.sleep(ms);

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
  const { lastFrame, unmount } = render(
    <Root connectionService={makeService()} />,
  );
  await tick();
  const frame = lastFrame() ?? '';
  expect(frame).toContain('TestDB'); // connection root
  expect(frame).toContain('[SQLite]'); // driver tag
  expect(frame).toContain('○'); // inactive — not yet connected
  unmount();
});

test('Enter on a connection connects and lists its objects; backtick disconnects', async () => {
  const { lastFrame, stdin, unmount } = render(
    <Root connectionService={makeService()} />,
  );
  await tick();

  stdin.write('\r'); // connect the selected connection root
  await tick(180);
  const browsing = lastFrame() ?? '';
  expect(browsing).toContain('gadget'); // its schema object → connected
  expect(browsing).toContain('TestDB'); // status bar shows the connection name

  stdin.write('`'); // disconnect → back to the connection list
  await tick(80);
  const after = lastFrame() ?? '';
  expect(after).toContain('TestDB'); // still listed
  expect(after).not.toContain('gadget'); // no longer connected/expanded
  unmount();
});

test('n opens the new-connection form and persists a profile', async () => {
  const saved: ConnectionProfile[] = [];
  const { lastFrame, stdin, unmount } = render(
    <Root connectionService={makeService(saved)} />,
  );
  await tick();

  stdin.write('n'); // open the new-connection form
  await tick();
  expect(lastFrame() ?? '').toContain('New connection');

  stdin.write('mydb'); // type into the Name field
  await tick();
  stdin.write('\r'); // save
  await tick(80);

  expect(saved).toHaveLength(1);
  expect(saved[0]!.name).toBe('mydb');
  expect(saved[0]!.id).toBe('mydb');
  expect(saved[0]!.driver).toBe('postgres'); // default driver
  expect(lastFrame() ?? '').toContain('mydb'); // new root appears in the tree
  unmount();
});

test('NL→SQL fills the editor with generated SQL for review (never auto-runs)', async () => {
  const fakeGen: SqlGenerator = {
    generate: async () => ({
      sql: 'SELECT count(*) FROM gadget',
      explanation: 'counts the gadgets',
    }),
  };
  const { lastFrame, stdin, unmount } = render(
    <Root connectionService={makeService()} generator={fakeGen} />,
  );
  await tick();
  stdin.write('\r'); // connect
  await tick(180);
  stdin.write(':'); // query view
  await tick(120);
  stdin.write(String.fromCharCode(7)); // Ctrl+G → begin NL prompt
  await tick();
  stdin.write('how many gadgets'); // natural language
  await tick();
  stdin.write('\r'); // generate
  await tick(120);

  // The explanation appears only after generateFromNl fills the editor — proof
  // the NL→SQL flow ran end to end.
  expect(lastFrame() ?? '').toContain('counts the gadgets');
  unmount();
});
