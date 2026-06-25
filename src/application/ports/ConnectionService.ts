/**
 * Outbound port the UI store uses to manage connections without ever touching a
 * driver, repository, or secret store. It folds the connection lifecycle —
 * listing saved profiles, opening one into a live DataSource, and persisting /
 * forgetting profiles (with their secret) — behind one interface the store
 * depends on. The composition root wires the concrete implementation over the
 * ConnectionRepository, SecretStore and DataSourceFactory. (DIP)
 */

import type { ConnectionProfile } from '../../domain/connection/ConnectionProfile.ts';
import type { DataSource } from '../../domain/datasource/DataSource.ts';
import type { ConnectionError } from '../../domain/errors/errors.ts';
import type { Result } from '../../shared/Result.ts';

export interface ConnectionService {
  /** All saved connection profiles. */
  list(): Promise<ConnectionProfile[]>;
  /** Resolve the profile's secret and open a live, connected DataSource. */
  open(
    profile: ConnectionProfile,
  ): Promise<Result<DataSource, ConnectionError>>;
  /** Persist a profile; the password (if any) goes to the SecretStore only. */
  save(profile: ConnectionProfile, password: string | null): Promise<void>;
  /** Forget a saved profile and its secret. */
  remove(id: string): Promise<void>;
}
