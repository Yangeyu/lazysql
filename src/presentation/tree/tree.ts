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

/** The connection shown as the tree root. */
export interface ConnRoot {
  readonly name: string;
  /** Short driver tag shown next to the name, e.g. `PG`. */
  readonly tag: string;
  readonly connected: boolean;
}

export type TreeRow =
  | {
      readonly type: 'connection';
      readonly label: string;
      readonly tag: string;
      readonly connected: boolean;
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

/** Short, human driver tag for the connection root (presentation only). */
export const shortTag = (dialectLabel: string): string =>
  ({
    PostgreSQL: 'PG',
    SQLite: 'SQLite',
    MySQL: 'MySQL',
    MongoDB: 'Mongo',
    Redis: 'Redis',
  })[dialectLabel] ?? dialectLabel;

export interface TreeInput {
  readonly root: ConnRoot;
  readonly objects: ReadonlyArray<ObjectRef>;
  readonly rootExpanded: boolean;
  readonly expandedCats: ReadonlySet<ObjectKind>;
}

/** Flatten the tree to the list of currently visible rows, top to bottom. */
export const buildTree = (input: TreeInput): TreeRow[] => {
  const rows: TreeRow[] = [
    {
      type: 'connection',
      label: input.root.name,
      tag: input.root.tag,
      connected: input.root.connected,
      expanded: input.rootExpanded,
    },
  ];
  if (!input.rootExpanded) return rows;

  for (const cat of CATEGORY_ORDER) {
    const objs = input.objects.filter((o) => o.kind === cat.kind);
    if (objs.length === 0) continue;
    const expanded = input.expandedCats.has(cat.kind);
    rows.push({
      type: 'category',
      kind: cat.kind,
      label: cat.label,
      count: objs.length,
      expanded,
    });
    if (expanded) {
      for (const ref of objs) rows.push({ type: 'object', ref, label: ref.name });
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
