/**
 * App — composition of the three panes plus the context-aware key map. Input
 * handling dispatches to store actions (a thin stand-in for the Command pattern
 * that arrives in Phase 3); rendering is pure projection of store state.
 */

import React, { useEffect, useMemo } from 'react';
import { useKeyboard, useRenderer, useTerminalDimensions } from '@opentui/react';
import { useApp, useStoreApi } from './context.ts';
import { Sidebar } from '../components/Sidebar.tsx';
import { ResultsPanel } from '../components/ResultsPanel.tsx';
import { QueryEditor } from '../components/QueryEditor.tsx';
import { StatusBar } from '../components/StatusBar.tsx';
import { Header } from '../components/Header.tsx';
import { HelpOverlay } from '../components/HelpOverlay.tsx';
import { ConnectionForm } from '../components/ConnectionForm.tsx';
import { CellView } from '../components/CellView.tsx';
import { helpGroups, deriveContext, dispatchKey, type KeyFlags } from '../keymap/keymap.ts';
import { SIDEBAR_WIDTH, computeLayout } from './layout.ts';
import { buildTree, toConnNodes, dialectLabel, shortTag } from '../tree/tree.ts';
import { theme } from '../theme/theme.ts';
import type { Filter } from '../../domain/query/Query.ts';

/** Compact one-line summary of an active filter, e.g. `label~foo`. */
const filterSummary = (filter: Filter | null): string => {
  if (!filter || filter.conditions.length === 0) return '';
  return filter.conditions
    .map((c) => `${c.column}${c.op === 'contains' ? '~' : ` ${c.op} `}${c.value}`)
    .join(' & ');
};

