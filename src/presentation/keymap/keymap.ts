/**
 * Keymap — the single source of truth for every keybinding: its documentation
 * AND its behaviour. Each row carries the key(s) to match (`match`), how to draw
 * them (`keys`/`hint`/`desc`), and what they do (`run`). The dispatcher
 * (`dispatchKey`) and the displays (`footerHints`/`helpGroups`) read the very
 * same rows, so a binding is defined once and the footer, the `?` overlay, and
 * the actual behaviour can never drift. Adding a feature is adding one row.
 *
 * `run` receives the live store state (every action hangs off it) and a small
 * env for the effects the store doesn't own (quit / clipboard / debug console),
 * injected at the composition root. Capability
 * gates (`enabled`) decide both whether a binding shows AND whether it fires, so a
 * key that isn't advertised genuinely does nothing.
 */

import type { KeyEvent } from '@opentui/core';
import type { AppState, Focus, Mode, SurfaceKind, MainTab } from '../app/store.ts';
import { errorDialogShowing } from '../app/appError.ts';
import { printableChar } from '../input/keys.ts';
import { formatCellValue } from '../components/cellFormat.ts';

/** The focus/mode the UI is in — selects which group of keys is active. */
export type KeyContext =
  | 'sidebar'
  | 'grid'
  | 'ddl'
  | 'editor'
  | 'filter'
  | 'treeFilter'
  | 'confirm'
  | 'connform'
  | 'cell'
  | 'cellEdit'
  | 'exporting'
  | 'nl';

/** Runtime flags that gate context-dependent bindings (capability-driven). */
export interface KeyFlags {
  readonly queryable: boolean;
  readonly nlAvailable: boolean;
}

/** The effects a binding may need that the store doesn't own: leaving the
 *  renderer, and writing to the system clipboard (an out-of-store side effect,
 *  injected at the composition root like `quit`). */
export interface DispatchEnv {
  readonly quit: () => void;
  readonly copy: (text: string) => void;
  /** Show/hide OpenTUI's debug console overlay (captured logs & errors — it no
   *  longer opens itself on error, so this is the way in). */
  readonly toggleConsole: () => void;
}

/** The minimal slice of UI state that selects the active key context. */
export interface ContextInput {
  /** The cell inspector, if open — its `mode` splits view (`cell`) from edit
   *  (`cellEdit`). Structurally typed so the store's `CellInspect` fits. */
  readonly cellView: { readonly mode?: 'view' | 'edit' } | null;
  readonly mode: Mode;
  readonly nlMode: boolean;
  readonly focus: Focus;
  readonly surface: SurfaceKind;
  readonly mainTab: MainTab;
}

/**
 * Which context's keys are active, as one linear precedence (highest first): an
 * open cell inspector owns input, then the input-capturing modes, then the NL
 * prompt, then pane focus — and a browsed object showing its DDL is its own
 * static context (only the tab toggle + globals apply). Pure: the single
 * definition of "where are we", shared by the dispatcher and the footer/help.
 */
export const deriveContext = (s: ContextInput): KeyContext => {
  // One linear precedence, highest first — read top to bottom.
  if (s.mode === 'exporting') return 'exporting'; // a running export owns input (esc cancels)
  if (s.cellView) return s.cellView.mode === 'edit' ? 'cellEdit' : 'cell';
  if (s.mode === 'connform') return 'connform';
  if (s.mode === 'filter') return 'filter';
  if (s.mode === 'treeFilter') return 'treeFilter';
  if (s.mode === 'confirm') return 'confirm';
  if (s.nlMode) return 'nl';
  if (s.focus === 'editor') return 'editor';
  if (s.focus === 'sidebar') return 'sidebar';
  if (s.surface === 'browse' && s.mainTab === 'ddl') return 'ddl';
  return 'grid';
};

