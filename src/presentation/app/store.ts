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
  asSqlDumpable,
  type DataSource,
} from '../../domain/datasource/DataSource.ts';
import type {
  ObjectKind,
  ObjectRef,
  ObjectSchema,
} from '../../domain/datasource/schema.ts';
import { columnsOf, objectRefKey, sectionsFor } from '../../domain/datasource/schema.ts';
import type { RowKey, FieldValue } from '../../domain/datasource/edit.ts';
import {
  buildTree,
  dialectLabel,
  firstCategoryKind,
  firstObjectIndex,
  firstSchemaKey,
  groupsBySchema,
  refKey,
  schemaKey,
  toConnNodes,
  type TreeRow,
} from '../tree/tree.ts';
import type {
  ConnectionProfile,
  DriverId,
} from '../../domain/connection/ConnectionProfile.ts';
import type { ConnectionService } from '../../application/ports/ConnectionService.ts';
import { resolveUserPath } from '../../shared/path.ts';
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
import { exportResult } from '../../application/usecases/ExportResult.ts';
import { cellEditText, isJsonText, prettyJson } from '../components/cellFormat.ts';
import { exportTable } from '../../application/usecases/ExportTable.ts';
import { exportTablesCombined } from '../../application/usecases/ExportTablesCombined.ts';
import {
  formatterFor,
  jsonCombinedFormatter,
  sqlCombinedFormatter,
  sqlFormatter,
  type ExportFormat,
  type RowFormatter,
} from '../../domain/export/RowFormatter.ts';
import type { Exporter, ExportSummary } from '../../application/ports/Exporter.ts';
import { ok, err, type Result } from '../../shared/Result.ts';
import { ExportError } from '../../domain/errors/errors.ts';
import type {
  SqlGenerator,
  SchemaContext,
} from '../../application/ports/SqlGenerator.ts';
import { classifyStatement, dangerKind } from '../../domain/query/classify.ts';
import type { DangerKind, StatementKind } from '../../domain/query/classify.ts';
import type { QueryHistoryStore } from '../../application/ports/QueryHistoryStore.ts';
import {
  complete,
  type SchemaCatalog,
} from '../completion/sqlCompleter.ts';
import { SIDEBAR_WIDTH, SIDEBAR_STEP, clampSidebarWidth } from './layout.ts';

export const PAGE_SIZE = 100;

/** How many recent statements the SQL editor history keeps, per connection. */
export const HISTORY_LIMIT = 100;
/** Tables whose columns are eagerly described for completion. Schema + table
 *  names are unbounded (they need no per-table round-trip); only column lookups
 *  cost a describe each, so they are capped. Beyond this, table/schema completion
 *  still works; per-table column completion is the on-demand future step. */
const CATALOG_DESCRIBE_LIMIT = 200;

/** The three persistent panes the cursor can occupy (lazygit-style). */
export type Focus = 'sidebar' | 'editor' | 'grid';
export type Status = 'connecting' | 'ready' | 'error';
// Cell editing is no longer a top-level mode — it lives in the cell inspector
// overlay (`CellInspect.mode`), so it isn't listed here (ADR 0011).
// `exporting`: a long export is running; input is captured so `esc` can cancel it
// and the status bar shows the live row count (ADR 0012).
export type Mode = 'normal' | 'filter' | 'confirm' | 'connform' | 'exporting';

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
  /** Writes exported rows to a destination; null disables export. */
  exporter?: Exporter | null;
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
/** An inline single-choice shown in the confirm (a segmented radio) — e.g. the
 *  export format. Generic so the dialog stays reusable; the key that cycles it is
 *  wired per-use in the keymap (`f` → `cycleExportFormat`). */
export interface PendingChoice {
  readonly label: string;
  readonly options: readonly string[];
  readonly selected: string;
}

