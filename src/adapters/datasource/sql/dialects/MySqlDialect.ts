/**
 * MySqlDialect — MySQL/MariaDB-specific SQL. Its differences from the other two
 * dialects again exercise the Strategy abstraction:
 *   - identifiers are quoted with backticks (`x`), not double quotes
 *   - placeholders are `?` (like SQLite, unlike Postgres' $n)
 *   - introspection scopes to DATABASE() and reads COLUMN_KEY = 'PRI' for the
 *     primary key (no constraint join needed)
 * SqlDataSource and the shared whereBuilder are reused unchanged. (Strategy/OCP)
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
import type { CascadeDrop } from '../../../../domain/datasource/DataSource.ts';
import type { RawResult } from '../Driver.ts';
import { buildWhere, buildOrderBy } from '../whereBuilder.ts';
import { buildInsert, buildUpdate, buildDelete } from '../dml.ts';

/** Quote an identifier with backticks, escaping embedded backticks. */
const quoteIdent = (name: string): string => `\`${name.replace(/`/g, '``')}\``;

/** MySQL uses positional `?` placeholders. */
const ph = (): string => '?';

/** Schema(database)-qualified, quoted object name. */
const qualify = (ref: ObjectRef): string =>
  ref.namespace
    ? `${quoteIdent(ref.namespace)}.${quoteIdent(ref.name)}`
    : quoteIdent(ref.name);

/** MySQL LIKE coerces non-text operands and the default *_ci collations
 *  already match case-insensitively. */
const contains = (column: string, ph: string): string => `${column} LIKE ${ph}`;

const col = (raw: RawResult, name: string): number =>
  raw.columns.findIndex((c) => c.toLowerCase() === name.toLowerCase());

export class MySqlDialect implements Dialect {
  readonly id = 'mysql';

  listObjectsQuery(): Query {
    // Uniform (ns, name, kind) across the current database's catalogs. Indexes
    // are omitted: MySQL index names are per-table (PRIMARY repeats), so a flat
    // by-name list would be ambiguous — they belong under their table, later.
    return sql(
      `SELECT table_schema AS ns, table_name AS name,
              CASE table_type WHEN 'VIEW' THEN 'view' ELSE 'table' END AS kind
         FROM information_schema.tables
        WHERE table_schema = DATABASE()
       UNION ALL
       SELECT trigger_schema, trigger_name, 'trigger'
         FROM information_schema.triggers
        WHERE trigger_schema = DATABASE()
       UNION ALL
       SELECT routine_schema, routine_name, 'procedure'
         FROM information_schema.routines
        WHERE routine_schema = DATABASE()
       ORDER BY kind, name`,
    );
  }

  parseObjects(raw: RawResult): ObjectRef[] {
    const iNs = col(raw, 'ns');
    const iName = col(raw, 'name');
    const iKind = col(raw, 'kind');
    return raw.rows.map((r) => ({
      namespace: String(r[iNs]),
      name: String(r[iName]),
      kind: String(r[iKind]) as ObjectKind,
    }));
  }

  describeQuery(ref: ObjectRef): Query {
    return sql(
      `SELECT column_name, data_type, is_nullable, column_key
       FROM information_schema.columns
       WHERE table_schema = DATABASE() AND table_name = ?
       ORDER BY ordinal_position`,
      [ref.name],
    );
  }

  parseColumns(raw: RawResult): ColumnDef[] {
    const iName = col(raw, 'column_name');
    const iType = col(raw, 'data_type');
    const iNullable = col(raw, 'is_nullable');
    const iKey = col(raw, 'column_key');
    return raw.rows.map((r) => {
      const dataType = String(r[iType] ?? '');
      return {
        name: String(r[iName]),
        dataType,
        nullable: r[iNullable] === 'YES',
        isPrimaryKey: r[iKey] === 'PRI',
        // MySQL json is stored in a normalized binary form — reformat-safe.
        ...(dataType === 'json' ? { jsonCanonical: true as const } : {}),
      };
    });
  }

  sourceQuery(ref: ObjectRef): Query {
    // information_schema (parameterizable) rather than SHOW CREATE (which can't
    // bind an identifier) for the definition text of each source-bearing kind.
    switch (ref.kind) {
      case 'trigger':
        return sql(
          `SELECT CONCAT(action_timing, ' ', event_manipulation, ' ON ',
                         event_object_table, '\n', action_statement)
             FROM information_schema.triggers
            WHERE trigger_schema = DATABASE() AND trigger_name = ?`,
          [ref.name],
        );
      case 'procedure':
        return sql(
          `SELECT routine_definition FROM information_schema.routines
            WHERE routine_schema = DATABASE() AND routine_name = ?`,
          [ref.name],
        );
      default: // view
        return sql(
          `SELECT view_definition FROM information_schema.views
            WHERE table_schema = DATABASE() AND table_name = ?`,
          [ref.name],
        );
    }
  }

  browseQuery(ref: ObjectRef, spec: BrowseSpec): Query {
    const where = buildWhere(spec.filter, quoteIdent, ph, contains);
    return sql(
      `SELECT * FROM ${qualify(ref)}${where.clause}${buildOrderBy(spec.sort, spec.stableKey, quoteIdent)} LIMIT ? OFFSET ?`,
      [...where.params, spec.page.limit, spec.page.offset],
    );
  }

  countQuery(ref: ObjectRef, filter?: Filter | null): Query {
    const where = buildWhere(filter, quoteIdent, ph, contains);
    return sql(
      `SELECT count(*) AS n FROM ${qualify(ref)}${where.clause}`,
      where.params,
    );
  }

  dropQuery(ref: ObjectRef): Query {
    return sql(`DROP ${ref.kind === 'view' ? 'VIEW' : 'TABLE'} ${qualify(ref)};`);
  }

  // MySQL parses CASCADE on DROP TABLE but ignores it (the fix is dropping the
  // referencing FK first), so there is no safe one-key escalation to offer.
  cascadeDrop(): CascadeDrop | null {
    return null;
  }

  insertQuery(ref: ObjectRef, row: RowPatch): Query {
    const dml = buildInsert(qualify(ref), row, quoteIdent, ph);
    return sql(dml.text, dml.params);
  }

  updateQuery(ref: ObjectRef, key: RowKey, patch: RowPatch): Query {
    const dml = buildUpdate(qualify(ref), patch, key, quoteIdent, ph);
    return sql(dml.text, dml.params);
  }

  deleteQuery(ref: ObjectRef, key: RowKey): Query {
    const dml = buildDelete(qualify(ref), key, quoteIdent, ph);
    return sql(dml.text, dml.params);
  }
}
