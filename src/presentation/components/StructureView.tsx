/**
 * StructureView — the DDL tab. Renders an open object's columns (name, type,
 * nullability, primary key) plus a synthesized CREATE statement. The schema
 * comes from the introspection port's describe(); the CREATE text is a faithful
 * rendering of that structure, not the engine's verbatim DDL — true per-engine
 * DDL (SHOW CREATE / pg_get_*) is a future introspection capability.
 */

import React from 'react';
import { Box, Text } from 'ink';
import type { ObjectSchema } from '../../domain/datasource/schema.ts';
import { theme } from '../theme/theme.ts';

interface Props {
  structure: ObjectSchema | null;
  loading: boolean;
  error: string | null;
  hasTable: boolean;
}

const NAME_COL = 22;
const TYPE_COL = 16;

/** Render the structure as a CREATE statement (representative, not verbatim). */
const synthDdl = (schema: ObjectSchema): string => {
  const keyword = schema.ref.kind === 'view' ? 'VIEW' : 'TABLE';
  const lines = schema.columns.map((c) => {
    const flags = `${c.nullable ? '' : ' NOT NULL'}${
      c.isPrimaryKey ? ' PRIMARY KEY' : ''
    }`;
    return `  ${c.name} ${c.dataType}${flags}`;
  });
  return `CREATE ${keyword} ${schema.ref.name} (\n${lines.join(',\n')}\n);`;
};

const StructureViewImpl: React.FC<Props> = ({
  structure,
  loading,
  error,
  hasTable,
}) => {
  if (!hasTable)
    return (
      <Text color={theme.border}>
        Select an object and press Enter, then ⇥ DDL.
      </Text>
    );
  if (loading) return <Text color={theme.yellow}>Loading structure…</Text>;
  if (error) return <Text color={theme.red}>error: {error}</Text>;
  if (!structure) return <Text color={theme.border}>(no structure)</Text>;

  return (
    <Box flexDirection="column">
      <Box>
        <Text bold color={theme.border}>{'pk'.padEnd(4)}</Text>
        <Text bold color={theme.border}>{'column'.padEnd(NAME_COL)}</Text>
        <Text bold color={theme.border}>{'type'.padEnd(TYPE_COL)}</Text>
        <Text bold color={theme.border}>null</Text>
      </Box>
      <Text color={theme.border}>{'─'.repeat(4 + NAME_COL + TYPE_COL + 4)}</Text>
      {structure.columns.map((c) => (
        <Text key={c.name} wrap="truncate">
          <Text color={theme.yellow}>{(c.isPrimaryKey ? '🔑' : '').padEnd(4)}</Text>
          <Text color={theme.cyan}>{c.name.padEnd(NAME_COL)}</Text>
          <Text color={theme.green}>{c.dataType.padEnd(TYPE_COL)}</Text>
          <Text color={theme.border}>{c.nullable ? 'yes' : 'no'}</Text>
        </Text>
      ))}
      <Text> </Text>
      <Text color={theme.border} wrap="truncate">
        {synthDdl(structure)
          .split('\n')
          .map((l, i) => (
            <Text key={i}>
              {l}
              {'\n'}
            </Text>
          ))}
      </Text>
    </Box>
  );
};

export const StructureView = React.memo(StructureViewImpl);