export interface KeyBinding {
  /** Display form of the key(s), e.g. '⏎', 'j/k', '^G'. */
  readonly keys: string;
  /** Short label for the compact footer, e.g. 'open'. */
  readonly hint: string;
  /** Fuller one-line description for the help overlay. */
  readonly desc: string;
  /** Tokens this binding fires on: a key name ('up', 'return'), a literal glyph
   *  ('k', ':', ' '), or a control chord ('^g'). Any one matching triggers it.
   *  Omitted for a documentation-only row — a key a focused native widget owns
   *  (e.g. ⏎ submits an <input>), shown in the footer/help but not dispatched. */
  readonly match?: readonly string[];
  /** What the binding does. Reads/acts on the live store state; `env` covers the
   *  non-store effects (quit/copy/console). Async actions are fired and not
   *  awaited. Omitted together with `match` for a documentation-only row. */
  readonly run?: (s: AppState, env: DispatchEnv) => void;
  /** When present, the binding shows AND fires only if this predicate holds. */
  readonly enabled?: (f: KeyFlags) => boolean;
  /** Show this binding in the compact footer — the curated "common few". When a
   *  context declares none, the footer falls back to all of them. The `?` overlay
   *  always lists everything regardless of this flag. */
  readonly primary?: boolean;
}

/** Raw char entry for a field with no native <input> of its own — only the
 *  connection form's masked secret field, which is store-rendered as bullets.
 *  Kept off the documented `bindings` so it never clutters the footer. */
export interface TextEntry {
  readonly onChar: (s: AppState, ch: string) => void;
  readonly onErase: (s: AppState) => void;
}

export interface KeyGroup {
  readonly title: string;
  readonly bindings: readonly KeyBinding[];
  readonly text?: TextEntry;
}

/** Keys available whenever the UI isn't capturing text — i.e. the navigational
 *  contexts (tree / grid / ddl). They never apply while typing, so `:` and `q`
 *  stay literal in the editor and the prompts. */
const GLOBAL: readonly KeyBinding[] = [
  { keys: '`', hint: 'conn', desc: 'Switch connection (back to picker)', match: ['`'], run: (s) => s.disconnect() },
  { keys: ':', hint: 'sql', desc: 'Open the SQL query editor', match: [':'], enabled: (f) => f.queryable, primary: true, run: (s) => s.focusPane('editor') },
  { keys: '^O', hint: 'sql pane', desc: 'Expand / collapse the SQL editor (collapsed: a one-line echo of the current SQL)', match: ['^o'], enabled: (f) => f.queryable, run: (s) => s.toggleEditorExpanded() },
  { keys: '^G', hint: 'ask AI', desc: 'Ask in natural language (opens the SQL editor)', match: ['^g'], enabled: (f) => f.queryable && f.nlAvailable, run: (s) => { s.focusPane('editor'); s.beginNl(); } },
  { keys: 'tab', hint: 'pane', desc: 'Toggle focus: tree ↔ results', match: ['tab'], run: (s) => s.cycleFocus() },
  // Direct pane jumps (vim-style). ^H needs the kitty keyboard protocol — legacy
  // terminals send it as backspace; degrades silently there (ADR 0007).
  { keys: '^H', hint: 'tree', desc: 'Focus the connections tree', match: ['^h'], run: (s) => s.focusPane('sidebar') },
  { keys: '^L', hint: 'results', desc: 'Focus the results grid', match: ['^l'], run: (s) => s.focusPane('grid') },
  { keys: '?', hint: 'help', desc: 'Toggle this help', match: ['?'], run: (s) => s.toggleHelp() },
  { keys: 'q', hint: 'quit', desc: 'Quit lazysql', match: ['q'], run: (_s, env) => env.quit() },
  // Sidebar resize — ctrl+shift+-/+. Needs the kitty keyboard protocol to be
  // distinguishable; degrades silently on legacy terminals (ADR 0007).
  { keys: '^⇧-', hint: 'shrink', desc: 'Shrink the connections sidebar', match: ['^⇧-', '^⇧_'], run: (s) => s.narrowSidebar() },
  { keys: '^⇧+', hint: 'widen', desc: 'Widen the connections sidebar', match: ['^⇧=', '^⇧+'], run: (s) => s.widenSidebar() },
  { keys: 'F12', hint: 'console', desc: 'Toggle the debug console (captured logs & errors)', match: ['f12'], run: (_s, env) => env.toggleConsole() },
];

