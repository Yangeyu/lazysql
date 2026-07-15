/**
 * Sidebar — the lazygit-style navigation tree: the connection roots, their
 * object categories (Tables, Views, …) and the objects themselves. It is a pure
 * projection of the flattened `TreeRow[]` the store computes; all folding and
 * cursor logic lives in the store, so this component only draws rows. A selected
 * row gets an accent gutter (and an explicit accent fill when focused) so the
 * cursor is always obvious. Clicking a row (or the pane) is reported up via
 * `onRowClick` / `onPaneClick` — no coordinate math, the index is known here.
 *
 * A one-line filter row sits under the title: a live <input> while editing
 * (mode 'treeFilter'), else a `/needle (n)` reminder while a filter rests active.
 * The store already narrows `rows`; this view only draws that row and hands the
 * virtualized body one fewer line when it shows.
 */

import React from 'react';
import { TextAttributes, type MouseEvent } from '@opentui/core';
import type { ObjectKind } from '../../domain/datasource/schema.ts';
import type { TreeRow } from '../tree/tree.ts';
import { refKey } from '../tree/tree.ts';
import { theme, driverColor, INPUT_CURSOR } from '../theme/theme.ts';
import { rowWindow } from '../app/layout.ts';

interface Props {
  rows: TreeRow[];
  selectedIndex: number;
  focused: boolean;
  width: number;
  /** Object refs marked for a batch export (keyed by `refKey`); marked table rows
   *  get a green ✓ so the selection is visible independent of the cursor. */
  marks: ReadonlySet<string>;
  /** Tree rows the body can show; the list virtualizes to this height. */
  viewportRows: number;
  /** A row was clicked (0-based index into `rows`). */
  onRowClick: (index: number) => void;
  /** The pane's chrome/empty space was clicked — focus it. */
  onPaneClick: () => void;
  /** The wheel/trackpad scrolled over the pane (moves the selection). */
  onScroll: (direction: 'up' | 'down') => void;
  /** The active object-name filter (empty ⇒ none): the resting reminder's text
   *  and the value the input is seeded with while editing. */
  filter: string;
  /** The filter input is being edited (mode 'treeFilter') — show the live input. */
  editing: boolean;
  /** The filter input changed — live-narrow the tree. */
  onFilterInput: (value: string) => void;
  /** The filter input was submitted (⏎) — keep it and return to navigation. */
  onFilterSubmit: () => void;
}

const fold = (expanded: boolean): string => (expanded ? '▾' : '▸');

const objectIcon = (kind: ObjectKind): string => {
  switch (kind) {
    case 'view':
      return '◇';
    case 'index':
      return '⚿';
    case 'trigger':
      return '⚡';
    case 'sequence':
      return '#';
    case 'procedure':
      return 'ƒ';
    case 'collection':
      return '▤';
    case 'keyspace':
      return '⚷';
    default:
      return '▦';
  }
};

/** Render one tree row's content (indentation + glyph + label) as inline spans.
 *  Indentation is `row.depth` driven, so the schema tier nests objects deeper
 *  without this view knowing whether they were grouped. */
const rowContent = (row: TreeRow, selected: boolean, marked: boolean): React.ReactNode => {
  const indent = '  '.repeat(row.depth);
  if (row.type === 'connection') {
    return (
      <>
        <span fg={selected ? undefined : theme.border}>{fold(row.expanded)} </span>
        <span fg={selected ? undefined : row.active ? theme.green : theme.border}>
          {row.active ? '●' : '○'}{' '}
        </span>
        <span attributes={row.active ? TextAttributes.BOLD : undefined}>
          {row.label}{' '}
        </span>
        <span fg={selected ? undefined : driverColor(row.tag)}>[{row.tag}]</span>
      </>
    );
  }
  if (row.type === 'category') {
    return (
      <>
        {indent}
        <span fg={selected ? undefined : theme.border}>{fold(row.expanded)} </span>
        <span fg={selected ? undefined : theme.cyan}>{row.label}</span>
        <span fg={selected ? undefined : theme.border}> {row.count}</span>
      </>
    );
  }
  if (row.type === 'schema') {
    return (
      <>
        {indent}
        <span fg={selected ? undefined : theme.border}>{fold(row.expanded)} </span>
        <span fg={selected ? undefined : theme.muted}>[{row.label}]</span>
        <span fg={selected ? undefined : theme.border}> {row.count}</span>
      </>
    );
  }
  return (
    <>
      {indent}
      {marked ? (
        <span fg={selected ? undefined : theme.green}>✓ </span>
      ) : (
        <span fg={selected ? undefined : theme.border}>{objectIcon(row.ref.kind)} </span>
      )}
      <span fg={selected ? undefined : marked ? theme.green : undefined}>{row.label}</span>
    </>
  );
};

