/**
 * App store (Zustand, vanilla) — single source of UI truth. State is sliced and
 * actions delegate to application use cases; the store never touches a driver or
 * builds a query. The connected DataSource is injected once (DIP), so the store
 * is trivially testable with a fake source.
 */

import { createStore, type StoreApi } from 'zustand/vanilla';
import {
  asIntrospectable,
  type DataSource,
} from '../../domain/datasource/DataSource.ts';
import type { ObjectRef } from '../../domain/datasource/schema.ts';
import type { RowKey, FieldValue } from '../../domain/datasource/edit.ts';
import type { ResultSet } from '../../domain/datasource/ResultSet.ts';
import {
  firstPage,
  nextPage,
  prevPage,
  cycleSort,
  type Page,
  type Sort,
  type Filter,
  type BrowseSpec,
} from '../../domain/query/Query.ts';
import { listObjects } from '../../application/usecases/ListObjects.ts';
import { browseTable } from '../../application/usecases/BrowseTable.ts';
import { updateRow, deleteRow } from '../../application/usecases/EditRow.ts';

export const PAGE_SIZE = 100;

export type Focus = 'sidebar' | 'grid';
export type Status = 'connecting' | 'ready' | 'error';
export type Mode = 'normal' | 'filter' | 'edit' | 'confirm';

/** A confirmed, ready-to-run action awaiting the user's y/n. */
export interface Pending {
  readonly message: string;
  readonly run: () => Promise<void>;
}

export interface AppState {
  status: Status;
  error: string | null;
  connectionName: string | null;
  objects: ObjectRef[];
  selectedIndex: number;
  focus: Focus;
  current: ObjectRef | null;
  result: ResultSet | null;
  page: Page;
  sort: Sort | null;
  filter: Filter | null;
  total: number;
  gridRow: number;
  gridCol: number;
  mode: Mode;
  filterDraft: string;
  editDraft: string;
  pkColumns: string[];
  pending: Pending | null;
  loading: boolean;

  init: () => Promise<void>;
  selectPrev: () => void;
  selectNext: () => void;
  openSelected: () => Promise<void>;
  toggleFocus: () => void;
  gridUp: () => void;
  gridDown: () => void;
  gridLeft: () => void;
  gridRight: () => void;
  applySort: () => Promise<void>;
  pageNext: () => Promise<void>;
  pagePrev: () => Promise<void>;
  beginFilter: () => void;
  updateFilterDraft: (text: string) => void;
  cancelFilter: () => void;
  commitFilter: () => Promise<void>;
  beginEdit: () => void;
  updateEditDraft: (text: string) => void;
  cancelEdit: () => void;
  submitEdit: () => void;
  beginDelete: () => void;
  confirmPending: () => Promise<void>;
  cancelPending: () => void;
}

export type AppStore = StoreApi<AppState>;

