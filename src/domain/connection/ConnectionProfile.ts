/**
 * A connection profile — the persisted, secret-free description of how to reach
 * a data source. Credentials live in the OS keychain (later phase); here we only
 * keep a reference. `driver` selects which adapter the registry instantiates.
 */

export type DriverId = 'sqlite' | 'postgres' | 'mysql' | 'mongodb' | 'redis';

export interface ConnectionProfile {
  readonly id: string;
  readonly name: string;
  readonly driver: DriverId;
  /** Driver-specific connection options (e.g. { file } for sqlite). */
  readonly options: Readonly<Record<string, unknown>>;
}
