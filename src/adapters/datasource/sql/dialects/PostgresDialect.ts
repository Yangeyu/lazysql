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
  ObjectKind,
} from '../../../../domain/datasource/schema.ts';
import type { RowKey, RowPatch } from '../../../../domain/datasource/edit.ts';
import type { CascadeDrop } from '../../../../domain/datasource/DataSource.ts';
import type { DataSourceError } from '../../../../domain/errors/errors.ts';
import { QueryError } from '../../../../domain/errors/errors.ts';
import type { RawResult } from '../Driver.ts';
import { buildWhere } from '../whereBuilder.ts';
import { buildInsert, buildUpdate, buildDelete } from '../dml.ts';

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

/** The objects a dependents-blocked DROP would cascade to. Postgres lists them
 *  in the error `detail`, one per line as "<object> depends on <object>"; the
 *  subject of each line is what CASCADE removes. De-duplicated, order preserved.
 *  A trailing "and N other objects" line (when PG caps the list) is kept verbatim. */
const parseDependents = (detail: string | undefined): string[] => {
  if (!detail) return [];
  const seen = new Set<string>();
  for (const line of detail.split('\n')) {
    const subject = line.split(/\s+depends on\s+/i)[0]?.trim();
    if (subject) seen.add(subject);
  }
  return [...seen];
};

export class PostgresDialect implements Dialect {
  readonly id = 'postgres';

  listObjectsQuery(): Query {
    // One UNION yields a uniform (ns, name, kind) row per object across every
    // catalog, so parseObjects reads the kind directly. User schemas only.
    return sql(
      `SELECT table_schema AS ns, table_name AS name,
              CASE table_type WHEN 'VIEW' THEN 'view' ELSE 'table' END AS kind
         FROM information_schema.tables
        WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
       UNION ALL
       SELECT schemaname, indexname, 'index'
         FROM pg_indexes
        WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
       UNION ALL
       SELECT sequence_schema, sequence_name, 'sequence'
         FROM information_schema.sequences
        WHERE sequence_schema NOT IN ('pg_catalog', 'information_schema')
       UNION ALL
       SELECT DISTINCT trigger_schema, trigger_name, 'trigger'
         FROM information_schema.triggers
        WHERE trigger_schema NOT IN ('pg_catalog', 'information_schema')
       UNION ALL
       SELECT routine_schema, routine_name, 'procedure'
         FROM information_schema.routines
        WHERE routine_schema NOT IN ('pg_catalog', 'information_schema')
       ORDER BY ns, kind, name`,
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

  sourceQuery(ref: ObjectRef): Query {
    const args = [ref.namespace ?? DEFAULT_SCHEMA, ref.name];
    switch (ref.kind) {
      case 'index':
        return sql(
          `SELECT pg_get_indexdef(c.oid)
             FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = $1 AND c.relname = $2 AND c.relkind = 'i'`,
          args,
        );
      case 'trigger':
        return sql(
          `SELECT pg_get_triggerdef(t.oid)
             FROM pg_trigger t
             JOIN pg_class c ON c.oid = t.tgrelid
             JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = $1 AND t.tgname = $2 AND NOT t.tgisinternal
            LIMIT 1`,
          args,
        );
      case 'procedure':
        return sql(
          `SELECT pg_get_functiondef(p.oid)
             FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = $1 AND p.proname = $2
            LIMIT 1`,
          args,
        );
      case 'sequence':
        return sql(
          `SELECT format(
              'CREATE SEQUENCE %I.%I START %s INCREMENT %s MINVALUE %s MAXVALUE %s%s;',
              schemaname, sequencename, start_value, increment_by, min_value, max_value,
              CASE WHEN cycle THEN ' CYCLE' ELSE '' END)
             FROM pg_sequences WHERE schemaname = $1 AND sequencename = $2`,
          args,
        );
      default: // view
        return sql(
          `SELECT view_definition FROM information_schema.views
            WHERE table_schema = $1 AND table_name = $2`,
          args,
        );
    }
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

  dropQuery(ref: ObjectRef): Query {
    return sql(`DROP ${ref.kind === 'view' ? 'VIEW' : 'TABLE'} ${qualify(ref)};`);
  }

  cascadeDrop(dropSql: string, error: DataSourceError): CascadeDrop | null {
    // SQLSTATE 2BP01 = dependent_objects_still_exist: the DROP was refused because
    // other objects (views, FKs, …) reference this one. CASCADE removes them too.
    if (!(error instanceof QueryError) || error.code !== '2BP01') return null;
    if (!/^\s*drop\s+(table|view)\b/i.test(dropSql)) return null;
    return {
      sql: dropSql.replace(/\s*;?\s*$/, ' CASCADE;'),
      dependents: parseDependents(error.detail),
    };
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