export interface Pending {
  readonly title: string;
  readonly statement?: string;
  readonly details?: readonly string[];
  readonly tone: 'normal' | 'danger';
  /** An adjustable option shown in the dialog (e.g. export format), or absent. */
  readonly choice?: PendingChoice;
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

/** The full-cell inspector overlay: one self-contained slice. It is either
 *  *viewing* the value (scrollable, read-only) or *editing* it (a focused
 *  textarea) — a discriminated union, not an `isEditing` flag. */
export type CellInspect =
  | {
      readonly mode: 'view';
      readonly column: string;
      readonly value: CellValue;
      /** First visible line of the (possibly long) formatted value. */
      readonly offset: number;
    }
  | {
      readonly mode: 'edit';
      readonly column: string;
      readonly value: CellValue;
      /** Carried through the edit so esc restores the view's scroll position. */
      readonly offset: number;
      /** The text the edit <textarea> was seeded with — the raw value, or its
       *  pretty-printed form on a jsonCanonical column. submitEdit compares the
       *  draft against it to skip no-op saves. */
      readonly seedText: string;
      /** The column stores canonical JSON (adapter-declared): the seed was
       *  pretty-printed and the draft is validated as JSON before staging. */
      readonly jsonCanonical: boolean;
      /** The primary-key locator of the row being edited, frozen at beginEdit —
       *  the grid under the overlay stays mouse-reachable, so the live cursor
       *  at save time may no longer be this cell. */
      readonly rowKey: RowKey;
    };

/** Pop an inspector back to its read-only view, keeping the scroll position —
 *  the one projection both esc and a no-op save must agree on. */
const backToView = (cv: CellInspect): CellInspect => ({
  mode: 'view',
  column: cv.column,
  value: cv.value,
  offset: cv.offset,
});

/** The clickable panes a mouse press can focus (same set as Focus). */
export type Region = Focus;

export interface AppState {
  status: Status;
  error: string | null;
  /** A transient info line (e.g. an export result) shown in the status bar until
   *  the next navigation replaces it. Distinct from `error` (failure) — success/
   *  info, not overlapping. */
  notice: string | null;
  /** Chosen export format (persists across exports); cycled in the export
   *  confirm with `f`. SQL is offered only for table exports (needs a dialect). */
  exportFormat: ExportFormat;
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
  /** Tables/views marked for a batch export (multi-select via `v`), keyed by
   *  `refKey`. Empty ⇒ no marks, and `X` falls back to the cursor's node. Reset
   *  on connection switch. */
  marks: ReadonlySet<string>;
  focus: Focus;
  /** User-adjustable connections sidebar width (cells); resized with ^⇧-/^⇧+. */
  sidebarWidth: number;
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
  /** Editor text — the store's MIRROR of the native <textarea>'s buffer (the
   *  widget owns the cursor + editing). Kept in sync by `setQuery` on every edit;
   *  programmatic writes (history/NL/clear) set it and the view reconciles the
   *  widget to match (ADR 0010). Running it lands the result in the shared grid
   *  (`result`, surface 'query'); there is no separate query result slice. */
  queryText: string;
  /** Caret offset (chars) into `queryText`, mirrored from the widget — drives the
   *  completion context and where a programmatic write seats the cursor. */
  editorCaret: number;
  queryError: string | null;
  queryElapsedMs: number | null;
  history: string[];
  historyIndex: number | null;
  catalog: SchemaCatalog | null;
  completions: string[];
  /** Whether schema completion is active (toggled with ^T). Off → no candidates
   *  computed or shown, and Tab falls back to cycling panes. */
  completionsOn: boolean;

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
  /** Grow / shrink the connections sidebar by one step, clamped (^⇧+ / ^⇧-). */
  widenSidebar: () => void;
  narrowSidebar: () => void;
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
  /** Stage a confirm to remove the connection under the cursor (a no-op unless the
   *  cursor is on a connection row). Confirming deletes its profile and secret. */
  beginRemoveConnection: () => void;
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
  /** Export the current grid view to a CSV file: the in-memory result for a
   *  query surface, or the whole (filtered/sorted) table when browsing. */
  exportGrid: () => void;
  /** Export from the sidebar: the marked tables if any, else every table/view
   *  under the cursor's node (a schema/category exports all its tables), else the
   *  single object under the cursor. One file per table when it's a batch. */
  exportSelectedTable: () => void;
  /** Toggle the export mark on the table/view under the tree cursor. A no-op off
   *  a table/view row. */
  toggleMark: () => void;
  /** Clear every export mark (esc in the sidebar). No-op when nothing is marked. */
  clearMarks: () => void;
  /** Cycle the export format (CSV → JSON → SQL) while the export confirm is up. */
  cycleExportFormat: () => void;
  /** Cancel the export in progress (esc during `mode: 'exporting'`); the partial
   *  file is discarded. A no-op when nothing is exporting. */
  cancelExport: () => void;
  confirmPending: () => Promise<void>;
  cancelPending: () => void;