export const createAppStore = (
  source: DataSource,
  connectionName: string | null = null,
): AppStore =>
  createStore<AppState>((set, get) => {
    const load = async (ref: ObjectRef, spec: BrowseSpec): Promise<void> => {
      set({ loading: true, error: null });
      const res = await browseTable(source, ref, spec);
      if (!res.ok) {
        set({ loading: false, status: 'error', error: res.error.message });
        return;
      }
      set({
        loading: false,
        current: ref,
        result: res.value.rows,
        total: res.value.total,
        page: res.value.spec.page,
        sort: res.value.spec.sort ?? null,
        filter: res.value.spec.filter ?? null,
        gridRow: 0,
      });
    };

    /** Build the primary-key locator for the row under the cursor. */
    const currentRowKey = (): RowKey | null => {
      const { result, gridRow, pkColumns } = get();
      if (!result || pkColumns.length === 0) return null;
      const row = result.rows[gridRow];
      if (!row) return null;
      const key: FieldValue[] = [];
      for (const name of pkColumns) {
        const i = result.columns.findIndex((c) => c.name === name);
        if (i < 0) return null;
        key.push({ column: name, value: row[i] ?? null });
      }
      return key;
    };

    /** Re-fetch the current window after a write, keeping the cursor in range. */
    const reloadKeepingCursor = async (): Promise<void> => {
      const { current, page, sort, filter, gridRow } = get();
      if (!current) return;
      await load(current, { page, sort, filter });
      const len = get().result?.rows.length ?? 0;
      set({ gridRow: Math.min(gridRow, Math.max(0, len - 1)) });
    };

    const keyText = (key: RowKey): string =>
      key.map((k) => `${k.column}=${String(k.value)}`).join(' AND ');

    return {
      status: 'connecting',
      error: null,
      connectionName,
      objects: [],
      selectedIndex: 0,
      focus: 'sidebar',
      current: null,
      result: null,
      page: firstPage(PAGE_SIZE),
      sort: null,
      filter: null,
      total: 0,
      gridRow: 0,
      gridCol: 0,
      mode: 'normal',
      filterDraft: '',
      editDraft: '',
      pkColumns: [],
      pending: null,
      loading: false,

      init: async () => {
        const res = await listObjects(source);
        if (!res.ok) {
          set({ status: 'error', error: res.error.message });
          return;
        }
        set({ status: 'ready', objects: res.value });
      },

      selectPrev: () =>
        set((s) => ({ selectedIndex: Math.max(0, s.selectedIndex - 1) })),

      selectNext: () =>
        set((s) => ({
          selectedIndex: Math.min(s.objects.length - 1, s.selectedIndex + 1),
        })),

      openSelected: async () => {
        const { objects, selectedIndex } = get();
        const ref = objects[selectedIndex];
        if (!ref) return;
        set({ focus: 'grid', gridCol: 0, sort: null, filter: null, pkColumns: [] });
        // Primary-key columns gate editing; a table without one is read-only.
        const introspectable = asIntrospectable(source);
        if (introspectable) {
          try {
            const schema = await introspectable.describe(ref);
            set({
              pkColumns: schema.columns
                .filter((c) => c.isPrimaryKey)
                .map((c) => c.name),
            });
          } catch {
            /* leave pkColumns empty → editing disabled for this table */
          }
        }
        await load(ref, { page: firstPage(PAGE_SIZE), sort: null, filter: null });
      },

      toggleFocus: () =>
        set((s) => ({ focus: s.focus === 'sidebar' ? 'grid' : 'sidebar' })),

      gridUp: () => set((s) => ({ gridRow: Math.max(0, s.gridRow - 1) })),

      gridDown: () =>
        set((s) => ({
          gridRow: Math.min(
            Math.max(0, (s.result?.rows.length ?? 1) - 1),
            s.gridRow + 1,
          ),
        })),

      gridLeft: () => set((s) => ({ gridCol: Math.max(0, s.gridCol - 1) })),

      gridRight: () =>
        set((s) => ({
          gridCol: Math.min(
            Math.max(0, (s.result?.columns.length ?? 1) - 1),
            s.gridCol + 1,
          ),
        })),

      applySort: async () => {
        const { current, sort, filter, result, gridCol } = get();
        const column = result?.columns[gridCol]?.name;
        if (!current || !column) return;
        // Re-sort always returns to the first page for a coherent ordering.
        const next = cycleSort(sort, column);
        await load(current, { page: firstPage(PAGE_SIZE), sort: next, filter });
      },

      pageNext: async () => {
        const { current, page, sort, filter, total } = get();
        if (!current || page.offset + page.limit >= total) return;
        await load(current, { page: nextPage(page), sort, filter });
      },

      pagePrev: async () => {
        const { current, page, sort, filter } = get();
        if (!current || page.offset === 0) return;
        await load(current, { page: prevPage(page), sort, filter });
      },

      beginFilter: () => {
        const { current, filter, result, gridCol } = get();
        const column = result?.columns[gridCol]?.name;
        if (!current || !column) return;
        // Pre-fill the draft with the existing value for this column, if any.
        const existing = filter?.conditions.find((c) => c.column === column);
        set({ mode: 'filter', filterDraft: existing?.value ?? '' });
      },

      updateFilterDraft: (text) => set({ filterDraft: text }),

      cancelFilter: () => set({ mode: 'normal', filterDraft: '' }),

      commitFilter: async () => {
        const { current, sort, result, gridCol, filterDraft } = get();
        const column = result?.columns[gridCol]?.name;
        set({ mode: 'normal', filterDraft: '' });
        if (!current || !column) return;
        const value = filterDraft.trim();
        const filter: Filter | null = value
          ? { conditions: [{ column, op: 'contains', value }] }
          : null;
        await load(current, { page: firstPage(PAGE_SIZE), sort, filter });
      },

      beginEdit: () => {
        const { result, gridRow, gridCol, pkColumns } = get();
        const column = result?.columns[gridCol]?.name;
        if (!result || !column) return;
        if (pkColumns.length === 0) {
          set({ error: 'table has no primary key — editing disabled' });
          return;
        }
        const cell = result.rows[gridRow]?.[gridCol];
        set({ mode: 'edit', error: null, editDraft: cell == null ? '' : String(cell) });
      },

      updateEditDraft: (text) => set({ editDraft: text }),

      cancelEdit: () => set({ mode: 'normal', editDraft: '' }),

      submitEdit: () => {
        const { current, result, gridCol, editDraft } = get();
        const column = result?.columns[gridCol]?.name;
        const key = currentRowKey();
        if (!current || !column || !key) {
          set({ mode: 'normal', editDraft: '' });
          return;
        }
        const value = editDraft;
        set({
          mode: 'confirm',
          editDraft: '',
          pending: {
            message: `UPDATE ${current.name} SET ${column} = '${value}' WHERE ${keyText(key)}`,
            run: async () => {
              const r = await updateRow(source, current, key, [
                { column, value },
              ]);
              if (!r.ok) set({ status: 'error', error: r.error.message });
              else await reloadKeepingCursor();
            },
          },
        });
      },

      beginDelete: () => {
        const { current } = get();
        const key = currentRowKey();
        if (!current || !key) {
          set({ error: 'table has no primary key — cannot delete' });
          return;
        }
        set({
          mode: 'confirm',
          pending: {
            message: `DELETE FROM ${current.name} WHERE ${keyText(key)}`,
            run: async () => {
              const r = await deleteRow(source, current, key);
              if (!r.ok) set({ status: 'error', error: r.error.message });
              else await reloadKeepingCursor();
            },
          },
        });
      },

      confirmPending: async () => {
        const { pending } = get();
        set({ mode: 'normal' });
        if (pending) await pending.run();
        set({ pending: null });
      },

      cancelPending: () => set({ mode: 'normal', pending: null }),
    };
  });
