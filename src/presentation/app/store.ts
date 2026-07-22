/**
 * App store (Zustand, vanilla) — single source of UI truth. State is sliced and
 * actions delegate to application use cases; the store never touches a driver or
 * builds a query. The connected DataSource is injected once (DIP), so the store
 * is trivially testable with a fake source.
 */

import { createStore, type StoreApi } from 'zustand/vanilla';
import { asQueryable, type DataSource } from '../../domain/datasource/DataSource.ts';
import type {
  ObjectKind,
  ObjectRef,
  ObjectSchema,
} from '../../domain/datasource/schema.ts';
import type { RowKey } from '../../domain/datasource/edit.ts';
import {
  buildTree,
  defaultNamespace,
  firstCategoryKind,
  firstObjectIndex,
  firstSchemaKey,
  groupsBySchema,
  toConnNodes,
  type TreeRow,
} from '../tree/tree.ts';
import type {
  ConnectionProfile,
  DriverId,
} from '../../domain/connection/ConnectionProfile.ts';
import type { ConnectionService } from '../../application/ports/ConnectionService.ts';
import { createConnFormSlice } from './slices/connForm.ts';
import { createBrowseSlice, PAGE_SIZE } from './slices/browse.ts';
import { createEditorSlice } from './slices/editor.ts';
import { createTreeSlice } from './slices/tree.ts';
import type { ResultSet, CellValue } from '../../domain/datasource/ResultSet.ts';
import {
  firstPage,
  type Page,
  type Sort,
  type Filter,
} from '../../domain/query/Query.ts';
import { listObjects } from '../../application/usecases/ListObjects.ts';
import type { ExportFormat } from '../../domain/export/RowFormatter.ts';
import type { Exporter } from '../../application/ports/Exporter.ts';
import { createExportSlice } from './slices/export.ts';
import type { SqlGenerator } from '../../application/ports/SqlGenerator.ts';
import type { StatementKind } from '../../domain/query/classify.ts';
import type { QueryHistoryStore } from '../../application/ports/QueryHistoryStore.ts';
import type { SchemaCatalog } from '../completion/sqlCompleter.ts';
import { SIDEBAR_WIDTH, SIDEBAR_STEP, clampSidebarWidth } from './layout.ts';
import { appError, fromError, type AppError } from './appError.ts';

// Owned by their feature slices; re-exported so consumers keep one import site.
export { PAGE_SIZE } from './slices/browse.ts';
export { HISTORY_LIMIT } from './slices/editor.ts';

/** The three persistent panes the cursor can occupy (lazygit-style). */
export type Focus = 'sidebar' | 'editor' | 'grid';
export type Status = 'connecting' | 'ready' | 'error';
// Cell editing is no longer a top-level mode — it lives in the cell inspector
// overlay (`CellInspect.mode`), so it isn't listed here (ADR 0011).
// Long-running modes (`exporting` / `generating`) capture input so `esc` can
// cancel them. `nl` is the native Ask AI input. Keeping all three here avoids
// parallel booleans that could describe impossible combinations.
// `filter` captures the grid's per-column filter input; `treeFilter` the sidebar's
// object-name filter — distinct input surfaces on distinct panes.
export type Mode =
  | 'normal'
  | 'filter'
  | 'treeFilter'
  | 'confirm'
  | 'connform'
  | 'exporting'
  | 'nl'
  | 'generating';

/** One editable field in the new-connection form. */
export interface ConnFormField {
  readonly key: string;
  readonly label: string;
  value: string;
  /** Masked input (passwords). */
  readonly secret?: boolean;
  /** Muted usage note rendered beside the value, e.g. "optional". */
  readonly hint?: string;
  /** Digits-only field (ports, db indexes) — other characters are dropped as
   *  typed, so an invalid value can never reach the profile. */
  readonly numeric?: boolean;
}

/** Focus index of the Driver selector row — it sits above the fields, so the
 *  navigable range is [DRIVER_ROW, fields.length-1]. ←/→ only cycles the driver
 *  while it's focused, which keeps ←/→ free for in-field cursor movement on the
 *  native <input> fields below. Owned by the form slice; re-exported so form
 *  consumers keep one import site. */