  /** Mirror the editor text + caret from the native <textarea> (re-derives
   *  completions for the text up to `caret`). `caret` defaults to end-of-text for
   *  programmatic fills (history/NL/clear). */
  setQuery: (value: string, caret?: number) => void;
  /** Toggle schema completion on/off (^T). */
  toggleCompletions: () => void;
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
    // Store an absolute path so a relative entry (e.g. "data/x.db") can't bind to
    // a different file later when lazysql is launched from another directory.
    options.file = resolveUserPath(val('file'));
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
    const { connectionService, generator = null, initial = null, historyStore = null, exporter = null } = deps;
    // The live connection, swapped in/out by attach()/disconnect(). The store
    // owns it but reaches it only through the segregated capability guards
    // (asQueryable/asIntrospectable), never as a concrete driver. (docs/adr/0002)
    let active: DataSource | null = null;

    // The in-flight export's abort handle (out of reactive state — a transient
    // control channel, like `active`); `cancelExport` fires it. (ADR 0012)
    let exportAbort: AbortController | null = null;

    // What the staged export confirm is about — captured when export is invoked,
    // held out of reactive state (only the confirm reads it). Kept so the format
    // can be re-cycled (`f`) against the same target without re-selecting it.
    let exportReq:
      | { readonly kind: 'result'; readonly result: ResultSet }
      | { readonly kind: 'table'; readonly ref: ObjectRef; readonly sort: Sort | null; readonly filter: Filter | null }
      | { readonly kind: 'tables'; readonly refs: readonly ObjectRef[] }
      | null = null;

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

    /** The exportable objects a tree row stands for: an object row → itself; a
     *  category/schema header → every object it groups. The caller narrows to
     *  tables/views. Powers "export this whole schema" from a header row. */
    const objectsUnder = (row: TreeRow | undefined): ObjectRef[] => {
      if (!row) return [];
      const objs = get().objects;
      switch (row.type) {
        case 'object':
          return [row.ref];
        case 'category':
          return objs.filter((o) => o.kind === row.kind);
        case 'schema':
          return objs.filter((o) => o.kind === row.kind && (o.namespace ?? '') === row.namespace);
        default:
          return [];
      }
    };

    /** Re-clamp the cursor after the visible row count changes. */
    const clampTree = (): void =>
      set((s) => ({
        treeIndex: Math.min(s.treeIndex, Math.max(0, rowsNow().length - 1)),
      }));

    /** Re-read the active connection's object list in place — keeping the fold
     *  state and (clamped) cursor — and drop the completion catalog so it rebuilds
     *  against the new schema. Shared by the manual `refresh` and the automatic
     *  reload after a DDL statement changes the schema. */
    const reloadObjects = async (): Promise<void> => {
      if (!active) return clampTree();
      const res = await listObjects(active);
      if (res.ok) set({ objects: res.value, catalog: null });
      clampTree();
    };

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
      set({ loading: true, error: null, notice: null });
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

    /** Default export filename for an object (namespaced tables stay distinct). */
    const exportName = (ref: ObjectRef, ext: string): string =>
      `${ref.namespace ? `${ref.namespace}_` : ''}${ref.name}.${ext}`;

    /** Filename for a combined batch file: the shared namespace when the tables
     *  all live in one schema (e.g. `public.sql`), else a neutral `export.<ext>`. */
    const combinedName = (refs: readonly ObjectRef[], ext: string): string => {
      const namespaces = [...new Set(refs.map((r) => r.namespace).filter((n): n is string => !!n))];
      return `${namespaces.length === 1 ? namespaces[0] : 'export'}.${ext}`;
    };

