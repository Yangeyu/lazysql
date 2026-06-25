/**
 * App store (Zustand, vanilla) — single source of UI truth. State is sliced and
 * actions delegate to application use cases; the store never touches a driver or
 * builds a query. The connected DataSource is injected once (DIP), so the store
 * is trivially testable with a fake source.
 */

import { createStore, type StoreApi } from 'zustand/vanilla';
import {
  asIntrospectable,
  asQueryable,
  type DataSource,
} from '../../domain/datasource/DataSource.ts';
import type {
  ObjectKind,
  ObjectRef,
  ObjectSchema,
} from '../../domain/datasource/schema.ts';
import type { RowKey, FieldValue } from '../../domain/datasource/edit.ts';
import {
  buildTree,
  firstCategoryKind,
  firstObjectIndex,
  shortTag,
  type TreeRow,
} from '../tree/tree.ts';
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
import { runQuery } from '../../application/usecases/RunQuery.ts';
import { generateSql } from '../../application/usecases/GenerateSql.ts';
import type {
  SqlGenerator,
  SchemaContext,
} from '../../application/ports/SqlGenerator.ts';
import type { StatementKind } from '../../domain/query/classify.ts';
import {
  complete,
  type SchemaCatalog,
} from '../completion/sqlCompleter.ts';

export const PAGE_SIZE = 100;

export type Focus = 'sidebar' | 'grid';
export type Status = 'connecting' | 'ready' | 'error';
export type Mode = 'normal' | 'filter' | 'edit' | 'confirm';
export type View = 'browse' | 'query';
export type QueryFocus = 'editor' | 'result';
/** Which face of the main pane is showing for an open object. */
export type MainTab = 'data' | 'ddl';

/** A confirmed, ready-to-run action awaiting the user's y/n. */
export interface Pending {
  readonly message: string;
  readonly run: () => Promise<void>;
}

export interface AppState {
  status: Status;
  error: string | null;
  connectionName: string | null;
  /** Human dialect label of the active connection, e.g. 'PostgreSQL'. */
  dialectLabel: string;
  objects: ObjectRef[];
  // ── sidebar tree ──
  /** Whether the connection root is expanded (shows its categories). */
  rootExpanded: boolean;
  /** Categories currently expanded (by object kind). */
  expandedCats: Set<ObjectKind>;
  /** Cursor into the flattened visible tree rows. */
  treeIndex: number;
  focus: Focus;
  current: ObjectRef | null;
  // ── main pane (data │ ddl) ──
  mainTab: MainTab;
  structure: ObjectSchema | null;
  structureLoading: boolean;
  structureError: string | null;
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
  /** Whether this source speaks SQL (Query capability) — gates the `:` editor. */
  queryable: boolean;
  /** Whether the `?` help overlay is showing. */
  helpOpen: boolean;

  // ── query editor ──
  view: View;
  queryFocus: QueryFocus;
  queryText: string;
  queryResult: ResultSet | null;
  queryError: string | null;
  queryElapsedMs: number | null;
  queryGridRow: number;
  history: string[];
  historyIndex: number | null;
  catalog: SchemaCatalog | null;
  completions: string[];

  // ── NL→SQL ──
  nlAvailable: boolean;
  nlMode: boolean;
  nlDraft: string;
  generating: boolean;
  nlExplanation: string | null;
  nlKind: StatementKind | null;

  init: () => Promise<void>;
  toggleHelp: () => void;
  /** The flattened, currently-visible sidebar tree rows. */
  treeRows: () => TreeRow[];
  treeUp: () => void;
  treeDown: () => void;
  /** Enter/Space: toggle a container's fold, or open an object. */
  treeToggle: () => Promise<void>;
  /** →/l: expand a container, or open an object. */
  treeExpand: () => Promise<void>;
  /** ←/h: collapse a container, or jump from an object to its category. */
  treeCollapse: () => void;
  /** →/D from the sidebar on an object: open it showing its DDL/structure. */
  treeShowDdl: () => Promise<void>;
  setMainTab: (tab: MainTab) => void;
  toggleMainTab: () => void;
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

  enterQueryView: () => void;
  exitQueryView: () => void;
  updateQueryText: (text: string) => void;
  executeQuery: () => Promise<void>;
  historyPrev: () => void;
  historyNext: () => void;
  toggleQueryFocus: () => void;
  queryGridUp: () => void;
  queryGridDown: () => void;
  acceptCompletion: () => void;
  beginNl: () => void;
  updateNlDraft: (text: string) => void;
  cancelNl: () => void;
  generateFromNl: () => Promise<void>;
}

export type AppStore = StoreApi<AppState>;

