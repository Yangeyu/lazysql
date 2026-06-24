/**
 * SqlDataSource — a generic SQL adapter implementing the DataSource port and
 * its Query/Introspect/Browse capabilities. It holds a Driver (transport) and a
 * Dialect (SQL differences) and contains NO database-specific SQL itself.
 * Postgres/MySQL reuse this class verbatim with a different Dialect + Driver.
 * (SRP + OCP + DIP — docs/ARCHITECTURE.md §4.3)
 */

import type {
  DataSource,
  Queryable,
  SchemaIntrospectable,
  Browsable,
  SourceId,
} from '../../../domain/datasource/DataSource.ts';
import {
  Capability,
  CapabilitySet,
} from '../../../domain/datasource/capabilities.ts';
import type {
  ResultSet,
  CellValue,
} from '../../../domain/datasource/ResultSet.ts';
import type {
  SchemaSnapshot,
  ObjectSchema,
  ObjectRef,
} from '../../../domain/datasource/schema.ts';
import type { Query, Page } from '../../../domain/query/Query.ts';
import { ConnectionError, QueryError } from '../../../domain/errors/errors.ts';
import { ok, err, type Result } from '../../../shared/Result.ts';
import type { SqlDriver, RawResult } from './Driver.ts';
import type { Dialect } from './Dialect.ts';

export class SqlDataSource
  implements DataSource, Queryable, SchemaIntrospectable, Browsable
{
  constructor(
    readonly id: SourceId,
    private readonly driver: SqlDriver,
    private readonly dialect: Dialect,
  ) {}

  // ── DataSource ──────────────────────────────────────────────────────────

  async connect(): Promise<Result<void, ConnectionError>> {
    try {
      await this.driver.connect();
      if (!(await this.driver.ping())) {
        return err(new ConnectionError(`connection check failed: ${this.id}`));
      }
      return ok(undefined);
    } catch (cause) {
      return err(new ConnectionError(`failed to connect: ${this.id}`, cause));
    }
  }

  disconnect(): Promise<void> {
    return this.driver.disconnect();
  }

  ping(): Promise<boolean> {
    return this.driver.ping();
  }

  capabilities(): CapabilitySet {
    return new CapabilitySet([
      Capability.Query,
      Capability.SchemaIntrospect,
      Capability.Browse,
    ]);
  }

  // ── Queryable ───────────────────────────────────────────────────────────

  async execute(query: Query, signal?: AbortSignal): Promise<ResultSet> {
    throwIfAborted(signal);
    const raw = await this.runQuery(query);
    return toResultSet(raw);
  }

  // ── SchemaIntrospectable ────────────────────────────────────────────────

  async introspect(): Promise<SchemaSnapshot> {
    const raw = await this.runQuery(this.dialect.listObjectsQuery());
    return { objects: this.dialect.parseObjects(raw) };
  }

  async describe(ref: ObjectRef): Promise<ObjectSchema> {
    const raw = await this.runQuery(this.dialect.describeQuery(ref));
    return { ref, columns: this.dialect.parseColumns(raw) };
  }

  // ── Browsable ───────────────────────────────────────────────────────────

  async browse(
    ref: ObjectRef,
    page: Page,
    signal?: AbortSignal,
  ): Promise<ResultSet> {
    throwIfAborted(signal);
    const raw = await this.runQuery(this.dialect.browseQuery(ref, page));
    const rs = toResultSet(raw);
    // A full page implies there may be more rows beyond this window.
    return { ...rs, truncated: rs.rows.length >= page.limit };
  }

  async count(ref: ObjectRef, signal?: AbortSignal): Promise<number> {
    throwIfAborted(signal);
    const raw = await this.runQuery(this.dialect.countQuery(ref));
    return Number(raw.rows[0]?.[0] ?? 0);
  }

  // ── internals ───────────────────────────────────────────────────────────

  private async runQuery(query: Query): Promise<RawResult> {
    try {
      return await this.driver.run(query.text, query.params ?? []);
    } catch (cause) {
      throw new QueryError(`query failed: ${truncate(query.text)}`, cause);
    }
  }
}

const throwIfAborted = (signal?: AbortSignal): void => {
  if (signal?.aborted) throw new QueryError('operation aborted');
};

const truncate = (text: string): string =>
  text.length > 80 ? `${text.slice(0, 77)}...` : text;

const toResultSet = (raw: RawResult): ResultSet => ({
  shape: 'tabular',
  columns: raw.columns.map((name) => ({ name })),
  rows: raw.rows.map((r) => r.map(normalizeCell)),
  affected: raw.affected,
  truncated: false,
});

const normalizeCell = (v: unknown): CellValue => {
  if (v === undefined || v === null) return null;
  if (
    typeof v === 'string' ||
    typeof v === 'number' ||
    typeof v === 'boolean' ||
    typeof v === 'bigint' ||
    v instanceof Uint8Array
  ) {
    return v;
  }
  return String(v);
};