    /** Drive an export task to a status-bar notice (success) or error. The task's
     *  errors are Error subclasses (Export/UnsupportedCapability), so `.message`
     *  reads uniformly. */
    /** Run a staged export: enter `exporting` mode (input captured so `esc` can
     *  cancel), stream progress to the status bar, then land on a success / error
     *  / cancelled notice. `run` gets the abort signal + a progress reporter. */
    const runExport = async (
      run: (signal: AbortSignal, onProgress: (rows: number) => void) => Promise<Result<ExportSummary, Error>>,
    ): Promise<void> => {
      exportReq = null; // the confirm's target is consumed once it runs
      const ctrl = new AbortController();
      exportAbort = ctrl;
      set({ mode: 'exporting', notice: 'exporting…', error: null });
      const r = await run(ctrl.signal, (rows) => set({ notice: `exporting… ${rows} rows` }));
      exportAbort = null;
      if (get().mode === 'exporting') set({ mode: 'normal' });
      if (r.ok) set({ notice: `exported ${r.value.rows} rows → ${r.value.path}`, error: null });
      // Neutral wording: a cancelled multi-file batch may have written some
      // complete files already, so don't claim "nothing written".
      else if (ctrl.signal.aborted) set({ notice: 'export cancelled', error: null });
      else set({ error: `export failed: ${r.error.message}`, notice: null });
    };

    /** Formats offered for a target: SQL needs a dialect (INSERTs) and a table to
     *  insert into, so it's table-only; a query result gets CSV/JSON. */
    const formatsFor = (req: NonNullable<typeof exportReq>): ExportFormat[] =>
      (req.kind === 'table' || req.kind === 'tables') && active && asSqlDumpable(active)
        ? ['csv', 'json', 'sql']
        : ['csv', 'json'];

    /** CSV batch: one file per table (`<ns>_<name>.csv`) in the working dir —
     *  CSV's columns differ per table so a shared file makes no sense (JSON/SQL
     *  combine into one file via `exportTablesCombined` instead, so this path is
     *  CSV-only). Stops at the first failure (报错停止 policy, ADR 0012). Progress
     *  reports the running row total across tables. */
    const exportCsvFilesPerTable = async (
      src: DataSource,
      refs: readonly ObjectRef[],
      ex: Exporter,
      signal: AbortSignal,
      onProgress: (rows: number) => void,
    ): Promise<Result<ExportSummary, Error>> => {
      let total = 0;
      let done = 0;
      let dir = '';
      for (const ref of refs) {
        // Cancel between tables reports as cancelled (not a partial success) so
        // the notice matches the mid-table and combined paths; files already
        // fully written stay on disk, the in-flight one is discarded.
        if (signal.aborted) return err(new ExportError('export cancelled'));
        const r = await exportTable(
          src, ref, formatterFor('csv'), ex, { path: exportName(ref, 'csv') }, {}, signal,
          (rows) => onProgress(total + rows),
        );
        if (!r.ok) return r;
        total += r.value.rows;
        done += 1;
        const slash = r.value.path.lastIndexOf('/');
        if (slash >= 0) dir = r.value.path.slice(0, slash);
      }
      return ok({ rows: total, path: `${done} files → ${dir}` });
    };

    /** (Re)stage the export confirm from the held target + current format —
     *  unified with every other write (ADR 0012). Shows the resolved destination
     *  and the format; `f` re-cycles the format through here. */
    const stageExportConfirm = (): void => {
      const req = exportReq;
      const ex = exporter;
      if (!req || !ex) return;
      const fmt = get().exportFormat;

      const choice: PendingChoice = {
        label: 'format',
        options: formatsFor(req).map((f) => f.toUpperCase()),
        selected: fmt.toUpperCase(),
      };
      const present = (
        title: string,
        statement: string,
        run: (signal: AbortSignal, onProgress: (rows: number) => void) => Promise<Result<ExportSummary, Error>>,
      ): void =>
        set({
          mode: 'confirm',
          pending: { title, statement, choice, tone: 'normal', run: () => runExport(run) },
        });

      if (req.kind === 'result') {
        const view = fmt === 'sql' ? 'csv' : fmt; // SQL isn't offered for a query result
        const path = `query-result.${view}`;
        present('Export the query result', `→ ${resolveUserPath(path)}`, (signal, onProgress) =>
          exportResult(req.result, formatterFor(view), ex, { path }, signal, onProgress),
        );
        return;
      }

      const src = active;
      if (!src) return;

      // One whole-table formatter for `ref` in the chosen format: SQL needs the
      // source's dialect-backed INSERT dump (per row-chunk); CSV/JSON are
      // ref-agnostic. `formatsFor` already gates SQL to a SqlDumpable source, so
      // the fallback below is unreachable — it only satisfies the null guard.
      const makeFormatter = (ref: ObjectRef): RowFormatter => {
        if (fmt === 'sql') {
          const dumpable = asSqlDumpable(src);
          if (!dumpable) return formatterFor('csv');
          return sqlFormatter((cols, rows) => dumpable.insertDump(ref, cols, rows));
        }
        return formatterFor(fmt);
      };

      if (req.kind === 'tables') {
        const { refs } = req;
        // CSV can't share a file (columns differ per table) → one file each.
        // JSON nests tables in an object, SQL concatenates INSERT blocks → one file.
        if (fmt === 'csv') {
          const example = resolveUserPath(exportName(refs[0]!, 'csv'));
          present(
            `Export ${refs.length} tables (CSV, one file each)`,
            `→ ${refs.length} files, e.g. ${example}`,
            (signal, onProgress) => exportCsvFilesPerTable(src, refs, ex, signal, onProgress),
          );
          return;
        }
        const path = combinedName(refs, fmt);
        const dumpable = asSqlDumpable(src);
        const combined =
          fmt === 'sql'
            ? sqlCombinedFormatter((ref, cols, rows) => (dumpable ? dumpable.insertDump(ref, cols, rows) : ''))
            : jsonCombinedFormatter();
        present(
          `Export ${refs.length} tables → one ${fmt.toUpperCase()} file`,
          `→ ${resolveUserPath(path)}`,
          (signal, onProgress) => exportTablesCombined(src, refs, combined, ex, { path }, signal, onProgress),
        );
        return;
      }

      const ref = req.ref;
      present(
        `Export ${ref.name} (whole table)`,
        `→ ${resolveUserPath(exportName(ref, fmt))}`,
        (signal, onProgress) =>
          exportTable(src, ref, makeFormatter(ref), ex, { path: exportName(ref, fmt) }, { sort: req.sort, filter: req.filter }, signal, onProgress),
      );
    };

