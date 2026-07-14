/**
 * Object-tree model — pure projection of the active connection's schema into the
 * flattened, lazygit-style navigation tree the sidebar renders and the store
 * navigates. Categories are derived by grouping objects on their `kind`, in a
 * fixed canonical order, and (when asked) split into a SQL-`schema` tier under
 * each category. `buildTree` itself stays driver-agnostic — it groups by `kind`
 * and, if `groupBySchema` is set, by `namespace` — so a richer adapter
 * introspection (indexes, triggers…) lights up its category automatically. The
 * one driver-shaped policy (which engines have schemas worth a tier) lives in
 * `groupsBySchema`, a sibling of `dialectLabel`/`shortTag`, not in the
 * projection. Keeping `buildTree` pure makes navigation trivially testable.
 *
 * Rows carry a `depth` so the view indents uniformly instead of hardcoding a
 * prefix per row type — the schema tier deepens objects without the renderer
 * having to know whether they were grouped.
 *
 * An optional `filter` narrows the projection to objects whose name matches a
 * substring: empty categories/schemas drop out and every surviving container is
 * force-expanded, so a hit is never buried in a fold (see `buildTree`).
 */

import type { ObjectKind, ObjectRef } from '../../domain/datasource/schema.ts';
import type {
  ConnectionProfile,
  DriverId,
} from '../../domain/connection/ConnectionProfile.ts';

/** One connection shown as a tree root. The active one carries the schema. */
export interface ConnNode {
  readonly id: string;
  readonly name: string;
  /** Short driver tag shown next to the name, e.g. `PG`. */
  readonly tag: string;
  /** Whether this is the live connection (its schema is shown under it). */
  readonly active: boolean;
}

export type TreeRow =
  | {
      readonly type: 'connection';
      readonly id: string;
      readonly label: string;
      readonly tag: string;
      readonly active: boolean;
      readonly expanded: boolean;
      readonly depth: number;
    }
  | {
      readonly type: 'category';
      readonly kind: ObjectKind;
      readonly label: string;
      readonly count: number;
      readonly expanded: boolean;
      readonly depth: number;
    }
  | {
      // A SQL schema (namespace) grouping a category's objects, e.g. `public`.
      // Identity is (kind, namespace): the same schema folds independently under
      // each category, so the expansion key carries both (see `schemaKey`).
      readonly type: 'schema';
      readonly kind: ObjectKind;
      readonly namespace: string;
      readonly label: string;
      readonly count: number;
      readonly expanded: boolean;
      readonly depth: number;
    }
  | {
      readonly type: 'object';
      readonly ref: ObjectRef;
      readonly label: string;
      readonly depth: number;
    };

/** Stable expansion key for a schema row — a schema folds independently under
 *  each category, so its key pairs the category `kind` with the `namespace`. */
export const schemaKey = (kind: ObjectKind, namespace: string): string =>
  `${kind} ${namespace}`;

/** Stable identity for an object ref — (kind, namespace, name) — so a
 *  multi-selection mark survives tree rebuilds (folding, refresh) without holding
 *  the ref object itself. The single key the sidebar highlight and the batch
 *  export both address a marked table by. */
export const refKey = (ref: ObjectRef): string =>
  `${ref.kind} ${ref.namespace ?? ''} ${ref.name}`;

/** Categories in display order. Empty ones are skipped (data-driven). */
const CATEGORY_ORDER: ReadonlyArray<{ kind: ObjectKind; label: string }> = [
  { kind: 'table', label: 'Tables' },
  { kind: 'view', label: 'Views' },
  { kind: 'index', label: 'Indexes' },
  { kind: 'trigger', label: 'Triggers' },
  { kind: 'sequence', label: 'Sequences' },
  { kind: 'procedure', label: 'Procedures' },
  { kind: 'enum', label: 'Enums' },
  { kind: 'collection', label: 'Collections' },
  { kind: 'keyspace', label: 'Keyspaces' },
];

/** Human dialect label for a driver, e.g. 'postgres' → 'PostgreSQL'. */
export const dialectLabel = (driver: DriverId): string =>
  ({
    sqlite: 'SQLite',
    postgres: 'PostgreSQL',
    mysql: 'MySQL',
    mongodb: 'MongoDB',
    redis: 'Redis',
  })[driver];

/** Whether a driver gets the schema tier (Tables → [schema] → objects). Only
 *  engines with a real schema namespace *distinct from the database* qualify:
 *  Postgres does; MySQL's schema IS the database, SQLite/Mongo/Redis have none,
 *  so a tier there would just repeat the connection. The single policy the store
 *  and view both read — `buildTree` itself never names a driver. */
export const groupsBySchema = (driver: DriverId): boolean => driver === 'postgres';

/** The namespace a fresh connection should land on, when the driver has a
 *  conventional default (Postgres: `public`). Sibling policy of
 *  `groupsBySchema` — the store reads it so `buildTree` never names a driver. */
export const defaultNamespace = (driver: DriverId): string | null =>
  driver === 'postgres' ? 'public' : null;

/** Short, human driver tag for the connection root (presentation only). */
export const shortTag = (label: string): string =>
  ({
    PostgreSQL: 'PG',
    SQLite: 'SQLite',
    MySQL: 'MySQL',
    MongoDB: 'Mongo',
    Redis: 'Redis',
  })[label] ?? label;