export const createAppStore = (
  source: DataSource,
  connectionName: string | null = null,
  generator: SqlGenerator | null = null,
  dialect: string = 'SQL',
): AppStore =>
  createStore<AppState>((set, get) => {
    // Capability-driven UI gating: features come from what the source can do,
    // never from its type. A non-Queryable source (Mongo/Redis) hides the SQL
    // editor and NL→SQL entirely. (docs/adr/0005)
    const queryable = asQueryable(source) !== null;

    /** Build the flattened tree rows from the current state (pure). */
    const rowsNow = (): TreeRow[] => {
      const { connectionName, dialectLabel, objects, rootExpanded, expandedCats } =
        get();
      return buildTree({
        root: {
          name: connectionName ?? '(no connection)',
          tag: shortTag(dialectLabel),
          connected: true,
        },
        objects,
        rootExpanded,
        expandedCats,
      });
    };

    /** Re-clamp the cursor after the visible row count changes. */
    const clampTree = (): void =>
      set((s) => ({
        treeIndex: Math.min(s.treeIndex, Math.max(0, rowsNow().length - 1)),
      }));

    /** Open an object into the data grid (focus moves to the grid). */
    const openObject = async (ref: ObjectRef): Promise<void> => {
      set({
        focus: 'grid',
        gridCol: 0,
        sort: null,
        filter: null,
        pkColumns: [],
        mainTab: 'data',
        structure: null,
        structureError: null,
      });
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
    };

    /** Lazily fetch the open object's column schema for the DDL tab (cached). */
    const loadStructure = async (): Promise<void> => {
      const { current, structure } = get();
      if (!current || structure) return; // already loaded for this object
      const introspectable = asIntrospectable(source);
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

    /** Recompute completions for the editor text against the cached catalog. */
    const completionsFor = (text: string): string[] => {
      const cat = get().catalog;
      return cat ? complete(text, cat).candidates : [];
    };

    /** Build the table/column catalog once, for schema-aware completion. */
    const buildCatalog = async (): Promise<void> => {
      const introspectable = asIntrospectable(source);
      if (!introspectable) return;
      try {
        const snapshot = await introspectable.introspect();
        const tables = snapshot.objects.map((o) => o.name);
        const columnsByTable: Record<string, string[]> = {};
        await Promise.all(
          snapshot.objects.slice(0, 50).map(async (o) => {
            try {
              const schema = await introspectable.describe(o);
              columnsByTable[o.name] = schema.columns.map((c) => c.name);
            } catch {
              /* skip a table we cannot describe */
            }
          }),
        );
        set({ catalog: { tables, columnsByTable } });
      } catch {
        /* completion simply stays empty if introspection fails */
      }
    };

    return {
      status: 'connecting',
      error: null,
      connectionName,
      dialectLabel: dialect,
      objects: [],
      rootExpanded: true,
      expandedCats: new Set<ObjectKind>(),
      treeIndex: 0,
      focus: 'sidebar',
      current: null,
      mainTab: 'data',
      structure: null,
      structureLoading: false,
      structureError: null,
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
      queryable,
      helpOpen: false,

      view: 'browse',
      queryFocus: 'editor',
      queryText: '',
      queryResult: null,
      queryError: null,
      queryElapsedMs: null,
      queryGridRow: 0,
      history: [],
      historyIndex: null,
      catalog: null,
      completions: [],

      nlAvailable: generator !== null && queryable,
      nlMode: false,
      nlDraft: '',
      generating: false,
      nlExplanation: null,
      nlKind: null,

      init: async () => {
        const res = await listObjects(source);
        if (!res.ok) {
          set({ status: 'error', error: res.error.message });
          return;
        }
        // Expand the first present category and land the cursor on its first
        // object, so a single Enter browses straight away.
        const first = firstCategoryKind(res.value);
        const expandedCats = new Set<ObjectKind>(first ? [first] : []);
        set({ status: 'ready', objects: res.value, expandedCats });
        set({ treeIndex: firstObjectIndex(rowsNow()) });
      },

      toggleHelp: () => set((s) => ({ helpOpen: !s.helpOpen })),

      treeRows: () => rowsNow(),

      treeUp: () =>
        set((s) => ({ treeIndex: Math.max(0, s.treeIndex - 1) })),

      treeDown: () =>
        set((s) => ({
          treeIndex: Math.min(rowsNow().length - 1, s.treeIndex + 1),
        })),

      treeToggle: async () => {
        const row = rowsNow()[get().treeIndex];
        if (!row) return;
        if (row.type === 'object') {
          await openObject(row.ref);
          return;
        }
        if (row.type === 'connection') {
          set((s) => ({ rootExpanded: !s.rootExpanded }));
        } else {
          const next = new Set(get().expandedCats);
          if (next.has(row.kind)) next.delete(row.kind);
          else next.add(row.kind);
          set({ expandedCats: next });
        }
        clampTree();
      },

      treeExpand: async () => {
        const row = rowsNow()[get().treeIndex];
        if (!row) return;
        if (row.type === 'object') {
          await openObject(row.ref);
        } else if (row.type === 'connection') {
          if (!get().rootExpanded) set({ rootExpanded: true });
        } else if (!get().expandedCats.has(row.kind)) {
          set({ expandedCats: new Set(get().expandedCats).add(row.kind) });
        }
      },

      treeCollapse: () => {
        const rows = rowsNow();
        const i = get().treeIndex;
        const row = rows[i];
        if (!row) return;
        if (row.type === 'object') {
          // Jump to the parent category header.
          for (let j = i - 1; j >= 0; j--) {
            if (rows[j]!.type === 'category') return set({ treeIndex: j });
          }
          set({ treeIndex: 0 });
        } else if (row.type === 'category') {
          if (get().expandedCats.has(row.kind)) {
            const next = new Set(get().expandedCats);
            next.delete(row.kind);
            set({ expandedCats: next });
            clampTree();
          } else {
            set({ treeIndex: 0 }); // to the connection root
          }
        } else if (get().rootExpanded) {
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

      setMainTab: (tab) => {
        set({ mainTab: tab });
        if (tab === 'ddl') void loadStructure();
      },

      toggleMainTab: () => {
        const next = get().mainTab === 'data' ? 'ddl' : 'data';
        set({ mainTab: next });
        if (next === 'ddl') void loadStructure();
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

      // ── query editor ──────────────────────────────────────────────────────

      enterQueryView: () => {
        if (!get().queryable) {
          set({ error: 'This source does not support SQL queries.' });
          return;
        }
        set({ view: 'query', queryFocus: 'editor', error: null });
        if (!get().catalog) void buildCatalog();
      },

      exitQueryView: () => set({ view: 'browse' }),

      updateQueryText: (text) =>
        set({
          queryText: text,
          historyIndex: null,
          completions: completionsFor(text),
        }),

      executeQuery: async () => {
        const { queryText, history } = get();
        const text = queryText.trim();
        if (!text) return;
        set({ loading: true, queryError: null });
        const r = await runQuery(source, text);
        if (!r.ok) {
          set({
            loading: false,
            queryError: r.error.message,
            queryResult: null,
            queryElapsedMs: null,
          });
          return;
        }
        set({
          loading: false,
          queryResult: r.value.result,
          queryElapsedMs: r.value.elapsedMs,
          queryError: null,
          queryGridRow: 0,
          queryFocus: 'result',
          // record in history, skipping an immediate duplicate
          history:
            history[history.length - 1] === text ? history : [...history, text],
          historyIndex: null,
        });
      },

      historyPrev: () => {
        const { history, historyIndex } = get();
        if (history.length === 0) return;
        const idx =
          historyIndex === null
            ? history.length - 1
            : Math.max(0, historyIndex - 1);
        const text = history[idx] ?? '';
        set({ historyIndex: idx, queryText: text, completions: [] });
      },

      historyNext: () => {
        const { history, historyIndex } = get();
        if (historyIndex === null) return;
        if (historyIndex >= history.length - 1) {
          set({ historyIndex: null, queryText: '', completions: [] });
          return;
        }
        const idx = historyIndex + 1;
        const text = history[idx] ?? '';
        set({ historyIndex: idx, queryText: text, completions: [] });
      },

      toggleQueryFocus: () =>
        set((s) => ({
          queryFocus: s.queryFocus === 'editor' ? 'result' : 'editor',
        })),

      queryGridUp: () => set((s) => ({ queryGridRow: Math.max(0, s.queryGridRow - 1) })),

      queryGridDown: () =>
        set((s) => ({
          queryGridRow: Math.min(
            Math.max(0, (s.queryResult?.rows.length ?? 1) - 1),
            s.queryGridRow + 1,
          ),
        })),

      acceptCompletion: () => {
        const { queryText, completions } = get();
        const top = completions[0];
        if (!top) return;
        const word = queryText.match(/([A-Za-z_][A-Za-z0-9_]*)$/)?.[1] ?? '';
        const next = queryText.slice(0, queryText.length - word.length) + top;
        set({ queryText: next, completions: completionsFor(next) });
      },

      // ── NL→SQL ────────────────────────────────────────────────────────────

      beginNl: () => {
        if (!generator) {
          set({ queryError: 'set ANTHROPIC_API_KEY to enable AI (NL→SQL)' });
          return;
        }
        set({ nlMode: true, nlDraft: '', queryError: null });
      },

      updateNlDraft: (text) => set({ nlDraft: text }),

      cancelNl: () => set({ nlMode: false, nlDraft: '' }),

      generateFromNl: async () => {
        const { nlDraft, catalog } = get();
        const nl = nlDraft.trim();
        if (!generator || !nl) {
          set({ nlMode: false, nlDraft: '' });
          return;
        }
        set({ nlMode: false, nlDraft: '', generating: true, queryError: null });
        const schema: SchemaContext = {
          tables: catalog
            ? catalog.tables.map((t) => ({
                name: t,
                columns: catalog.columnsByTable[t] ?? [],
              }))
            : [],
        };
        const r = await generateSql(generator, { nl, schema, dialect });
        if (!r.ok) {
          set({ generating: false, queryError: r.error.message });
          return;
        }
        // Fill the editor for review — NEVER auto-execute (§5.2).
        set({
          generating: false,
          queryText: r.value.sql,
          nlExplanation: r.value.explanation,
          nlKind: r.value.kind,
          completions: [],
          queryFocus: 'editor',
        });
      },
    };
  });