const GROUPS: Record<KeyContext, KeyGroup> = {
  sidebar: {
    title: 'Tree',
    bindings: [
      { keys: '↑/↓ k/j', hint: 'move', desc: 'Move the selection', match: ['up', 'k'], run: (s) => s.treeUp() },
      { keys: '↑/↓ k/j', hint: 'move', desc: 'Move the selection', match: ['down', 'j'], run: (s) => s.treeDown() },
      { keys: '⏎/space', hint: 'open', desc: 'Expand/collapse a node · open an object', match: ['return', ' '], primary: true, run: (s) => void s.treeToggle() },
      { keys: 'a', hint: 'all', desc: 'Browse the selected table — clean SELECT *', match: ['a'], primary: true, run: (s) => s.browseSelected() },
      { keys: '/ f', hint: 'filter', desc: 'Filter objects by name (live-narrows the tree)', match: ['/', 'f'], primary: true, run: (s) => s.beginTreeFilter() },
      { keys: 'v', hint: 'mark', desc: 'Mark/unmark this table for a batch export (multi-select)', match: ['v'], primary: true, run: (s) => s.toggleMark() },
      { keys: 'X', hint: 'export', desc: 'Export: marked tables, else all tables under the node (schema/category), else this one', match: ['X'], primary: true, run: (s) => s.exportSelectedTable() },
      { keys: 'esc', hint: 'clear', desc: 'Clear the tree filter, else the export marks', match: ['escape'], run: (s) => (s.treeFilter ? s.clearTreeFilter() : s.clearMarks()) },
      { keys: 'g/G', hint: 'top/end', desc: 'Jump to the first / last row', match: ['g'], run: (s) => s.treeTop() },
      { keys: 'g/G', hint: 'top/end', desc: 'Jump to the first / last row', match: ['G'], run: (s) => s.treeBottom() },
      { keys: '→/l', hint: 'expand', desc: 'Expand a node · open an object', match: ['right', 'l'], run: (s) => void s.treeExpand() },
      { keys: '←/h', hint: 'collapse', desc: 'Collapse a node · jump to parent', match: ['left', 'h'], run: (s) => s.treeCollapse() },
      { keys: 'D', hint: 'ddl', desc: 'Open the object showing its DDL/structure', match: ['D'], run: (s) => void s.treeShowDdl() },
      { keys: 'd', hint: 'drop', desc: 'Draft a DROP for the object in the editor (review, then run)', match: ['d'], enabled: (f) => f.queryable, primary: true, run: (s) => s.draftDrop() },
      { keys: 'r', hint: 'refresh', desc: 'Reload connections and re-read the object tree', match: ['r'], run: (s) => void s.refresh() },
      { keys: 'n', hint: 'new', desc: 'New connection', match: ['n'], primary: true, run: (s) => s.beginNewConnection() },
      { keys: 'e', hint: 'edit', desc: 'Edit the selected connection’s config', match: ['e'], run: (s) => s.beginEditConnection() },
      { keys: 'x', hint: 'remove', desc: 'Remove the selected connection (profile + saved password)', match: ['x'], run: (s) => s.beginRemoveConnection() },
    ],
  },
  grid: {
    title: 'Data grid',
    bindings: [
      { keys: '↑/↓ k/j', hint: 'row', desc: 'Move the row cursor', match: ['up', 'k'], run: (s) => s.gridUp() },
      { keys: '↑/↓ k/j', hint: 'row', desc: 'Move the row cursor', match: ['down', 'j'], run: (s) => s.gridDown() },
      { keys: '←/→ h/l', hint: 'col', desc: 'Move the column cursor · scroll wide tables', match: ['left', 'h'], run: (s) => s.gridLeft() },
      { keys: '←/→ h/l', hint: 'col', desc: 'Move the column cursor · scroll wide tables', match: ['right', 'l'], run: (s) => s.gridRight() },
      { keys: '⏎', hint: 'inspect', desc: 'Inspect the full cell value', match: ['return'], primary: true, run: (s) => s.openCell() },
      { keys: 'a', hint: 'all', desc: 'Browse the selected table — clean SELECT *', match: ['a'], run: (s) => s.browseSelected() },
      { keys: 'g/G', hint: 'top/end', desc: 'Jump to the first / last loaded row', match: ['g'], run: (s) => s.gridTop() },
      { keys: 'g/G', hint: 'top/end', desc: 'Jump to the first / last loaded row', match: ['G'], run: (s) => s.gridBottom() },
      { keys: '^U/^D', hint: 'half-pg', desc: 'Move the cursor half a page up / down', match: ['^u'], run: (s) => s.gridHalfUp() },
      { keys: '^U/^D', hint: 'half-pg', desc: 'Move the cursor half a page up / down', match: ['^d'], run: (s) => s.gridHalfDown() },
      { keys: 's', hint: 'sort', desc: 'Cycle sort on the column', match: ['s'], primary: true, run: (s) => { if (s.surface === 'browse') void s.applySort(); } },
      { keys: '/', hint: 'filter', desc: 'Filter the column by a substring', match: ['/'], primary: true, run: (s) => { if (s.surface === 'browse') s.beginFilter(); } },
      // Editing lives in the cell inspector (ADR 0011): ⏎ to inspect, then `e`.
      // No `e` here — a single entry (view → edit) keeps esc a clean pop back.
      { keys: 'd', hint: 'del', desc: 'Delete the row under the cursor', match: ['d'], run: (s) => { if (s.surface === 'browse') s.beginDelete(); } },
      { keys: 'X', hint: 'export', desc: 'Export to CSV — the whole browsed table (filtered/sorted), or the query result', match: ['X'], primary: true, run: (s) => s.exportGrid() },
      { keys: 'n', hint: 'page+', desc: 'Next page (browsed table)', match: ['n'], run: (s) => { if (s.surface === 'browse') void s.pageNext(); } },
      { keys: 'p', hint: 'page-', desc: 'Previous page (browsed table)', match: ['p'], run: (s) => { if (s.surface === 'browse') void s.pagePrev(); } },
      { keys: 'D', hint: 'data/ddl', desc: 'Toggle the Data / DDL tab', match: ['D'], run: (s) => { if (s.surface === 'browse') s.toggleMainTab(); } },
    ],
  },
  ddl: {
    title: 'Structure',
    bindings: [
      { keys: '↑/↓ k/j', hint: 'scroll', desc: 'Scroll the structure / DDL', match: ['up', 'k'], run: (s) => s.scrollStructure(-1) },
      { keys: '↑/↓ k/j', hint: 'scroll', desc: 'Scroll the structure / DDL', match: ['down', 'j'], run: (s) => s.scrollStructure(1) },
      { keys: 'g/G', hint: 'top/end', desc: 'Jump to the first / last line', match: ['g'], run: (s) => s.scrollStructure(-Number.MAX_SAFE_INTEGER) },
      { keys: 'g/G', hint: 'top/end', desc: 'Jump to the first / last line', match: ['G'], run: (s) => s.scrollStructure(Number.MAX_SAFE_INTEGER) },
      { keys: 'D', hint: 'data/ddl', desc: 'Toggle the Data / DDL tab', match: ['D'], primary: true, run: (s) => s.toggleMainTab() },
    ],
  },
  editor: {
    title: 'SQL editor',
    bindings: [
      // ⏎ / ⇧⏎ are owned by the native <textarea> (Enter→run, Shift+Enter→newline;
      // ADR 0010) — documentation-only rows, dispatched by the widget not here.
      { keys: '⏎', hint: 'run', desc: 'Run the query (result shows in the grid)' },
      { keys: '⇧⏎', hint: 'newline', desc: 'Insert a newline — compose multi-line SQL' },
      { keys: 'tab', hint: 'complete', desc: 'Accept completion · else cycle to the next pane', match: ['tab'], run: (s) => (s.completionsOn && s.completions.length > 0 ? s.acceptCompletion() : s.cycleFocus()) },
      { keys: '^P/^N', hint: 'history', desc: 'Previous / next history entry', match: ['^p'], run: (s) => s.historyPrev() },
      { keys: '^P/^N', hint: 'history', desc: 'Previous / next history entry', match: ['^n'], run: (s) => s.historyNext() },
      { keys: '^T', hint: 'compl', desc: 'Toggle schema completion on/off', match: ['^t'], run: (s) => s.toggleCompletions() },
      { keys: '^G', hint: 'ask AI', desc: 'Generate SQL from natural language', match: ['^g'], enabled: (f) => f.nlAvailable, run: (s) => s.beginNl() },
      // ^C is intercepted ahead of the context loop (dispatchKey) — doc-only here.
      { keys: '^C', hint: 'clear', desc: 'Clear the editor draft' },
      { keys: '^O', hint: 'hide', desc: 'Collapse the editor to its one-line echo bar (draft kept)', match: ['^o'], run: (s) => s.toggleEditorExpanded() },
      { keys: 'esc', hint: 'grid', desc: 'Focus the results grid (the editor stays open)', match: ['escape'], run: (s) => s.focusPane('grid') },
    ],
  },
  filter: {
    title: 'Filter',
    bindings: [
      // ⏎ is owned by the native <input> (onSubmit) — documentation-only here.
      { keys: '⏎', hint: 'apply', desc: 'Apply the filter (empty clears it)' },
      { keys: 'esc', hint: 'cancel', desc: 'Cancel', match: ['escape'], run: (s) => s.cancelFilter() },
    ],
  },
  treeFilter: {
    title: 'Filter tree',
    bindings: [
      // ⏎ is owned by the sidebar's native <input> (onSubmit) — doc-only here.
      { keys: '⏎', hint: 'apply', desc: 'Keep the filter and return to the tree' },
      { keys: 'esc', hint: 'clear', desc: 'Clear the filter', match: ['escape'], run: (s) => s.clearTreeFilter() },
    ],
  },
  confirm: {
    title: 'Confirm',
    bindings: [
      { keys: 'y', hint: 'apply', desc: 'Apply the pending write', match: ['y', 'Y'], run: (s) => void s.confirmPending() },
      { keys: 'n', hint: 'cancel', desc: 'Cancel', match: ['n', 'N', 'escape'], run: (s) => s.cancelPending() },
      // Export confirms only: cycle CSV/JSON/SQL. A no-op on other confirms.
      { keys: 'f', hint: 'format', desc: 'Cycle export format (CSV / JSON / SQL)', match: ['f'], run: (s) => s.cycleExportFormat() },
    ],
  },
  connform: {
    title: 'New connection',
    bindings: [
      { keys: '↑/↓', hint: 'field', desc: 'Move between the driver and fields', match: ['up'], run: (s) => s.connFormMove(-1) },
      { keys: '↑/↓', hint: 'field', desc: 'Move between the driver and fields', match: ['down', 'tab'], run: (s) => s.connFormMove(1) },
      { keys: '←/→', hint: 'cycle', desc: 'Cycle the driver / focused button (on that row)', match: ['left'], run: (s) => s.connFormCycle(-1) },
      { keys: '←/→', hint: 'cycle', desc: 'Cycle the driver / focused button (on that row)', match: ['right'], run: (s) => s.connFormCycle(1) },
      { keys: '^R', hint: 'reveal', desc: 'Show/hide the password', match: ['^r'], run: (s) => s.connFormToggleReveal() },
      { keys: '^T', hint: 'test', desc: 'Test the connection without saving', match: ['^t'], run: (s) => void s.connFormTest() },
      { keys: '⏎', hint: 'save', desc: 'Save — or press the focused button', match: ['return'], run: (s) => void s.connFormSubmit() },
      { keys: 'esc', hint: 'cancel', desc: 'Cancel', match: ['escape'], run: (s) => s.connFormCancel() },
    ],
    text: { onChar: (s, ch) => s.connFormType(ch), onErase: (s) => s.connFormBackspace() },
  },
  cell: {
    title: 'Cell inspector',
    bindings: [
      { keys: 'j/k ↑/↓', hint: 'scroll', desc: 'Scroll the value', match: ['down', 'j'], run: (s) => s.scrollCell(1) },
      { keys: 'j/k ↑/↓', hint: 'scroll', desc: 'Scroll the value', match: ['up', 'k'], run: (s) => s.scrollCell(-1) },
      { keys: 'e', hint: 'edit', desc: 'Edit this cell in place', match: ['e'], run: (s) => s.beginEdit() },
      { keys: 'y', hint: 'copy', desc: 'Copy the full value to the clipboard', match: ['y'], run: (s, env) => { if (s.cellView) env.copy(formatCellValue(s.cellView.value).lines.join('\n')); } },
      { keys: 'esc/⏎', hint: 'close', desc: 'Close the inspector', match: ['escape', 'return'], run: (s) => s.closeCell() },
    ],
  },
  cellEdit: {
    title: 'Edit cell',
    bindings: [
      // ^S and ⏎ are owned by the native <textarea> (^S submits → stage the update,
      // ⏎ inserts a newline; ADR 0011) — documentation-only rows.
      { keys: '^S', hint: 'save', desc: 'Save the change (stages an update confirm)' },
      { keys: '⏎', hint: 'newline', desc: 'Insert a newline — edit multi-line values' },
      { keys: 'esc', hint: 'view', desc: 'Discard the edit — back to the value view', match: ['escape'], run: (s) => s.cancelEdit() },
    ],
  },
  exporting: {
    title: 'Exporting',
    bindings: [
      { keys: 'esc', hint: 'cancel', desc: 'Cancel the export (discards the partial file)', match: ['escape'], run: (s) => s.cancelExport() },
    ],
  },
  nl: {
    title: 'Ask AI',
    bindings: [
      // ⏎ is owned by the native <input> (onSubmit) — documentation-only here.
      { keys: '⏎', hint: 'generate', desc: 'Generate SQL (always reviewed before running)' },
      { keys: 'esc', hint: 'cancel', desc: 'Cancel', match: ['escape'], run: (s) => s.cancelNl() },
    ],
  },
};

