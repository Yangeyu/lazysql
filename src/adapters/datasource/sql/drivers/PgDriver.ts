/**
 * PgDriver — SqlDriver backed by node-postgres (`pg`) over TCP. Like
 * BunSqliteDriver, it is the only module importing its client library and
 * speaks nothing but the Driver interface upward. `rowMode: 'array'` makes pg
 * return positional rows directly, matching RawResult with no remapping. (DIP)
 */

import { Pool, type PoolConfig } from 'pg';
import type { SqlDriver, RawResult } from '../Driver.ts';
import { ConnectionError } from '../../../../domain/errors/errors.ts';

export class PgDriver implements SqlDriver {
  private pool: Pool | null = null;

  constructor(private readonly config: PoolConfig) {}

  async connect(): Promise<void> {
    this.pool = new Pool({ max: 4, ...this.config });
    // Acquire once to surface auth/host errors eagerly.
    const client = await this.pool.connect();
    client.release();
  }

  async disconnect(): Promise<void> {
    await this.pool?.end();
    this.pool = null;
  }

  async ping(): Promise<boolean> {
    try {
      await this.requirePool().query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  async run(
    text: string,
    params: ReadonlyArray<unknown>,
  ): Promise<RawResult> {
    const res = await this.requirePool().query({
      text,
      values: params as unknown[],
      rowMode: 'array',
    });
    return {
      columns: res.fields.map((f) => f.name),
      rows: res.rows as unknown[][],
      affected: res.rowCount ?? undefined,
    };
  }

  private requirePool(): Pool {
    if (!this.pool) throw new ConnectionError('pg driver not connected');
    return this.pool;
  }
}