    /** Point the format at an allowed value for the held target (e.g. drop SQL
     *  when the target became a query result). */
    const clampExportFormat = (): void => {
      if (exportReq && !formatsFor(exportReq).includes(get().exportFormat)) {
        set({ exportFormat: 'csv' });
      }
    };

    /** Run the editor's SQL and take over the shared grid with the result. The
     *  execution proper, shared by the direct run and the guarded (confirmed)
     *  path so the two can't drift. */
    const runEditorSql = async (text: string): Promise<void> => {
      if (!active) return;
      const { history } = get();
      set({ loading: true, queryError: null, notice: null });
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
      // A DDL statement (CREATE/DROP/ALTER/TRUNCATE/…) changed the schema, so the
      // tree and completion catalog are now stale — reload them in the background
      // (fire-and-forget) so the result shows immediately and the tree catches up.
      if (classifyStatement(text) === 'ddl') void reloadObjects();
    };

    /** Recompute completions for the editor text at `caret`. Keywords complete
     *  even before the catalog loads (it may still be null); schema/table/column
     *  candidates join in once it is built — so typing a DROP/SELECT is never dead
     *  while introspecting. */
    const completionsFor = (text: string, caret: number): string[] =>
      complete(text, get().catalog, caret).candidates;

    /** Build the schema/table/column catalog once, for schema-aware completion.
     *  Schema + table names come straight from the single introspection (every
     *  object, no per-table round-trip); only columns need a describe each, so
     *  those are bounded — table/schema completion stays complete even for a huge
     *  DB while column completion covers the first `CATALOG_DESCRIBE_LIMIT`. */
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
        const qualify = (o: ObjectRef): string =>
          o.namespace ? `${o.namespace}.${o.name}` : o.name;

        const schemas = [
          ...new Set(
            relations.map((o) => o.namespace).filter((s): s is string => !!s),
          ),
        ];
        const tables = [...new Set(relations.map((o) => o.name))];
        const tablesBySchema: Record<string, string[]> = {};
        for (const o of relations) {
          if (o.namespace) (tablesBySchema[o.namespace] ??= []).push(o.name);
        }

