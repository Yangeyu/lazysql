/**
 * PgDriver — SqlDriver backed by Bun's native Postgres client (`Bun.SQL`).
 *
 * We deliberately do NOT use node-postgres (`pg`): under Bun (≤1.2.16) its
 * SCRAM-SHA-256 auth handshake spins at 100% CPU and never completes, so a
 * Postgres connection hangs forever on "Connecting…". Bun's built-in client
 * speaks the wire protocol natively (no JS SASL loop) and connects in ~30ms,
 * and it keeps the project Bun-native and dependency-light — exactly as
 * BunSqliteDriver does for SQLite. It is the only module importing the client
 * and speaks nothing but the Driver interface upward. (DIP)
 *
 * Bun.SQL returns rows as objects; we project them to the positional RawResult
 * the dialect/domain expect. The one trade-off vs `rowMode: 'array'` is that
 * duplicate column names in ad-hoc SQL collapse — acceptable for a browser, and
 * never an issue for introspection/browse which select distinct columns.
 */

import { SQL } from 'bun';
import type { SqlDriver, RawResult, RunFn } from '../Driver.ts';
import { ConnectionError } from '../../../../domain/errors/errors.ts';

/** Discrete connection fields, or a full connection string (which wins). */
export interface PgConnectConfig {
  readonly host?: string;
  readonly port?: number;
  readonly user?: string;
  readonly password?: string;
  readonly database?: string;
  readonly connectionString?: string;
}

/** A Bun.SQL result array carries `count`/`command` metadata alongside rows. */
type SqlRows = Record<string, unknown>[] & {
  readonly count?: number;
  readonly command?: string;
};

/** Project Bun.SQL's object rows into the positional RawResult. */
const toRaw = (rows: SqlRows): RawResult => {
  const columns = rows.length > 0 ? Object.keys(rows[0]!) : [];
  return {
    columns,
    rows: rows.map((r) => columns.map((c) => r[c])),
    affected: typeof rows.count === 'number' ? rows.count : undefined,
  };
};

export class PgDriver implements SqlDriver {
  private sql: SQL | null = null;

  constructor(private readonly config: PgConnectConfig) {}

  async connect(): Promise<void> {
    // max: 1, not a pool: a pool scatters statements across backends, so
    // session-scoped state (TEMP tables, SET/search_path, multi-statement
    // BEGIN…COMMIT) would vanish between queries. Single-user UI ⇒ serialised.
    const common = { adapter: 'postgres' as const, max: 1, connectionTimeout: 10 };
    const sql = this.config.connectionString
      ? new SQL({ url: this.config.connectionString, ...common })
      : new SQL({
          ...common,
          hostname: this.config.host ?? 'localhost',
          port: this.config.port ?? 5432,
          user: this.config.user,
          password: this.config.password,
          database: this.config.database,
        });
    // Force a real round-trip so auth/host errors surface here, eagerly, rather
    // than lazily on the first browse.
    await sql`select 1`;
    this.sql = sql;
  }

  async disconnect(): Promise<void> {
    await this.sql?.end();
    this.sql = null;
  }

  async ping(): Promise<boolean> {
    try {
      await this.require()`select 1`;
      return true;
    } catch {
      return false;
    }
  }

  async run(text: string, params: ReadonlyArray<unknown>): Promise<RawResult> {
    const rows = (await this.require().unsafe(text, [...params])) as SqlRows;
    return toRaw(rows);
  }

  async transaction<T>(fn: (run: RunFn) => Promise<T>): Promise<T> {
    return this.require().begin(async (tx: SQL) => {
      const run: RunFn = async (text, params) =>
        toRaw((await tx.unsafe(text, [...params])) as SqlRows);
      return fn(run);
    });
  }

  private require(): SQL {
    if (!this.sql) throw new ConnectionError('pg driver not connected');
    return this.sql;
  }
}
