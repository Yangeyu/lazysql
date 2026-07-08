/**
 * StructureView — the DDL tab. Shows an open object's structure as two stacked
 * facets: a `columns` table (pk, name, type, nullability, enum values) and the
 * object's SQL source (a view's verbatim definition, or a CREATE synthesized
 * from the columns for a plain table). An index/trigger (source only) just shows
 * source.
 *
 * The two facets are flattened into one list of single-row lines and only the
 * `[scroll, scroll+viewportRows)` window is rendered — so a long definition
 * scrolls instead of overflowing the panel (overflow makes the terminal
 * composite lines on top of each other). A footer shows the scroll position.
 */

import React, { useEffect } from 'react';
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
  /** First visible line (scroll offset); the store clamps it via `onViewport`. */
  scroll: number;
  /** Rows of vertical space the panel gives this view. */
  viewportRows: number;
  /** Report the scroll range back so the store clamps the offset to real lines. */
  onViewport: (maxScroll: number) => void;
}

/** Marker cell width: 🔑 renders ~2 cells, padEnd counts its surrogate pair as
 *  2, so a 4-wide cell keeps keyed and unkeyed rows aligned. */
const PK_COL = 4;
/** Fixed gutter between value columns, so a column exactly at its content width
 *  still keeps a readable gap (the old fixed-width padEnd lost it on overflow). */
const GAP = '  ';
/** The nullability column is 'yes'/'no' under a 'null' header → 4 wide. */
const NULL_COL = 4;

/** One heading line above a facet. */
const label = (key: string, text: string): React.ReactNode => (
  <text key={key} attributes={TextAttributes.BOLD} fg={theme.border}>
    {text}
  </text>
);

/** The columns facet as a flat list of single-row nodes (heading, header, rule,
 *  one per column) — widths sized to content so a long type like `timestamp
 *  with time zone` can't collide with the nullability column. */
const columnRows = (columns: ColumnDef[]): React.ReactNode[] => {
  const nameW = Math.max('column'.length, ...columns.map((c) => c.name.length));
  const typeW = Math.max('type'.length, ...columns.map((c) => c.dataType.length));
  const rule = '─'.repeat(PK_COL + nameW + GAP.length + typeW + GAP.length + NULL_COL);
  return [
    label('lbl-cols', 'Columns'),
    <box key="cols-hdr" flexDirection="row">
      <text attributes={TextAttributes.BOLD} fg={theme.muted}>{'pk'.padEnd(PK_COL)}</text>
      <text attributes={TextAttributes.BOLD} fg={theme.muted}>{'column'.padEnd(nameW) + GAP}</text>
      <text attributes={TextAttributes.BOLD} fg={theme.muted}>{'type'.padEnd(typeW) + GAP}</text>
      <text attributes={TextAttributes.BOLD} fg={theme.muted}>null</text>
    </box>,
    <text key="cols-rule" fg={theme.border}>{rule}</text>,
    ...columns.map((c) => (
      <text key={`col-${c.name}`} wrapMode="none" selectable>
        <span fg={theme.yellow}>{(c.isPrimaryKey ? '🔑' : '').padEnd(PK_COL)}</span>
        <span fg={theme.cyan}>{c.name.padEnd(nameW) + GAP}</span>
        <span fg={theme.green}>{c.dataType.padEnd(typeW) + GAP}</span>
        <span fg={theme.muted}>{(c.nullable ? 'yes' : 'no').padEnd(NULL_COL)}</span>
        {c.enumValues ? (
          <span fg={theme.yellow}>{GAP + `(${c.enumValues.join(', ')})`}</span>
        ) : null}
      </text>
    )),
  ];
};

/** The SQL facet as a flat list of single-row nodes (heading + one per line). */
const sourceRows = (text: string): React.ReactNode[] => [
  label('lbl-sql', 'SQL'),
  ...(text === '' ? '(no definition)' : text).split('\n').map((l, i) => (
    <text key={`src-${i}`} fg={theme.muted} wrapMode="none" selectable>
      {l === '' ? ' ' : l}
    </text>
  )),
];

/** Display-only identifier quoting (standard SQL double-quotes), so the
 *  synthesized CREATE reads correctly even for reserved-word names. */
const q = (name: string): string => `"${name.replace(/"/g, '""')}"`;

/** Representative CREATE synthesized from columns — the fallback when an object
 *  exposes no real `source` section (e.g. a plain table). */
const synthDdl = (ref: ObjectRef, columns: ColumnDef[]): string => {
  const lines = columns.map(
    (c) =>
      `  ${q(c.name)} ${c.dataType}${c.nullable ? '' : ' NOT NULL'}${c.isPrimaryKey ? ' PRIMARY KEY' : ''}`,
  );
  return `CREATE TABLE ${q(ref.name)} (\n${lines.join(',\n')}\n);`;
};

const StructureViewImpl = ({
  structure,
  loading,
  error,
  hasTable,
  scroll,
  viewportRows,
  onViewport,
}: Props) => {
  // Flatten both facets into one list of single-row lines (empty until the
  // structure loads). Windowing this list keeps content within the panel, so it
  // scrolls instead of overflowing (overflow makes the terminal composite rows).
  const sections = structure?.detail ?? [];
  const columnsSection = sections.find((s) => s.kind === 'columns');
  const sourceSection = sections.find((s) => s.kind === 'source');
  const sourceText =
    sourceSection?.kind === 'source'
      ? sourceSection.text
      : structure && columnsSection?.kind === 'columns'
        ? synthDdl(structure.ref, columnsSection.columns) // synthesize for a plain table
        : null;

  const lines: React.ReactNode[] = [];
  if (columnsSection?.kind === 'columns') lines.push(...columnRows(columnsSection.columns));
  if (lines.length > 0 && sourceText !== null) lines.push(<text key="spacer"> </text>);
  if (sourceText !== null) lines.push(...sourceRows(sourceText));

  // Same virtualization as the data grid: window the lines to the viewport and
  // report the scroll range so the store clamps j/k at the ends. No in-panel
  // scrollbar/hint — the context footer already advertises j/k.
  const maxScroll = Math.max(0, lines.length - viewportRows);
  useEffect(() => onViewport(maxScroll), [onViewport, maxScroll]);

  if (!hasTable)
    return (
      <text fg={theme.muted}>
        Select an object and press Enter, then ⇥ DDL.
      </text>
    );
  if (loading) return <text fg={theme.yellow}>Loading structure…</text>;
  if (error) return <text fg={theme.red}>error: {error}</text>;
  if (!structure) return <text fg={theme.muted}>(no structure)</text>;

  const start = Math.min(Math.max(0, scroll), maxScroll);
  return <box flexDirection="column">{lines.slice(start, start + viewportRows)}</box>;
};

export const StructureView = React.memo(StructureViewImpl);