/** Navigational contexts — the ones that aren't capturing text, so the GLOBAL
 *  keys apply to them (and only them). The single gate shared by the dispatcher
 *  and the footer/help, so what's advertised is exactly what fires. */
const NAV: ReadonlySet<KeyContext> = new Set<KeyContext>(['sidebar', 'grid', 'ddl']);

/** The longest binding description across EVERY context and the globals. The
 *  help overlay derives its fixed panel width from this, so the panel is the
 *  same size wherever `?` is pressed and no description ever clips. */
export const widestHelpDesc: number = Math.max(
  ...Object.values(GROUPS).flatMap((g) => g.bindings.map((b) => b.desc.length)),
  ...GLOBAL.map((b) => b.desc.length),
);

const NAMED: ReadonlySet<string> = new Set([
  'up', 'down', 'left', 'right', 'return', 'escape', 'tab', 'backspace', 'delete', 'f12',
]);

const usable = (b: KeyBinding, f: KeyFlags): boolean => !b.enabled || b.enabled(f);

/** Does this key event satisfy one of a binding's match tokens?
 *  Token forms: `^⇧x` = ctrl+shift chord, `^x` = ctrl chord, a NAMED key, else a
 *  literal glyph. `^⇧x` matches the char as either the base name or the shifted
 *  sequence, so it fires whether the terminal reports `-` or `_` for that key. */