/** Project saved profiles into sidebar connection roots (the single source). */
export const toConnNodes = (
  profiles: ReadonlyArray<ConnectionProfile>,
  activeId: string | null,
): ConnNode[] =>
  profiles.map((p) => ({
    id: p.id,
    name: p.name,
    tag: shortTag(dialectLabel(p.driver)),
    active: p.id === activeId,
  }));

export interface TreeInput {
  /** All connections shown as roots, in display order. */
  readonly connections: ReadonlyArray<ConnNode>;
  /** Objects of the *active* connection (grouped under its root). */
  readonly objects: ReadonlyArray<ObjectRef>;
  /** Whether the active connection's root is expanded. */
  readonly rootExpanded: boolean;
  readonly expandedCats: ReadonlySet<ObjectKind>;
  /** Split each category's objects into a schema tier (set by the store from the
   *  active driver; see `groupsBySchema`). Off → objects sit directly under the
   *  category, as before. */
  readonly groupBySchema?: boolean;
  /** Which schema rows are expanded, keyed by `schemaKey(kind, namespace)`. */
  readonly expandedSchemas?: ReadonlySet<string>;
  /** Case-insensitive substring matched against object NAMES only. While set,
   *  non-matching objects and the containers left empty by them drop out, and
   *  every surviving category/schema is force-expanded (the stored fold state is
   *  ignored) so a match is never hidden. Empty/undefined ⇒ the full tree. */
  readonly filter?: string;
}

const NO_SCHEMAS: ReadonlySet<string> = new Set();

/** Flatten the tree to the list of currently visible rows, top to bottom. */
export const buildTree = (input: TreeInput): TreeRow[] => {
  const expandedSchemas = input.expandedSchemas ?? NO_SCHEMAS;
  // Filtering narrows the object set AND forces every container open, so a match
  // is never buried in a collapsed fold; an empty needle leaves everything as-is.
  const needle = input.filter?.trim().toLowerCase() ?? '';
  const filtering = needle !== '';
  const hit = (o: ObjectRef): boolean =>
    !filtering || o.name.toLowerCase().includes(needle);
  const rows: TreeRow[] = [];
  for (const conn of input.connections) {
    const expanded = conn.active && input.rootExpanded;
    rows.push({
      type: 'connection',
      id: conn.id,
      label: conn.name,
      tag: conn.tag,
      active: conn.active,
      expanded,
      depth: 0,
    });
    if (!expanded) continue;
    for (const cat of CATEGORY_ORDER) {
      const objs = input.objects.filter((o) => o.kind === cat.kind && hit(o));
      if (objs.length === 0) continue;
      const catExpanded = filtering || input.expandedCats.has(cat.kind);
      rows.push({
        type: 'category',
        kind: cat.kind,
        label: cat.label,
        count: objs.length,
        expanded: catExpanded,
        depth: 1,
      });
      if (!catExpanded) continue;
      // A category splits into a schema tier only when asked AND its objects
      // actually carry a namespace; otherwise the objects list flat under it.
      const grouped = input.groupBySchema === true && objs.some((o) => o.namespace);
      if (!grouped) {
        for (const ref of objs) rows.push({ type: 'object', ref, label: ref.name, depth: 2 });
        continue;
      }
      for (const ns of distinctNamespaces(objs)) {
        const schemaObjs = objs.filter((o) => (o.namespace ?? '') === ns);
        const schExpanded = filtering || expandedSchemas.has(schemaKey(cat.kind, ns));
        rows.push({
          type: 'schema',
          kind: cat.kind,
          namespace: ns,
          label: ns,
          count: schemaObjs.length,
          expanded: schExpanded,
          depth: 2,
        });
        if (schExpanded) {
          for (const ref of schemaObjs) rows.push({ type: 'object', ref, label: ref.name, depth: 3 });
        }
      }
    }
  }
  return rows;
};

/** The distinct namespaces among `objs`, in first-seen (query) order. */
const distinctNamespaces = (objs: ReadonlyArray<ObjectRef>): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const o of objs) {
    const ns = o.namespace ?? '';
    if (!seen.has(ns)) {
      seen.add(ns);
      out.push(ns);
    }
  }
  return out;
};

/** Index of the first object row, or 0 (the root) when there are none. */
export const firstObjectIndex = (rows: TreeRow[]): number => {
  const i = rows.findIndex((r) => r.type === 'object');
  return i >= 0 ? i : 0;
};

/** The kind of the first present category, for sensible initial expansion. */
export const firstCategoryKind = (
  objects: ReadonlyArray<ObjectRef>,
): ObjectKind | null => {
  for (const cat of CATEGORY_ORDER) {
    if (objects.some((o) => o.kind === cat.kind)) return cat.kind;
  }
  return null;
};

/** Expansion key of the schema to auto-open under category `kind` on connect,
 *  landing the cursor on its first object (parity with the flat case): the
 *  driver's `preferred` namespace when it actually has objects there, else the
 *  first namespaced one. Null when that category has no namespaced object. */
export const firstSchemaKey = (
  objects: ReadonlyArray<ObjectRef>,
  kind: ObjectKind,
  preferred?: string | null,
): string | null => {
  const candidates = objects.filter((o) => o.kind === kind && o.namespace);
  const pick =
    (preferred != null && candidates.find((o) => o.namespace === preferred)) ||
    candidates[0];
  return pick?.namespace ? schemaKey(kind, pick.namespace) : null;
};
