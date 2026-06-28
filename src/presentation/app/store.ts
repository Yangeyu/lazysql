/**
 * App store (Zustand, vanilla) — single source of UI truth. State is sliced and
 * actions delegate to application use cases; the store never touches a driver or
 * builds a query. The connected DataSource is injected once (DIP), so the store
 * is trivially testable with a fake source.
 */

import { createStore, type StoreApi } from 'zustand/vanilla';
import {
  asBrowsePreviewable,
  asDdlScriptable,
  asIntrospectable,
  asQueryable,
  type DataSource,
} from '../../domain/datasource/DataSource.ts';
import type {
  ObjectKind,
  ObjectRef,
  ObjectSchema,
} from '../../domain/datasource/schema.ts';
import { columnsOf, sectionsFor } from '../../domain/datasource/schema.ts';
import type { RowKey, FieldValue } from '../../domain/datasource/edit.ts';
import {
  buildTree,
  dialectLabel,
  firstCategoryKind,
  firstObjectIndex,
  firstSchemaKey,
  groupsBySchema,
  schemaKey,
  toConnNodes,
  type TreeRow,
} from '../tree/tree.ts';
import type {
  ConnectionProfile,
  DriverId,
} from '../../domain/connection/ConnectionProfile.ts';
import type { ConnectionService } from '../../application/ports/ConnectionService.ts';
import type { ResultSet, CellValue } from '../../domain/datasource/ResultSet.ts';
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
import { dangerKind, type DangerKind } from '../../domain/query/classify.ts';
import type { StatementKind } from '../../domain/query/classify.ts';
import type { QueryHistoryStore } from '../../application/ports/QueryHistoryStore.ts';
import {
  complete,
  type SchemaCatalog,
} from '../completion/sqlCompleter.ts';

export const PAGE_SIZE = 100;

/** How many recent statements the SQL editor history keeps, per connection. */
export const HISTORY_LIMIT = 100;

/** The three persistent panes the cursor can occupy (lazygit-style). */
export type Focus = 'sidebar' | 'editor' | 'grid';
export type Status = 'connecting' | 'ready' | 'error';
export type Mode = 'normal' | 'filter' | 'edit' | 'confirm' | 'connform';

/** One editable field in the new-connection form. */
export interface ConnFormField {
  readonly key: string;
  readonly label: string;
  value: string;
  /** Masked input (passwords). */
  readonly secret?: boolean;
}

/** Focus index of the Driver selector row — it sits above the fields, so the
 *  navigable range is [DRIVER_ROW, fields.length-1]. ←/→ only cycles the driver
 *  while it's focused, which keeps ←/→ free for in-field cursor movement on the
 *  native <input> fields below. */
export const DRIVER_ROW = -1;

/** State of a one-off "test connection" probe, shown until the next edit. */
export interface ConnProbe {
  readonly state: 'testing' | 'ok' | 'fail';
  readonly message: string;
}

/** Draft state for the new-connection form (mode === 'connform'). */
export interface ConnForm {
  driver: DriverId;
  fields: ConnFormField[];
  /** Focused row: DRIVER_ROW for the driver selector, else a field index. */
  index: number;
  /** Whether the secret (password) field shows its value instead of bullets. */
  reveal: boolean;
  error: string | null;
  /** Result of the last ^T test probe, or null before one is run / after an edit. */
  probe: ConnProbe | null;
  /** Id of the profile being edited, or null when creating a new one. */
  editingId: string | null;
}

export interface AppStoreDeps {
  /** The only way the store reaches connections — never a driver/repo directly. */
  connectionService: ConnectionService;
  generator?: SqlGenerator | null;
  /** Profile to connect to on init (e.g. a CLI arg); also shown as a root. */
  initial?: ConnectionProfile | null;
  /** Durable SQL editor history, per connection; null disables persistence. */
  historyStore?: QueryHistoryStore | null;
}
/**
 * What the single results grid is currently showing. ONE grid, ONE result —
 * 'browse' is a table-backed, editable/paginated view; 'query' is a read-only
 * SQL result. This discriminator replaces the old parallel `result`/`queryResult`
 * (+ their own cursors) state, so the two can never drift or both be "current".
 */
export type SurfaceKind = 'browse' | 'query';
/** Which face of the main pane is showing for an open object. */
export type MainTab = 'data' | 'ddl';

/**
 * A confirmed, ready-to-run action awaiting the user's y/n, rendered in the
 * confirm dialog. `title` is the one-line headline; `statement` is the exact SQL
 * it will run (echoed so the user sees what they're approving); `details` are
 * supporting lines (e.g. the objects a CASCADE would also drop); `tone` drives
 * the dialog's emphasis (`danger` → red) for irreversible/bulk operations.
 */
export interface Pending {
  readonly title: string;
  readonly statement?: string;
  readonly details?: readonly string[];
  readonly tone: 'normal' | 'danger';
  readonly run: () => Promise<void>;
}

