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
  BrowsePreviewable,
  CascadeDrop,
  RowEditable,
  WriteErrorExplainable,
  WriteRefusal,
  Transactional,
  Tx,
  SourceId,
  SqlDumpable,
} from '../../../domain/datasource/DataSource.ts';
import {
  Capability,
  CapabilitySet,
} from '../../../domain/datasource/capabilities.ts';
import type {
  ResultSet,
  CellValue,
  ColumnMeta,
  Row,
} from '../../../domain/datasource/ResultSet.ts';
import type {
  SchemaSnapshot,
  ObjectSchema,
  ObjectRef,
  DetailSection,
} from '../../../domain/datasource/schema.ts';
import { sectionsFor } from '../../../domain/datasource/schema.ts';
import type {
  RowKey,
  RowPatch,
  EditResult,
} from '../../../domain/datasource/edit.ts';
import type { Query, BrowseSpec, Filter } from '../../../domain/query/Query.ts';
import {
  ConnectionError,
  DataSourceError,
  QueryError,
} from '../../../domain/errors/errors.ts';
import { ok, err, type Result } from '../../../shared/Result.ts';
import type { SqlDriver, RawResult } from './Driver.ts';
import type { Dialect } from './Dialect.ts';
import { inlineParams } from './inlineParams.ts';
import { renderInsertStatements } from './sqlDump.ts';

export class SqlDataSource
  implements
    DataSource,
    Queryable,
    SchemaIntrospectable,
    Browsable,
    BrowsePreviewable,
    RowEditable,
    WriteErrorExplainable,
    Transactional,
    SqlDumpable
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
      // Surface the driver's own message (e.g. "password authentication
      // failed") so the user can actually diagnose the failure, not just see
      // an opaque wrapper.
      const detail = cause instanceof Error ? `: ${cause.message}` : '';
      return err(
        new ConnectionError(`failed to connect (${this.id})${detail}`, cause),
      );
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
      Capability.BrowsePreview,
      Capability.DdlScript,
      Capability.RowEdit,
      Capability.Transaction,
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
    // Assemble exactly the sections this kind exposes (sectionsFor) by running
    // the dialect query for each: columns for relations, the verbatim DDL for
    // source-only objects (and both, for a view).
    const detail = await Promise.all(
      sectionsFor(ref.kind).map(
        async (kind): Promise<DetailSection> =>
          kind === 'columns'
            ? { kind, columns: this.dialect.parseColumns(await this.runQuery(this.dialect.describeQuery(ref))) }
            : { kind, text: firstCell(await this.runQuery(this.dialect.sourceQuery(ref))) },
      ),
    );
    return { ref, detail };
  }

  // ── Browsable ───────────────────────────────────────────────────────────

  async browse(
    ref: ObjectRef,
    spec: BrowseSpec,
    signal?: AbortSignal,
  ): Promise<ResultSet> {
    throwIfAborted(signal);
    const raw = await this.runQuery(this.dialect.browseQuery(ref, spec));
    const rs = toResultSet(raw);
    // A full page implies there may be more rows beyond this window.
    return { ...rs, truncated: rs.rows.length >= spec.page.limit };
  }

  async count(
    ref: ObjectRef,
    filter?: Filter | null,
    signal?: AbortSignal,
  ): Promise<number> {
    throwIfAborted(signal);
    const raw = await this.runQuery(this.dialect.countQuery(ref, filter));
    return Number(raw.rows[0]?.[0] ?? 0);
  }

  // ── BrowsePreviewable / EditPreviewable ───────────────────────────────────

  /** The exact statement `browse()` runs, value-inlined for display (never run).
   *  Derives from the dialect's `browseQuery`, so the echo can never drift from
   *  what actually executes. */
  previewBrowse(ref: ObjectRef, spec: BrowseSpec): string {
    return inlineParams(this.dialect.browseQuery(ref, spec));
  }

  /** The exact statements `update()`/`delete()` run, value-inlined for the y/n
   *  confirm — same dialect builders as the write itself, so the approved text
   *  and the executed SQL cannot drift. */
  previewUpdate(ref: ObjectRef, key: RowKey, patch: RowPatch): string {
    return inlineParams(this.dialect.updateQuery(ref, key, patch));
  }

  previewDelete(ref: ObjectRef, key: RowKey): string {
    return inlineParams(this.dialect.deleteQuery(ref, key));
  }

  // ── DdlScriptable ─────────────────────────────────────────────────────────

  /** A quoted, schema-qualified DROP for `ref` — the dialect handles reserved
   *  words, so dropping an object named `window` is correct. Null when the
   *  dialect has no standalone DROP for this kind (e.g. an index/sequence). */
  dropStatement(ref: ObjectRef): string | null {
    return this.dialect.dropQuery(ref)?.text ?? null;
  }

  cascadeRetry(dropSql: string, error: DataSourceError): CascadeDrop | null {
    return this.dialect.cascadeDrop(dropSql, error);
  }

  // ── SqlDumpable ───────────────────────────────────────────────────────────

  /** Runnable `INSERT` statements for `rows`, quoted via the dialect. */
  insertDump(ref: ObjectRef, columns: readonly ColumnMeta[], rows: readonly Row[]): string {
    return renderInsertStatements(this.dialect, ref, columns, rows);
  }

  // ── Transactional ─────────────────────────────────────────────────────────

  transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.driver.transaction(async (run) => {
      const tx: Tx = {
        // Same QueryError boundary as execute()/runQuery — without it a driver
        // failure inside a transaction (e.g. an FK-refused delete) escapes raw,
        // losing the code/detail the dialects classify on.
        execute: async (query) => {
          try {
            return toResultSet(await run(query.text, query.params ?? []));
          } catch (cause) {
            throw asQueryError(cause);
          }
        },
      };
      return fn(tx);
    });
  }

  // ── RowEditable ───────────────────────────────────────────────────────────

  insert(ref: ObjectRef, row: RowPatch): Promise<EditResult> {
    return this.writeOne(this.dialect.insertQuery(ref, row), 'insert');
  }

  update(ref: ObjectRef, key: RowKey, patch: RowPatch): Promise<EditResult> {
    return this.writeOne(this.dialect.updateQuery(ref, key, patch), 'update');
  }

  delete(ref: ObjectRef, key: RowKey): Promise<EditResult> {
    return this.writeOne(this.dialect.deleteQuery(ref, key), 'delete');
  }

  explainWriteError(error: DataSourceError): WriteRefusal | null {
    return this.dialect.explainWriteError(error);
  }

  /** Run a single-row write in a transaction; roll back unless it affects 1 row.
   *  This is the safety guard: a write that would hit 0 or many rows is undone. */
  private writeOne(query: Query, op: string): Promise<EditResult> {
    return this.transaction(async (tx) => {
      const rs = await tx.execute(query);
      const affected = rs.affected ?? 0;
      if (affected !== 1) {
        throw new QueryError(
          `${op} affected ${affected} rows (expected 1); rolled back`,
        );
      }
      return { affected };
    });
  }

  // ── internals ───────────────────────────────────────────────────────────

  private async runQuery(query: Query): Promise<RawResult> {
    try {
      return await this.driver.run(query.text, query.params ?? []);
    } catch (cause) {
      throw asQueryError(cause);
    }
  }
}