        const columnsByTable: Record<string, string[]> = {};
        await Promise.all(
          relations.slice(0, CATALOG_DESCRIBE_LIMIT).map(async (o) => {
            try {
              const schema = await introspectable.describe(o);
              const cols = columnsOf(schema).map((c) => c.name);
              columnsByTable[qualify(o)] = cols; // de-collided key
              columnsByTable[o.name] ??= cols; // bare fallback (first schema wins)
            } catch {
              /* skip a table we cannot describe */
            }
          }),
        );
        set({ catalog: { schemas, tables, tablesBySchema, columnsByTable } });
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
        marks: new Set<string>(),
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
      notice: null,
      exportFormat: 'csv',
      profiles: [],
      activeId: null,
      connForm: null,
      objects: [],
      rootExpanded: true,
      expandedCats: new Set<ObjectKind>(),
      expandedSchemas: new Set<string>(),
      treeIndex: 0,
      marks: new Set<string>(),
      focus: 'sidebar',
      sidebarWidth: SIDEBAR_WIDTH,
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
      editorCaret: 0,
      queryError: null,
      queryElapsedMs: null,
      history: [],
      historyIndex: null,
      catalog: null,
      completions: [],
      completionsOn: true,

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
        set({ cellView: { column, value, offset: 0, mode: 'view' } });
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
        await reloadObjects();
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
          marks: new Set<string>(),
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

