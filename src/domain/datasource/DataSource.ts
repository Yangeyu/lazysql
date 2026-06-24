/**
 * The DataSource port — the central abstraction of lazysql.
 *
 * `DataSource` is the minimal common surface every source implements. Richer
 * behaviour is split into segregated capability interfaces (ISP): a source
 * implements only what it can do and advertises it via `capabilities()`.
 * The application/presentation layers depend on these interfaces, never on a
 * concrete adapter (DIP). See docs/ARCHITECTURE.md §4 and docs/adr/0002.
 */

import type { CapabilitySet } from './capabilities.ts';
import type { ResultSet } from './ResultSet.ts';
import type { SchemaSnapshot, ObjectRef, ObjectSchema } from './schema.ts';
import type { RowKey, RowPatch, EditResult } from './edit.ts';
import type { Query, BrowseSpec, Filter } from '../query/Query.ts';
import type { Result } from '../../shared/Result.ts';
import type { ConnectionError } from '../errors/errors.ts';

export type SourceId = string;

/** Minimal base surface — lifecycle + capability discovery. */
export interface DataSource {
  readonly id: SourceId;
  connect(): Promise<Result<void, ConnectionError>>;
  disconnect(): Promise<void>;
  ping(): Promise<boolean>;
  capabilities(): CapabilitySet;
}

// ── Segregated capability interfaces ──────────────────────────────────────

/** Execute a raw query/command and return a unified ResultSet. */
export interface Queryable {
  execute(query: Query, signal?: AbortSignal): Promise<ResultSet>;
}

/** Enumerate the source's browsable objects and their columns. */
export interface SchemaIntrospectable {
  introspect(): Promise<SchemaSnapshot>;
  describe(ref: ObjectRef): Promise<ObjectSchema>;
}

/**
 * Read a paginated window of an object's rows — the source-agnostic browse
 * path. SQL adapters implement it via their Dialect's pagination; Mongo via
 * find().skip().limit(). The use case calls this and never builds a query.
 */
export interface Browsable {
  browse(
    ref: ObjectRef,
    spec: BrowseSpec,
    signal?: AbortSignal,
  ): Promise<ResultSet>;
  /** Exact total row count under the same optional filter, for paging UI. */
  count(
    ref: ObjectRef,
    filter?: Filter | null,
    signal?: AbortSignal,
  ): Promise<number>;
}

/** Row/document level writes. Every method targets a single row via its key. */
export interface RowEditable {
  insert(ref: ObjectRef, row: RowPatch): Promise<EditResult>;
  update(ref: ObjectRef, key: RowKey, patch: RowPatch): Promise<EditResult>;
  delete(ref: ObjectRef, key: RowKey): Promise<EditResult>;
}

/** A scoped execution handle inside a transaction. */
export interface Tx {
  execute(query: Query): Promise<ResultSet>;
}

/** begin/commit/rollback around a unit of work. */
export interface Transactional {
  transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
}

// (Streamable arrives in a later phase — the model is designed for it now so
//  adding it touches no existing code.)

// ── Type guards: narrow a DataSource to a capability ──────────────────────

export const asQueryable = (s: DataSource): (DataSource & Queryable) | null =>
  typeof (s as Partial<Queryable>).execute === 'function'
    ? (s as DataSource & Queryable)
    : null;

export const asIntrospectable = (
  s: DataSource,
): (DataSource & SchemaIntrospectable) | null =>
  typeof (s as Partial<SchemaIntrospectable>).introspect === 'function'
    ? (s as DataSource & SchemaIntrospectable)
    : null;

export const asBrowsable = (s: DataSource): (DataSource & Browsable) | null =>
  typeof (s as Partial<Browsable>).browse === 'function'
    ? (s as DataSource & Browsable)
    : null;

export const asRowEditable = (
  s: DataSource,
): (DataSource & RowEditable) | null =>
  typeof (s as Partial<RowEditable>).update === 'function'
    ? (s as DataSource & RowEditable)
    : null;

export const asTransactional = (
  s: DataSource,
): (DataSource & Transactional) | null =>
  typeof (s as Partial<Transactional>).transaction === 'function'
    ? (s as DataSource & Transactional)
    : null;