/** Wrap a driver failure as a QueryError carrying the native code + detail.
 *  Surfaces the driver's real message: the failing SQL is already echoed, so
 *  restating it (the obvious move) tells the user nothing. */
const asQueryError = (cause: unknown): QueryError =>
  new QueryError(reasonOf(cause), {
    cause,
    code: codeOf(cause),
    detail: detailOf(cause),
  });

/** The first cell of a raw result as text — a `sourceQuery` returns one DDL
 *  string in one row, one column; empty when the object yields nothing. */
const firstCell = (raw: RawResult): string => String(raw.rows[0]?.[0] ?? '');

const reasonOf = (cause: unknown): string => {
  const message = cause instanceof Error ? cause.message.trim() : String(cause);
  return message.length > 0 ? message : 'query failed';
};

/** The driver's native error code, so a dialect can recognise a specific failure
 *  without parsing the message. Bun.SQL's PostgresError carries the SQLSTATE
 *  ('2BP01') in `errno` — `code` there is a generic 'ERR_POSTGRES_SERVER_ERROR' —
 *  so prefer `errno`, falling back to `code` for drivers (mysql2) that put a
 *  stable string there instead. */
const codeOf = (cause: unknown): string | undefined => {
  const e = cause as { code?: unknown; errno?: unknown };
  if (typeof e?.errno === 'string') return e.errno;
  if (typeof e?.code === 'string') return e.code;
  return undefined;
};

/** The driver's supplementary explanation (Bun.SQL/pg expose `detail`), e.g. the
 *  newline-listed objects that block a DROP — the dialect parses it for the UI. */
const detailOf = (cause: unknown): string | undefined => {
  const detail = (cause as { detail?: unknown })?.detail;
  return typeof detail === 'string' && detail.length > 0 ? detail : undefined;
};

const throwIfAborted = (signal?: AbortSignal): void => {
  if (signal?.aborted) throw new QueryError('operation aborted');
};

const toResultSet = (raw: RawResult): ResultSet => ({
  shape: 'tabular',
  columns: raw.columns.map((name) => ({ name })),
  rows: raw.rows.map((r) => r.map(normalizeCell)),
  affected: raw.affected,
  truncated: false,
});

export const normalizeCell = (v: unknown): CellValue => {
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
  if (v instanceof Date) return v.toISOString();
  // Structured values (a JSON/JSONB column surfaces as a JS object/array via the
  // driver) become faithful JSON — NOT a useless "[object Object]". The cell
  // inspector then detects it (looksLikeJson) and pretty-prints it.
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
};
