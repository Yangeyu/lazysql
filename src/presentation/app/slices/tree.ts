/**
 * Sidebar-tree feature slice — cursor movement over the flattened tree rows,
 * fold/unfold of connection/category/schema containers, and the object-row
 * actions (open, browse, show DDL, draft a DROP). Extracted from the store's
 * single closure; the tree PROJECTION (rowsNow) stays in the root — it is
 * shared by the export and connection-form slices too — and browsing an object
 * is borrowed from the browse slice.
 */

import type { StoreApi } from 'zustand/vanilla';
import type { AppState } from '../store.ts';
import { asDdlScriptable, type DataSource } from '../../../domain/datasource/DataSource.ts';
import type { ObjectRef } from '../../../domain/datasource/schema.ts';
import { firstObjectIndex, refKey, schemaKey, type TreeRow } from '../../tree/tree.ts';

export interface TreeSliceCtx {
  readonly set: StoreApi<AppState>['setState'];
  readonly get: StoreApi<AppState>['getState'];
  /** The live connection (owned by the store root; null when disconnected). */
  readonly source: () => DataSource | null;
  /** Root-owned tree projection (shared with the export/conn-form slices). */
  readonly rowsNow: () => TreeRow[];
  /** Root-owned: re-clamp the cursor after the visible row count changes. */
  readonly clampTree: () => void;
  /** Browse-slice: open an object into the data grid. */
  readonly openObject: (ref: ObjectRef) => Promise<void>;
  /** Browse-slice: fetch the open object's schema for the DDL tab. */
  readonly loadStructure: () => Promise<void>;
}

export type TreeActions = Pick<
  AppState,
  | 'clickTree'
  | 'treeRows'
  | 'treeUp'
  | 'treeDown'
  | 'treeTop'
  | 'treeBottom'
  | 'beginTreeFilter'
  | 'setTreeFilter'
  | 'commitTreeFilter'
  | 'clearTreeFilter'
  | 'treeToggle'
  | 'browseSelected'
  | 'treeExpand'
  | 'treeCollapse'
  | 'treeShowDdl'
  | 'draftDrop'
>;

