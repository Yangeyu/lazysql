/**
 * SqliteDialect — every SQLite-specific SQL string lives here and nowhere else.
 * It uses table-valued pragma functions (`pragma_table_info(?)`) so even schema
 * introspection binds parameters instead of interpolating. Identifiers (which
 * can't be bound) are quoted via `quoteIdent`. (docs/ARCHITECTURE.md §4.3)
 */

import type { Dialect } from '../Dialect.ts';
import type { Query, BrowseSpec, Sort } from '../../../../domain/query/Query.ts';
import { sql } from '../../../../domain/query/Query.ts';
import type {
  ObjectRef,
  ColumnDef,
} from '../../../../domain/datasource/schema.ts';
import type { RawResult } from '../Driver.ts';

/** Quote a SQL identifier, escaping embedded double-quotes. */
const quoteIdent = (name: string): string => `"${name.replace(/"/g, '""')}"`;

/** ` ORDER BY "col" ASC|DESC`, or empty when unsorted. */
const orderBy = (sort: Sort | null | undefined): string =>
  sort ? ` ORDER BY ${quoteIdent(sort.column)} ${sort.direction.toUpperCase()}` : '';

/** Index of a column in a raw result, by name (case-insensitive). */
const col = (raw: RawResult, name: string): number =>
  raw.columns.findIndex((c) => c.toLowerCase() === name.toLowerCase());

export class SqliteDialect implements Dialect {
  readonly id = 'sqlite';

  listObjectsQuery(): Query {
    return sql(
      `SELECT name, type FROM sqlite_master
       WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%'
       ORDER BY type, name`,
    );
  }

  parseObjects(raw: RawResult): ObjectRef[] {
    const iName = col(raw, 'name');
    const iType = col(raw, 'type');
    return raw.rows.map((r) => ({
      name: String(r[iName]),
      kind: r[iType] === 'view' ? ('view' as const) : ('table' as const),
    }));
  }

  describeQuery(ref: ObjectRef): Query {
    return sql(
      `SELECT name, type, "notnull", pk FROM pragma_table_info(?)`,
      [ref.name],
    );
  }

  parseColumns(raw: RawResult): ColumnDef[] {
    const iName = col(raw, 'name');
    const iType = col(raw, 'type');
    const iNotNull = col(raw, 'notnull');
    const iPk = col(raw, 'pk');
    return raw.rows.map((r) => ({
      name: String(r[iName]),
      dataType: String(r[iType] ?? ''),
      nullable: Number(r[iNotNull]) === 0,
      isPrimaryKey: Number(r[iPk]) > 0,
    }));
  }

  browseQuery(ref: ObjectRef, spec: BrowseSpec): Query {
    return sql(
      `SELECT * FROM ${quoteIdent(ref.name)}${orderBy(spec.sort)} LIMIT ? OFFSET ?`,
      [spec.page.limit, spec.page.offset],
    );
  }

  countQuery(ref: ObjectRef): Query {
    return sql(`SELECT COUNT(*) AS n FROM ${quoteIdent(ref.name)}`);
  }
}
