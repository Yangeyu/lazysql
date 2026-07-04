/**
 * Connection-form interaction rules: digits-only fields, required-field
 * validation (the error names the field and focus jumps to it), and the
 * action-button row (↑/↓ reaches it, ←/→ cycles, ⏎ presses the focused
 * button, a click presses directly). The service is faked — no real DB.
 */

import { test, expect } from 'bun:test';
import { createAppStore, DRIVER_ROW } from '../store.ts';
import { CapabilitySet } from '../../../domain/datasource/capabilities.ts';
import { ok } from '../../../shared/Result.ts';
import type { DataSource } from '../../../domain/datasource/DataSource.ts';
import type { ConnectionService } from '../../../application/ports/ConnectionService.ts';
import type { ConnectionProfile } from '../../../domain/connection/ConnectionProfile.ts';

const fakeSource: DataSource = {
  id: 'fake',
  connect: async () => ok(undefined),
  disconnect: async () => {},
  ping: async () => true,
  capabilities: () => new CapabilitySet([]),
};

const storeWith = () => {
  const saved: ConnectionProfile[] = [];
  const service: ConnectionService = {
    list: async () => [...saved],
    open: async () => ok(fakeSource),
    save: async (p) => {
      saved.push(p);
    },
    remove: async () => {},
  };
  return { store: createAppStore({ connectionService: service }), saved };
};

test('numeric fields drop non-digits as typed (a bad port can never be saved)', () => {
  const { store } = storeWith();
  store.getState().beginNewConnection(); // postgres
  store.getState().connFormSetField('port', '5a4b32c');
  const port = store.getState().connForm?.fields.find((f) => f.key === 'port');
  expect(port?.value).toBe('5432');
});

test('submitting with a blank required field names it and moves focus to it', async () => {
  const { store, saved } = storeWith();
  store.getState().beginNewConnection(); // name is blank
  await store.getState().connFormSubmit();

  let f = store.getState().connForm;
  expect(f?.error).toBe('name is required');
  expect(f?.index).toBe(0); // jumped to the Name field
  expect(saved).toHaveLength(0);

  store.getState().connFormSetField('name', 'pg');
  store.getState().connFormSetField('host', '');
  await store.getState().connFormSubmit();
  f = store.getState().connForm;
  expect(f?.error).toBe('host is required');
  expect(f?.index).toBe(1); // …and to the Host field
});

test('mongodb requires a database — the lazily-created server never rejects a typo', async () => {
  const { store, saved } = storeWith();
  store.getState().beginNewConnection();
  store.getState().connFormFocus(DRIVER_ROW);
  // postgres → mysql → sqlite → mongodb
  store.getState().connFormCycle(1);
  store.getState().connFormCycle(1);
  store.getState().connFormCycle(1);
  expect(store.getState().connForm?.driver).toBe('mongodb');
  store.getState().connFormSetField('name', 'm');

  await store.getState().connFormSubmit();

  const f = store.getState().connForm;
  expect(f?.error).toBe('database is required');
  expect(f?.fields[f.index]?.key).toBe('database');
  expect(saved).toHaveLength(0);
});

test('⏎ on the button row presses the FOCUSED button (Cancel closes unsaved)', async () => {
  const { store, saved } = storeWith();
  store.getState().beginNewConnection();
  store.getState().connFormSetField('name', 'pg');
  const buttonRow = store.getState().connForm!.fields.length;
  store.getState().connFormFocus(buttonRow); // default button is Save
  store.getState().connFormCycle(1); // Save → Cancel

  await store.getState().connFormSubmit();

  expect(store.getState().connForm).toBeNull();
  expect(store.getState().mode).toBe('normal');
  expect(saved).toHaveLength(0); // cancelled, not saved
});

test('⏎ on the Save button saves; a button click presses without ⏎', async () => {
  const { store, saved } = storeWith();
  store.getState().beginNewConnection();
  store.getState().connFormSetField('name', 'pg');
  const buttonRow = store.getState().connForm!.fields.length;
  store.getState().connFormFocus(buttonRow);

  await store.getState().connFormSubmit(); // focused button: Save
  expect(saved).toHaveLength(1);

  // Mouse path: pressing Test runs the probe even with Save focused before.
  store.getState().beginNewConnection();
  store.getState().connFormSetField('name', 'pg2');
  store.getState().connFormPressButton(0); // click [ Test ]
  await new Promise((r) => setTimeout(r, 0)); // let the async probe settle
  expect(store.getState().connForm?.probe?.state).toBe('ok');
});

// ── paste a connection URL into any field ──

test('a pasted URL fills the whole form, switching driver to its scheme', () => {
  const { store } = storeWith();
  store.getState().beginNewConnection(); // postgres
  store.getState().connFormSetField('host', 'redis://ops:s3c%40ret@cache.internal:6390/3');

  const f = store.getState().connForm!;
  expect(f.driver).toBe('redis');
  const val = (k: string) => f.fields.find((x) => x.key === k)?.value;
  expect(val('host')).toBe('cache.internal');
  expect(val('port')).toBe('6390');
  expect(val('user')).toBe('ops');
  expect(val('password')).toBe('s3c@ret'); // percent-decoded, into the masked field
  expect(val('db')).toBe('3');
  expect(val('name')).toBe('3'); // defaulted from the URL path (no typed name)
});

test('a pasted URL keeps a hand-typed name and defaults missing parts', () => {
  const { store } = storeWith();
  store.getState().beginNewConnection();
  store.getState().connFormSetField('name', 'prod');
  store.getState().connFormSetField('host', 'postgres://db.internal/appdb');

  const f = store.getState().connForm!;
  const val = (k: string) => f.fields.find((x) => x.key === k)?.value;
  expect(f.driver).toBe('postgres');
  expect(val('name')).toBe('prod'); // the typed name survives the fill
  expect(val('port')).toBe('5432'); // no port in the URL → driver default
  expect(val('database')).toBe('appdb');
});

test('an unsupported URL scheme reports an error and leaves the fields alone', () => {
  const { store } = storeWith();
  store.getState().beginNewConnection();
  store.getState().connFormSetField('host', 'mongodb+srv://cluster0.example.net/app');

  const f = store.getState().connForm!;
  expect(f.error).toBe('unsupported URL scheme: mongodb+srv');
  expect(f.driver).toBe('postgres'); // untouched
  expect(f.fields.find((x) => x.key === 'host')?.value).toBe('localhost');
});

test('the button row is reachable with ↓ and ←/→ cycles within it', () => {
  const { store } = storeWith();
  store.getState().beginNewConnection();
  const f0 = store.getState().connForm!;
  for (let i = 0; i <= f0.fields.length + 2; i++) store.getState().connFormMove(1);

  const f = store.getState().connForm!;
  expect(f.index).toBe(f.fields.length); // clamped on the button row
  expect(f.button).toBe(1); // Save is the default
  store.getState().connFormCycle(-1);
  expect(store.getState().connForm?.button).toBe(0); // Test
});
