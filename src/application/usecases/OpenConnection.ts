/**
 * Use case: turn a stored profile into a live, connected DataSource.
 *
 * Resolves the secret from the SecretStore and merges it into the connection
 * options (the password never lives in the profile / connections.yml), then
 * builds and connects via the injected factory. Pure orchestration over ports.
 */

import type { ConnectionProfile } from '../../domain/connection/ConnectionProfile.ts';
import type { DataSource } from '../../domain/datasource/DataSource.ts';
import { ConnectionError } from '../../domain/errors/errors.ts';
import { err, type Result } from '../../shared/Result.ts';
import type { SecretStore } from '../ports/SecretStore.ts';
import type { DataSourceFactory } from '../ports/DataSourceFactory.ts';

export interface OpenDeps {
  factory: DataSourceFactory;
  secrets: SecretStore;
}

export const openConnection = async (
  profile: ConnectionProfile,
  deps: OpenDeps,
): Promise<Result<DataSource, ConnectionError>> => {
  const secret = await deps.secrets.get(profile.id);
  const resolved: ConnectionProfile = secret
    ? { ...profile, options: { ...profile.options, password: secret } }
    : profile;

  const created = await deps.factory(resolved);
  if (!created.ok) return created;

  const connected = await created.value.connect();
  if (!connected.ok) {
    await created.value.disconnect().catch(() => {});
    return err(connected.error);
  }
  return created;
};
