/**
 * App store (Zustand, vanilla) — single source of UI truth. State is sliced and
 * actions delegate to application use cases; the store never touches a driver or
 * builds a query. The connected DataSource is injected once (DIP), so the store
 * is trivially testable with a fake source.
 */

import { createStore, type StoreApi } from 'zustand/vanilla';
import type { DataSource } from '../../domain/datasource/DataSource.ts';
import type { ObjectRef } from '../../domain/datasource/schema.ts';
import type { ResultSet } from '../../domain/datasource/ResultSet.ts';
import {
  firstPage,
  nextPage,
  prevPage,
  cycleSort,
  type Page,
  type Sort,
  type BrowseSpec,
} from '../../domain/query/Query.ts';
import { listObjects } from '../../application/usecases/ListObjects.ts';
import { browseTable } from '../../application/usecases/BrowseTable.ts';

export const PAGE_SIZE = 100;

export type Focus = 'sidebar' | 'grid';
export type Status = 'connecting' | 'ready' | 'error';

export interface AppState {
  status: Status;
  error: string | null;
  objects: ObjectRef[];
  selectedIndex: number;
  focus: Focus;
  current: ObjectRef | null;
  result: ResultSet | null;
  page: Page;
  sort: Sort | null;
  total: number;
  gridRow: number;
  gridCol: number;
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
}

export type AppStore = StoreApi<AppState>;

export const createAppStore = (source: DataSource): AppStore =>
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
        gridRow: 0,
      });
    };

    return {
      status: 'connecting',
      error: null,
      objects: [],
      selectedIndex: 0,
      focus: 'sidebar',
      current: null,
      result: null,
      page: firstPage(PAGE_SIZE),
      sort: null,
      total: 0,
      gridRow: 0,
      gridCol: 0,
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
        set({ focus: 'grid', gridCol: 0, sort: null });
        await load(ref, { page: firstPage(PAGE_SIZE), sort: null });
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
        const { current, sort, result, gridCol } = get();
        const column = result?.columns[gridCol]?.name;
        if (!current || !column) return;
        // Re-sort always returns to the first page for a coherent ordering.
        const next = cycleSort(sort, column);
        await load(current, { page: firstPage(PAGE_SIZE), sort: next });
      },

      pageNext: async () => {
        const { current, page, sort, total } = get();
        if (!current || page.offset + page.limit >= total) return;
        await load(current, { page: nextPage(page), sort });
      },

      pagePrev: async () => {
        const { current, page, sort } = get();
        if (!current || page.offset === 0) return;
        await load(current, { page: prevPage(page), sort });
      },
    };
  });
