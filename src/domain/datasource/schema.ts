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

/**
 * One facet of an object's structure, rendered as its own section. An object is
 * genuinely multi-faceted — a view has BOTH a column schema and a defining
 * source — so detail is a list of these, not a single shape. Rendered by `kind`
 * (the same Strategy as `ResultSet.shape`), never by database type, so the view
 * stays decoupled from any adapter. New facets (sequence properties, real table
 * DDL) arrive as new union arms with no reshape. (OCP)
 */
export type DetailSection =
  | { readonly kind: 'columns'; readonly columns: ColumnDef[] }
  | { readonly kind: 'source'; readonly text: string };

export interface ObjectSchema {
  readonly ref: ObjectRef;
  /** The object's detail sections, in render order. Non-empty by construction
   *  (every describable object exposes at least one facet). */
  readonly detail: readonly DetailSection[];
}

/**
 * Which detail sections an object kind exposes, in render order — an
 * engine-neutral rule the adapters fill: a view has both its columns and its
 * defining source, an index only its source, a table just its columns.
 */
export const sectionsFor = (
  kind: ObjectKind,
): ReadonlyArray<DetailSection['kind']> =>
  kind === 'view'
    ? ['columns', 'source']
    : kind === 'table' || kind === 'collection' || kind === 'keyspace'
      ? ['columns']
      : ['source']; // index, trigger, sequence, procedure

/** The columns of an object's `columns` section, or [] when it has none (an
 *  index/trigger/… exposes only source). Also the test for "has rows to browse". */
export const columnsOf = (schema: ObjectSchema): ColumnDef[] => {
  for (const s of schema.detail) if (s.kind === 'columns') return s.columns;
  return [];
};

/** A point-in-time snapshot of everything the UI/sidebar needs to render. */
export interface SchemaSnapshot {
  readonly objects: ObjectRef[];
}
