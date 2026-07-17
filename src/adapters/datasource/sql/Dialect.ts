/**
 * Dialect — the Strategy that encapsulates per-database SQL differences
 * (identifier quoting, pagination syntax, introspection queries, result
 * parsing). `SqlDataSource` is generic and delegates every dialect-specific
 * decision here. Adding ClickHouse/Postgres/MySQL = a new Dialect, with
 * `SqlDataSource` unchanged. (Strategy + OCP — docs/ARCHITECTURE.md §4.3)
 */

import type { Query, BrowseSpec, Filter } from '../../../domain/query/Query.ts';
import type {
  ObjectRef,
  ColumnDef,
  JsonKind,
} from '../../../domain/datasource/schema.ts';
import type { RowKey, RowPatch } from '../../../domain/datasource/edit.ts';
import type { CascadeDrop, WriteRefusal } from '../../../domain/datasource/DataSource.ts';
import type { DataSourceError } from '../../../domain/errors/errors.ts';
import type { RawResult } from './Driver.ts';

export interface Dialect {
  readonly id: string;

  /** Query listing browsable objects (tables/views). */
  listObjectsQuery(): Query;
  /** Parse the raw result of `listObjectsQuery` into object references. */
  parseObjects(raw: RawResult): ObjectRef[];

  /** Query describing one object's columns. */
  describeQuery(ref: ObjectRef): Query;
  /** Parse the raw result of `describeQuery` into column definitions. */
  parseColumns(raw: RawResult): ColumnDef[];

  /** The declared-JSON marker for a type name of this dialect's database, or
   *  undefined when the type is not JSON. The single authority on "which types
   *  are JSON" — consumed by `parseColumns` (schema path) and by result-set
   *  typing over `RawResult.columnTypes` (query path). */
  jsonKindOfType(dataType: string): JsonKind | undefined;

  /** Query yielding one object's verbatim source/DDL as a single text cell
   *  (view's SELECT, index/trigger/routine definition). Called only for kinds
   *  whose `sectionsFor` includes 'source'. */
  sourceQuery(ref: ObjectRef): Query;

  /** Query reading one paginated, optionally sorted/filtered window of rows. */
  browseQuery(ref: ObjectRef, spec: BrowseSpec): Query;
  /** Query counting an object's rows under the same optional filter. */
  countQuery(ref: ObjectRef, filter?: Filter | null): Query;

  /** A quoted, schema-qualified DROP for `ref` — a display draft the UI runs,
   *  never executed here — or null for a kind this dialect can't drop directly
   *  (so it never silently emits a wrong `DROP TABLE` for an index/sequence). */
  dropQuery(ref: ObjectRef): Query | null;

  /** The CASCADE retry (and the dependents it will also drop) for a failed
   *  `dropSql` when `error` is this dialect's "dependent objects still exist"
   *  failure; null otherwise (wrong error, or no CASCADE in this dialect). Lets
   *  the UI offer the escalation, naming the casualties, only when it applies. */
  cascadeDrop(dropSql: string, error: DataSourceError): CascadeDrop | null;

  /** Structured facts for a row write refused by a constraint this dialect
   *  recognizes — currently the foreign-key "still referenced" refusal — or
   *  null (unrecognized error, or no such classification for this dialect).
   *  Lets the UI word the failure for a human instead of echoing the driver. */
  explainWriteError(error: DataSourceError): WriteRefusal | null;

  /** Parameterized DML — every value bound, never a write without a key. */
  insertQuery(ref: ObjectRef, row: RowPatch): Query;
  updateQuery(ref: ObjectRef, key: RowKey, patch: RowPatch): Query;
  deleteQuery(ref: ObjectRef, key: RowKey): Query;
}
