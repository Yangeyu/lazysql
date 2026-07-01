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
import { ConfirmDialog } from '../components/ConfirmDialog.tsx';
import { helpGroups, deriveContext, dispatchKey, type KeyFlags } from '../keymap/keymap.ts';
import { SIDEBAR_WIDTH, computeLayout } from './layout.ts';
import { buildTree, toConnNodes, dialectLabel, shortTag, groupsBySchema } from '../tree/tree.ts';
import { theme } from '../theme/theme.ts';
import type { Filter } from '../../domain/query/Query.ts';
import type { Clipboard } from '../../application/ports/Clipboard.ts';

interface AppProps {
  /** Where keyboard copy commands write; injected from the composition root. */
  readonly clipboard: Clipboard;
}

/** Compact one-line summary of an active filter, e.g. `label~foo`. */
const filterSummary = (filter: Filter | null): string => {
  if (!filter || filter.conditions.length === 0) return '';
  return filter.conditions
    .map((c) => `${c.column}${c.op === 'contains' ? '~' : ` ${c.op} `}${c.value}`)
    .join(' & ');
};

export const App = ({ clipboard }: AppProps) => {
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
  const expandedSchemas = useApp((s) => s.expandedSchemas);
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
  const editorCaret = useApp((s) => s.editorCaret);
  const statement = useApp((s) => s.statement);
  const queryError = useApp((s) => s.queryError);
  const queryElapsedMs = useApp((s) => s.queryElapsedMs);
  const completions = useApp((s) => s.completions);
  const completionsOn = useApp((s) => s.completionsOn);
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
  // and writing the clipboard are the effects the store doesn't own, so they're
  // passed in.
  useKeyboard((key) =>
    dispatchKey(store.getState(), key, {
      quit: () => renderer.destroy(),
      copy: (text) => clipboard.write(text),
    }),
  );

  const { viewportCols, editorRows, gridBodyRows, sidebarRows } = computeLayout(
    terminalCols,
    terminalRows,
    queryable,
  );
  const gridFocused = focus === 'grid';

  // Mirror the grid's visible height into the store so half-page cursor jumps
  // (^d/^u) can size themselves; the store can't see the layout otherwise.
  useEffect(() => {
    store.getState().setGridViewport(gridBodyRows);
  }, [store, gridBodyRows]);

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
        expandedSchemas,
        groupBySchema: activeProfile ? groupsBySchema(activeProfile.driver) : false,
      }),
    [profiles, activeId, objects, rootExpanded, expandedCats, expandedSchemas, activeProfile],
  );

  const flags: KeyFlags = { queryable, nlAvailable };
  const context = deriveContext({ cellView, mode, nlMode, focus, surface, mainTab });

  const rowsInPage = result?.rows.length ?? 0;
  const from = total === 0 ? 0 : page.offset + 1;
  const to = page.offset + rowsInPage;
  // Absolute 1-based position of the grid cursor across pages (0 when empty).
  const cursorRow = rowsInPage > 0 ? page.offset + gridRow + 1 : 0;

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
    // owns its full border and keeps a constant identity. A 1-cell `gap` sets the
    // sidebar off from the main column; the right column stacks the editor over
    // the results panel flush (gap 0) for a compact, single-rule divider.
    <box flexDirection="row" flexGrow={1} gap={1}>
      <Sidebar
        rows={treeRows}
        selectedIndex={treeIndex}
        focused={focus === 'sidebar'}
        width={SIDEBAR_WIDTH}
        viewportRows={sidebarRows}
        onRowClick={(i) => store.getState().clickTree(i)}
        onPaneClick={() => store.getState().focusPane('sidebar')}
        onScroll={(dir) =>
          dir === 'up' ? store.getState().treeUp() : store.getState().treeDown()
        }
      />
      {/* Right column: the SQL editor (top, ~1/4) directly over the results panel
          (~3/4), stacked flush with no gap. Both stretch to the full column width. */}
      <box flexDirection="column" flexGrow={1} gap={0}>
        {queryable ? (
          <QueryEditor
            queryText={queryText}
            editorCaret={editorCaret}
            statement={statement}
            focused={focus === 'editor'}
            nlMode={nlMode}
            completionsOn={completionsOn}
            onNlSubmit={(p) => void store.getState().generateFromNl(p)}
            onEditorChange={(t, c) => store.getState().setQuery(t, c)}
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
          onScroll={(dir) => {
            // Only the data grid scrolls; the DDL view has no scroll of its own.
            if (surface === 'browse' && mainTab === 'ddl') return;
            const s = store.getState();
            if (dir === 'up') s.gridUp();
            else if (dir === 'down') s.gridDown();
            else if (dir === 'left') s.gridLeft();
            else s.gridRight();
          }}
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
  // stay visible, exactly like lazygit's menus. A staged confirm takes precedence
  // — it's the most urgent thing on screen and owns the y/n keys.
  const overlay = mode === 'confirm' && pending ? (
    <ConfirmDialog
      title={pending.title}
      statement={pending.statement}
      details={pending.details}
      tone={pending.tone}
      termRows={terminalRows}
      termCols={terminalCols}
    />
  ) : helpOpen ? (
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
      mode={cellView.mode}
      termRows={terminalRows}
      termCols={terminalCols}
      onScroll={(delta) => store.getState().scrollCell(delta)}
      onEditSubmit={(v) => store.getState().submitEdit(v)}
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
        cursorRow={cursorRow}
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
      />
      {/* drawn last so it composites on top of every pane and the status bar */}
      {overlay}
    </box>
  );
};
