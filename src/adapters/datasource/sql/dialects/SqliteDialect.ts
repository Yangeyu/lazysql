/**
 * SqliteDialect — every SQLite-specific SQL string lives here and nowhere else.
 * It uses table-valued pragma functions (`pragma_table_info(?)`) so even schema
 * introspection binds parameters instead of interpolating. Identifiers (which
 * can't be bound) are quoted via `quoteIdent`. (docs/ARCHITECTURE.md §4.3)
 */

import type { Dialect } from '../Dialect.ts';
import type {
  Query,
  BrowseSpec,
  Sort,
  Filter,
} from '../../../../domain/query/Query.ts';
import { sql } from '../../../../domain/query/Query.ts';
import type {
  ObjectRef,
  ColumnDef,
  ObjectKind,
} from '../../../../domain/datasource/schema.ts';
import type { RowKey, RowPatch } from '../../../../domain/datasource/edit.ts';
import type { RawResult } from '../Driver.ts';
import { buildWhere } from '../whereBuilder.ts';
import { buildInsert, buildUpdate, buildDelete } from '../dml.ts';

/** Quote a SQL identifier, escaping embedded double-quotes. */
const quoteIdent = (name: string): string => `"${name.replace(/"/g, '""')}"`;

/** SQLite uses positional `?` placeholders. */
const ph = (): string => '?';

/** ` ORDER BY "col" ASC|DESC`, or empty when unsorted. */
const orderBy = (sort: Sort | null | undefined): string =>
  sort ? ` ORDER BY ${quoteIdent(sort.column)} ${sort.direction.toUpperCase()}` : '';

/** Index of a column in a raw result, by name (case-insensitive). */
const col = (raw: RawResult, name: string): number =>
  raw.columns.findIndex((c) => c.toLowerCase() === name.toLowerCase());

export class SqliteDialect implements Dialect {
  readonly id = 'sqlite';

  listObjectsQuery(): Query {
    // sqlite_master already carries every object kind in one table; `sql IS NULL`
    // drops the auto-indexes SQLite creates for UNIQUE/PK (noise, not user objects).
    return sql(
      `SELECT name, type FROM sqlite_master
       WHERE type IN ('table','view','index','trigger')
         AND name NOT LIKE 'sqlite_%'
         AND (type <> 'index' OR sql IS NOT NULL)
       ORDER BY type, name`,
    );
  }

  parseObjects(raw: RawResult): ObjectRef[] {
    const iName = col(raw, 'name');
    const iType = col(raw, 'type');
    // sqlite_master's `type` is already one of our ObjectKinds.
    return raw.rows.map((r) => ({
      name: String(r[iName]),
      kind: String(r[iType]) as ObjectKind,
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

  sourceQuery(ref: ObjectRef): Query {
    // sqlite_master.sql holds the verbatim CREATE for views/indexes/triggers.
    return sql(`SELECT sql FROM sqlite_master WHERE name = ?`, [ref.name]);
  }

  browseQuery(ref: ObjectRef, spec: BrowseSpec): Query {
    const where = buildWhere(spec.filter, quoteIdent, ph, 'LIKE');
    return sql(
      `SELECT * FROM ${quoteIdent(ref.name)}${where.clause}${orderBy(spec.sort)} LIMIT ? OFFSET ?`,
      [...where.params, spec.page.limit, spec.page.offset],
    );
  }

  countQuery(ref: ObjectRef, filter?: Filter | null): Query {
    const where = buildWhere(filter, quoteIdent, ph, 'LIKE');
    return sql(
      `SELECT COUNT(*) AS n FROM ${quoteIdent(ref.name)}${where.clause}`,
      where.params,
    );
  }

  insertQuery(ref: ObjectRef, row: RowPatch): Query {
    const dml = buildInsert(quoteIdent(ref.name), row, quoteIdent, ph);
    return sql(dml.text, dml.params);
  }

  updateQuery(ref: ObjectRef, key: RowKey, patch: RowPatch): Query {
    const dml = buildUpdate(quoteIdent(ref.name), patch, key, quoteIdent, ph);
    return sql(dml.text, dml.params);
  }

  deleteQuery(ref: ObjectRef, key: RowKey): Query {
    const dml = buildDelete(quoteIdent(ref.name), key, quoteIdent, ph);
    return sql(dml.text, dml.params);
  }
}