export const createTreeSlice = (ctx: TreeSliceCtx): TreeActions => {
  const { set, get, source, rowsNow, clampTree, openObject, loadStructure } = ctx;
  return {
    clickTree: (row) => {
      get().focusPane('sidebar');
      set((s) => ({ treeIndex: row != null ? row : s.treeIndex }));
    },

    treeRows: () => rowsNow(),

    treeUp: () => set((s) => ({ treeIndex: Math.max(0, s.treeIndex - 1) })),

    treeDown: () =>
      set((s) => ({
        treeIndex: Math.min(rowsNow().length - 1, s.treeIndex + 1),
      })),

    treeTop: () => set({ treeIndex: 0 }),

    treeBottom: () => set({ treeIndex: Math.max(0, rowsNow().length - 1) }),

    beginTreeFilter: () => set({ mode: 'treeFilter' }),

    setTreeFilter: (value) => {
      // Live-narrow, then seat the cursor on the first surviving object so ⏎
      // (commit) lands ready to open it; firstObjectIndex falls to 0 (the root)
      // when nothing matches, which is the sensible resting spot for "no hits".
      set({ treeFilter: value });
      set({ treeIndex: firstObjectIndex(rowsNow()) });
    },

    commitTreeFilter: () =>
      set({ mode: 'normal', treeIndex: firstObjectIndex(rowsNow()) }),

    clearTreeFilter: () => {
      // Clearing restores the full tree, so the pre-filter cursor index now points
      // at an unrelated row. Land it on the open object instead — where the user
      // actually is — revealing its container(s) first, since the restored fold
      // state may have hidden it. No open object ⇒ fall back to the first object.
      const cur = get().current;
      set((s) => ({
        mode: 'normal',
        treeFilter: '',
        expandedCats: cur ? new Set(s.expandedCats).add(cur.kind) : s.expandedCats,
        expandedSchemas: cur?.namespace
          ? new Set(s.expandedSchemas).add(schemaKey(cur.kind, cur.namespace))
          : s.expandedSchemas,
      }));
      const rows = rowsNow();
      const at = cur
        ? rows.findIndex((r) => r.type === 'object' && refKey(r.ref) === refKey(cur))
        : -1;
      set({ treeIndex: at >= 0 ? at : firstObjectIndex(rows) });
    },

    treeToggle: async () => {
      const row = rowsNow()[get().treeIndex];
      if (!row) return;
      if (row.type === 'object') {
        await openObject(row.ref);
        return;
      }
      if (row.type === 'connection') {
        // Active connection folds; an inactive one connects (switches to it).
        if (row.active) set((s) => ({ rootExpanded: !s.rootExpanded }));
        else void get().connect(row.id);
      } else if (row.type === 'category') {
        const next = new Set(get().expandedCats);
        next.has(row.kind) ? next.delete(row.kind) : next.add(row.kind);
        set({ expandedCats: next });
      } else {
        const key = schemaKey(row.kind, row.namespace);
        const next = new Set(get().expandedSchemas);
        next.has(key) ? next.delete(key) : next.add(key);
        set({ expandedSchemas: next });
      }
      clampTree();
    },

    browseSelected: () => {
      const row = rowsNow()[get().treeIndex];
      if (row?.type === 'object') {
        void openObject(row.ref);
        return;
      }
      // The cursor isn't on an object (e.g. moved to a category after a query):
      // fall back to re-browsing whatever object is currently open.
      const cur = get().current;
      if (cur) void openObject(cur);
    },

    treeExpand: async () => {
      const row = rowsNow()[get().treeIndex];
      if (!row) return;
      if (row.type === 'object') {
        await openObject(row.ref);
      } else if (row.type === 'connection') {
        if (!row.active) void get().connect(row.id);
        else if (!get().rootExpanded) set({ rootExpanded: true });
      } else if (row.type === 'category') {
        if (!get().expandedCats.has(row.kind)) {
          set({ expandedCats: new Set(get().expandedCats).add(row.kind) });
        }
      } else {
        const key = schemaKey(row.kind, row.namespace);
        if (!get().expandedSchemas.has(key)) {
          set({ expandedSchemas: new Set(get().expandedSchemas).add(key) });
        }
      }
    },

    treeCollapse: () => {
      const rows = rowsNow();
      const i = get().treeIndex;
      const row = rows[i];
      if (!row) return;
      // Jump the cursor to the nearest ancestor row above matching `is`.
      const parentAbove = (is: (r: TreeRow) => boolean): void => {
        for (let j = i - 1; j >= 0; j--) {
          if (is(rows[j]!)) return set({ treeIndex: j });
        }
        set({ treeIndex: 0 });
      };
      if (row.type === 'object') {
        // Parent is the schema header when grouped, else the category header.
        parentAbove((r) => r.type === 'schema' || r.type === 'category');
      } else if (row.type === 'schema') {
        if (get().expandedSchemas.has(schemaKey(row.kind, row.namespace))) {
          const next = new Set(get().expandedSchemas);
          next.delete(schemaKey(row.kind, row.namespace));
          set({ expandedSchemas: next });
          clampTree();
        } else {
          parentAbove((r) => r.type === 'category');
        }
      } else if (row.type === 'category') {
        if (get().expandedCats.has(row.kind)) {
          const next = new Set(get().expandedCats);
          next.delete(row.kind);
          set({ expandedCats: next });
          clampTree();
        } else {
          parentAbove((r) => r.type === 'connection'); // jump to the owning root
        }
      } else if (row.active && get().rootExpanded) {
        set({ rootExpanded: false });
        clampTree();
      }
    },

    treeShowDdl: async () => {
      const row = rowsNow()[get().treeIndex];
      if (!row || row.type !== 'object') return;
      await openObject(row.ref);
      set({ mainTab: 'ddl' });
      await loadStructure();
    },

    draftDrop: () => {
      const row = rowsNow()[get().treeIndex];
      if (!row || row.type !== 'object') return;
      // The adapter builds a quoted, schema-qualified DROP (reserved-word safe)
      // and returns null for a kind it can't drop directly — the authority on
      // droppability, so no kind list lives here. Non-SQL sources lack it.
      const active = source();
      const scriptable = active ? asDdlScriptable(active) : null;
      const stmt = scriptable?.dropStatement(row.ref) ?? null;
      if (stmt === null) return;
      get().setQuery(stmt);
      get().focusPane('editor');
    },
  };
};