const hits = (b: KeyBinding, key: KeyEvent, ch: string | null): boolean =>
  (b.match ?? []).some((t) =>
    t.startsWith('^⇧')
      ? key.ctrl && key.shift && (key.name === t.slice(2) || key.sequence === t.slice(2))
      : t.startsWith('^')
        ? key.ctrl && key.name === t.slice(1)
        : NAMED.has(t)
          ? key.name === t
          : ch === t,
  );

/** The de-duplicated bindings to *show* for a context (the table repeats a row
 *  per match alternative, e.g. up and k; the display only wants it once). */
const shown = (context: KeyContext, flags: KeyFlags): KeyBinding[] => {
  const seen = new Set<string>();
  return GROUPS[context].bindings.filter((b) => {
    if (!usable(b, flags) || seen.has(b.hint)) return false;
    seen.add(b.hint);
    return true;
  });
};

/** Exits pinned to the end of every navigational footer, in a fixed order: the
 *  always-there way out (quit) and into the full reference (help). */
const FOOTER_EXITS: readonly string[] = ['quit', 'help'];

/**
 * Compact one-line footer for the active context: the curated *primary* bindings
 * (the common few), or ALL of them when a context declares no primaries (keeps
 * the short contexts — filter/cell/exporting — unchanged). Nav contexts append
 * the quit/help exits. The full list always lives in the `?` overlay, and the
 * status bar scrolls to reveal anything a narrow width clips.
 */
