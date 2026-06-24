/**
 * MySqlDriver — SqlDriver backed by mysql2 (works with MySQL and MariaDB). Uses
 * the text-protocol `query()` with `rowsAsArray` so rows come back positional,
 * matching RawResult directly. Only this module imports mysql2. (DIP)
 */

import { createPool } from 'mysql2/promise';
import type { Pool, FieldPacket } from 'mysql2/promise';
import type { PoolOptions } from 'mysql2';
import type { SqlDriver, RawResult } from '../Driver.ts';
import { ConnectionError } from '../../../../domain/errors/errors.ts';

export class MySqlDriver implements SqlDriver {
  private pool: Pool | null = null;

  constructor(private readonly config: PoolOptions | string) {}

  async connect(): Promise<void> {
    this.pool =
      typeof this.config === 'string'
        ? createPool(this.config)
        : createPool({ connectionLimit: 4, ...this.config });
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
    // SELECT → array of positional rows + field metadata.
    if (Array.isArray(result)) {
      const columns = ((fields ?? []) as FieldPacket[]).map((f) => f.name);
      return { columns, rows: result as unknown[][] };
    }
    // INSERT/UPDATE/DDL → a ResultSetHeader carrying affectedRows.
    const header = result as { affectedRows?: number };
    return { columns: [], rows: [], affected: header.affectedRows };
  }

  private requirePool(): Pool {
    if (!this.pool) throw new ConnectionError('mysql driver not connected');
    return this.pool;
  }
}
