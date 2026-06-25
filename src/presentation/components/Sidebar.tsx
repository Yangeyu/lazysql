/**
 * Sidebar — the lazygit-style navigation tree: the connection root, its object
 * categories (Tables, Views, …) and the objects themselves. It is a pure
 * projection of the flattened `TreeRow[]` the store computes; all folding and
 * cursor logic lives in the store, so this component only draws rows.
 */

import React from 'react';
import { Box, Text } from 'ink';
import type { ObjectKind } from '../../domain/datasource/schema.ts';
import type { TreeRow } from '../tree/tree.ts';

interface Props {
  rows: TreeRow[];
  selectedIndex: number;
  focused: boolean;
  width: number;
}

const fold = (expanded: boolean): string => (expanded ? '▼' : '▶');

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

/** Render one tree row's text (indentation + glyph + label). */
const rowContent = (row: TreeRow): React.ReactNode => {
  if (row.type === 'connection') {
    return (
      <>
        {fold(row.expanded)}{' '}
        <Text color={row.connected ? 'green' : 'gray'}>●</Text>{' '}
        <Text bold>{row.label}</Text>
        <Text dimColor> [{row.tag}]</Text>
      </>
    );
  }
  if (row.type === 'category') {
    return (
      <>
        {'  '}
        {fold(row.expanded)} {row.label}
        <Text dimColor> ({row.count})</Text>
      </>
    );
  }
  return (
    <>
      {'    '}
      {objectIcon(row.ref.kind)} {row.label}
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
    borderColor={focused ? 'cyan' : 'gray'}
    paddingX={1}
  >
    {rows.length === 0 ? (
      <Text dimColor>(no connection)</Text>
    ) : (
      rows.map((row, i) => {
        const selected = i === selectedIndex;
        return (
          <Text
            key={i}
            inverse={selected && focused}
            color={selected && !focused ? 'cyan' : undefined}
            wrap="truncate"
          >
            {rowContent(row)}
          </Text>
        );
      })
    )}
  </Box>
);

export const Sidebar = React.memo(SidebarImpl);
