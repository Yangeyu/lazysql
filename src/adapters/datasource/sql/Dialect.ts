/**
 * Dialect — the Strategy that encapsulates per-database SQL differences
 * (identifier quoting, pagination syntax, introspection queries, result
 * parsing). `SqlDataSource` is generic and delegates every dialect-specific
 * decision here. Adding ClickHouse/Postgres/MySQL = a new Dialect, with
 * `SqlDataSource` unchanged. (Strategy + OCP — docs/ARCHITECTURE.md §4.3)
 */

import type { Query, BrowseSpec } from '../../../domain/query/Query.ts';
import type {
  ObjectRef,
  ColumnDef,
} from '../../../domain/datasource/schema.ts';
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

  /** Query reading one paginated (and optionally sorted) window of rows. */
  browseQuery(ref: ObjectRef, spec: BrowseSpec): Query;
  /** Query counting an object's rows. */
  countQuery(ref: ObjectRef): Query;
}
