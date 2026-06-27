/**
 * Keychain adapter test. Runs only on macOS, and against a THROWAWAY keychain
 * file (created/deleted here) so it never touches the user's login keychain or
 * triggers an access prompt. Confirms the same SecretStore contract as the file
 * store — the proof that the port lets secrets move to the OS keychain.
 */

import { test, expect, beforeAll, afterAll } from 'bun:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KeychainSecretStore } from '../KeychainSecretStore.ts';

const darwin = process.platform === 'darwin';
const kcTest = test.skipIf(!darwin);
const keychain = join(tmpdir(), `lazysql-test-${process.pid}.keychain`);

const security = (args: string[]) =>
  Bun.spawn(['security', ...args], { stdout: 'ignore', stderr: 'ignore' }).exited;

beforeAll(async () => {
  if (!darwin) return;
  await security(['create-keychain', '-p', '', keychain]);
  await security(['unlock-keychain', '-p', '', keychain]);
});

afterAll(async () => {
  if (!darwin) return;
  await security(['delete-keychain', keychain]);
});

kcTest('keychain store sets, updates, reads, and deletes a secret', async () => {
  const store = new KeychainSecretStore(keychain);

  expect(await store.get('pg1')).toBeNull();

  await store.set('pg1', 'kc-secret');
  expect(await store.get('pg1')).toBe('kc-secret');

  await store.set('pg1', 'updated'); // -U updates in place
  expect(await store.get('pg1')).toBe('updated');

  await store.delete('pg1');
  expect(await store.get('pg1')).toBeNull();
});
