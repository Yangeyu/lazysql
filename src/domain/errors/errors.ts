/** Typed domain errors so callers can branch on failure kind, not message text. */

import { ok, err, type Result } from '../../shared/Result.ts';

export class DataSourceError extends Error {
  constructor(message: string, cause?: unknown) {
    // Forward `cause` to the standard Error.cause (ES2022) rather than
    // redeclaring it, so subclasses stay free of override conflicts.
    super(message, cause === undefined ? undefined : { cause });
    this.name = new.target.name;
  }
}

/** Failed to establish or verify a connection. */
export class ConnectionError extends DataSourceError {}

/**
 * A query/command failed to execute. `code` carries the driver's native error
 * code (e.g. a Postgres SQLSTATE like `2BP01`) so callers branch on failure kind
 * without matching message text; `detail` carries the driver's supplementary
 * explanation (e.g. Postgres' newline-listed dependent objects on a blocked DROP).
 */
export class QueryError extends DataSourceError {
  constructor(
    message: string,
    options?: { cause?: unknown; code?: string; detail?: string },
  ) {
    super(message, options?.cause);
    this.code = options?.code;
    this.detail = options?.detail;
  }

  readonly code?: string;
  readonly detail?: string;
}

/** The source does not support the requested capability. */
export class UnsupportedCapabilityError extends DataSourceError {}

/** Coerce an unknown thrown value to a DataSourceError, passing one through
 *  untouched — the boundary helper use cases wrap adapter calls with. */
export const toDataSourceError = (e: unknown): DataSourceError =>
  e instanceof DataSourceError
    ? e
    : new DataSourceError(e instanceof Error ? e.message : String(e));

/** Run an adapter call inside the Result boundary: ok(value) on success, any
 *  throw trapped as err(toDataSourceError). Use cases wrap every capability
 *  call with this so a rejection can never escape to the UI. */
export const attempt = async <T>(
  fn: () => Promise<T>,
): Promise<Result<T, DataSourceError>> => {
  try {
    return ok(await fn());
  } catch (e) {
    return err(toDataSourceError(e));
  }
};

/** An export failed to write its destination (open / write / rename / close). */
export class ExportError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = new.target.name;
  }
}
