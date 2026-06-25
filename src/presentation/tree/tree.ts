/**
 * Object-tree model — pure projection of the active connection's schema into the
 * flattened, lazygit-style navigation tree the sidebar renders and the store
 * navigates. Categories are derived by grouping objects on their `kind`, in a
 * fixed canonical order: nothing here knows or branches on the database *type*,
 * so a richer adapter introspection (indexes, triggers…) lights up its category
 * automatically. Keeping this a pure function makes navigation trivially
 * testable without Ink.
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
    }
  | {
      readonly type: 'category';
      readonly kind: ObjectKind;
      readonly label: string;
      readonly count: number;
      readonly expanded: boolean;
    }
  | { readonly type: 'object'; readonly ref: ObjectRef; readonly label: string };

/** Categories in display order. Empty ones are skipped (data-driven). */
const CATEGORY_ORDER: ReadonlyArray<{ kind: ObjectKind; label: string }> = [
  { kind: 'table', label: 'Tables' },
  { kind: 'view', label: 'Views' },
  { kind: 'index', label: 'Indexes' },
  { kind: 'trigger', label: 'Triggers' },
  { kind: 'sequence', label: 'Sequences' },
  { kind: 'procedure', label: 'Procedures' },
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
}

/** Flatten the tree to the list of currently visible rows, top to bottom. */
export const buildTree = (input: TreeInput): TreeRow[] => {
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
    });
    if (!expanded) continue;
    for (const cat of CATEGORY_ORDER) {
      const objs = input.objects.filter((o) => o.kind === cat.kind);
      if (objs.length === 0) continue;
      const catExpanded = input.expandedCats.has(cat.kind);
      rows.push({
        type: 'category',
        kind: cat.kind,
        label: cat.label,
        count: objs.length,
        expanded: catExpanded,
      });
      if (catExpanded) {
        for (const ref of objs) rows.push({ type: 'object', ref, label: ref.name });
      }
    }
  }
  return rows;
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