      beginRemoveConnection: () => {
        // Removal only acts on a connection row — never the active connection by
        // proxy of a deeper category/object row (unlike edit's fallback).
        const row = rowsNow()[get().treeIndex];
        if (row?.type !== 'connection') return;
        const profile = get().profiles.find((p) => p.id === row.id);
        if (!profile) return;
        set({
          mode: 'confirm',
          pending: {
            title: `Remove connection "${profile.name}"?`,
            details: ['Deletes the saved profile and its stored password.'],
            tone: 'danger',
            run: () => get().removeConnection(profile.id),
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
        const { result, gridRow, gridCol, pkColumns, structure, current, cellView } = get();
        const column = result?.columns[gridCol]?.name;
        if (!result || !column) return;
        if (pkColumns.length === 0) {
          set({ error: 'table has no primary key — editing disabled' });
          return;
        }
        // Freeze the row locator NOW: submitEdit must target the cell the draft
        // was seeded from, whatever the grid cursor does while the overlay is up.
        const rowKey = currentRowKey();
        if (!rowKey) {
          set({ error: 'cannot locate this row by primary key — editing disabled' });
          return;
        }
        const value = result.rows[gridRow]?.[gridCol] ?? null;
        // Editing happens in the cell inspector overlay (ADR 0011): open it in
        // edit mode seeded with THIS cell. Binary blobs aren't text-editable.
        if (value instanceof Uint8Array) {
          set({ error: 'binary value — not editable here' });
          return;
        }
        // The <textarea> holds the draft (seeded from `seedText`); the store keeps
        // no draft of its own — submitEdit reads the widget's text on ^S. On a
        // jsonCanonical column (from the object's cached describe) the seed is
        // pretty-printed: the store normalizes JSON anyway, so the layout is free.
        // The describe cache can lag mid-navigation (openObject's async sets are
        // unserialized), so only trust it when it describes the browsed object.
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
            set({ error: 'not valid JSON — fix the draft or esc to discard' });
            return;
          }
        }
        set({
          mode: 'confirm',
          cellView: null, // leave the editor; the confirm owns the screen + y/n
          error: null,
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

      exportGrid: () => {
        if (!exporter) return set({ error: 'export is unavailable' });
        const { surface, result, current, sort, filter } = get();
        // A query surface has only its in-memory result; a browse surface exports
        // the WHOLE table behind the view (its filter/sort applied), not one page.
        if (surface === 'query') {
          if (!result) return set({ error: 'nothing to export' });
          exportReq = { kind: 'result', result };
        } else {
          if (!active || !current) return set({ error: 'nothing to export' });
          exportReq = { kind: 'table', ref: current, sort, filter };
        }
        clampExportFormat();
        stageExportConfirm();
      },

      exportSelectedTable: () => {
        if (!exporter) return set({ error: 'export is unavailable' });
        if (!active) return set({ error: 'nothing to export' });
        // Marks win over the cursor when present (a selection overrides position);
        // otherwise the cursor's node decides — a schema/category exports all its
        // tables, an object row just itself.
        const marks = get().marks;
        const picked =
          marks.size > 0
            ? get().objects.filter((o) => marks.has(refKey(o)))
            : objectsUnder(rowsNow()[get().treeIndex]);
        const refs = picked.filter((o) => o.kind === 'table' || o.kind === 'view');
        if (refs.length === 0) {
          return set({ error: 'select a table, a schema, or mark tables (v) to export' });
        }
        exportReq =
          refs.length === 1
            ? { kind: 'table', ref: refs[0]!, sort: null, filter: null }
            : { kind: 'tables', refs };
        clampExportFormat();
        stageExportConfirm();
      },

      toggleMark: () => {
        const row = rowsNow()[get().treeIndex];
        if (row?.type !== 'object') return;
        // Only tables/views hold rows worth exporting; skip index/trigger/… rows.
        if (row.ref.kind !== 'table' && row.ref.kind !== 'view') return;
        const key = refKey(row.ref);
        const next = new Set(get().marks);
        next.has(key) ? next.delete(key) : next.add(key);
        set({ marks: next });
      },

      clearMarks: () => {
        if (get().marks.size > 0) set({ marks: new Set() });
      },

      cycleExportFormat: () => {
        if (!exportReq) return; // a non-export confirm — `f` does nothing
        const allowed = formatsFor(exportReq);
        const next = allowed[(allowed.indexOf(get().exportFormat) + 1) % allowed.length];
        if (next) set({ exportFormat: next });
        stageExportConfirm();
      },

      cancelExport: () => {
        exportAbort?.abort();
        if (get().mode === 'exporting') set({ notice: 'cancelling…' });
      },

      widenSidebar: () => set((s) => ({ sidebarWidth: clampSidebarWidth(s.sidebarWidth + SIDEBAR_STEP) })),
      narrowSidebar: () => set((s) => ({ sidebarWidth: clampSidebarWidth(s.sidebarWidth - SIDEBAR_STEP) })),

      confirmPending: async () => {
        const { pending } = get();
        set({ mode: 'normal' });
        if (pending) await pending.run();
        // run() may itself stage a follow-up confirm (e.g. the CASCADE escalation
        // after a dependents-blocked DROP); only clear when nothing new was queued
        // so the chained prompt survives.
        if (get().pending === pending) set({ pending: null });
      },

      cancelPending: () => {
        exportReq = null; // if it was an export confirm, drop its target too
        set({ mode: 'normal', pending: null });
      },

      // ── query editor ──────────────────────────────────────────────────────

      setQuery: (value, caret) => {
        const c = caret ?? value.length;
        // A real edit changes the text; only then reset the history cursor (you're
        // back on a fresh draft). A SAME-text write is the <textarea> echoing a
        // programmatic setText (history/NL/clear) back through onContentChange —
        // keep historyIndex so ↓ (historyNext) can still step forward. Completions
        // track the caret; suppressed while the toggle is off.
        const changed = value !== get().queryText;
        set({
          queryText: value,
          editorCaret: c,
          ...(changed ? { historyIndex: null } : {}),
          completions: get().completionsOn ? completionsFor(value, c) : [],
        });
      },

      toggleCompletions: () => {
        const on = !get().completionsOn;
        const { queryText, editorCaret } = get();
        set({
          completionsOn: on,
          completions: on ? completionsFor(queryText, editorCaret) : [],
        });
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
        set({ historyIndex: idx, queryText: text, editorCaret: text.length, completions: [] });
      },

      historyNext: () => {
        const { history, historyIndex } = get();
        if (historyIndex === null) return;
        if (historyIndex >= history.length - 1) {
          set({ historyIndex: null, queryText: '', editorCaret: 0, completions: [] });
          return;
        }
        const idx = historyIndex + 1;
        const text = history[idx] ?? '';
        set({ historyIndex: idx, queryText: text, editorCaret: text.length, completions: [] });
      },

      acceptCompletion: () => {
        const { queryText, editorCaret, completions } = get();
        const top = completions[0];
        if (!top) return;
        // Replace the partial identifier ending AT the caret, leaving the rest of
        // the (possibly multi-line) text untouched; seat the caret after the word.
        const head = queryText.slice(0, editorCaret);
        const tail = queryText.slice(editorCaret);
        const word = head.match(/[A-Za-z_][A-Za-z0-9_]*$/)?.[0] ?? '';
        const newHead = head.slice(0, head.length - word.length) + top;
        const next = newHead + tail;
        set({
          queryText: next,
          editorCaret: newHead.length,
          completions: completionsFor(next, newHead.length),
        });
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
          editorCaret: r.value.sql.length,
          nlExplanation: r.value.explanation,
          nlKind: r.value.kind,
          completions: [],
          focus: 'editor',
        });
      },
    };
  });
