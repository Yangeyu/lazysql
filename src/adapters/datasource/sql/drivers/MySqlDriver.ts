/**
 * MySqlDriver — SqlDriver backed by mysql2 (works with MySQL and MariaDB). Uses
 * the text-protocol `query()` with `rowsAsArray` so rows come back positional,
 * matching RawResult directly. Only this module imports mysql2. (DIP)
 */

import { createPool } from 'mysql2/promise';
import type { Pool, FieldPacket } from 'mysql2/promise';
import type { PoolOptions } from 'mysql2';
import type { SqlDriver, RawResult, RunFn } from '../Driver.ts';
import { ConnectionError } from '../../../../domain/errors/errors.ts';

export class MySqlDriver implements SqlDriver {
  private pool: Pool | null = null;

  constructor(private readonly config: PoolOptions | string) {}

  async connect(): Promise<void> {
    // connectionLimit: 1, not a pool: a pool scatters statements across
    // sessions, so session-scoped state (TEMP tables, SET/@vars, multi-statement
    // BEGIN…COMMIT) would vanish between queries. Single-user UI ⇒ serialised.
    this.pool =
      typeof this.config === 'string'
        ? createPool(this.config)
        : createPool({ connectionLimit: 1, ...this.config });
    const conn = await this.pool.getConnection();
    conn.release();
  }

  async disconnect(): Promise<void> {
    await this.pool?.end();
    this.pool = null;
  }

  async ping(): Promise<boolean> {
    try {
      const conn = await this.requirePool().getConnection();
      await conn.ping();
      conn.release();
      return true;
    } catch {
      return false;
    }
  }

  async run(
    text: string,
    params: ReadonlyArray<unknown>,
  ): Promise<RawResult> {
    const [result, fields] = await this.requirePool().query({
      sql: text,
      values: params as unknown[],
      rowsAsArray: true,
    });
    return toRaw(result, fields);
  }

  async transaction<T>(fn: (run: RunFn) => Promise<T>): Promise<T> {
    const conn = await this.requirePool().getConnection();
    const run: RunFn = async (text, params) => {
      const [result, fields] = await conn.query({
        sql: text,
        values: params as unknown[],
        rowsAsArray: true,
      });
      return toRaw(result, fields);
    };
    try {
      await conn.beginTransaction();
      const out = await fn(run);
      await conn.commit();
      return out;
    } catch (e) {
      await conn.rollback().catch(() => {});
      throw e;
    } finally {
      conn.release();
    }
  }

  private requirePool(): Pool {
    if (!this.pool) throw new ConnectionError('mysql driver not connected');
    return this.pool;
  }
}

/** Wire type code → MySqlDialect type-name vocabulary. Only types a consumer
 *  actually reads are mapped (null = unknown is the contract). */
const MYSQL_TYPE_NAMES: Record<number, string> = {
  245: 'json', // MYSQL_TYPE_JSON — declared JSON columns and JSON expressions
};

/** Map a mysql2 result into RawResult: SELECT → rows, write → affectedRows. */
const toRaw = (result: unknown, fields: FieldPacket[] | undefined): RawResult => {
  if (Array.isArray(result)) {
    const packets = (fields ?? []) as FieldPacket[];
    return {
      columns: packets.map((f) => f.name),
      columnTypes: packets.map((f) => MYSQL_TYPE_NAMES[f.type ?? -1] ?? null),
      rows: result as unknown[][],
    };
  }
  const header = result as { affectedRows?: number };
  return { columns: [], rows: [], affected: header.affectedRows };
};