/** Presentation wording for a structured danger kind — the dialog headline. */
const dangerHeadline = (kind: DangerKind, sql: string): string => {
  switch (kind) {
    case 'drop':
      return 'DROP — irreversible';
    case 'truncate':
      return 'TRUNCATE — irreversible';
    case 'unqualified-write': {
      const verb = sql.match(/^[a-z]+/i)?.[0]?.toUpperCase() ?? 'WRITE';
      return `${verb} with no WHERE — affects ALL rows`;
    }
  }
};

/** The full-cell inspector overlay: one self-contained slice (value + scroll). */
export interface CellInspect {
  readonly column: string;
  readonly value: CellValue;
  /** First visible line of the (possibly long) formatted value. */
  readonly offset: number;
}

/** The clickable panes a mouse press can focus (same set as Focus). */
export type Region = Focus;

export interface AppState {
  status: Status;
  error: string | null;
  /** All saved connection profiles — the single source for the tree roots. */
  profiles: ConnectionProfile[];
  /** Id of the live connection, or null when none is connected. */
  activeId: string | null;
  /** New-connection form draft, or null when not editing one. */
  connForm: ConnForm | null;
  objects: ObjectRef[];
  // ── sidebar tree ──
  /** Whether the connection root is expanded (shows its categories). */
  rootExpanded: boolean;
  /** Categories currently expanded (by object kind). */
  expandedCats: Set<ObjectKind>;
  /** Schema rows currently expanded, keyed by `schemaKey(kind, namespace)`
   *  (only Postgres grows this tier; see `groupsBySchema`). */
  expandedSchemas: Set<string>;
  /** Cursor into the flattened visible tree rows. */
  treeIndex: number;
  focus: Focus;
  current: ObjectRef | null;
  // ── results grid (the single bottom-right surface) ──
  /** Whether the grid is showing a browsed table or a read-only query result. */
  surface: SurfaceKind;
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
  /** The statement behind whatever the grid currently shows — the value-inlined
   *  browse SQL while browsing, or the executed query/write after a run. Echoed as
   *  the editor's dim placeholder so you always see how the result was produced;
   *  null when there's nothing open. Recomputed wherever the result is set (`load`
   *  / `runEditorSql`), so it never drifts from what produced the grid. */
  statement: string | null;
  gridRow: number;
  gridCol: number;
  /** Visible body rows of the grid, mirrored from the layout so cursor jumps
   *  (half-page) can size themselves; 0 until the view reports it. */
  gridViewportRows: number;
  mode: Mode;
  pkColumns: string[];
  pending: Pending | null;
  loading: boolean;
  /** Whether this source speaks SQL (Query capability) — gates the `:` editor. */
  queryable: boolean;
  /** Whether the `?` help overlay is showing. */
  helpOpen: boolean;
  /** The cell inspector overlay, or null when closed. */
  cellView: CellInspect | null;

  // ── query editor ──
  /** Editor input text — the value the native <input> is bound to (it owns the
   *  cursor). The result of running it lands in the shared grid (`result`,
   *  surface 'query'); there is no separate query result slice. */
  queryText: string;
  queryError: string | null;
  queryElapsedMs: number | null;
  history: string[];
  historyIndex: number | null;
  catalog: SchemaCatalog | null;
  completions: string[];

  // ── NL→SQL ──
  nlAvailable: boolean;
  nlMode: boolean;
  generating: boolean;
  nlExplanation: string | null;
  nlKind: StatementKind | null;

