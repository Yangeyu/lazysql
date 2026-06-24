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
} from '../../../../domain/datasource/schema.ts';
import type { RawResult } from '../Driver.ts';
import { buildWhere } from '../whereBuilder.ts';

/** Quote an identifier with backticks, escaping embedded backticks. */
const quoteIdent = (name: string): string => `\`${name.replace(/`/g, '``')}\``;

/** MySQL uses positional `?` placeholders. */
const ph = (): string => '?';

/** Schema(database)-qualified, quoted object name. */
const qualify = (ref: ObjectRef): string =>
  ref.namespace
    ? `${quoteIdent(ref.namespace)}.${quoteIdent(ref.name)}`
    : quoteIdent(ref.name);

const orderBy = (sort: Sort | null | undefined): string =>
  sort ? ` ORDER BY ${quoteIdent(sort.column)} ${sort.direction.toUpperCase()}` : '';

const col = (raw: RawResult, name: string): number =>
  raw.columns.findIndex((c) => c.toLowerCase() === name.toLowerCase());

export class MySqlDialect implements Dialect {
  readonly id = 'mysql';

  listObjectsQuery(): Query {
    return sql(
      `SELECT table_schema, table_name, table_type
       FROM information_schema.tables
       WHERE table_schema = DATABASE()
       ORDER BY table_type, table_name`,
    );
  }

  parseObjects(raw: RawResult): ObjectRef[] {
    const iSchema = col(raw, 'table_schema');
    const iName = col(raw, 'table_name');
    const iType = col(raw, 'table_type');
    return raw.rows.map((r) => ({
      namespace: String(r[iSchema]),
      name: String(r[iName]),
      kind: r[iType] === 'VIEW' ? ('view' as const) : ('table' as const),
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
    return raw.rows.map((r) => ({
      name: String(r[iName]),
      dataType: String(r[iType] ?? ''),
      nullable: r[iNullable] === 'YES',
      isPrimaryKey: r[iKey] === 'PRI',
    }));
  }

  browseQuery(ref: ObjectRef, spec: BrowseSpec): Query {
    const where = buildWhere(spec.filter, quoteIdent, ph, 'LIKE');
    return sql(
      `SELECT * FROM ${qualify(ref)}${where.clause}${orderBy(spec.sort)} LIMIT ? OFFSET ?`,
      [...where.params, spec.page.limit, spec.page.offset],
    );
  }

  countQuery(ref: ObjectRef, filter?: Filter | null): Query {
    const where = buildWhere(filter, quoteIdent, ph, 'LIKE');
    return sql(
      `SELECT count(*) AS n FROM ${qualify(ref)}${where.clause}`,
      where.params,
    );
  }
}
