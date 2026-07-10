/**
 * Registry rejections for profiles an ssh tunnel can't serve — these fail
 * before any process is spawned, so no SSH server is needed.
 */

import { test, expect } from 'bun:test';
import { createDataSource, toMongoConfig } from '../registry.ts';

const ssh = { host: 'bastion' };

test('ssh + sqlite is rejected — there is no endpoint to forward to', async () => {
  const r = await createDataSource({
    id: 'x',
    name: 'x',
    driver: 'sqlite',
    options: { file: '/tmp/x.db' },
    ssh,
  });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.error.message).toContain('sqlite');
});

test('ssh + URL-form options is rejected — the embedded host cannot be rewritten', async () => {
  for (const options of [
    { connectionString: 'postgres://db.internal/app' },
    { url: 'redis://db.internal:6379' },
    { uri: 'mongodb://db.internal/app' },
  ]) {
    const r = await createDataSource({
      id: 'x',
      name: 'x',
      driver: options.uri ? 'mongodb' : options.url ? 'redis' : 'postgres',
      options,
      ssh,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toContain('discrete host/port');
  }
});

test('a tunneled mongo URI pins directConnection so the driver cannot chase replica-set members', () => {
  const { uri } = toMongoConfig({
    host: '127.0.0.1',
    port: 55001,
    database: 'app',
    directConnection: true,
  });
  expect(uri).toBe('mongodb://127.0.0.1:55001/?directConnection=true');
  // …and an untunneled profile is untouched.
  expect(toMongoConfig({ host: 'db', database: 'app' }).uri).toBe('mongodb://db:27017');
});