export const footerHints = (context: KeyContext, flags: KeyFlags): string => {
  const nav = NAV.has(context);
  const candidates = [
    ...shown(context, flags),
    ...(nav ? GLOBAL.filter((b) => usable(b, flags)) : []),
  ];
  const primaries = candidates.filter((b) => b.primary);
  const pick = primaries.length > 0 ? primaries : candidates;
  const hints = pick.map((b) => `${b.keys} ${b.hint}`);
  if (nav) {
    for (const hint of FOOTER_EXITS) {
      const b = GLOBAL.find((g) => g.hint === hint && usable(g, flags));
      if (b) {
        const s = `${b.keys} ${b.hint}`;
        if (!hints.includes(s)) hints.push(s);
      }
    }
  }
  return hints.join(' · ');
};

/** The groups the `?` overlay shows for the active context (local + global). */
export const helpGroups = (context: KeyContext, flags: KeyFlags): KeyGroup[] => {
  const groups: KeyGroup[] = [{ title: GROUPS[context].title, bindings: shown(context, flags) }];
  if (NAV.has(context)) {
    groups.push({ title: 'Global', bindings: GLOBAL.filter((b) => usable(b, flags)) });
  }
  return groups;
};

/**
 * Route one key press to its action. The single dispatcher the App's keyboard
 * handler delegates to. Precedence: ⌃C always quits; an open help overlay and an
 * in-flight generation own input; then the active context's documented bindings,
 * the global keys (navigational contexts only), and finally free-text entry.
 */
