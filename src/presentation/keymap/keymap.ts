/**
 * Keymap registry — the single source of truth for every keybinding's
 * *documentation*. Both the compact status-bar footer and the `?` help overlay
 * render from this table, so a binding is described once and can never drift
 * between the two. (Dispatch still lives in App's input handler; this module is
 * purely declarative — the lazygit cheat-sheet pattern.)
 *
 * A new feature adds one row here and its hint shows up in the footer and help
 * automatically.
 */

import type { Focus, Mode } from '../app/store.ts';

/** The focus/mode the UI is in — selects which group of keys is active. */
export type KeyContext =
  | 'sidebar'
  | 'grid'
  | 'editor'
  | 'filter'
  | 'edit'
  | 'confirm'
  | 'connform'
  | 'cell'
  | 'nl';

/** Runtime flags that gate context-dependent bindings (capability-driven). */
export interface KeyFlags {
  readonly queryable: boolean;
  readonly nlAvailable: boolean;
}

/** The minimal slice of UI state that selects the active key context. */
export interface ContextInput {
  readonly cellView: unknown | null;
  readonly mode: Mode;
  readonly nlMode: boolean;
  readonly focus: Focus;
}

/**
 * Which context's keys are active, as one linear precedence (highest first): an
 * open cell inspector owns input, then the input-capturing modes, then the NL
 * prompt, then plain pane focus. Pure — the single definition of "where are we",
 * shared by the key dispatcher and the footer/help, and unit-testable on its own.
 */
export const deriveContext = (s: ContextInput): KeyContext =>
  s.cellView
    ? 'cell'
    : s.mode === 'connform'
      ? 'connform'
      : s.mode === 'filter'
        ? 'filter'
        : s.mode === 'edit'
          ? 'edit'
          : s.mode === 'confirm'
            ? 'confirm'
            : s.nlMode
              ? 'nl'
              : s.focus === 'editor'
                ? 'editor'
                : s.focus === 'sidebar'
                  ? 'sidebar'
                  : 'grid';

export interface KeyBinding {
  /** Display form of the key(s), e.g. '⏎', 'j/k', '^G'. */
  readonly keys: string;
  /** Short label for the compact footer, e.g. 'open'. */
  readonly hint: string;
  /** Fuller one-line description for the help overlay. */
  readonly desc: string;
  /** When present, the binding only applies if this predicate holds. */
  readonly enabled?: (f: KeyFlags) => boolean;
}

export interface KeyGroup {
  readonly title: string;
  readonly bindings: readonly KeyBinding[];
}

/** Always-available actions (outside input-capturing modals). */
const GLOBAL: readonly KeyBinding[] = [
  { keys: '`', hint: 'conn', desc: 'Switch connection (back to picker)' },
  {
    keys: ':',
    hint: 'sql',
    desc: 'Open the SQL query editor',
    enabled: (f) => f.queryable,
  },
  { keys: '?', hint: 'help', desc: 'Toggle this help' },
  { keys: 'q', hint: 'quit', desc: 'Quit lazysql' },
];

