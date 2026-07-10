/**
 * A connection profile — the persisted, secret-free description of how to reach
 * a data source. Credentials live in the OS keychain (later phase); here we only
 * keep a reference. `driver` selects which adapter the registry instantiates.
 */

export type DriverId = 'sqlite' | 'postgres' | 'mysql' | 'mongodb' | 'redis';

/**
 * Reach the database through an SSH local port forward. `host` may be a
 * ~/.ssh/config alias — the tunnel is opened by the system `ssh`, so config,
 * keys and the agent all apply. Key/agent auth only: the TUI owns the
 * terminal, an interactive SSH password prompt can never be answered.
 */
export interface SshTunnelConfig {
  readonly host: string;
  readonly port?: number;
  readonly user?: string;
  /** Private key path (`-i`); omit to let ssh pick from config/agent. */
  readonly keyFile?: string;
}

export interface ConnectionProfile {
  readonly id: string;
  readonly name: string;
  readonly driver: DriverId;
  /** Driver-specific connection options (e.g. { file } for sqlite). */
  readonly options: Readonly<Record<string, unknown>>;
  /** Tunnel the connection over SSH. Requires discrete host/port options —
   *  URL-form options can't be rewritten to point at the local forward. */
  readonly ssh?: SshTunnelConfig;
}