export const dispatchKey = (s: AppState, key: KeyEvent, env: DispatchEnv): void => {
  if (key.ctrl && key.name === 'c') {
    // In the SQL editor ^C clears a non-empty draft (shell-like); on an already
    // empty editor — or in any other context — it quits.
    if (!s.helpOpen && deriveContext(s) === 'editor' && s.queryText !== '') {
      return s.setQuery('');
    }
    return env.quit();
  }

  const ch = printableChar(key);

  // The error dialog (auto-popped on failure) swallows input until dismissed —
  // but only while it is the layer actually on screen: a staged confirm and the
  // connection form render above it, and they must keep their keys.
  if (errorDialogShowing(s)) {
    if (key.name === 'escape' || key.name === 'return') s.dismissError();
    return;
  }

  // The help overlay floats over any context and swallows input until
  // dismissed; j/k (and ^d/^u) scroll it when the list outgrows the panel.
  if (s.helpOpen) {
    if (ch === '?' || key.name === 'escape') s.toggleHelp();
    else if (key.ctrl && key.name === 'd') s.scrollHelp(10);
    else if (key.ctrl && key.name === 'u') s.scrollHelp(-10);
    else if (key.name === 'down' || ch === 'j') s.scrollHelp(1);
    else if (key.name === 'up' || ch === 'k') s.scrollHelp(-1);
    return;
  }
  if (s.generating) return; // ignore input while the model works

  const flags: KeyFlags = { queryable: s.queryable, nlAvailable: s.nlAvailable };
  const context = deriveContext(s);
  const group = GROUPS[context];

  for (const b of group.bindings) {
    if (b.run && usable(b, flags) && hits(b, key, ch)) return b.run(s, env);
  }
  if (NAV.has(context)) {
    for (const b of GLOBAL) {
      if (b.run && usable(b, flags) && hits(b, key, ch)) return b.run(s, env);
    }
  }
  // The native <input>s own their own editing; the only text the dispatcher
  // still routes is the connection form's masked secret field (no input there).
  if (group.text) {
    if (key.name === 'backspace' || key.name === 'delete') group.text.onErase(s);
    else if (ch !== null) group.text.onChar(s, ch);
  }
};
