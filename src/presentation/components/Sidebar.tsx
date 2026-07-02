/**
 * Sidebar — the lazygit-style navigation tree: the connection roots, their
 * object categories (Tables, Views, …) and the objects themselves. It is a pure
 * projection of the flattened `TreeRow[]` the store computes; all folding and
 * cursor logic lives in the store, so this component only draws rows. A selected
 * row gets an accent gutter (and inverse when the panel is focused) so the
 * cursor is always obvious. Clicking a row (or the pane) is reported up via
 * `onRowClick` / `onPaneClick` — no coordinate math, the index is known here.
 */

import React from 'react';
import { TextAttributes, type MouseEvent } from '@opentui/core';
import type { ObjectKind } from '../../domain/datasource/schema.ts';
import type { TreeRow } from '../tree/tree.ts';
import { refKey } from '../tree/tree.ts';
import { theme, driverColor } from '../theme/theme.ts';
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
        <span fg={theme.border}>{fold(row.expanded)} </span>
        <span fg={row.active ? theme.green : theme.border}>
          {row.active ? '●' : '○'}{' '}
        </span>
        <span attributes={row.active ? TextAttributes.BOLD : undefined}>
          {row.label}{' '}
        </span>
        <span fg={driverColor(row.tag)}>[{row.tag}]</span>
      </>
    );
  }
  if (row.type === 'category') {
    return (
      <>
        {indent}
        <span fg={theme.border}>{fold(row.expanded)} </span>
        <span fg={selected ? undefined : theme.cyan}>{row.label}</span>
        <span fg={theme.border}> {row.count}</span>
      </>
    );
  }
  if (row.type === 'schema') {
    return (
      <>
        {indent}
        <span fg={theme.border}>{fold(row.expanded)} </span>
        <span fg={selected ? undefined : theme.muted}>[{row.label}]</span>
        <span fg={theme.border}> {row.count}</span>
      </>
    );
  }
  return (
    <>
      {indent}
      {marked ? (
        <span fg={theme.green}>✓ </span>
      ) : (
        <span fg={theme.border}>{objectIcon(row.ref.kind)} </span>
      )}
      <span fg={marked ? theme.green : undefined}>{row.label}</span>
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
  onRowClick,
  onPaneClick,
  onScroll,
}: Props) => {
  // Vertical virtualization, identical to the DataGrid: render only the window
  // that fits, scrolled to keep the cursor in view. `i` stays the absolute index
  // so selection highlight and the click handler address the full `rows`.
  const vh = Math.max(1, viewportRows);
  const top = rowWindow(selectedIndex, vh, rows.length);
  const visible = rows.slice(top, top + vh);
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
              attributes={selected && focused ? TextAttributes.INVERSE : undefined}
              fg={selected && !focused ? theme.accent : undefined}
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
