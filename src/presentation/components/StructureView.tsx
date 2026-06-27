/**
 * StructureView — the DDL tab. Renders an open object's detail sections in
 * order: a `columns` section as a table (name, type, nullability, primary key),
 * a `source` section as the engine's verbatim DDL/definition. A view shows both;
 * an index/trigger shows only its source. When an object has no real source
 * (a plain table), a representative CREATE is synthesized from its columns as a
 * fallback — superseded the moment true DDL (a `source` section) is present.
 */

import React from 'react';
import { TextAttributes } from '@opentui/core';
import type {
  ColumnDef,
  ObjectRef,
  ObjectSchema,
} from '../../domain/datasource/schema.ts';
import { theme } from '../theme/theme.ts';

interface Props {
  structure: ObjectSchema | null;
  loading: boolean;
  error: string | null;
  hasTable: boolean;
}

const NAME_COL = 22;
const TYPE_COL = 16;

const columnsTable = (columns: ColumnDef[]): React.ReactNode => (
  <box flexDirection="column">
    <box flexDirection="row">
      <text attributes={TextAttributes.BOLD} fg={theme.border}>{'pk'.padEnd(4)}</text>
      <text attributes={TextAttributes.BOLD} fg={theme.border}>{'column'.padEnd(NAME_COL)}</text>
      <text attributes={TextAttributes.BOLD} fg={theme.border}>{'type'.padEnd(TYPE_COL)}</text>
      <text attributes={TextAttributes.BOLD} fg={theme.border}>null</text>
    </box>
    <text fg={theme.border}>{'─'.repeat(4 + NAME_COL + TYPE_COL + 4)}</text>
    {columns.map((c) => (
      <text key={c.name} wrapMode="none" selectable>
        <span fg={theme.yellow}>{(c.isPrimaryKey ? '🔑' : '').padEnd(4)}</span>
        <span fg={theme.cyan}>{c.name.padEnd(NAME_COL)}</span>
        <span fg={theme.green}>{c.dataType.padEnd(TYPE_COL)}</span>
        <span fg={theme.border}>{c.nullable ? 'yes' : 'no'}</span>
      </text>
    ))}
  </box>
);

const sourceBlock = (text: string): React.ReactNode => (
  <box flexDirection="column">
    {(text === '' ? '(no definition)' : text).split('\n').map((l, i) => (
      <text key={i} fg={theme.border} wrapMode="none" selectable>
        {l === '' ? ' ' : l}
      </text>
    ))}
  </box>
);

/** Representative CREATE synthesized from columns — the fallback when an object
 *  exposes no real `source` section (e.g. a plain table). */
const synthDdl = (ref: ObjectRef, columns: ColumnDef[]): string => {
  const lines = columns.map(
    (c) =>
      `  ${c.name} ${c.dataType}${c.nullable ? '' : ' NOT NULL'}${c.isPrimaryKey ? ' PRIMARY KEY' : ''}`,
  );
  return `CREATE TABLE ${ref.name} (\n${lines.join(',\n')}\n);`;
};

const StructureViewImpl = ({ structure, loading, error, hasTable }: Props) => {
  if (!hasTable)
    return (
      <text fg={theme.border}>
        Select an object and press Enter, then ⇥ DDL.
      </text>
    );
  if (loading) return <text fg={theme.yellow}>Loading structure…</text>;
  if (error) return <text fg={theme.red}>error: {error}</text>;
  if (!structure) return <text fg={theme.border}>(no structure)</text>;

  const sections = structure.detail;
  const columns = sections.find((s) => s.kind === 'columns');
  const hasSource = sections.some((s) => s.kind === 'source');

  return (
    <box flexDirection="column">
      {sections.map((section, i) => (
        <box key={i} flexDirection="column">
          {i > 0 ? <text> </text> : null}
          {section.kind === 'columns'
            ? columnsTable(section.columns)
            : sourceBlock(section.text)}
        </box>
      ))}
      {!hasSource && columns?.kind === 'columns' ? (
        <box flexDirection="column">
          <text> </text>
          {synthDdl(structure.ref, columns.columns)
            .split('\n')
            .map((l, i) => (
              <text key={i} fg={theme.border} wrapMode="none">
                {l === '' ? ' ' : l}
              </text>
            ))}
        </box>
      ) : null}
    </box>
  );
};

export const StructureView = React.memo(StructureViewImpl);