const GROUPS: Record<KeyContext, KeyGroup> = {
  sidebar: {
    title: 'Tree',
    bindings: [
      { keys: '↑/↓ k/j', hint: 'move', desc: 'Move the selection' },
      {
        keys: '⏎/space',
        hint: 'open',
        desc: 'Expand/collapse a node · open an object',
      },
      { keys: '→/l', hint: 'expand', desc: 'Expand a node · open an object' },
      { keys: '←/h', hint: 'collapse', desc: 'Collapse a node · jump to parent' },
      { keys: 'D', hint: 'ddl', desc: 'Open the object showing its DDL/structure' },
      { keys: 'n', hint: 'new', desc: 'New connection' },
      { keys: 'e', hint: 'edit', desc: 'Edit the selected connection’s config' },
      { keys: ':', hint: 'sql', desc: 'Focus the SQL editor', enabled: (f) => f.queryable },
      { keys: 'tab', hint: 'pane', desc: 'Cycle to the next pane' },
    ],
  },
  grid: {
    title: 'Data grid',
    bindings: [
      { keys: '↑/↓ k/j', hint: 'row', desc: 'Move the row cursor' },
      { keys: '←/→ h/l', hint: 'col', desc: 'Move the column cursor · scroll wide tables' },
      { keys: '⏎', hint: 'inspect', desc: 'Inspect the full cell value' },
      { keys: 's', hint: 'sort', desc: 'Cycle sort on the column' },
      { keys: '/', hint: 'filter', desc: 'Filter the column by a substring' },
      { keys: 'e', hint: 'edit', desc: 'Edit the cell under the cursor' },
      { keys: 'd', hint: 'del', desc: 'Delete the row under the cursor' },
      { keys: 'n/p', hint: 'page', desc: 'Next / previous page (browsed table)' },
      { keys: 'D', hint: 'data/ddl', desc: 'Toggle the Data / DDL tab' },
      { keys: ':', hint: 'sql', desc: 'Focus the SQL editor', enabled: (f) => f.queryable },
      { keys: 'tab', hint: 'pane', desc: 'Cycle to the next pane' },
    ],
  },
  editor: {
    title: 'SQL editor',
    bindings: [
      { keys: '⏎', hint: 'run', desc: 'Run the query (result shows in the grid)' },
      {
        keys: 'tab',
        hint: 'complete',
        desc: 'Accept completion · else cycle to the next pane',
      },
      { keys: '↑/↓', hint: 'history', desc: 'Previous / next history entry' },
      {
        keys: '^G',
        hint: 'ask AI',
        desc: 'Generate SQL from natural language',
        enabled: (f) => f.nlAvailable,
      },
      { keys: 'esc', hint: 'grid', desc: 'Focus the results grid' },
    ],
  },
  filter: {
    title: 'Filter',
    bindings: [
      { keys: '⏎', hint: 'apply', desc: 'Apply the filter (empty clears it)' },
      { keys: 'esc', hint: 'cancel', desc: 'Cancel' },
    ],
  },
  edit: {
    title: 'Edit cell',
    bindings: [
      { keys: '⏎', hint: 'review', desc: 'Review the change before applying' },
      { keys: 'esc', hint: 'cancel', desc: 'Cancel' },
    ],
  },
  confirm: {
    title: 'Confirm',
    bindings: [
      { keys: 'y', hint: 'apply', desc: 'Apply the pending write' },
      { keys: 'n', hint: 'cancel', desc: 'Cancel' },
    ],
  },
  connform: {
    title: 'New connection',
    bindings: [
      { keys: '↑/↓', hint: 'field', desc: 'Move between fields' },
      { keys: '←/→', hint: 'driver', desc: 'Change the driver' },
      { keys: '⏎', hint: 'save', desc: 'Save the connection' },
      { keys: 'esc', hint: 'cancel', desc: 'Cancel' },
    ],
  },
  cell: {
    title: 'Cell inspector',
    bindings: [
      { keys: 'j/k ↑/↓', hint: 'scroll', desc: 'Scroll the value' },
      { keys: 'esc/⏎', hint: 'close', desc: 'Close the inspector' },
    ],
  },
  nl: {
    title: 'Ask AI',
    bindings: [
      {
        keys: '⏎',
        hint: 'generate',
        desc: 'Generate SQL (always reviewed before running)',
      },
      { keys: 'esc', hint: 'cancel', desc: 'Cancel' },
    ],
  },
};

/** Modal contexts capture all input, so the global keys don't apply to them. */
const MODAL: ReadonlySet<KeyContext> = new Set<KeyContext>([
  'filter',
  'edit',
  'confirm',
  'connform',
  'cell',
  'nl',
]);

const usable = (b: KeyBinding, f: KeyFlags): boolean => !b.enabled || b.enabled(f);

/** Compact one-line footer string for the active context, e.g. `⏎ open · …`. */
export const footerHints = (context: KeyContext, flags: KeyFlags): string => {
  const local = GROUPS[context].bindings.filter((b) => usable(b, flags));
  const global = MODAL.has(context)
    ? []
    : GLOBAL.filter((b) => usable(b, flags));
  return [...local, ...global].map((b) => `${b.keys} ${b.hint}`).join(' · ');
};

/** The groups the `?` overlay shows for the active context (local + global). */
export const helpGroups = (context: KeyContext, flags: KeyFlags): KeyGroup[] => {
  const local: KeyGroup = {
    title: GROUPS[context].title,
    bindings: GROUPS[context].bindings.filter((b) => usable(b, flags)),
  };
  const groups: KeyGroup[] = [local];
  if (!MODAL.has(context)) {
    groups.push({
      title: 'Global',
      bindings: GLOBAL.filter((b) => usable(b, flags)),
    });
  }
  return groups;
};
