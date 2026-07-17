/**
 * PgDriver — SqlDriver backed by postgres.js (`postgres`).
 *
 * Client history, so it isn't relitigated: node-postgres (`pg`) is out — under
 * Bun (≤1.2.16) its SCRAM-SHA-256 handshake spins at 100% CPU forever. Bun's
 * built-in `Bun.SQL` (used until v0.1.23) is out too: it exposes no result
 * metadata (no RowDescription/OIDs — so ad-hoc query results can never be
 * typed, oven-sh/bun#15088 has no plan) and hangs the connection on composite
 * values (`SELECT ROW(1,'x')`). postgres.js authenticates SCRAM fine under
 * Bun, exposes `result.columns` with type OIDs, and is the API Bun.SQL was
 * modeled on — so swapping back later is cheap if Bun catches up. This is the
 * only module importing the client; everything above speaks Driver. (DIP)
 */

import postgres from 'postgres';
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

type Sql = ReturnType<typeof postgres>;

/** OID → PostgresDialect type-name vocabulary. Only types a consumer actually
 *  reads are mapped (null = unknown is the contract); extend as needs grow. */
const PG_TYPE_NAMES: Record<number, string> = {
  114: 'json',
  3802: 'jsonb',
};

/** Positional `.values()` rows + column metadata into RawResult. `count` is
 *  the affected-row count for writes (for SELECT it is just the row count,
 *  which consumers ignore — same shape the previous client reported). */
const toRaw = (result: {
  readonly columns?: readonly { name: string; type: number }[];
  readonly count?: number;
  slice(): unknown[];
}): RawResult => {
  const cols = result.columns ?? [];
  return {
    columns: cols.map((c) => c.name),
    columnTypes: cols.map((c) => PG_TYPE_NAMES[c.type] ?? null),
    rows: result.slice() as unknown[][],
    affected: typeof result.count === 'number' ? result.count : undefined,
  };
};

export class PgDriver implements SqlDriver {
  private sql: Sql | null = null;

  constructor(private readonly config: PgConnectConfig) {}

  async connect(): Promise<void> {
    // max: 1, not a pool: a pool scatters statements across backends, so
    // session-scoped state (TEMP tables, SET/search_path, multi-statement
    // BEGIN…COMMIT) would vanish between queries. Single-user UI ⇒ serialised.
    // onnotice: postgres.js logs server NOTICEs to console by default — the
    // TUI owns the screen, so swallow them (the statement result is unaffected).
    const common = { max: 1, connect_timeout: 10, onnotice: () => {} };
    const sql = this.config.connectionString
      ? postgres(this.config.connectionString, common)
      : postgres({
          ...common,
          host: this.config.host ?? 'localhost',
          port: this.config.port ?? 5432,
          username: this.config.user,
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
    return toRaw(await this.require().unsafe(text, [...params] as never[]).values());
  }

  async transaction<T>(fn: (run: RunFn) => Promise<T>): Promise<T> {
    return this.require().begin(async (tx) => {
      const run: RunFn = async (text, params) =>
        toRaw(await tx.unsafe(text, [...params] as never[]).values());
      return fn(run);
    }) as Promise<T>;
  }

  private require(): Sql {
    if (!this.sql) throw new ConnectionError('pg driver not connected');
    return this.sql;
  }
}