export { DRIVER_ROW } from './slices/connForm.ts';

/** State of a one-off "test connection" probe, shown until the next edit. */
export interface ConnProbe {
  readonly state: 'testing' | 'ok' | 'fail';
  readonly message: string;
}

/** Draft state for the new-connection form (mode === 'connform'). */
export interface ConnForm {
  driver: DriverId;
  fields: ConnFormField[];
  /** Focused row: DRIVER_ROW for the driver selector, a field index, or
   *  fields.length for the action-button row below the fields. */
  index: number;
  /** Focused button on the action row (an index into FORM_BUTTONS). */
  button: number;
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

/** One-level return point created when a grid filter is committed. `esc` reloads
 *  this browse window and restores its cell cursor; a newer filter replaces it. */
export interface FilterReturnPoint {
  readonly ref: ObjectRef;
  readonly page: Page;
  readonly sort: Sort | null;
  readonly filter: Filter | null;
  readonly gridRow: number;
  readonly gridCol: number;
}

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

export interface AppState {
  status: Status;
  /** The last failure: a one-line `message` for the status bar plus the driver
   *  facts behind it. A new error pops the details dialog (see `errorShowing`);
   *  null when healthy. */
  error: AppError | null;
  /** The error the user dismissed (esc), so its dialog stays closed. Identity-
   *  based, not a boolean: a NEW error object pops the dialog again without any
   *  set site having to reset a flag. */
  errorDismissed: AppError | null;
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
  /** Active sidebar object-name filter (empty ⇒ no filter). `buildTree` narrows
   *  the tree to matching objects; `mode:'treeFilter'` is the editing state whose
   *  value this holds (mirrors the grid's `filter` vs `mode:'filter'`). */
  treeFilter: string;
  /** Tables/views marked for a batch export (multi-select via `v`), keyed by
   *  `refKey`. Empty ⇒ no marks, and `X` falls back to the cursor's node. Reset
   *  on connection switch. */
  marks: ReadonlySet<string>;
  focus: Focus;
  /** User-adjustable connections sidebar width (cells); resized with ^⇧-/^⇧+. */
  sidebarWidth: number;
  /** SQL editor gear (ADR 0013): expanded = the full editing pane; collapsed =
   *  a one-line echo of the statement behind the grid. Sticky UI preference —
   *  focus changes and query runs never flip it. ^O toggles it; entering the
   *  editor (`:`/click/NL fill) expands it, since the echo bar can't compose. */
  editorExpanded: boolean;
  current: ObjectRef | null;
  // ── results grid (the single bottom-right surface) ──
  /** Whether the grid is showing a browsed table or a read-only query result. */
  surface: SurfaceKind;
  // ── main pane (data │ ddl) ──
  mainTab: MainTab;
  structure: ObjectSchema | null;
  structureLoading: boolean;
  structureError: string | null;
  /** First visible line of the DDL view, for its vertical scroll. */
  structureScroll: number;
  /** Largest useful structureScroll, reported by the DDL view from its viewport
   *  so scroll actions clamp to real content (mirrors helpMaxScroll). */
  structureMaxScroll: number;
  result: ResultSet | null;
  page: Page;
  sort: Sort | null;
  filter: Filter | null;
  /** View and cell to restore when `esc` undoes the latest committed filter. */
  filterReturnPoint: FilterReturnPoint | null;
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
  /** First visible body line of the help overlay (0 = top). */
  helpScroll: number;
  /** Largest useful helpScroll, reported by the overlay from its viewport so
   *  scrolling clamps instead of running past the end (cf. gridViewportRows). */
  helpMaxScroll: number;
  /** The cell inspector overlay, or null when closed. */
  cellView: CellInspect | null;