export const App = () => {
  const renderer = useRenderer();
  const store = useStoreApi();
  const { width: terminalCols, height: terminalRows } = useTerminalDimensions();

  const status = useApp((s) => s.status);
  const error = useApp((s) => s.error);
  const profiles = useApp((s) => s.profiles);
  const activeId = useApp((s) => s.activeId);
  const objects = useApp((s) => s.objects);
  const rootExpanded = useApp((s) => s.rootExpanded);
  const expandedCats = useApp((s) => s.expandedCats);
  const treeIndex = useApp((s) => s.treeIndex);
  const focus = useApp((s) => s.focus);
  const current = useApp((s) => s.current);
  const mainTab = useApp((s) => s.mainTab);
  const structure = useApp((s) => s.structure);
  const structureLoading = useApp((s) => s.structureLoading);
  const structureError = useApp((s) => s.structureError);
  const result = useApp((s) => s.result);
  const total = useApp((s) => s.total);
  const page = useApp((s) => s.page);
  const gridRow = useApp((s) => s.gridRow);
  const gridCol = useApp((s) => s.gridCol);
  const sort = useApp((s) => s.sort);
  const filter = useApp((s) => s.filter);
  const mode = useApp((s) => s.mode);
  const connForm = useApp((s) => s.connForm);
  const pending = useApp((s) => s.pending);
  const loading = useApp((s) => s.loading);

  const queryable = useApp((s) => s.queryable);
  const helpOpen = useApp((s) => s.helpOpen);
  const cellView = useApp((s) => s.cellView);
  const surface = useApp((s) => s.surface);
  const queryText = useApp((s) => s.queryText);
  const browseSql = useApp((s) => s.browseSql);
  const queryError = useApp((s) => s.queryError);
  const queryElapsedMs = useApp((s) => s.queryElapsedMs);
  const completions = useApp((s) => s.completions);
  const nlAvailable = useApp((s) => s.nlAvailable);
  const nlMode = useApp((s) => s.nlMode);
  const generating = useApp((s) => s.generating);
  const nlExplanation = useApp((s) => s.nlExplanation);
  const nlKind = useApp((s) => s.nlKind);

  useEffect(() => {
    void store.getState().init();
  }, [store]);

  // All key handling is one delegation to the keymap dispatcher: it reads the
  // live store state, derives the active context, and runs the matching binding
  // (or routes a typed glyph into the focused text field). Quitting the renderer
  // is the only effect the store doesn't own, so it's passed in.
  useKeyboard((key) => dispatchKey(store.getState(), key, { quit: () => renderer.destroy() }));

  const { viewportCols, editorRows, gridBodyRows } = computeLayout(
    terminalCols,
    terminalRows,
    queryable,
  );
  const gridFocused = focus === 'grid';

  // The active connection's display name + driver tag are derived from the
  // single source of truth (profiles + activeId), not stored separately.
  const activeProfile = useMemo(
    () => profiles.find((p) => p.id === activeId) ?? null,
    [profiles, activeId],
  );
  const connectionName = activeProfile?.name ?? null;
  const driverTag = activeProfile ? shortTag(dialectLabel(activeProfile.driver)) : null;
  const treeRows = useMemo(
    () =>
      buildTree({
        connections: toConnNodes(profiles, activeId),
        objects,
        rootExpanded,
        expandedCats,
      }),
    [profiles, activeId, objects, rootExpanded, expandedCats],
  );

  const flags: KeyFlags = { queryable, nlAvailable };
  const context = deriveContext({ cellView, mode, nlMode, focus, surface, mainTab });

  const rowsInPage = result?.rows.length ?? 0;
  const from = total === 0 ? 0 : page.offset + 1;
  const to = page.offset + rowsInPage;

  // The persistent background — ALWAYS rendered, so the `?` help and the cell
  // inspector float OVER it (lazygit-style) rather than replacing it.
  const background = connForm ? (
    <ConnectionForm
      form={connForm}
      onFieldInput={(k, v) => store.getState().connFormSetField(k, v)}
    />
  ) : status === 'connecting' ? (
    <box flexGrow={1} alignItems="center" justifyContent="center">
      <text fg={theme.yellow}>◢◣◤◥ connecting…</text>
    </box>
  ) : (
    // Three self-contained bordered panels; App is pure layout here. Every panel
    // owns its full border and keeps a constant identity. A uniform 1-cell `gap`
    // separates them on BOTH axes — the sidebar from the main column, and the SQL
    // editor from the results panel — so the spacing reads the same everywhere and
    // borders never double up. One row is the minimum clean separation between two
    // bordered boxes (zero would collide their edges into a doubled line).
    <box flexDirection="row" flexGrow={1} gap={1}>
      <Sidebar
        rows={treeRows}
        selectedIndex={treeIndex}
        focused={focus === 'sidebar'}
        width={SIDEBAR_WIDTH}
        onRowClick={(i) => store.getState().clickTree(i)}
        onPaneClick={() => store.getState().focusPane('sidebar')}
      />
      {/* Right column: the SQL editor (top, ~1/4) over the results panel (~3/4),
          each a distinct bordered panel split by the same 1-row gap. Both stretch
          to the full column width. */}
      <box flexDirection="column" flexGrow={1} gap={0}>
        {queryable ? (
          <QueryEditor
            queryText={queryText}
            browsePreview={browseSql}
            focused={focus === 'editor'}
            nlMode={nlMode}
            onNlSubmit={(p) => void store.getState().generateFromNl(p)}
            onQueryInput={(v) => store.getState().setQuery(v)}
            onQuerySubmit={() => void store.getState().executeQuery()}
            completions={completions}
            generating={generating}
            nlExplanation={nlExplanation}
            nlKind={nlKind}
            error={queryError}
            height={editorRows}
            innerWidth={viewportCols}
            onPaneClick={() => store.getState().focusPane('editor')}
          />
        ) : null}
        <ResultsPanel
          focused={gridFocused}
          onPaneClick={() => store.getState().focusPane('grid')}
          surface={surface}
          mainTab={mainTab}
          current={current}
          queryElapsedMs={queryElapsedMs}
          result={result}
          gridRow={gridRow}
          gridCol={gridCol}
          sort={sort}
          loading={loading}
          viewportRows={gridBodyRows}
          viewportCols={viewportCols}
          onCellClick={(r, c) => store.getState().clickGrid(r, c)}
          structure={structure}
          structureLoading={structureLoading}
          structureError={structureError}
        />
      </box>
    </box>
  );

  // Floating layers, composited over the background by <Overlay> (absolute, so
  // they add no height to the frame). Only one shows at a time; the panes behind
  // stay visible, exactly like lazygit's menus.
  const overlay = helpOpen ? (
    <HelpOverlay
      groups={helpGroups(context, flags)}
      termRows={terminalRows}
      termCols={terminalCols}
    />
  ) : cellView ? (
    <CellView
      column={cellView.column}
      value={cellView.value}
      offset={cellView.offset}
      termRows={terminalRows}
      termCols={terminalCols}
    />
  ) : null;

  return (
    // position="relative" anchors the absolute overlays to the full screen.
    <box
      position="relative"
      flexDirection="column"
      height={terminalRows}
      width={terminalCols}
    >
      <Header
        width={terminalCols}
        connectionName={connectionName}
        driverTag={driverTag}
        connected={activeId !== null}
        objectName={surface === 'browse' ? current?.name ?? null : null}
        from={from}
        to={to}
        total={total}
        filterSummary={surface === 'browse' ? filterSummary(filter) : ''}
        nlAvailable={nlAvailable}
      />
      <box flexGrow={1} flexDirection="column">
        {background}
      </box>
      <StatusBar
        width={terminalCols}
        status={status}
        error={error}
        context={context}
        flags={flags}
        mode={mode}
        filterInitial={
          filter?.conditions.find(
            (c) => c.column === (result?.columns[gridCol]?.name ?? ''),
          )?.value ?? ''
        }
        filterColumn={result?.columns[gridCol]?.name ?? null}
        onFilterSubmit={(v) => void store.getState().commitFilter(v)}
        editInitial={(() => {
          const cell = result?.rows[gridRow]?.[gridCol];
          return cell == null ? '' : String(cell);
        })()}
        editColumn={result?.columns[gridCol]?.name ?? null}
        onEditSubmit={(v) => store.getState().submitEdit(v)}
        pendingMessage={pending?.message ?? null}
      />
      {/* drawn last so it composites on top of every pane and the status bar */}
      {overlay}
    </box>
  );
};
