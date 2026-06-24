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
  type Page,
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
  total: number;
  gridRow: number;
  loading: boolean;

  init: () => Promise<void>;
  selectPrev: () => void;
  selectNext: () => void;
  openSelected: () => Promise<void>;
  toggleFocus: () => void;
  gridUp: () => void;
  gridDown: () => void;
  pageNext: () => Promise<void>;
  pagePrev: () => Promise<void>;
}

export type AppStore = StoreApi<AppState>;

export const createAppStore = (source: DataSource): AppStore =>
  createStore<AppState>((set, get) => {
    const load = async (ref: ObjectRef, page: Page): Promise<void> => {
      set({ loading: true, error: null });
      const res = await browseTable(source, ref, page);
      if (!res.ok) {
        set({ loading: false, status: 'error', error: res.error.message });
        return;
      }
      set({
        loading: false,
        current: ref,
        result: res.value.rows,
        total: res.value.total,
        page: res.value.page,
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
      total: 0,
      gridRow: 0,
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
        set({ focus: 'grid' });
        await load(ref, firstPage(PAGE_SIZE));
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

      pageNext: async () => {
        const { current, page, total } = get();
        if (!current || page.offset + page.limit >= total) return;
        await load(current, nextPage(page));
      },

      pagePrev: async () => {
        const { current, page } = get();
        if (!current || page.offset === 0) return;
        await load(current, prevPage(page));
      },
    };
  });
