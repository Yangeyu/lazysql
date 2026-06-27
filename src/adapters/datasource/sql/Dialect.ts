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
} from '../../../domain/datasource/schema.ts';
import type { RowKey, RowPatch } from '../../../domain/datasource/edit.ts';
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

  /** Query yielding one object's verbatim source/DDL as a single text cell
   *  (view's SELECT, index/trigger/routine definition). Called only for kinds
   *  whose `sectionsFor` includes 'source'. */
  sourceQuery(ref: ObjectRef): Query;

  /** Query reading one paginated, optionally sorted/filtered window of rows. */
  browseQuery(ref: ObjectRef, spec: BrowseSpec): Query;
  /** Query counting an object's rows under the same optional filter. */
  countQuery(ref: ObjectRef, filter?: Filter | null): Query;

  /** A `DROP TABLE`/`DROP VIEW` statement for `ref` with the identifier quoted and
   *  schema-qualified — a display draft the UI runs, never executed here. */
  dropQuery(ref: ObjectRef): Query;

  /** Parameterized DML — every value bound, never a write without a key. */
  insertQuery(ref: ObjectRef, row: RowPatch): Query;
  updateQuery(ref: ObjectRef, key: RowKey, patch: RowPatch): Query;
  deleteQuery(ref: ObjectRef, key: RowKey): Query;
}
