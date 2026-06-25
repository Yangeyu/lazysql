/**
 * Schema domain model — deliberately generic so it can describe a SQL table,
 * a Mongo collection, or a Redis keyspace. SQL-specific notions (foreign keys,
 * check constraints) are added in later phases as optional fields; Phase 0
 * only needs object identity and columns.
 */

/**
 * Kind of schema object, kept open for non-relational sources. The relational
 * kinds beyond table/view (index, trigger, sequence, procedure) are recognised
 * by the navigation tree now; adapters start populating them as their
 * introspection grows, at which point the matching category lights up with no
 * UI change (the tree groups purely by kind).
 */
export type ObjectKind =
  | 'table'
  | 'view'
  | 'index'
  | 'trigger'
  | 'sequence'
  | 'procedure'
  | 'collection'
  | 'keyspace';

/**
 * A stable reference to a browsable object. `namespace` maps to a SQL schema
 * (e.g. "public"), a Mongo database, or a Redis logical grouping.
 */
export interface ObjectRef {
  readonly namespace?: string;
  readonly name: string;
  readonly kind: ObjectKind;
}

export const objectRefKey = (ref: ObjectRef): string =>
  ref.namespace ? `${ref.namespace}.${ref.name}` : ref.name;

export interface ColumnDef {
  readonly name: string;
  /** Source-declared type, verbatim (e.g. "INTEGER", "varchar(255)"). */
  readonly dataType: string;
  readonly nullable: boolean;
  readonly isPrimaryKey: boolean;
}

export interface ObjectSchema {
  readonly ref: ObjectRef;
  readonly columns: ColumnDef[];
}

/** A point-in-time snapshot of everything the UI/sidebar needs to render. */
export interface SchemaSnapshot {
  readonly objects: ObjectRef[];
}
