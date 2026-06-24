/**
 * SqlDriver — the thinnest possible wrapper over a concrete SQL client. It is
 * the ONLY place a specific client library (bun:sqlite, pg, mysql2) is imported.
 * It knows nothing about dialects, domain models, or pagination. (SRP)
 */

export interface RawResult {
  /** Ordered column names. */
  readonly columns: string[];
  /** Positional rows aligned to `columns`. */
  readonly rows: unknown[][];
  /** Rows affected by a write, when applicable. */
  readonly affected?: number;
}

/** Runs a statement on a specific connection (used inside a transaction). */
export type RunFn = (
  text: string,
  params: ReadonlyArray<unknown>,
) => Promise<RawResult>;

export interface SqlDriver {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  ping(): Promise<boolean>;
  /** Execute SQL with positional params and return raw columns + rows. */
  run(text: string, params: ReadonlyArray<unknown>): Promise<RawResult>;
  /**
   * Run `fn` inside a transaction on a single dedicated connection. Commits if
   * it resolves, rolls back if it throws. The `run` passed to `fn` executes on
   * that same connection — essential for pooled drivers (pg/mysql).
   */
  transaction<T>(fn: (run: RunFn) => Promise<T>): Promise<T>;
}
