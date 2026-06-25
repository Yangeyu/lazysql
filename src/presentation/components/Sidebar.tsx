/**
 * Sidebar — the lazygit-style navigation tree: the connection roots, their
 * object categories (Tables, Views, …) and the objects themselves. It is a pure
 * projection of the flattened `TreeRow[]` the store computes; all folding and
 * cursor logic lives in the store, so this component only draws rows. A selected
 * row gets an accent gutter (and inverse when the panel is focused) so the
 * cursor is always obvious.
 */

import React from 'react';
import { Box, Text } from 'ink';
import type { ObjectKind } from '../../domain/datasource/schema.ts';
import type { TreeRow } from '../tree/tree.ts';
import { theme, driverColor } from '../theme/theme.ts';

interface Props {
  rows: TreeRow[];
  selectedIndex: number;
  focused: boolean;
  width: number;
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

/** Render one tree row's content (indentation + glyph + label). */
const rowContent = (row: TreeRow, selected: boolean): React.ReactNode => {
  if (row.type === 'connection') {
    return (
      <>
        <Text color={theme.border}>{fold(row.expanded)} </Text>
        <Text color={row.active ? theme.green : theme.border}>
          {row.active ? '●' : '○'}{' '}
        </Text>
        <Text bold={row.active}>{row.label} </Text>
        <Text color={driverColor(row.tag)}>[{row.tag}]</Text>
      </>
    );
  }
  if (row.type === 'category') {
    return (
      <>
        {'  '}
        <Text color={theme.border}>{fold(row.expanded)} </Text>
        <Text color={selected ? undefined : theme.cyan}>{row.label}</Text>
        <Text color={theme.border}> {row.count}</Text>
      </>
    );
  }
  return (
    <>
      {'    '}
      <Text color={theme.border}>{objectIcon(row.ref.kind)} </Text>
      {row.label}
    </>
  );
};

const SidebarImpl: React.FC<Props> = ({
  rows,
  selectedIndex,
  focused,
  width,
}) => (
  <Box
    flexDirection="column"
    width={width}
    borderStyle="round"
    borderColor={focused ? theme.borderFocus : theme.border}
    paddingX={1}
  >
    <Text bold color={focused ? theme.accent : theme.border}>
      CONNECTIONS
    </Text>
    {rows.length === 0 ? (
      <Text color={theme.border}>(no connection)</Text>
    ) : (
      rows.map((row, i) => {
        const selected = i === selectedIndex;
        return (
          <Text
            key={i}
            inverse={selected && focused}
            color={selected && !focused ? theme.accent : undefined}
            wrap="truncate"
          >
            {selected && !focused ? <Text color={theme.accent}>▎</Text> : ' '}
            {rowContent(row, selected)}
          </Text>
        );
      })
    )}
  </Box>
);

export const Sidebar = React.memo(SidebarImpl);