  init: () => Promise<void>;
  toggleHelp: () => void;
  /** Select a sidebar tree row from a click (null row → just focus the pane). */
  clickTree: (row: number | null) => void;
  /** Select a grid data row from a click (null row → just focus the pane). */
  clickGrid: (row: number | null, col?: number) => void;
  /** Open the full-value inspector for the cell under the grid cursor. */
  openCell: () => void;
  closeCell: () => void;
  /** Scroll the open inspector by `delta` lines (clamped at the top). */
  scrollCell: (delta: number) => void;
  /** The flattened, currently-visible sidebar tree rows. */
  treeRows: () => TreeRow[];
  treeUp: () => void;
  treeDown: () => void;
  /** Jump the tree selection to the first / last visible row (vim g/G). */
  treeTop: () => void;
  treeBottom: () => void;
  /** Enter/Space: toggle a container's fold, or open an object. */
  treeToggle: () => Promise<void>;
  /** Browse the selected object (or the open one) as a clean SELECT * — resets
   *  sort/filter/page. The `a` key: a one-press "show me this table" from any pane. */
  browseSelected: () => void;
  /** →/l: expand a container, or open an object. */
  treeExpand: () => Promise<void>;
  /** ←/h: collapse a container, or jump from an object to its category. */
  treeCollapse: () => void;
  /** →/D from the sidebar on an object: open it showing its DDL/structure. */
  treeShowDdl: () => Promise<void>;
  /** d from the sidebar on a table/view: draft a DROP for it into the editor and
   *  focus it — review, then ⏎ runs it. Never executes on its own. No-op off an
   *  object row or on a non-SQL source. */
  draftDrop: () => void;
  /** Re-list saved connections and re-introspect the active one's objects, so
   *  schema changes made elsewhere (e.g. a CREATE TABLE run in the editor) show
   *  up. Keeps the current fold/cursor; the SQL completion catalog is rebuilt
   *  lazily on next editor focus. */
  refresh: () => Promise<void>;
  setMainTab: (tab: MainTab) => void;
  toggleMainTab: () => void;
  // ── connections / new-connection form ──
  /** Switch the active connection to a saved profile by id. */
  connect: (id: string) => Promise<void>;
  /** Open an arbitrary profile (e.g. an ad-hoc CLI file) and show it as a root. */
  connectProfile: (profile: ConnectionProfile) => Promise<void>;
  /** Tear down the active connection, back to the connection list. */
  disconnect: () => void;
  saveConnection: (
    profile: ConnectionProfile,
    password: string | null,
  ) => Promise<void>;
  removeConnection: (id: string) => Promise<void>;
  beginNewConnection: () => void;
  /** Edit the connection under the cursor: open the form prefilled from it. */
  beginEditConnection: () => void;
  /** Set a non-secret field's value (the native <input> is controlled). */
  connFormSetField: (key: string, value: string) => void;
  /** Append/erase for the masked secret field only (no native input there). */
  connFormType: (ch: string) => void;
  connFormBackspace: () => void;
  connFormMove: (delta: 1 | -1) => void;
  connFormCycleDriver: (dir: 1 | -1) => void;
  /** Toggle showing the password in clear (^R) to verify what was typed. */
  connFormToggleReveal: () => void;
  connFormSubmit: () => Promise<void>;
  /** Probe the drafted connection (connect + drop) without saving it; the result
   *  shows in the form until the next edit. */
  connFormTest: () => Promise<void>;
  connFormCancel: () => void;
  /** Move focus to a pane (`:`/Esc/click); gates the editor on `queryable`. */
  focusPane: (target: Focus) => void;
  /** Tab: cycle focus across the available panes. */
  cycleFocus: () => void;
  gridUp: () => void;
  gridDown: () => void;
  gridLeft: () => void;
  gridRight: () => void;
  /** Jump the row cursor to the first / last loaded row (vim g/G). */
  gridTop: () => void;
  gridBottom: () => void;
  /** Move the row cursor half a viewport up / down (vim ^u/^d), clamped to the
   *  loaded rows. */
  gridHalfUp: () => void;
  gridHalfDown: () => void;
  /** Report the grid's visible body height so half-page jumps can size to it. */
  setGridViewport: (rows: number) => void;
  applySort: () => Promise<void>;
  pageNext: () => Promise<void>;
  pagePrev: () => Promise<void>;
  beginFilter: () => void;
  cancelFilter: () => void;
  /** Apply the filter typed in the native input (empty clears it). */
  commitFilter: (value: string) => Promise<void>;
  beginEdit: () => void;
  cancelEdit: () => void;
  /** Stage the cell edit typed in the native input as a pending confirm. */
  submitEdit: (value: string) => void;
  beginDelete: () => void;
  confirmPending: () => Promise<void>;
  cancelPending: () => void;

  /** Sync the query editor's text from the native input (re-derives completions). */
  setQuery: (value: string) => void;
  executeQuery: () => Promise<void>;
  historyPrev: () => void;
  historyNext: () => void;
  acceptCompletion: () => void;
  beginNl: () => void;
  cancelNl: () => void;
  /** Generate SQL from the natural-language prompt typed in the native input. */
  generateFromNl: (prompt: string) => Promise<void>;
}

export type AppStore = StoreApi<AppState>;

/** Drivers offered by the new-connection form, in cycle order. */
const FORM_DRIVERS: DriverId[] = [
  'postgres',
  'mysql',
  'sqlite',
  'mongodb',
  'redis',
];

const DEFAULT_PORT: Record<DriverId, string> = {
  postgres: '5432',
  mysql: '3306',
  mongodb: '27017',
  redis: '6379',
  sqlite: '',
};

/** The form fields for a driver (SQLite needs only a file; servers need host…). */
const fieldsForDriver = (driver: DriverId): ConnFormField[] => {
  const name: ConnFormField = { key: 'name', label: 'Name', value: '' };
  if (driver === 'sqlite') {
    return [name, { key: 'file', label: 'File', value: '' }];
  }
  const common: ConnFormField[] = [
    name,
    { key: 'host', label: 'Host', value: 'localhost' },
    { key: 'port', label: 'Port', value: DEFAULT_PORT[driver] },
    { key: 'user', label: 'User', value: '' },
    { key: 'password', label: 'Password', value: '', secret: true },
  ];
  return driver === 'redis'
    ? [...common, { key: 'db', label: 'DB', value: '0' }]
    : [...common, { key: 'database', label: 'Database', value: '' }];
};

