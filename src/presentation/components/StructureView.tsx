/**
 * StructureView — the DDL tab. Renders an open object's columns (name, type,
 * nullability, primary key) plus a synthesized CREATE statement. The schema
 * comes from the introspection port's describe(); the CREATE text is a faithful
 * rendering of that structure, not the engine's verbatim DDL — true per-engine
 * DDL (SHOW CREATE / pg_get_*) is a future introspection capability.
 */

import React from 'react';
import { TextAttributes } from '@opentui/core';
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

const StructureViewImpl = ({
  structure,
  loading,
  error,
  hasTable,
}: Props) => {
  if (!hasTable)
    return (
      <text fg={theme.border}>
        Select an object and press Enter, then ⇥ DDL.
      </text>
    );
  if (loading) return <text fg={theme.yellow}>Loading structure…</text>;
  if (error) return <text fg={theme.red}>error: {error}</text>;
  if (!structure) return <text fg={theme.border}>(no structure)</text>;

  return (
    <box flexDirection="column">
      <box flexDirection="row">
        <text attributes={TextAttributes.BOLD} fg={theme.border}>{'pk'.padEnd(4)}</text>
        <text attributes={TextAttributes.BOLD} fg={theme.border}>{'column'.padEnd(NAME_COL)}</text>
        <text attributes={TextAttributes.BOLD} fg={theme.border}>{'type'.padEnd(TYPE_COL)}</text>
        <text attributes={TextAttributes.BOLD} fg={theme.border}>null</text>
      </box>
      <text fg={theme.border}>{'─'.repeat(4 + NAME_COL + TYPE_COL + 4)}</text>
      {structure.columns.map((c) => (
        <text key={c.name} wrapMode="none" selectable>
          <span fg={theme.yellow}>{(c.isPrimaryKey ? '🔑' : '').padEnd(4)}</span>
          <span fg={theme.cyan}>{c.name.padEnd(NAME_COL)}</span>
          <span fg={theme.green}>{c.dataType.padEnd(TYPE_COL)}</span>
          <span fg={theme.border}>{c.nullable ? 'yes' : 'no'}</span>
        </text>
      ))}
      <text> </text>
      <box flexDirection="column">
        {synthDdl(structure)
          .split('\n')
          .map((l, i) => (
            <text key={i} fg={theme.border} wrapMode="none">
              {l === '' ? ' ' : l}
            </text>
          ))}
      </box>
    </box>
  );
};

export const StructureView = React.memo(StructureViewImpl);
