/**
 * ResultsPanel — the bottom-right pane: ONE self-contained bordered container
 * that owns its own chrome (full border + focus colour), its title/tab row, and
 * its body. It is a peer of Sidebar and QueryEditor: App composes the three as a
 * pure layout and each panel renders its own region (no panel's border is drawn
 * by the parent, and the panel never reshapes its border to fit a neighbour —
 * its identity is constant). A pure projection of store state passed as props.
 *
 * The title row has three faces, mutually exclusive by state:
 *   • a read-only SQL result  → a magenta "Result" badge + row count / elapsed;
 *   • an open object (browse)  → the Data │ DDL tab switch;
 *   • nothing open yet         → the "RESULTS" placeholder.
 * The body is the data grid, or the structure (DDL) view when that tab is active.
 */

import React from 'react';
import { TextAttributes } from '@opentui/core';
import { DataGrid } from './DataGrid.tsx';
import { StructureView } from './StructureView.tsx';
import { theme } from '../theme/theme.ts';
import type { SurfaceKind, MainTab } from '../app/store.ts';
import type { ObjectRef, ObjectSchema } from '../../domain/datasource/schema.ts';
import type { ResultSet } from '../../domain/datasource/ResultSet.ts';
import type { Sort } from '../../domain/query/Query.ts';

interface Props {
  focused: boolean;
  /** The pane's chrome/empty space was clicked — focus it. */
  onPaneClick: () => void;
  /** Whether the grid shows a browsed table or a read-only query result. */
  surface: SurfaceKind;
  /** Which face of a browsed object is showing (data │ ddl). */
  mainTab: MainTab;
  /** The open object, or null (no object / a query result). */
  current: ObjectRef | null;
  /** Server-side elapsed time of the last query (query surface only). */
  queryElapsedMs: number | null;
  // ── grid body ──
  result: ResultSet | null;
  gridRow: number;
  gridCol: number;
  sort: Sort | null;
  loading: boolean;
  /** Rows of vertical space available for the grid body. */
  viewportRows: number;
  /** Columns (terminal cells) of horizontal space available. */
  viewportCols: number;
  /** A data row was clicked (absolute row index). */
  onRowClick: (index: number) => void;
  // ── structure (DDL) body ──
  structure: ObjectSchema | null;
  structureLoading: boolean;
  structureError: string | null;
}

const ResultsPanelImpl = ({
  focused,
  onPaneClick,
  surface,
  mainTab,
  current,
  queryElapsedMs,
  result,
  gridRow,
  gridCol,
  sort,
  loading,
  viewportRows,
  viewportCols,
  onRowClick,
  structure,
  structureLoading,
  structureError,
}: Props) => (
  <box
    flexGrow={1}
    flexDirection="column"
    border
    borderStyle="rounded"
    borderColor={focused ? theme.borderFocus : theme.border}
    paddingX={1}
    onMouseDown={onPaneClick}
  >
    {surface === 'query' ? (
      <box flexDirection="row">
        <text bg={theme.magenta} fg={theme.onAccent} attributes={TextAttributes.BOLD}>
          {' Result '}
        </text>
        <text fg={theme.border}>
          {'  '}
          {result?.rows.length ?? 0} rows
          {queryElapsedMs != null ? ` · ${queryElapsedMs}ms` : ''}
        </text>
      </box>
    ) : current ? (
      <box flexDirection="row">
        <text
          bg={mainTab === 'data' ? theme.accent : undefined}
          fg={mainTab === 'data' ? theme.onAccent : theme.border}
          attributes={mainTab === 'data' ? TextAttributes.BOLD : undefined}
        >
          {' Data '}
        </text>
        <text> </text>
        <text
          bg={mainTab === 'ddl' ? theme.accent : undefined}
          fg={mainTab === 'ddl' ? theme.onAccent : theme.border}
          attributes={mainTab === 'ddl' ? TextAttributes.BOLD : undefined}
        >
          {' DDL '}
        </text>
      </box>
    ) : (
      <text attributes={TextAttributes.BOLD} fg={focused ? theme.accent : theme.border}>
        RESULTS
      </text>
    )}
    {surface === 'browse' && mainTab === 'ddl' ? (
      <StructureView
        structure={structure}
        loading={structureLoading}
        error={structureError}
        hasTable={current !== null}
      />
    ) : (
      <DataGrid
        result={result}
        cursor={gridRow}
        selectedCol={gridCol}
        sort={surface === 'browse' ? sort : null}
        loading={loading}
        hasTable={surface === 'query' || current !== null}
        viewportRows={viewportRows}
        viewportCols={viewportCols}
        focused={focused}
        onRowClick={onRowClick}
      />
    )}
  </box>
);

export const ResultsPanel = React.memo(ResultsPanelImpl);
