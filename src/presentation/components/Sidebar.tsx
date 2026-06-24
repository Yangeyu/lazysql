/**
 * Sidebar — the object tree (Phase 0: a flat list of tables/views). Highlights
 * the selection and indicates which pane holds focus.
 */

import React from 'react';
import { Box, Text } from 'ink';
import type { ObjectRef } from '../../domain/datasource/schema.ts';

interface Props {
  objects: ObjectRef[];
  selectedIndex: number;
  focused: boolean;
  width: number;
}

const icon = (kind: ObjectRef['kind']): string =>
  kind === 'view' ? '◇' : '▦';

const SidebarImpl: React.FC<Props> = ({
  objects,
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
    <Text bold color={focused ? 'cyan' : 'gray'}>
      Objects
    </Text>
    {objects.length === 0 ? (
      <Text dimColor>(none)</Text>
    ) : (
      objects.map((o, i) => {
        const selected = i === selectedIndex;
        return (
          <Text
            key={o.name}
            inverse={selected && focused}
            color={selected && !focused ? 'cyan' : undefined}
            wrap="truncate"
          >
            {icon(o.kind)} {o.name}
          </Text>
        );
      })
    )}
  </Box>
);

export const Sidebar = React.memo(SidebarImpl);
