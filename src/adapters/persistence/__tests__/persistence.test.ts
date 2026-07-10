/**
 * Persistence + connection-open tests. Uses temp files (no global config is
 * touched). Verifies the YAML repo round-trips profiles, the secret store keeps
 * secrets in a 0600 file, and OpenConnection merges the resolved secret into the
 * options handed to the factory — all without a real database.
 */

import { test, expect, afterAll } from 'bun:test';
import { stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { YamlConnectionRepository } from '../YamlConnectionRepository.ts';
import { FileSecretStore } from '../FileSecretStore.ts';
import { openConnection } from '../../../application/usecases/OpenConnection.ts';
import { ok } from '../../../shared/Result.ts';
import { CapabilitySet } from '../../../domain/datasource/capabilities.ts';
import type { DataSource } from '../../../domain/datasource/DataSource.ts';
import type { ConnectionProfile } from '../../../domain/connection/ConnectionProfile.ts';
import type { DataSourceFactory } from '../../../application/ports/DataSourceFactory.ts';

const dir = join(tmpdir(), `lazysql-cfg-${process.pid}`);
const connFile = join(dir, 'connections.yml');
const secFile = join(dir, 'secrets.json');

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

const profile: ConnectionProfile = {
  id: 'pg1',
  name: 'Local PG',
  driver: 'postgres',
  options: { host: 'localhost', port: 5432, user: 'me', database: 'app' },
};

test('YAML repo round-trips, updates, and removes profiles', async () => {
  const repo = new YamlConnectionRepository(connFile);
  expect(await repo.list()).toEqual([]); // missing file → empty

  await repo.save(profile);
  expect((await repo.get('pg1'))?.name).toBe('Local PG');

  await repo.save({ ...profile, name: 'Renamed' });
  expect(await repo.list()).toHaveLength(1); // upsert, not duplicate
  expect((await repo.get('pg1'))?.name).toBe('Renamed');

  await repo.remove('pg1');
  expect(await repo.list()).toEqual([]);
});

test('YAML repo never persists a password field', async () => {
  const repo = new YamlConnectionRepository(connFile);
  await repo.save(profile);
  const text = await Bun.file(connFile).text();
  expect(text).not.toContain('password');
  await repo.remove('pg1');
});

test('secret store keeps secrets in a 0600 file', async () => {
  const store = new FileSecretStore(secFile);
  expect(await store.get('pg1')).toBeNull();

  await store.set('pg1', 's3cret');
  expect(await store.get('pg1')).toBe('s3cret');

  const mode = (await stat(secFile)).mode & 0o777;
  expect(mode).toBe(0o600);

  await store.delete('pg1');
  expect(await store.get('pg1')).toBeNull();
});

test('openConnection merges the resolved secret into options', async () => {
  const store = new FileSecretStore(secFile);
  await store.set('pg1', 'injected-pw');

  let received: ConnectionProfile | null = null;
  const fakeSource: DataSource = {
    id: 'pg1',
    connect: async () => ok(undefined),
    disconnect: async () => {},
    ping: async () => true,
    capabilities: () => new CapabilitySet([]),
  };
  const factory: DataSourceFactory = async (p) => {
    received = p;
    return ok(fakeSource);
  };

  const result = await openConnection(profile, { factory, secrets: store });
  expect(result.ok).toBe(true);
  expect(received).not.toBeNull();
  expect(received!.options.password).toBe('injected-pw');
});