  // ── query editor ──
  /** Editor text — the store's MIRROR of the native <textarea>'s buffer (the
   *  widget owns the cursor + editing). Kept in sync by `setQuery` on every edit;
   *  programmatic writes (history/NL/clear) set it and the view reconciles the
   *  widget to match (ADR 0010). Running it lands the result in the shared grid
   *  (`result`, surface 'query'); there is no separate query result slice. */
  queryText: string;
  /** JavaScript string index (UTF-16 code units) into `queryText`, mirrored from
   *  the widget — drives completion context and programmatic cursor placement. */
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
  /** Submitted prompts for the active connection, memory-only and bounded. */
  nlHistory: string[];
  nlExplanation: string | null;
  nlKind: StatementKind | null;

  init: () => Promise<void>;
  toggleHelp: () => void;
  /** Show or dismiss the retained error's details dialog. */
  setErrorDetails: (show: boolean) => void;
  /** Scroll the help overlay's body by `delta` lines, clamped to its content. */
  scrollHelp: (delta: number) => void;
  /** The overlay reports how far its content can scroll (0 when it all fits). */
  setHelpViewport: (maxScroll: number) => void;
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
  /** `/`: begin editing the sidebar object-name filter (enters mode:'treeFilter'). */
  beginTreeFilter: () => void;
  /** Live-narrow the tree as the filter input changes, seating the cursor on the
   *  first match so a commit lands ready to open it. */
  setTreeFilter: (value: string) => void;
  /** ⏎: keep the filter, leave the input, return to tree navigation. */
  commitTreeFilter: () => void;
  /** esc: clear the filter and leave the input. */
  clearTreeFilter: () => void;
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
  /** Scroll the DDL view by `delta` lines (negative = up), clamped to content. */
  scrollStructure: (delta: number) => void;
  /** The DDL view reports its scroll range so the offset clamps to real lines. */
  setStructureViewport: (maxScroll: number) => void;
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
  /** ←/→: cycles the driver on the Driver row, the focused button on the action
   *  row; inert elsewhere (the arrows belong to the field <input> cursor). */
  connFormCycle: (dir: 1 | -1) => void;
  /** Focus a form row directly (mouse click on it). */
  connFormFocus: (index: number) => void;
  /** Focus AND activate an action button (mouse click on it). */
  connFormPressButton: (button: number) => void;
  /** Toggle showing the password in clear (^R) to verify what was typed. */
  connFormToggleReveal: () => void;
  connFormSubmit: () => Promise<void>;
  /** Probe the drafted connection (connect + drop) without saving it; the result
   *  shows in the form until the next edit. */
  connFormTest: () => Promise<void>;
  connFormCancel: () => void;
  /** Move focus to a pane (`:`/Esc/click); gates the editor on `queryable`.
   *  Any explicit pane focus leaves Ask AI; focusing SQL also expands it. */
  focusPane: (target: Focus) => void;
  /** ^O: toggle the editor between the echo bar and the full editing pane.
   *  Collapsing moves focus off the editor (the bar is not focusable). */
  toggleEditorExpanded: () => void;
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
  /** Re-fetch the browsed window (same page/sort/filter), keeping the cursor. */
  refreshBrowse: () => Promise<void>;
  beginFilter: () => void;
  cancelFilter: () => void;
  /** Apply the filter typed in the native input (empty clears it). */
  commitFilter: (value: string) => Promise<void>;
  /** Undo the latest committed filter and restore its prior page/cell. */
  restoreFilter: () => Promise<void>;
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
  /** Re-run the query surface's statement in place. Read statements only —
   *  re-running a write/DDL would repeat its side effects, so those get a
   *  notice pointing back to the editor instead. */
  refreshQuery: () => Promise<void>;
  historyPrev: () => void;
  historyNext: () => void;
  acceptCompletion: () => void;
  beginNl: () => void;
  /** Leave the Ask AI prompt or abort its in-flight provider request. */
  cancelNl: () => void;
  /** Generate SQL from the natural-language prompt typed in the native input. */
  generateFromNl: (prompt: string) => Promise<void>;
}

export type AppStore = StoreApi<AppState>;

export const createAppStore = (deps: AppStoreDeps): AppStore =>
  createStore<AppState>((set, get) => {
    const { connectionService, generator = null, initial = null, historyStore = null, exporter = null } = deps;
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
      const { profiles, activeId, objects, rootExpanded, expandedCats, expandedSchemas, treeFilter } = get();
      const profile = activeProfile();
      return buildTree({
        connections: toConnNodes(profiles, activeId),
        objects,
        rootExpanded,
        expandedCats,
        expandedSchemas,
        filter: treeFilter,
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

    // Feature slices — each borrows the root's closures through a narrow ctx and
    // owns its own actions; the root composes them and keeps only the shared
    // projections (rowsNow/objectsUnder) plus the connection lifecycle.
    const browse = createBrowseSlice({ set, get, source: () => active });

    const editor = createEditorSlice({
      set,
      get,
      source: () => active,
      generator,
      historyStore,
      reloadObjects,
      activeProfile,
    });

    const tree = createTreeSlice({
      set,
      get,
      source: () => active,
      rowsNow,
      clampTree,
      openObject: browse.openObject,
      loadStructure: browse.loadStructure,
    });

    const formSlice = createConnFormSlice({ set, get, connectionService, rowsNow });

    const xport = createExportSlice({
      set,
      get,
      exporter,
      source: () => active,
      rowsNow,
      objectsUnder,
    });

    /** Load the active connection's objects and seat the cursor on the first. */
    const loadSchema = async (): Promise<void> => {
      if (!active) return;
      const res = await listObjects(active);
      if (!res.ok) {
        set({ status: 'error', error: fromError(res.error) });
        return;
      }
      // Expand the first present category — and, for a schema-tiered driver, its
      // first schema — then land the cursor on the first object, so a single
      // Enter browses straight away.
      const first = firstCategoryKind(res.value);
      const profile = activeProfile();
      const grouped = profile ? groupsBySchema(profile.driver) : false;
      const schema =
        first && grouped && profile
          ? firstSchemaKey(res.value, first, defaultNamespace(profile.driver))
          : null;
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
        mode: 'normal',
        notice: null,
        // everything below is scoped to one connection — reset on switch
        objects: [],
        rootExpanded: true,
        expandedCats: new Set<ObjectKind>(),
        expandedSchemas: new Set<string>(),
        treeIndex: 0,
        treeFilter: '',
        marks: new Set<string>(),
        focus: 'sidebar',
        current: null,
        surface: 'browse',
        result: null,
        statement: null,
        filterReturnPoint: null,
        gridRow: 0,
        gridCol: 0,
        mainTab: 'data',
        structure: null,
        structureError: null,
        structureScroll: 0,
        cellView: null,
        queryText: '',
        queryError: null,
        history: [],
        historyIndex: null,
        catalog: null,
        nlHistory: [],
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
      errorDismissed: null,
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
      treeFilter: '',
      marks: new Set<string>(),
      focus: 'sidebar',
      sidebarWidth: SIDEBAR_WIDTH,
      editorExpanded: false,
      current: null,
      surface: 'browse',
      mainTab: 'data',
      structure: null,
      structureLoading: false,
      structureError: null,
      structureScroll: 0,
      structureMaxScroll: 0,
      result: null,
      page: firstPage(PAGE_SIZE),
      sort: null,
      filter: null,
      filterReturnPoint: null,
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
      helpScroll: 0,
      helpMaxScroll: 0,
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
      nlHistory: [],
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

      toggleHelp: () => set((s) => ({ helpOpen: !s.helpOpen, helpScroll: 0 })),

      setErrorDetails: (show) =>
        set((s) => (s.error === null ? {} : { errorDismissed: show ? null : s.error })),

      scrollHelp: (delta) =>
        set((s) => ({
          helpScroll: Math.max(0, Math.min(s.helpMaxScroll, s.helpScroll + delta)),
        })),

      setHelpViewport: (maxScroll) =>
        set((s) =>
          s.helpMaxScroll === maxScroll
            ? s
            : { helpMaxScroll: maxScroll, helpScroll: Math.min(s.helpScroll, maxScroll) },
        ),

      // Sidebar-tree actions live in treeSlice.ts; browse/grid actions in
      // browseSlice.ts; the SQL editor + NL→SQL in editorSlice.ts.
      ...tree,
      ...browse.actions,
      ...editor.actions,

      refresh: async () => {
        set({ profiles: await connectionService.list() });
        await reloadObjects();
      },

      connect: async (id) => {
        const profile = get().profiles.find((p) => p.id === id);
        if (profile) await get().connectProfile(profile);
      },

      connectProfile: async (profile) => {
        get().cancelNl();
        set({ status: 'connecting', error: null });
        const r = await connectionService.open(profile);
        if (!r.ok) {
          set({ status: 'error', error: fromError(r.error) });
          return;
        }
        if (!get().profiles.some((p) => p.id === profile.id)) {
          set({ profiles: [...get().profiles, profile] });
        }
        await attach(r.value, profile.id);
      },

      disconnect: () => {
        get().cancelNl();
        if (active) void active.disconnect();
        active = null;
        set({
          activeId: null,
          status: 'ready',
          queryable: false,
          nlAvailable: false,
          nlHistory: [],
          mode: 'normal',
          notice: null,
          objects: [],
          current: null,
          surface: 'browse',
          result: null,
          statement: null,
          filterReturnPoint: null,
          cellView: null,
          rootExpanded: true,
          treeIndex: 0,
          treeFilter: '',
          marks: new Set<string>(),
          focus: 'sidebar',
        });
        clampTree();
      },

      saveConnection: async (profile, password) => {
        await connectionService.save(profile, password);
        set({ profiles: await connectionService.list() });
        clampTree();
        // Land the cursor on the saved connection so the next ⏎ connects it.
        const at = rowsNow().findIndex(
          (r) => r.type === 'connection' && r.id === profile.id,
        );
        if (at >= 0) set({ treeIndex: at });
        // A DataSource bakes its options (host/database/…) in at construction,
        // so editing the ACTIVE connection must rebuild it — a mere refresh
        // would keep listing objects through the stale connection.
        if (get().activeId === profile.id) await get().connectProfile(profile);
      },

      removeConnection: async (id) => {
        await connectionService.remove(id);
        if (get().activeId === id) get().disconnect();
        set({ profiles: await connectionService.list() });
        clampTree();
      },

      // Connection-form actions live in connFormSlice.ts (form UI only;
      // the connection lifecycle stays here).
      ...formSlice,

      focusPane: (target) => {
        if (target === 'editor') {
          // The editor pane only exists for SQL-speaking sources.
          if (!get().queryable) {
            set({ error: appError('This source does not support SQL queries.') });
            return;
          }
          if (!get().catalog) void editor.buildCatalog();
          set((s) => ({
            focus: 'editor',
            editorExpanded: true,
            error: null,
            ...(s.mode === 'nl' ? { mode: 'normal' as const } : {}),
          }));
          return;
        }
        set((s) => ({
          focus: target,
          ...(s.mode === 'nl' ? { mode: 'normal' as const } : {}),
        }));
      },

      toggleEditorExpanded: () => {
        if (!get().queryable) return;
        // Collapsing kills the pane's interactive rows — whatever they were
        // capturing must let go, or keys would flow into invisible widgets.
        set((s) => ({
          editorExpanded: !s.editorExpanded,
          ...(s.editorExpanded
            ? {
                ...(s.mode === 'nl' ? { mode: 'normal' as const } : {}),
                ...(s.focus === 'editor' ? { focus: 'grid' as const } : {}),
              }
            : {}),
        }));
      },

      cycleFocus: () => {
        // Tab toggles only the two persistent panes, tree ↔ results. The editor
        // is reached deliberately (`:`) and left with Esc, so it stays off the
        // cycle — Tab never lands you mid-compose.
        get().focusPane(get().focus === 'sidebar' ? 'grid' : 'sidebar');
      },

      // Export actions live in exportSlice.ts (ADR 0012 owns the flow).
      ...xport.actions,

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
        xport.dropTarget(); // if it was an export confirm, drop its target too
        set({ mode: 'normal', pending: null });
      },
    };
  });
