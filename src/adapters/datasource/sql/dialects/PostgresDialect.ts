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
  Filter,
} from '../../../../domain/query/Query.ts';
import { sql } from '../../../../domain/query/Query.ts';
import type {
  ObjectRef,
  ColumnDef,
  ObjectKind,
  JsonKind,
} from '../../../../domain/datasource/schema.ts';
import type { RowKey, RowPatch } from '../../../../domain/datasource/edit.ts';
import type { CascadeDrop, WriteRefusal } from '../../../../domain/datasource/DataSource.ts';
import type { DataSourceError } from '../../../../domain/errors/errors.ts';
import { QueryError } from '../../../../domain/errors/errors.ts';
import type { RawResult } from '../Driver.ts';
import { buildWhere, buildOrderBy } from '../whereBuilder.ts';
import { buildInsert, buildUpdate, buildDelete } from '../dml.ts';

const DEFAULT_SCHEMA = 'public';

/** Object kinds Postgres can draft a standalone DROP for → their DROP keyword.
 *  Absent kinds (index/trigger/sequence/procedure) yield no draft: they are
 *  dropped through their owning object or not at all. Add a kind here to make
 *  it droppable everywhere — the one source of truth callers gate on. */
const DROP_KEYWORD: Partial<Record<ObjectKind, string>> = {
  table: 'TABLE',
  view: 'VIEW',
  enum: 'TYPE', // an enum is a user-defined TYPE in Postgres DDL
};

const quoteIdent = (name: string): string => `"${name.replace(/"/g, '""')}"`;

/** Postgres uses numbered `$n` placeholders. */
const ph = (index: number): string => `$${index}`;

/** Schema-qualified, quoted object name. */
const qualify = (ref: ObjectRef): string =>
  `${quoteIdent(ref.namespace ?? DEFAULT_SCHEMA)}.${quoteIdent(ref.name)}`;

/** Substring match; the cast lets non-text columns (uuid, numeric, jsonb…)
 *  accept ILIKE, which only exists for text operands. */
const contains = (column: string, ph: string): string =>
  `${column}::text ILIKE ${ph}`;

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
       UNION ALL
       SELECT n.nspname, t.typname, 'enum'
         FROM pg_type t
         JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE t.typtype = 'e'
          AND n.nspname NOT IN ('pg_catalog', 'information_schema')
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
      // udt_name + a per-column label aggregate resolve an enum column, which
      // information_schema reports only as the opaque data_type 'USER-DEFINED'.
      // ARRAY(…) yields text[] (empty for non-enum columns).
      `SELECT c.column_name, c.data_type, c.udt_name, c.is_nullable,
              COALESCE(pk.is_pk, false) AS is_pk,
              ARRAY(
                SELECT e.enumlabel
                  FROM pg_enum e
                  JOIN pg_type t ON t.oid = e.enumtypid
                  JOIN pg_namespace tn ON tn.oid = t.typnamespace
                 WHERE t.typname = c.udt_name AND tn.nspname = c.udt_schema
                 ORDER BY e.enumsortorder
              ) AS enum_values
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
    const iUdt = col(raw, 'udt_name');
    const iNullable = col(raw, 'is_nullable');
    const iPk = col(raw, 'is_pk');
    const iEnum = col(raw, 'enum_values');
    return raw.rows.map((r) => {
      const declared = String(r[iType] ?? '');
      // A user-defined type surfaces as 'USER-DEFINED'; the real name is udt_name.
      const udt = iUdt >= 0 ? String(r[iUdt] ?? '') : '';
      const dataType = declared === 'USER-DEFINED' && udt ? udt : declared;
      const rawEnum = iEnum >= 0 ? r[iEnum] : undefined;
      const enumValues =
        Array.isArray(rawEnum) && rawEnum.length > 0
          ? rawEnum.map(String)
          : undefined;
      const jsonKind = this.jsonKindOfType(dataType);
      return {
        name: String(r[iName]),
        dataType,
        nullable: r[iNullable] === 'YES',
        isPrimaryKey: r[iPk] === true,
        ...(enumValues ? { enumValues } : {}),
        ...(jsonKind ? { jsonKind } : {}),
      };
    });
  }

  jsonKindOfType(dataType: string): JsonKind | undefined {
    // jsonb is stored normalized (reformat-safe); `json` keeps its text
    // verbatim — still a JSON column, but its layout is data.
    if (dataType === 'jsonb') return 'canonical';
    if (dataType === 'json') return 'verbatim';
    return undefined;
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
      case 'enum':
        // Reconstruct the CREATE TYPE … AS ENUM so the DDL tab shows the label
        // set — the value list PG omits from information_schema entirely — in
        // declared order (enumsortorder).
        return sql(
          `SELECT format('CREATE TYPE %I.%I AS ENUM (%s);',
              n.nspname, t.typname,
              string_agg(quote_literal(e.enumlabel), ', ' ORDER BY e.enumsortorder))
             FROM pg_type t
             JOIN pg_namespace n ON n.oid = t.typnamespace
             JOIN pg_enum e ON e.enumtypid = t.oid
            WHERE n.nspname = $1 AND t.typname = $2
            GROUP BY n.nspname, t.typname`,
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
    const where = buildWhere(spec.filter, quoteIdent, ph, contains);
    const n = where.params.length;
    return sql(
      `SELECT * FROM ${qualify(ref)}${where.clause}${buildOrderBy(spec.sort, spec.stableKey, quoteIdent)} LIMIT ${ph(n + 1)} OFFSET ${ph(n + 2)}`,
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

  dropQuery(ref: ObjectRef): Query | null {
    const keyword = DROP_KEYWORD[ref.kind];
    return keyword ? sql(`DROP ${keyword} ${qualify(ref)};`) : null;
  }

  cascadeDrop(dropSql: string, error: DataSourceError): CascadeDrop | null {
    // SQLSTATE 2BP01 = dependent_objects_still_exist: the DROP was refused because
    // other objects (views, FKs, …) reference this one. CASCADE removes them too.
    if (!(error instanceof QueryError) || error.code !== '2BP01') return null;
    if (!/^\s*drop\s+(table|view|type)\b/i.test(dropSql)) return null;
    return {
      sql: dropSql.replace(/\s*;?\s*$/, ' CASCADE;'),
      dependents: parseDependents(error.detail),
    };
  }

  explainWriteError(error: DataSourceError): WriteRefusal | null {
    // SQLSTATE 23503 = foreign_key_violation. Only its delete/update face —
    // "the row is still referenced" — is classified; the insert face (the
    // referenced parent is missing) reads fine as the raw message.
    if (!(error instanceof QueryError) || error.code !== '23503') return null;
    // detail: `Key (id)=(42) is still referenced from table "child".`
    const detail = error.detail?.match(
      /^Key (\(.+\)=\(.+\)) is still referenced from table "([^"]+)"/,
    );
    if (detail?.[1] !== undefined && detail[2] !== undefined) {
      return { kind: 'stillReferenced', table: detail[2], key: detail[1] };
    }
    // No detail (some poolers strip it) — the message still names the table:
    // `update or delete on table "t" violates … constraint "fk" on table "child"`
    const table = error.message.match(
      /^update or delete on table ".+" violates foreign key constraint ".+" on table "([^"]+)"/,
    )?.[1];
    return table !== undefined ? { kind: 'stillReferenced', table } : null;
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
