/**
 * Connection form ^T probe: connFormTest opens the drafted connection through
 * the ConnectionService (no save), reports the outcome, and clears once an edit
 * changes the draft. The service is faked — no real DB.
 */

import { test, expect } from 'bun:test';
import { createAppStore } from '../store.ts';
import { CapabilitySet } from '../../../domain/datasource/capabilities.ts';
import { ok, err } from '../../../shared/Result.ts';
import { ConnectionError } from '../../../domain/errors/errors.ts';
import type { DataSource } from '../../../domain/datasource/DataSource.ts';
import type { ConnectionService } from '../../../application/ports/ConnectionService.ts';
import type { ConnectionProfile } from '../../../domain/connection/ConnectionProfile.ts';

const profile: ConnectionProfile = { id: 'x', name: 'X', driver: 'sqlite', options: {} };

let disconnected = false;
const fakeSource: DataSource = {
  id: 'fake',
  connect: async () => ok(undefined),
  disconnect: async () => {
    disconnected = true;
  },
  ping: async () => true,
  capabilities: () => new CapabilitySet([]),
};

const serviceWith = (open: ConnectionService['open']): ConnectionService => ({
  list: async () => [profile],
  open,
  save: async () => {},
  remove: async () => {},
});

test('connFormTest reports success and drops the probed connection', async () => {
  disconnected = false;
  const store = createAppStore({ connectionService: serviceWith(async () => ok(fakeSource)) });
  store.getState().beginNewConnection();
  store.getState().connFormSetField('name', 'Local');

  await store.getState().connFormTest();

  expect(store.getState().connForm?.probe).toEqual({ state: 'ok', message: 'connection ok' });
  expect(disconnected).toBe(true); // a test connection never lingers
});

test('connFormTest surfaces the failure message', async () => {
  const store = createAppStore({
    connectionService: serviceWith(async () => err(new ConnectionError('host unreachable'))),
  });
  store.getState().beginNewConnection();
  store.getState().connFormSetField('name', 'Local');

  await store.getState().connFormTest();

  expect(store.getState().connForm?.probe).toEqual({
    state: 'fail',
    message: 'host unreachable',
  });
});

test('editing a field clears a stale probe result', async () => {
  const store = createAppStore({ connectionService: serviceWith(async () => ok(fakeSource)) });
  store.getState().beginNewConnection();
  store.getState().connFormSetField('name', 'Local');
  await store.getState().connFormTest();
  expect(store.getState().connForm?.probe?.state).toBe('ok');

  store.getState().connFormSetField('host', 'db.internal');
  expect(store.getState().connForm?.probe).toBeNull();
});
