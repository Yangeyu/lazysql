/**
 * BunSqliteDriver — SqlDriver backed by Bun's built-in `bun:sqlite`. Zero native
 * install. This is the only module that imports the sqlite client; everything
 * above it speaks the Driver interface, so swapping to better-sqlite3 or
 * node:sqlite is a one-file change. (DIP)
 */

import { Database, type SQLQueryBindings } from 'bun:sqlite';
import type { SqlDriver, RawResult, RunFn } from '../Driver.ts';
import { ConnectionError } from '../../../../domain/errors/errors.ts';

export class BunSqliteDriver implements SqlDriver {
  private db: Database | null = null;

  constructor(private readonly file: string) {}

  async connect(): Promise<void> {
    this.db = new Database(this.file, { readwrite: true, create: false });
  }

  async disconnect(): Promise<void> {
    this.db?.close();
    this.db = null;
  }

  async ping(): Promise<boolean> {
    try {
      this.requireDb().query('SELECT 1').get();
      return true;
    } catch {
      return false;
    }
  }

  async run(
    text: string,
    params: ReadonlyArray<unknown>,
  ): Promise<RawResult> {
    const db = this.requireDb();
    const stmt = db.query(text);
    // Driver edge: domain passes opaque `unknown[]`; sqlite accepts scalar
    // bindings. The cast is contained to this single boundary.
    const bind = params as SQLQueryBindings[];

    if (returnsRows(text)) {
      const objs = stmt.all(...bind) as Array<Record<string, unknown>>;
      const columns = columnNamesOf(stmt, objs);
      const rows = objs.map((o) => columns.map((c) => o[c] ?? null));
      return { columns, rows };
    }

    const res = stmt.run(...bind);
    return { columns: [], rows: [], affected: res.changes };
  }

  async transaction<T>(fn: (run: RunFn) => Promise<T>): Promise<T> {
    const db = this.requireDb();
    // bun:sqlite is a single connection, so BEGIN/COMMIT scope it directly.
    db.run('BEGIN');
    try {
      const result = await fn((text, params) => this.run(text, params));
      db.run('COMMIT');
      return result;
    } catch (e) {
      try {
        db.run('ROLLBACK');
      } catch {
        /* already rolled back / not in a tx */
      }
      throw e;
    }
  }

  private requireDb(): Database {
    if (!this.db) throw new ConnectionError('sqlite driver not connected');
    return this.db;
  }
}

/** Heuristic: which statements yield a result set worth reading. */
const returnsRows = (text: string): boolean =>
  /^\s*(select|pragma|with|explain)/i.test(text);

/** Prefer the prepared statement's authoritative column order; fall back to
 *  the first row's keys (insertion order matches column order in SQLite). */
const columnNamesOf = (
  stmt: { columnNames?: string[] },
  objs: Array<Record<string, unknown>>,
): string[] => {
  const declared = stmt.columnNames;
  if (declared && declared.length > 0) return declared;
  return objs.length > 0 ? Object.keys(objs[0]!) : [];
};