const SidebarImpl = ({
  rows,
  selectedIndex,
  focused,
  width,
  marks,
  viewportRows,
  filter,
  editing,
  onRowClick,
  onPaneClick,
  onScroll,
  onFilterInput,
  onFilterSubmit,
}: Props) => {
  // The filter row (live input or resting reminder) costs the body one line, so
  // the virtualization window shrinks by it — otherwise the border would clip the
  // last tree row. Otherwise identical to the DataGrid: render only the window
  // that fits; `i` stays the absolute index so highlight + clicks address `rows`.
  const showFilterRow = editing || filter !== '';
  const vh = Math.max(1, viewportRows - (showFilterRow ? 1 : 0));
  const top = rowWindow(selectedIndex, vh, rows.length);
  const visible = rows.slice(top, top + vh);
  const matchCount = rows.reduce((n, r) => n + (r.type === 'object' ? 1 : 0), 0);
  return (
    <box
      flexDirection="column"
      width={width}
      border
      borderStyle="rounded"
      borderColor={focused ? theme.borderFocus : theme.border}
      paddingX={1}
      onMouseDown={onPaneClick}
      onMouseScroll={(e: MouseEvent) => {
        if (e.scroll && (e.scroll.direction === 'up' || e.scroll.direction === 'down'))
          onScroll(e.scroll.direction);
      }}
    >
      <text attributes={TextAttributes.BOLD} fg={focused ? theme.accent : theme.border}>
        CONNECTIONS
      </text>
      {editing ? (
        <box flexDirection="row" flexShrink={0}>
          <text wrapMode="none" flexShrink={0}>
            <span fg={theme.accent}>/ </span>
          </text>
          <input
            focused
            value={filter}
            onInput={(v) => onFilterInput(v)}
            // onSubmit is typed as an upstream intersection quirk; at runtime it
            // fires on ⏎ (the string value is unused — the mirror is already set).
            onSubmit={onFilterSubmit as never}
            flexGrow={1}
            textColor={theme.cyan}
            cursorStyle={INPUT_CURSOR}
            cursorColor={theme.accent}
          />
        </box>
      ) : filter !== '' ? (
        <text wrapMode="none" flexShrink={0}>
          <span fg={theme.yellow}>/ {filter}</span>
          <span fg={theme.border}>{`  (${matchCount})`}</span>
        </text>
      ) : null}
      {rows.length === 0 ? (
        <text fg={theme.border}>(no connection)</text>
      ) : (
        visible.map((row, vi) => {
          const i = top + vi;
          const selected = i === selectedIndex;
          const marked = row.type === 'object' && marks.has(refKey(row.ref));
          return (
            <text
              key={i}
              wrapMode="none"
              selectable
              bg={selected && focused ? theme.accent : undefined}
              fg={selected ? (focused ? theme.onAccent : theme.accent) : undefined}
              onMouseDown={(e) => {
                e.stopPropagation();
                onRowClick(i);
              }}
            >
              {selected && !focused ? <span fg={theme.accent}>▎</span> : ' '}
              {rowContent(row, selected, marked)}
            </text>
          );
        })
      )}
    </box>
  );
};

export const Sidebar = React.memo(SidebarImpl);
