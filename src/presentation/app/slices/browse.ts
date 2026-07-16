/**
 * Browse feature slice — everything behind the results grid's browse surface:
 * opening an object, paged/sorted/filtered loads (with the navigation-epoch
 * race guard), grid cursor movement, the cell inspector, and row edit/delete
 * staging. Extracted from the store's single closure; the store root composes
 * it and borrows `openObject`/`loadStructure` for the tree actions.
 */

import type { StoreApi } from 'zustand/vanilla';
import type { AppState, CellInspect, FilterReturnPoint } from '../store.ts';
import {
  asBrowsePreviewable,
  asEditPreviewable,
  asIntrospectable,
  asWriteErrorExplainable,
  type DataSource,
} from '../../../domain/datasource/DataSource.ts';
import type { DataSourceError } from '../../../domain/errors/errors.ts';
import { appError, fromError, type AppError } from '../appError.ts';
import type { ObjectRef, ObjectSchema } from '../../../domain/datasource/schema.ts';
import { columnsOf, objectRefKey } from '../../../domain/datasource/schema.ts';
import type { RowKey, RowPatch, FieldValue } from '../../../domain/datasource/edit.ts';
import {
  firstPage,
  nextPage,
  prevPage,
  cycleSort,
  type Filter,
  type BrowseSpec,
} from '../../../domain/query/Query.ts';
import { browseTable } from '../../../application/usecases/BrowseTable.ts';
import { updateRow, deleteRow } from '../../../application/usecases/EditRow.ts';
import { cellEditText, isJsonText, prettyJson } from '../../components/cellFormat.ts';

export const PAGE_SIZE = 100;

/** A failed row write as the status bar's one line: worded for a human when the
 *  source can explain the refusal (FK "still referenced"), else the raw driver
 *  message — the full driver facts ride along for the `!` overlay either way. */
const editFailure = (
  live: DataSource,
  verb: 'update' | 'delete',
  e: DataSourceError,
): AppError => {
  const why = asWriteErrorExplainable(live)?.explainWriteError(e);
  if (why?.kind !== 'stillReferenced') return fromError(e);
  const where = why.table ? `by "${why.table}"` : 'by other rows';
  const key = why.key ? ` — key ${why.key}` : '';
  return fromError(e, `cannot ${verb}: row is still referenced ${where}${key}`);
};

/** Pop an inspector back to its read-only view, keeping the scroll position —
 *  the one projection both esc and a no-op save must agree on. */
const backToView = (cv: CellInspect): CellInspect => ({
  mode: 'view',
  column: cv.column,
  value: cv.value,
  offset: cv.offset,
});

export interface BrowseSliceCtx {
  readonly set: StoreApi<AppState>['setState'];
  readonly get: StoreApi<AppState>['getState'];
  /** The live connection (owned by the store root; null when disconnected). */
  readonly source: () => DataSource | null;
}

export type BrowseActions = Pick<
  AppState,
  | 'clickGrid'
  | 'openCell'
  | 'closeCell'
  | 'scrollCell'
  | 'scrollStructure'
  | 'setStructureViewport'
  | 'setMainTab'
  | 'toggleMainTab'
  | 'gridUp'
  | 'gridDown'
  | 'gridLeft'
  | 'gridRight'
  | 'gridTop'
  | 'gridBottom'
  | 'gridHalfUp'
  | 'gridHalfDown'
  | 'setGridViewport'
  | 'applySort'
  | 'pageNext'
  | 'pagePrev'
  | 'refreshBrowse'
  | 'beginFilter'
  | 'cancelFilter'
  | 'commitFilter'
  | 'restoreFilter'
  | 'beginEdit'
  | 'cancelEdit'
  | 'submitEdit'
  | 'beginDelete'
>;

export interface BrowseSlice {
  readonly actions: BrowseActions;
  /** Open an object into the data grid (focus moves to the grid). */
  readonly openObject: (ref: ObjectRef) => Promise<void>;
  /** Lazily fetch the open object's column schema for the DDL tab (cached). */
  readonly loadStructure: () => Promise<void>;
}