/** Prefill the driver's fields from a saved profile (for the edit form). The
 *  password is never prefilled — left blank, it keeps the stored secret. */
const fieldsForProfile = (profile: ConnectionProfile): ConnFormField[] =>
  fieldsForDriver(profile.driver).map((f) => {
    if (f.key === 'name') return { ...f, value: profile.name };
    if (f.secret) return f; // never echo a stored password
    const v = profile.options[f.key];
    return v === undefined || v === null ? f : { ...f, value: String(v) };
  });

/** Stable id from a connection name, e.g. "Local PG" → "local-pg". */
const slugify = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '') || 'connection';

/** The profile + inline password a connection form currently describes. Shared
 *  by save and the test probe so the two read the form's fields identically. */
const formProfile = (
  f: ConnForm,
): { profile: ConnectionProfile; password: string | null } => {
  const val = (k: string) => (f.fields.find((x) => x.key === k)?.value ?? '').trim();
  const password = val('password') || null;
  const options: Record<string, unknown> = {};
  if (f.driver === 'sqlite') {
    options.file = val('file');
  } else {
    options.host = val('host');
    options.port = val('port');
    options.user = val('user');
    if (f.driver === 'redis') options.db = val('db');
    else options.database = val('database');
  }
  const name = val('name');
  return {
    profile: { id: f.editingId ?? slugify(name), name, driver: f.driver, options },
    password,
  };
};

