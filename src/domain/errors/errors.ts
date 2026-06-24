/** Typed domain errors so callers can branch on failure kind, not message text. */

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

/** A query/command failed to execute. */
export class QueryError extends DataSourceError {}

/** The source does not support the requested capability. */
export class UnsupportedCapabilityError extends DataSourceError {}