export const createBrowseSlice = (ctx: BrowseSliceCtx): BrowseSlice => {
  const { set, get, source } = ctx;

  // Navigation epoch: every browse-affecting navigation bumps it and aborts
  // the previous in-flight load, so a slow stale response can neither
  // overwrite a newer navigation's state nor surface its own (aborted) error.
  let navEpoch = 0;
  let navAbort: AbortController | null = null;
  interface Nav {
    readonly epoch: number;
    readonly signal: AbortSignal;
  }
  const beginNav = (): Nav => {
    navAbort?.abort();
    navAbort = new AbortController();
    return { epoch: ++navEpoch, signal: navAbort.signal };
  };
  const stale = (nav: Nav): boolean => nav.epoch !== navEpoch;

  const load = async (
    ref: ObjectRef,
    spec: BrowseSpec,
    nav: Nav = beginNav(),
  ): Promise<boolean> => {
    const active = source();
    if (!active) return false;
    set({ loading: true, error: null, notice: null });
    // The primary key rides along as the ordering tiebreaker: without it an
    // unsorted browse has no deterministic order, so a row can jump to another
    // position after every write-then-reload (openObject sets pkColumns first).
    const res = await browseTable(active, ref, { ...spec, stableKey: get().pkColumns }, nav.signal);
    if (stale(nav)) return false; // a newer navigation owns the UI (this one was aborted)
    if (!res.ok) {
      set({ loading: false, status: 'error', error: fromError(res.error) });
      return false;
    }
    set({
      loading: false,
      current: ref,
      result: res.value.rows,
      total: res.value.total,
      page: res.value.spec.page,
      sort: res.value.spec.sort ?? null,
      filter: res.value.spec.filter ?? null,
      // Echo the exact statement the adapter ran (value-inlined). Same source
      // (ref, spec) as the result above, so the echo always matches the view.
      statement: asBrowsePreviewable(active)?.previewBrowse(ref, res.value.spec) ?? null,
      gridRow: 0,
    });
    return true;
  };

  const openObject = async (ref: ObjectRef): Promise<void> => {
    const active = source();
    if (!active) return;
    const nav = beginNav();
    set({
      focus: 'grid',
      surface: 'browse',
      gridCol: 0,
      sort: null,
      filter: null,
      filterReturnPoint: null,
      pkColumns: [],
      structure: null,
      structureError: null,
      structureScroll: 0,
      // Browsing is a fresh context: drop any leftover draft so the editor
      // echoes this object's browse statement, not the last query you ran.
      queryText: '',
      historyIndex: null,
    });
    // One describe decides everything: an object with a column section has rows
    // (browse it into the grid); a source-only object (index/trigger/…) has
    // none, so we skip the browse and show its definition in the structure tab.
    let schema: ObjectSchema | null = null;
    const introspectable = asIntrospectable(active);
    if (introspectable) {
      try {
        schema = await introspectable.describe(ref);
      } catch {
        /* describe failed → treat as browsable; load() surfaces any error */
      }
    }
    if (stale(nav)) return; // navigated away while describe was in flight
    const columns = schema ? columnsOf(schema) : [];
    set({
      structure: schema, // cache for the structure/DDL view
      pkColumns: columns.filter((c) => c.isPrimaryKey).map((c) => c.name),
    });
    if (!schema || columns.length > 0) {
      set({ mainTab: 'data' });
      await load(ref, { page: firstPage(PAGE_SIZE), sort: null, filter: null }, nav);
    } else {
      // No rows to browse — present the definition only.
      set({ current: ref, result: null, total: 0, statement: null, mainTab: 'ddl' });
    }
  };

  const loadStructure = async (): Promise<void> => {
    const active = source();
    if (!active) return;
    const { current, structure } = get();
    if (!current || structure) return; // already loaded for this object
    const introspectable = asIntrospectable(active);
    if (!introspectable) {
      set({ structureError: 'structure is not available for this source' });
      return;
    }
    set({ structureLoading: true, structureError: null });
    try {
      const schema = await introspectable.describe(current);
      set({ structure: schema, structureLoading: false });
    } catch (e) {
      set({ structureLoading: false, structureError: (e as Error).message });
    }
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
    const nav = beginNav();
    await load(current, { page, sort, filter }, nav);
    if (stale(nav)) return;
    const len = get().result?.rows.length ?? 0;
    set({ gridRow: Math.min(gridRow, Math.max(0, len - 1)) });
  };

  const keyText = (key: RowKey): string =>
    key.map((k) => `${k.column}=${String(k.value)}`).join(' AND ');

  const actions: BrowseActions = {
    clickGrid: (row, col) =>
      set((s) => ({
        focus: 'grid',
        gridRow: row != null ? row : s.gridRow,
        gridCol: col != null ? col : s.gridCol,
      })),

    openCell: () => {
      const { result, gridRow, gridCol } = get();
      const column = result?.columns[gridCol]?.name;
      if (!result || !column) return;
      const value = result.rows[gridRow]?.[gridCol] ?? null;
      set({ cellView: { column, value, offset: 0, mode: 'view' } });
    },

    closeCell: () => set({ cellView: null }),

    scrollCell: (delta) =>
      set((s) =>
        s.cellView
          ? { cellView: { ...s.cellView, offset: Math.max(0, s.cellView.offset + delta) } }
          : {},
      ),

    scrollStructure: (delta) =>
      set((s) => ({
        structureScroll: Math.max(0, Math.min(s.structureMaxScroll, s.structureScroll + delta)),
      })),

    setStructureViewport: (maxScroll) =>
      set((s) =>
        s.structureMaxScroll === maxScroll
          ? s
          : { structureMaxScroll: maxScroll, structureScroll: Math.min(s.structureScroll, maxScroll) },
      ),

    setMainTab: (tab) => {
      set({ mainTab: tab, structureScroll: 0 });
      if (tab === 'ddl') void loadStructure();
    },

    toggleMainTab: () => {
      // A source-only object (index/trigger/…) has no Data tab to flip to — the
      // structure (its definition) is all there is, so the toggle is inert.
      const s = get().structure;
      if (s && columnsOf(s).length === 0) return;
      const next = get().mainTab === 'data' ? 'ddl' : 'data';
      set({ mainTab: next, structureScroll: 0 });
      if (next === 'ddl') void loadStructure();
    },

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

    gridTop: () => set({ gridRow: 0 }),

    gridBottom: () =>
      set((s) => ({ gridRow: Math.max(0, (s.result?.rows.length ?? 1) - 1) })),

    gridHalfUp: () =>
      set((s) => ({
        gridRow: Math.max(0, s.gridRow - Math.max(1, Math.floor(s.gridViewportRows / 2))),
      })),

    gridHalfDown: () =>
      set((s) => ({
        gridRow: Math.min(
          Math.max(0, (s.result?.rows.length ?? 1) - 1),
          s.gridRow + Math.max(1, Math.floor(s.gridViewportRows / 2)),
        ),
      })),

    setGridViewport: (rows) =>
      set((s) => (s.gridViewportRows === rows ? s : { gridViewportRows: rows })),

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

    refreshBrowse: () => reloadKeepingCursor(),

    beginFilter: () => {
      const { current, result, gridCol } = get();
      const column = result?.columns[gridCol]?.name;
      if (!current || !column) return;
      // The native <input> holds the draft; it is seeded with any existing
      // filter value for this column (derived in the view), so the store keeps
      // no draft of its own.
      set({ mode: 'filter' });
    },

    cancelFilter: () => set({ mode: 'normal' }),

    commitFilter: async (value) => {
      const { current, page, sort, filter, result, gridRow, gridCol } = get();
      const column = result?.columns[gridCol]?.name;
      set({ mode: 'normal' });
      if (!current || !column) return;
      const v = value.trim();
      const nextFilter: Filter | null = v
        ? { conditions: [{ column, op: 'contains', value: v }] }
        : null;
      const returnPoint: FilterReturnPoint = {
        ref: current,
        page,
        sort,
        filter,
        gridRow,
        gridCol,
      };
      set({ filterReturnPoint: returnPoint });
      const nav = beginNav();
      const applied = await load(
        current,
        { page: firstPage(PAGE_SIZE), sort, filter: nextFilter },
        nav,
      );
      // A real failure leaves the old result on screen, so there is nothing to
      // undo. A stale request must not clear the return point owned by the newer
      // navigation (including an esc restore already in flight).
      if (!applied && !stale(nav) && get().filterReturnPoint === returnPoint) {
        set({ filterReturnPoint: null });
      }
    },

    restoreFilter: async () => {
      const { filterReturnPoint, current, surface } = get();
      if (!filterReturnPoint) return;
      if (
        surface !== 'browse' ||
        !current ||
        objectRefKey(current) !== objectRefKey(filterReturnPoint.ref)
      ) {
        set({ filterReturnPoint: null });
        return;
      }

      const nav = beginNav();
      const restored = await load(
        filterReturnPoint.ref,
        {
          page: filterReturnPoint.page,
          sort: filterReturnPoint.sort,
          filter: filterReturnPoint.filter,
        },
        nav,
      );
      if (!restored || stale(nav)) return;

      const restoredResult = get().result;
      set({
        filterReturnPoint: null,
        gridRow: Math.min(
          filterReturnPoint.gridRow,
          Math.max(0, (restoredResult?.rows.length ?? 1) - 1),
        ),
        gridCol: Math.min(
          filterReturnPoint.gridCol,
          Math.max(0, (restoredResult?.columns.length ?? 1) - 1),
        ),
      });
    },

    beginEdit: () => {
      const { result, gridRow, gridCol, pkColumns, structure, current, cellView } = get();
      const column = result?.columns[gridCol]?.name;
      if (!result || !column) return;
      if (pkColumns.length === 0) {
        set({ error: appError('table has no primary key — editing disabled') });
        return;
      }
      // Freeze the row locator NOW: submitEdit must target the cell the draft
      // was seeded from, whatever the grid cursor does while the overlay is up.
      const rowKey = currentRowKey();
      if (!rowKey) {
        set({ error: appError('cannot locate this row by primary key — editing disabled') });
        return;
      }
      const value = result.rows[gridRow]?.[gridCol] ?? null;
      // Editing happens in the cell inspector overlay (ADR 0011): open it in
      // edit mode seeded with THIS cell. Binary blobs aren't text-editable.
      if (value instanceof Uint8Array) {
        set({ error: appError('binary value — not editable here') });
        return;
      }
      // The <textarea> holds the draft (seeded from `seedText`); the store keeps
      // no draft of its own — submitEdit reads the widget's text on ^S. On a
      // jsonCanonical column (from the object's cached describe) the seed is
      // pretty-printed: the store normalizes JSON anyway, so the layout is free.
      // Mid-navigation `structure` lands before load() commits `current` (the
      // nav epoch only discards STALE sets, it doesn't order these two), so the
      // cache may briefly describe the NEXT object — only trust a match.
      const jsonCanonical =
        structure != null &&
        current != null &&
        objectRefKey(structure.ref) === objectRefKey(current) &&
        columnsOf(structure).find((c) => c.name === column)?.jsonCanonical === true;
      const raw = cellEditText(value);
      const seedText = jsonCanonical ? (prettyJson(raw) ?? raw) : raw;
      set({
        cellView: {
          mode: 'edit',
          column,
          value,
          offset: cellView?.offset ?? 0,
          seedText,
          jsonCanonical,
          rowKey,
        },
        error: null,
      });
    },

    // Cancel a cell edit → discard the draft and fall back to the value view
    // (esc). The inspector stays open: editing is only entered from view (`e`),
    // so esc always pops back to where the edit began. A no-op if nothing's open.
    cancelEdit: () =>
      set((s) => (s.cellView ? { cellView: backToView(s.cellView), error: null } : {})),

    submitEdit: (value) => {
      const active = source();
      const { current, cellView } = get();
      if (!current || cellView?.mode !== 'edit') {
        set({ mode: 'normal', cellView: null });
        return;
      }
      // Target the cell the draft was SEEDED from (column + frozen row key),
      // never the live cursor — the grid under the overlay is still clickable,
      // so gridRow/gridCol may have moved since `e`.
      const { column, rowKey: key } = cellView;
      if (cellView.jsonCanonical) {
        // Untouched pretty seed → nothing to stage: the seed's layout is OUR
        // reformatting, not the user's edit. Plain columns keep save-always
        // semantics (a deliberate re-save can fire ON UPDATE triggers).
        if (value === cellView.seedText) {
          set({ cellView: backToView(cellView), notice: 'no change', error: null });
          return;
        }
        // A jsonCanonical column would reject malformed JSON anyway — fail
        // here, next to the draft, instead of at the database.
        if (!isJsonText(value)) {
          set({ error: appError('not valid JSON — fix the draft or esc to discard') });
          return;
        }
      }
      // Echo the dialect's own statement (value-inlined) when the source can
      // render one, so the approved text can't drift from what runs; the
      // readable fallback covers document/kv sources with no SQL to show.
      const patch: RowPatch = [{ column, value }];
      const preview = active ? asEditPreviewable(active) : null;
      set({
        mode: 'confirm',
        cellView: null, // leave the editor; the confirm owns the screen + y/n
        error: null,
        pending: {
          title: `Update ${column} in ${current.name}?`,
          statement:
            preview?.previewUpdate(current, key, patch) ??
            `update ${current.name} set ${column} where ${keyText(key)}`,
          tone: 'normal',
          run: async () => {
            const live = source();
            if (!live) return;
            const r = await updateRow(live, current, key, patch);
            if (!r.ok) set({ status: 'error', error: editFailure(live, 'update', r.error) });
            else await reloadKeepingCursor();
          },
        },
      });
    },

    beginDelete: () => {
      const active = source();
      const { current } = get();
      const key = currentRowKey();
      if (!current || !key) {
        set({ error: appError('table has no primary key — cannot delete') });
        return;
      }
      const preview = active ? asEditPreviewable(active) : null;
      set({
        mode: 'confirm',
        pending: {
          title: `Delete this row from ${current.name}?`,
          statement:
            preview?.previewDelete(current, key) ??
            `delete from ${current.name} where ${keyText(key)}`,
          tone: 'danger',
          run: async () => {
            const live = source();
            if (!live) return;
            const r = await deleteRow(live, current, key);
            if (!r.ok) set({ status: 'error', error: editFailure(live, 'delete', r.error) });
            else await reloadKeepingCursor();
          },
        },
      });
    },
  };

  return { actions, openObject, loadStructure };
};