export const createAppStore = (deps: AppStoreDeps): AppStore =>
  createStore<AppState>((set, get) => {
    const { connectionService, generator = null, initial = null, historyStore = null } = deps;
    // The live connection, swapped in/out by attach()/disconnect(). The store
    // owns it but reaches it only through the segregated capability guards
    // (asQueryable/asIntrospectable), never as a concrete driver. (docs/adr/0002)
    let active: DataSource | null = null;

    /** The profile of the live connection, if any. */
    const activeProfile = (): ConnectionProfile | null =>
      get().profiles.find((p) => p.id === get().activeId) ?? null;

    /** Build the flattened tree rows from the current state (pure). The schema
     *  tier is gated on the active driver — the store owns that policy so the
     *  pure projection never names a driver. */
    const rowsNow = (): TreeRow[] => {
      const { profiles, activeId, objects, rootExpanded, expandedCats, expandedSchemas } = get();
      const profile = activeProfile();
      return buildTree({
        connections: toConnNodes(profiles, activeId),
        objects,
        rootExpanded,
        expandedCats,
        expandedSchemas,
        groupBySchema: profile ? groupsBySchema(profile.driver) : false,
      });
    };

    /** Re-clamp the cursor after the visible row count changes. */
    const clampTree = (): void =>
      set((s) => ({
        treeIndex: Math.min(s.treeIndex, Math.max(0, rowsNow().length - 1)),
      }));

    /** Open an object into the data grid (focus moves to the grid). */
    const openObject = async (ref: ObjectRef): Promise<void> => {
      if (!active) return;
      set({
        focus: 'grid',
        surface: 'browse',
        gridCol: 0,
        sort: null,
        filter: null,
        pkColumns: [],
        structure: null,
        structureError: null,
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
      const columns = schema ? columnsOf(schema) : [];
      set({
        structure: schema, // cache for the structure/DDL view
        pkColumns: columns.filter((c) => c.isPrimaryKey).map((c) => c.name),
      });
      if (!schema || columns.length > 0) {
        set({ mainTab: 'data' });
        await load(ref, { page: firstPage(PAGE_SIZE), sort: null, filter: null });
      } else {
        // No rows to browse — present the definition only.
        set({ current: ref, result: null, total: 0, statement: null, mainTab: 'ddl' });
      }
    };

    /** Lazily fetch the open object's column schema for the DDL tab (cached). */
    const loadStructure = async (): Promise<void> => {
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

    const load = async (ref: ObjectRef, spec: BrowseSpec): Promise<void> => {
      if (!active) return;
      set({ loading: true, error: null });
      const res = await browseTable(active, ref, spec);
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
        // Echo the exact statement the adapter ran (value-inlined). Same source
        // (ref, spec) as the result above, so the echo always matches the view.
        statement: asBrowsePreviewable(active)?.previewBrowse(ref, res.value.spec) ?? null,
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

    /** Run the editor's SQL and take over the shared grid with the result. The
     *  execution proper, shared by the direct run and the guarded (confirmed)
     *  path so the two can't drift. */
    const runEditorSql = async (text: string): Promise<void> => {
      if (!active) return;
      const { history } = get();
      set({ loading: true, queryError: null });
      const r = await runQuery(active, text);
      if (!r.ok) {
        set({ loading: false, queryError: r.error.message, queryElapsedMs: null });
        // A DROP refused because dependents exist can be retried with CASCADE —
        // a heavier hammer, so it gets its own confirm rather than auto-running.
        // Name the objects CASCADE would also drop so the choice is informed.
        const cascade = asDdlScriptable(active)?.cascadeRetry(text, r.error) ?? null;
        if (cascade) {
          set({
            mode: 'confirm',
            focus: 'grid',
            pending: {
              title: 'Other objects depend on it — drop them too?',
              statement: cascade.sql,
              details: cascade.dependents,
              tone: 'danger',
              run: () => runEditorSql(cascade.sql),
            },
          });
        }
        return;
      }
      // Record in history, skipping an immediate duplicate and keeping only the
      // most recent HISTORY_LIMIT entries.
      const nextHistory = (
        history[history.length - 1] === text ? history : [...history, text]
      ).slice(-HISTORY_LIMIT);
      // The result takes over the shared grid as a read-only 'query' surface.
      // The browsed table is dropped (current=null) so its row ops can't fire
      // on a query result; re-selecting it in the sidebar returns to browse.
      set({
        loading: false,
        surface: 'query',
        current: null,
        pkColumns: [],
        // The editor echoes the executed statement: clear the draft so the
        // placeholder shows `text`, the SQL that produced this result.
        statement: text,
        queryText: '',
        result: r.value.result,
        total: r.value.result.rows.length,
        queryElapsedMs: r.value.elapsedMs,
        queryError: null,
        gridRow: 0,
        gridCol: 0,
        mainTab: 'data',
        structure: null,
        focus: 'grid',
        history: nextHistory,
        historyIndex: null,
      });
      const id = get().activeId;
      if (id && historyStore) void historyStore.save(id, nextHistory);
    };

    /** Recompute completions for the editor text against the cached catalog. */
    const completionsFor = (text: string): string[] => {
      const cat = get().catalog;
      return cat ? complete(text, cat).candidates : [];
    };

    /** Build the table/column catalog once, for schema-aware completion. */
    const buildCatalog = async (): Promise<void> => {
      if (!active) return;
      const introspectable = asIntrospectable(active);
      if (!introspectable) return;
      try {
        const snapshot = await introspectable.introspect();
        // Completion only wants column-bearing objects (tables/views), not the
        // index/trigger/… kinds that have no columns.
        const relations = snapshot.objects.filter((o) =>
          sectionsFor(o.kind).includes('columns'),
        );
        const tables = relations.map((o) => o.name);
        const columnsByTable: Record<string, string[]> = {};
        await Promise.all(
          relations.slice(0, 50).map(async (o) => {
            try {
              const schema = await introspectable.describe(o);
              columnsByTable[o.name] = columnsOf(schema).map((c) => c.name);
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

    /** Load the active connection's objects and seat the cursor on the first. */
    const loadSchema = async (): Promise<void> => {
      if (!active) return;
      const res = await listObjects(active);
      if (!res.ok) {
        set({ status: 'error', error: res.error.message });
        return;
      }
      // Expand the first present category — and, for a schema-tiered driver, its
      // first schema — then land the cursor on the first object, so a single
      // Enter browses straight away.
      const first = firstCategoryKind(res.value);
      const profile = activeProfile();
      const grouped = profile ? groupsBySchema(profile.driver) : false;
      const schema = first && grouped ? firstSchemaKey(res.value, first) : null;
      set({
        status: 'ready',
        objects: res.value,
        expandedCats: new Set<ObjectKind>(first ? [first] : []),
        expandedSchemas: new Set<string>(schema ? [schema] : []),
      });
      set({ treeIndex: firstObjectIndex(rowsNow()) });
    };

    /** Make `next` the live connection, reset per-connection state, load schema. */
    const attach = async (next: DataSource, id: string): Promise<void> => {
      if (active && active !== next) void active.disconnect();
      active = next;
      const canQuery = asQueryable(next) !== null;
      set({
        activeId: id,
        status: 'connecting',
        error: null,
        queryable: canQuery,
        nlAvailable: generator !== null && canQuery,
        // everything below is scoped to one connection — reset on switch
        objects: [],
        rootExpanded: true,
        expandedCats: new Set<ObjectKind>(),
        expandedSchemas: new Set<string>(),
        treeIndex: 0,
        focus: 'sidebar',
        current: null,
        surface: 'browse',
        result: null,
        statement: null,
        gridRow: 0,
        gridCol: 0,
        mainTab: 'data',
        structure: null,
        structureError: null,
        cellView: null,
        queryText: '',
        queryError: null,
        history: [],
        historyIndex: null,
        catalog: null,
      });
      // Restore this connection's persisted history (best-effort, async); guard
      // against a fast switch landing it on a different connection.
      if (historyStore) {
        historyStore
          .load(id)
          .then((h) => {
            if (get().activeId === id) set({ history: h });
          })
          .catch(() => {});
      }
      await loadSchema();
    };

    return {
      status: 'ready',
      error: null,
      profiles: [],
      activeId: null,
      connForm: null,
      objects: [],
      rootExpanded: true,
      expandedCats: new Set<ObjectKind>(),
      expandedSchemas: new Set<string>(),
      treeIndex: 0,
      focus: 'sidebar',
      current: null,
      surface: 'browse',
      mainTab: 'data',
      structure: null,
      structureLoading: false,
      structureError: null,
      result: null,
      page: firstPage(PAGE_SIZE),
      sort: null,
      filter: null,
      total: 0,
      statement: null,
      gridRow: 0,
      gridCol: 0,
      gridViewportRows: 0,
      mode: 'normal',
      pkColumns: [],
      pending: null,
      loading: false,
      queryable: false,
      helpOpen: false,
      cellView: null,

      queryText: '',
      queryError: null,
      queryElapsedMs: null,
      history: [],
      historyIndex: null,
      catalog: null,
      completions: [],

      nlAvailable: false,
      nlMode: false,
      generating: false,
      nlExplanation: null,
      nlKind: null,

      init: async () => {
        const saved = await connectionService.list();
        // An ad-hoc initial profile (e.g. a CLI file) joins the list as a root.
        const profiles =
          initial && !saved.some((p) => p.id === initial.id)
            ? [...saved, initial]
            : saved;
        set({ status: 'ready', profiles });
        if (initial) await get().connectProfile(initial);
      },

      toggleHelp: () => set((s) => ({ helpOpen: !s.helpOpen })),

      clickTree: (row) =>
        set((s) => ({
          focus: 'sidebar',
          treeIndex: row != null ? row : s.treeIndex,
        })),

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
        set({ cellView: { column, value, offset: 0 } });
      },

      closeCell: () => set({ cellView: null }),

      scrollCell: (delta) =>
        set((s) =>
          s.cellView
            ? { cellView: { ...s.cellView, offset: Math.max(0, s.cellView.offset + delta) } }
            : {},
        ),

      treeRows: () => rowsNow(),

      treeUp: () =>
        set((s) => ({ treeIndex: Math.max(0, s.treeIndex - 1) })),

      treeDown: () =>
        set((s) => ({
          treeIndex: Math.min(rowsNow().length - 1, s.treeIndex + 1),
        })),

      treeTop: () => set({ treeIndex: 0 }),

      treeBottom: () => set({ treeIndex: Math.max(0, rowsNow().length - 1) }),

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
        if (row.ref.kind !== 'table' && row.ref.kind !== 'view') return;
        // The adapter builds a quoted, schema-qualified DROP, so a reserved-word
        // name (e.g. `window`) is dropped correctly. Non-SQL sources lack it.
        const scriptable = active ? asDdlScriptable(active) : null;
        if (!scriptable) return;
        get().setQuery(scriptable.dropStatement(row.ref));
        get().focusPane('editor');
      },

      refresh: async () => {
        set({ profiles: await connectionService.list() });
        if (!active) {
          clampTree();
          return;
        }
        const res = await listObjects(active);
        // Refresh in place: swap the objects but keep the fold/cursor (clamped),
        // and drop the completion catalog so it rebuilds with the new schema.
        if (res.ok) set({ objects: res.value, catalog: null });
        clampTree();
      },

      setMainTab: (tab) => {
        set({ mainTab: tab });
        if (tab === 'ddl') void loadStructure();
      },

      toggleMainTab: () => {
        // A source-only object (index/trigger/…) has no Data tab to flip to — the
        // structure (its definition) is all there is, so the toggle is inert.
        const s = get().structure;
        if (s && columnsOf(s).length === 0) return;
        const next = get().mainTab === 'data' ? 'ddl' : 'data';
        set({ mainTab: next });
        if (next === 'ddl') void loadStructure();
      },

      connect: async (id) => {
        const profile = get().profiles.find((p) => p.id === id);
        if (profile) await get().connectProfile(profile);
      },

      connectProfile: async (profile) => {
        set({ status: 'connecting', error: null });
        const r = await connectionService.open(profile);
        if (!r.ok) {
          set({ status: 'error', error: r.error.message });
          return;
        }
        if (!get().profiles.some((p) => p.id === profile.id)) {
          set({ profiles: [...get().profiles, profile] });
        }
        await attach(r.value, profile.id);
      },

      disconnect: () => {
        if (active) void active.disconnect();
        active = null;
        set({
          activeId: null,
          status: 'ready',
          queryable: false,
          nlAvailable: false,
          objects: [],
          current: null,
          surface: 'browse',
          result: null,
          statement: null,
          cellView: null,
          rootExpanded: true,
          treeIndex: 0,
          focus: 'sidebar',
        });
        clampTree();
      },

      saveConnection: async (profile, password) => {
        await connectionService.save(profile, password);
        set({ profiles: await connectionService.list() });
        clampTree();
      },

      removeConnection: async (id) => {
        await connectionService.remove(id);
        if (get().activeId === id) get().disconnect();
        set({ profiles: await connectionService.list() });
        clampTree();
      },

      beginNewConnection: () => {
        const driver: DriverId = 'postgres';
        set({
          mode: 'connform',
          connForm: {
            driver,
            fields: fieldsForDriver(driver),
            index: 0,
            reveal: false,
            error: null,
            probe: null,
            editingId: null,
          },
        });
      },

      beginEditConnection: () => {
        const row = rowsNow()[get().treeIndex];
        // A connection row edits itself; a category/object row belongs to the
        // active connection, so edit that.
        const id =
          row?.type === 'connection' ? row.id : get().activeId;
        const profile = id
          ? get().profiles.find((p) => p.id === id)
          : null;
        if (!profile) return;
        set({
          mode: 'connform',
          connForm: {
            driver: profile.driver,
            fields: fieldsForProfile(profile),
            index: 0,
            reveal: false,
            error: null,
            probe: null,
            editingId: profile.id,
          },
        });
      },

      connFormSetField: (key, value) => {
        const f = get().connForm;
        if (!f) return;
        const fields = f.fields.map((x) => (x.key === key ? { ...x, value } : x));
        set({ connForm: { ...f, fields, probe: null } });
      },

      // The non-secret fields are native <input>s that own their own editing;
      // the dispatcher only routes raw chars here for the masked secret field,
      // so these no-op unless the focused field is actually secret.
      connFormType: (ch) => {
        const f = get().connForm;
        if (!f || !f.fields[f.index]?.secret) return;
        const fields = f.fields.map((field, i) =>
          i === f.index ? { ...field, value: field.value + ch } : field,
        );
        set({ connForm: { ...f, fields, probe: null } });
      },

      connFormBackspace: () => {
        const f = get().connForm;
        if (!f || !f.fields[f.index]?.secret) return;
        const fields = f.fields.map((field, i) =>
          i === f.index ? { ...field, value: field.value.slice(0, -1) } : field,
        );
        set({ connForm: { ...f, fields, probe: null } });
      },

      connFormMove: (delta) => {
        const f = get().connForm;
        if (!f) return;
        const index = Math.max(
          DRIVER_ROW,
          Math.min(f.fields.length - 1, f.index + delta),
        );
        set({ connForm: { ...f, index } });
      },

      // Only acts while the Driver row is focused — otherwise ←/→ belongs to the
      // focused field's <input> cursor. Stays on the Driver row after cycling.
      connFormCycleDriver: (dir) => {
        const f = get().connForm;
        if (!f || f.index !== DRIVER_ROW) return;
        const at = FORM_DRIVERS.indexOf(f.driver);
        const driver =
          FORM_DRIVERS[(at + dir + FORM_DRIVERS.length) % FORM_DRIVERS.length]!;
        // Carry the typed name across a driver change.
        const name = f.fields.find((x) => x.key === 'name')?.value ?? '';
        const fields = fieldsForDriver(driver).map((x) =>
          x.key === 'name' ? { ...x, value: name } : x,
        );
        set({ connForm: { ...f, driver, fields, index: DRIVER_ROW } });
      },

      connFormToggleReveal: () => {
        const f = get().connForm;
        if (!f) return;
        set({ connForm: { ...f, reveal: !f.reveal } });
      },

      connFormCancel: () => set({ mode: 'normal', connForm: null }),

      connFormSubmit: async () => {
        const f = get().connForm;
        if (!f) return;
        // Editing keeps the original id so the saved secret stays linked; a blank
        // password leaves that secret untouched (saveConnection only writes a
        // secret when one is provided).
        const { profile, password } = formProfile(f);
        if (!profile.name) {
          set({ connForm: { ...f, error: 'name is required' } });
          return;
        }
        set({ mode: 'normal', connForm: null });
        await get().saveConnection(profile, password);
      },

      connFormTest: async () => {
        const f = get().connForm;
        if (!f) return;
        const { profile, password } = formProfile(f);
        // The probe connects with the typed password inlined (it isn't in the
        // keychain yet); openConnection falls back to the stored secret when the
        // field is blank, so editing an existing connection tests too.
        const probeProfile = password
          ? { ...profile, options: { ...profile.options, password } }
          : profile;
        set({ connForm: { ...f, error: null, probe: { state: 'testing', message: 'testing…' } } });
        const r = await connectionService.open(probeProfile);
        if (r.ok) await r.value.disconnect().catch(() => {});
        const result: ConnProbe = r.ok
          ? { state: 'ok', message: 'connection ok' }
          : { state: 'fail', message: r.error.message };
        // Drop the result if the form was edited or closed while the probe ran.
        const cur = get().connForm;
        if (cur && cur.probe?.state === 'testing') set({ connForm: { ...cur, probe: result } });
      },

      focusPane: (target) => {
        if (target === 'editor') {
          // The editor pane only exists for SQL-speaking sources.
          if (!get().queryable) {
            set({ error: 'This source does not support SQL queries.' });
            return;
          }
          if (!get().catalog) void buildCatalog();
          set({ focus: 'editor', error: null });
          return;
        }
        set({ focus: target });
      },

      cycleFocus: () =>
        // Tab toggles only the two persistent panes, tree ↔ results. The editor
        // is reached deliberately (`:`) and left with Esc, so it stays off the
        // cycle — Tab never lands you mid-compose.
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
        const { current, sort, result, gridCol } = get();
        const column = result?.columns[gridCol]?.name;
        set({ mode: 'normal' });
        if (!current || !column) return;
        const v = value.trim();
        const filter: Filter | null = v
          ? { conditions: [{ column, op: 'contains', value: v }] }
          : null;
        await load(current, { page: firstPage(PAGE_SIZE), sort, filter });
      },

      beginEdit: () => {
        const { result, gridCol, pkColumns } = get();
        const column = result?.columns[gridCol]?.name;
        if (!result || !column) return;
        if (pkColumns.length === 0) {
          set({ error: 'table has no primary key — editing disabled' });
          return;
        }
        // The native <input> holds the draft, seeded with the cell value (derived
        // in the view); the store keeps no draft of its own.
        set({ mode: 'edit', error: null });
      },

      cancelEdit: () => set({ mode: 'normal' }),

      submitEdit: (value) => {
        const { current, result, gridCol } = get();
        const column = result?.columns[gridCol]?.name;
        const key = currentRowKey();
        if (!current || !column || !key) {
          set({ mode: 'normal' });
          return;
        }
        set({
          mode: 'confirm',
          pending: {
            title: `Update ${column} in ${current.name}?`,
            statement: `UPDATE ${current.name} SET ${column} = '${value}' WHERE ${keyText(key)}`,
            tone: 'normal',
            run: async () => {
              if (!active) return;
              const r = await updateRow(active, current, key, [
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
            title: `Delete this row from ${current.name}?`,
            statement: `DELETE FROM ${current.name} WHERE ${keyText(key)}`,
            tone: 'danger',
            run: async () => {
              if (!active) return;
              const r = await deleteRow(active, current, key);
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
        // run() may itself stage a follow-up confirm (e.g. the CASCADE escalation
        // after a dependents-blocked DROP); only clear when nothing new was queued
        // so the chained prompt survives.
        if (get().pending === pending) set({ pending: null });
      },

      cancelPending: () => set({ mode: 'normal', pending: null }),

      // ── query editor ──────────────────────────────────────────────────────

      setQuery: (value) => {
        // The controlled <input> re-fires onInput with the SAME text when history
        // navigation writes queryText programmatically (a value-prop echo). That
        // no-op write must NOT reset historyIndex — otherwise ↓ (historyNext) sees
        // a null cursor and can never step forward. A real edit always changes the
        // text, so ignoring an identical write is safe.
        if (value === get().queryText) return;
        set({ queryText: value, historyIndex: null, completions: completionsFor(value) });
      },

      executeQuery: async () => {
        if (!active) return;
        const text = get().queryText.trim();
        if (!text) return;
        // A destructive statement (unqualified UPDATE/DELETE, or DROP/TRUNCATE)
        // stages a confirm rather than running straight off the editor's ⏎. Focus
        // leaves the editor so its native input can't swallow the y/n the prompt
        // is waiting on.
        const kind = dangerKind(text);
        if (kind) {
          set({
            mode: 'confirm',
            focus: 'grid',
            pending: {
              title: dangerHeadline(kind, text),
              statement: text,
              tone: 'danger',
              run: () => runEditorSql(text),
            },
          });
          return;
        }
        await runEditorSql(text);
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

      acceptCompletion: () => {
        const { queryText, completions } = get();
        const top = completions[0];
        if (!top) return;
        const text = queryText;
        const word = text.match(/([A-Za-z_][A-Za-z0-9_]*)$/)?.[1] ?? '';
        const next = text.slice(0, text.length - word.length) + top;
        set({ queryText: next, completions: completionsFor(next) });
      },

      // ── NL→SQL ────────────────────────────────────────────────────────────

      beginNl: () => {
        if (!generator) {
          set({ queryError: 'set ANTHROPIC_API_KEY to enable AI (NL→SQL)' });
          return;
        }
        set({ nlMode: true, queryError: null });
      },

      cancelNl: () => set({ nlMode: false }),

      generateFromNl: async (prompt) => {
        const { catalog } = get();
        const nl = prompt.trim();
        if (!generator || !nl) {
          set({ nlMode: false });
          return;
        }
        set({ nlMode: false, generating: true, queryError: null });
        const schema: SchemaContext = {
          tables: catalog
            ? catalog.tables.map((t) => ({
                name: t,
                columns: catalog.columnsByTable[t] ?? [],
              }))
            : [],
        };
        const profile = activeProfile();
        const dialect = profile ? dialectLabel(profile.driver) : 'SQL';
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
          focus: 'editor',
        });
      },
    };
  });
