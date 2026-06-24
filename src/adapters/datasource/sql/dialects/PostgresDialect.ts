/**
 * PostgresDialect — every Postgres-specific SQL string lives here. The contrast
 * with SqliteDialect is exactly what validates the Dialect abstraction:
 *   - parameter placeholders are `$1, $2` (not `?`)
 *   - object names are schema-qualified ("public"."t")
 *   - introspection reads information_schema / table_constraints (not pragma)
 * SqlDataSource consumes both dialects unchanged. (Strategy + OCP)
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

const DEFAULT_SCHEMA = 'public';

const quoteIdent = (name: string): string => `"${name.replace(/"/g, '""')}"`;

/** Postgres uses numbered `$n` placeholders. */
const ph = (index: number): string => `$${index}`;

/** Schema-qualified, quoted object name. */
const qualify = (ref: ObjectRef): string =>
  `${quoteIdent(ref.namespace ?? DEFAULT_SCHEMA)}.${quoteIdent(ref.name)}`;

/** ` ORDER BY "col" ASC|DESC`, or empty when unsorted. */
const orderBy = (sort: Sort | null | undefined): string =>
  sort ? ` ORDER BY ${quoteIdent(sort.column)} ${sort.direction.toUpperCase()}` : '';

const col = (raw: RawResult, name: string): number =>
  raw.columns.findIndex((c) => c.toLowerCase() === name.toLowerCase());

export class PostgresDialect implements Dialect {
  readonly id = 'postgres';

  listObjectsQuery(): Query {
    return sql(
      `SELECT table_schema, table_name, table_type
       FROM information_schema.tables
       WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
       ORDER BY table_schema, table_type, table_name`,
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
      `SELECT c.column_name, c.data_type, c.is_nullable,
              COALESCE(pk.is_pk, false) AS is_pk
       FROM information_schema.columns c
       LEFT JOIN (
         SELECT kcu.column_name, true AS is_pk
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu
           ON kcu.constraint_name = tc.constraint_name
          AND kcu.table_schema = tc.table_schema
         WHERE tc.constraint_type = 'PRIMARY KEY'
           AND tc.table_schema = $1 AND tc.table_name = $2
       ) pk ON pk.column_name = c.column_name
       WHERE c.table_schema = $1 AND c.table_name = $2
       ORDER BY c.ordinal_position`,
      [ref.namespace ?? DEFAULT_SCHEMA, ref.name],
    );
  }

  parseColumns(raw: RawResult): ColumnDef[] {
    const iName = col(raw, 'column_name');
    const iType = col(raw, 'data_type');
    const iNullable = col(raw, 'is_nullable');
    const iPk = col(raw, 'is_pk');
    return raw.rows.map((r) => ({
      name: String(r[iName]),
      dataType: String(r[iType] ?? ''),
      nullable: r[iNullable] === 'YES',
      isPrimaryKey: r[iPk] === true,
    }));
  }

  browseQuery(ref: ObjectRef, spec: BrowseSpec): Query {
    const where = buildWhere(spec.filter, quoteIdent, ph, 'ILIKE');
    const n = where.params.length;
    return sql(
      `SELECT * FROM ${qualify(ref)}${where.clause}${orderBy(spec.sort)} LIMIT ${ph(n + 1)} OFFSET ${ph(n + 2)}`,
      [...where.params, spec.page.limit, spec.page.offset],
    );
  }

  countQuery(ref: ObjectRef, filter?: Filter | null): Query {
    const where = buildWhere(filter, quoteIdent, ph, 'ILIKE');
    return sql(
      `SELECT count(*) AS n FROM ${qualify(ref)}${where.clause}`,
      where.params,
    );
  }
}
