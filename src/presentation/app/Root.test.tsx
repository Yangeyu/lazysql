/**
 * Connection-picker flow test (headless): render Root with a saved profile,
 * pick it, land in the browse UI, then switch back to the picker. Exercises the
 * full picker ↔ browsing lifecycle including teardown.
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
import type { SecretStore } from '../../application/ports/SecretStore.ts';

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

const open = (p: ConnectionProfile) =>
  openConnection(p, { factory: createDataSource, secrets: noSecrets });

beforeAll(() => {
  const db = new Database(DB, { create: true });
  db.exec('CREATE TABLE gadget (id INTEGER PRIMARY KEY, name TEXT);');
  db.exec("INSERT INTO gadget (name) VALUES ('a'), ('b');");
  db.close();
});

afterAll(() => rmSync(DB, { force: true }));

test('picker lists saved connections', async () => {
  const { lastFrame, unmount } = render(
    <Root profiles={profiles} open={open} />,
  );
  await tick();
  const frame = lastFrame() ?? '';
  expect(frame).toContain('lazysql — connections');
  expect(frame).toContain('TestDB');
  unmount();
});

test('selecting a connection enters the browse UI, backtick returns', async () => {
  const { lastFrame, stdin, unmount } = render(
    <Root profiles={profiles} open={open} />,
  );
  await tick();

  stdin.write('\r'); // connect selected profile
  await tick(140);
  const browsing = lastFrame() ?? '';
  expect(browsing).toContain('gadget'); // sidebar object → we're browsing
  expect(browsing).toContain('TestDB'); // status bar shows the connection name

  stdin.write('`'); // switch connection → back to picker
  await tick();
  expect(lastFrame() ?? '').toContain('lazysql — connections');
  unmount();
});
