/**
 * Connection-form interaction rules: digits-only fields, required-field
 * validation (the error names the field and focus jumps to it), and the
 * action-button row (↑/↓ reaches it, ←/→ cycles, ⏎ presses the focused
 * button, a click presses directly). The service is faked — no real DB.
 */

import { test, expect } from 'bun:test';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createAppStore, DRIVER_ROW } from '../store.ts';
import { parseSshField } from '../slices/connForm.ts';
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
  store.getState().connFormFocus(1); // off the URL row — ⏎ there means "fill"
  await store.getState().connFormSubmit();

  let f = store.getState().connForm!;
  expect(f.error).toBe('name is required');
  expect(f.fields[f.index]?.key).toBe('name'); // jumped to the Name field
  expect(saved).toHaveLength(0);

  store.getState().connFormSetField('name', 'pg');
  store.getState().connFormSetField('host', '');
  await store.getState().connFormSubmit();
  f = store.getState().connForm!;
  expect(f.error).toBe('host is required');
  expect(f.fields[f.index]?.key).toBe('host'); // …and to the Host field
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

// ── the URL row: ⏎ expands a pasted URL into the fields below ──

test('⏎ on a filled URL row expands it, switching driver to its scheme', async () => {
  const { store, saved } = storeWith();
  store.getState().beginNewConnection(); // postgres; focus starts ON the URL row
  store.getState().connFormSetField('url', 'redis://ops:s3c%40ret@cache.internal:6390/3');
  await store.getState().connFormSubmit();

  const f = store.getState().connForm!;
  expect(f.driver).toBe('redis');
  const val = (k: string) => f.fields.find((x) => x.key === k)?.value;
  expect(val('host')).toBe('cache.internal');
  expect(val('port')).toBe('6390');
  expect(val('user')).toBe('ops');
  expect(val('password')).toBe('s3c@ret'); // percent-decoded, into the masked field
  expect(val('db')).toBe('3');
  expect(val('name')).toBe('3'); // defaulted from the URL path (no typed name)
  expect(val('url')).toBe(''); // consumed — a later ⏎ won't stomp hand edits
  expect(f.fields[f.index]?.key).toBe('name'); // focus lands on Name for review
  expect(saved).toHaveLength(0); // filling is NOT saving
});

test('the URL fill keeps a hand-typed name and defaults missing parts', async () => {
  const { store } = storeWith();
  store.getState().beginNewConnection();
  store.getState().connFormSetField('name', 'prod');
  store.getState().connFormSetField('url', 'postgres://db.internal/appdb');
  await store.getState().connFormSubmit(); // focus is still on the URL row

  const f = store.getState().connForm!;
  const val = (k: string) => f.fields.find((x) => x.key === k)?.value;
  expect(f.driver).toBe('postgres');
  expect(val('name')).toBe('prod'); // the typed name survives the fill
  expect(val('port')).toBe('5432'); // no port in the URL → driver default
  expect(val('database')).toBe('appdb');
});

test('an unsupported URL scheme reports an error and leaves the fields alone', async () => {
  const { store } = storeWith();
  store.getState().beginNewConnection();
  store.getState().connFormSetField('url', 'mongodb+srv://cluster0.example.net/app');
  await store.getState().connFormSubmit();

  const f = store.getState().connForm!;
  expect(f.error).toBe('unsupported URL scheme: mongodb+srv');
  expect(f.driver).toBe('postgres'); // untouched
  expect(f.fields.find((x) => x.key === 'host')?.value).toBe('localhost');
});

test('⏎ on a BLANK URL row falls through to save (it is not a trap)', async () => {
  const { store, saved } = storeWith();
  store.getState().beginNewConnection();
  store.getState().connFormSetField('name', 'pg');
  expect(store.getState().connForm?.fields[store.getState().connForm!.index]?.key).toBe('url');

  await store.getState().connFormSubmit();

  expect(store.getState().connForm).toBeNull();
  expect(saved).toHaveLength(1);
});

// ── the SSH rows: optional tunnel spec, validated before save/test ──

test('parseSshField reads user@host:port and its shorthands', () => {
  expect(parseSshField('ops@bastion:2222')).toEqual({
    host: 'bastion',
    port: 2222,
    user: 'ops',
  });
  expect(parseSshField('bastion')).toEqual({ host: 'bastion' });
  expect(parseSshField('ops@bastion')).toEqual({ host: 'bastion', user: 'ops' });
  expect(parseSshField('')).toBeNull();
  expect(parseSshField('@bastion')).toBeNull();
  expect(parseSshField('bastion:abc')).toBeNull();
});

test('a filled SSH row saves as the profile ssh block (key path expanded)', async () => {
  const { store, saved } = storeWith();
  store.getState().beginNewConnection();
  store.getState().connFormSetField('name', 'pg');
  store.getState().connFormSetField('ssh', 'ops@bastion:2222');
  store.getState().connFormSetField('sshKey', '~/.ssh/id_ed25519');
  store.getState().connFormFocus(1); // off the URL row
  await store.getState().connFormSubmit();

  expect(saved).toHaveLength(1);
  expect(saved[0]?.ssh).toEqual({
    host: 'bastion',
    port: 2222,
    user: 'ops',
    keyFile: join(homedir(), '.ssh/id_ed25519'),
  });
});

test('a blank SSH row saves no ssh block at all', async () => {
  const { store, saved } = storeWith();
  store.getState().beginNewConnection();
  store.getState().connFormSetField('name', 'pg');
  store.getState().connFormFocus(1);
  await store.getState().connFormSubmit();

  expect(saved).toHaveLength(1);
  expect('ssh' in saved[0]!).toBe(false);
});

test('an unparseable SSH row blocks save and test alike, focus jumping to it', async () => {
  const { store, saved } = storeWith();
  store.getState().beginNewConnection();
  store.getState().connFormSetField('name', 'pg');
  store.getState().connFormSetField('ssh', 'bastion:abc');
  store.getState().connFormFocus(1);
  await store.getState().connFormSubmit();

  let f = store.getState().connForm!;
  expect(f.error).toBe('ssh must be user@host[:port]');
  expect(f.fields[f.index]?.key).toBe('ssh');
  expect(saved).toHaveLength(0);

  await store.getState().connFormTest();
  f = store.getState().connForm!;
  expect(f.probe).toBeNull(); // the probe never ran against the bare host
  expect(f.error).toBe('ssh must be user@host[:port]');
});

test('an SSH key without an SSH host is an error, not a silent no-op', async () => {
  const { store, saved } = storeWith();
  store.getState().beginNewConnection();
  store.getState().connFormSetField('name', 'pg');
  store.getState().connFormSetField('sshKey', '~/.ssh/id_ed25519');
  store.getState().connFormFocus(1);
  await store.getState().connFormSubmit();

  const f = store.getState().connForm!;
  expect(f.error).toBe('ssh key needs an SSH host above');
  expect(f.fields[f.index]?.key).toBe('sshKey');
  expect(saved).toHaveLength(0);
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
