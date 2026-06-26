/**
 * App — composition of the three panes plus the context-aware key map. Input
 * handling dispatches to store actions (a thin stand-in for the Command pattern
 * that arrives in Phase 3); rendering is pure projection of store state.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Box, Text, useApp as useInkApp, useInput } from 'ink';
import { useApp, useStoreApi } from './context.ts';
import { Sidebar } from '../components/Sidebar.tsx';
import { DataGrid } from '../components/DataGrid.tsx';
import { QueryEditor } from '../components/QueryEditor.tsx';
import { StructureView } from '../components/StructureView.tsx';
import { StatusBar } from '../components/StatusBar.tsx';
import { Header } from '../components/Header.tsx';
import { HelpOverlay } from '../components/HelpOverlay.tsx';
import { ConnectionForm } from '../components/ConnectionForm.tsx';
import { CellView } from '../components/CellView.tsx';
import {
  helpGroups,
  type KeyContext,
  type KeyFlags,
} from '../keymap/keymap.ts';
import { buildTree, toConnNodes, dialectLabel, shortTag } from '../tree/tree.ts';
import { theme } from '../theme/theme.ts';
import { regionAt } from './layout.ts';
import { useMouse } from '../hooks/useMouse.ts';
import type { Filter } from '../../domain/query/Query.ts';

const SIDEBAR_WIDTH = 28;

/** Live terminal dimensions, so the workbench fills the screen and reflows. */
const useTerminalSize = (): { rows: number; cols: number } => {
  const [size, setSize] = useState({
    rows: process.stdout.rows || 24,
    cols: process.stdout.columns || 80,
  });
  useEffect(() => {
    const onResize = () =>
      setSize({
        rows: process.stdout.rows || 24,
        cols: process.stdout.columns || 80,
      });
    process.stdout.on('resize', onResize);
    return () => {
      process.stdout.off('resize', onResize);
    };
  }, []);
  return size;
};

/** Compact one-line summary of an active filter, e.g. `label~foo`. */
const filterSummary = (filter: Filter | null): string => {
  if (!filter || filter.conditions.length === 0) return '';
  return filter.conditions
    .map((c) => `${c.column}${c.op === 'contains' ? '~' : ` ${c.op} `}${c.value}`)
    .join(' & ');
};

export const App: React.FC = () => {
  const ink = useInkApp();
  const store = useStoreApi();

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
  const filterDraft = useApp((s) => s.filterDraft);
  const editDraft = useApp((s) => s.editDraft);
  const pending = useApp((s) => s.pending);
  const loading = useApp((s) => s.loading);

  const queryable = useApp((s) => s.queryable);
  const helpOpen = useApp((s) => s.helpOpen);
  const cellView = useApp((s) => s.cellView);
  const surface = useApp((s) => s.surface);
  const queryText = useApp((s) => s.queryText);
  const queryError = useApp((s) => s.queryError);
  const queryElapsedMs = useApp((s) => s.queryElapsedMs);
  const completions = useApp((s) => s.completions);
  const nlAvailable = useApp((s) => s.nlAvailable);
  const nlMode = useApp((s) => s.nlMode);
  const nlDraft = useApp((s) => s.nlDraft);
  const generating = useApp((s) => s.generating);
  const nlExplanation = useApp((s) => s.nlExplanation);
  const nlKind = useApp((s) => s.nlKind);

  useEffect(() => {
    void store.getState().init();
  }, [store]);

  // A click focuses the pane it lands in (sidebar vs main grid).
  useMouse((e) => {
    const region = regionAt(
      { rows: terminalRows, cols: terminalCols, sidebarWidth: SIDEBAR_WIDTH },
      e.x,
      e.y,
    );
    if (region) store.getState().focusRegion(region);
  });

  useInput((input, key) => {
    const s = store.getState();

    // Mouse escape sequences arrive here as a stray "[<…M" input (Ink strips the
    // ESC); useMouse handles the real event, so we just drop them as keys.
    if (input.startsWith('[<')) return;

    // Cell inspector owns all input while open: Esc/⏎ closes, j/k scrolls.
    if (s.cellView) {
      if (key.ctrl && input === 'c') ink.exit();
      else if (key.escape || key.return) s.closeCell();
      else if (key.downArrow || input === 'j') s.scrollCell(1);
      else if (key.upArrow || input === 'k') s.scrollCell(-1);
      return;
    }

    // Help overlay owns all input while open: ? or Esc closes, ^C still quits.
    if (s.helpOpen) {
      if (key.ctrl && input === 'c') ink.exit();
      else if (input === '?' || key.escape) s.toggleHelp();
      return;
    }

    // NL→SQL prompt captures all keys until generate/cancel (an editor sub-mode).
    if (s.nlMode) {
      if (key.ctrl && input === 'c') ink.exit();
      else if (key.return) void s.generateFromNl();
      else if (key.escape) s.cancelNl();
      else if (key.backspace || key.delete) s.updateNlDraft(s.nlDraft.slice(0, -1));
      else if (input && !key.ctrl && !key.meta) s.updateNlDraft(s.nlDraft + input);
      return;
    }
    if (s.generating) return; // ignore input while the model works

    // Filter input mode captures all keys until commit/cancel.
    if (s.mode === 'filter') {
      if (key.return) void s.commitFilter();
      else if (key.escape) s.cancelFilter();
      else if (key.backspace || key.delete)
        s.updateFilterDraft(s.filterDraft.slice(0, -1));
      else if (input && !key.ctrl && !key.meta)
        s.updateFilterDraft(s.filterDraft + input);
      return;
    }

    // Cell-edit input mode: type a new value, Enter → confirm, Esc → cancel.
    if (s.mode === 'edit') {
      if (key.return) s.submitEdit();
      else if (key.escape) s.cancelEdit();
      else if (key.backspace || key.delete)
        s.updateEditDraft(s.editDraft.slice(0, -1));
      else if (input && !key.ctrl && !key.meta)
        s.updateEditDraft(s.editDraft + input);
      return;
    }

    // New-connection form owns all input while open.
    if (s.mode === 'connform') {
      if (key.return) void s.connFormSubmit();
      else if (key.escape) s.connFormCancel();
      else if (key.upArrow) s.connFormMove(-1);
      else if (key.downArrow || key.tab) s.connFormMove(1);
      else if (key.leftArrow) s.connFormCycleDriver(-1);
      else if (key.rightArrow) s.connFormCycleDriver(1);
      else if (key.backspace || key.delete) s.connFormBackspace();
      else if (input && !key.ctrl && !key.meta) s.connFormType(input);
      return;
    }

    // Confirmation: y runs the pending write, n/Esc cancels.
    if (s.mode === 'confirm') {
      if (input === 'y' || input === 'Y') void s.confirmPending();
      else if (input === 'n' || input === 'N' || key.escape) s.cancelPending();
      return;
    }

    // ^C always quits, even from the editor.
    if (key.ctrl && input === 'c') {
      ink.exit();
      return;
    }

    // Editor focus captures typing — handled BEFORE the global letter shortcuts,
    // so `q`/`:`/`?` are literal characters while you write SQL.
    if (s.focus === 'editor') {
      if (key.escape) s.focusPane('grid');
      else if (key.return) void s.executeQuery();
      else if (key.ctrl && input === 'g') s.beginNl(); // ask the AI
      else if (key.upArrow) s.historyPrev();
      else if (key.downArrow) s.historyNext();
      else if (key.tab) {
        // Tab completes the current word, else cycles to the next pane.
        if (s.completions.length > 0) s.acceptCompletion();
        else s.cycleFocus();
      } else if (key.backspace || key.delete)
        s.updateQueryText(s.queryText.slice(0, -1));
      else if (input && !key.ctrl && !key.meta)
        s.updateQueryText(s.queryText + input);
      return;
    }

    // Global keys (sidebar / grid focus only).
    if (input === 'q') {
      ink.exit();
      return;
    }
    if (input === '`') {
      s.disconnect();
      return;
    }
    if (input === '?') {
      s.toggleHelp();
      return;
    }
    if (input === ':') {
      s.focusPane('editor'); // activate the SQL editor pane
      return;
    }
    if (key.tab) {
      s.cycleFocus();
      return;
    }
    if (s.focus === 'sidebar') {
      if (key.upArrow || input === 'k') s.treeUp();
      else if (key.downArrow || input === 'j') s.treeDown();
      else if (key.return || input === ' ') void s.treeToggle();
      else if (key.rightArrow || input === 'l') void s.treeExpand();
      else if (key.leftArrow || input === 'h') s.treeCollapse();
      else if (input === 'D') void s.treeShowDdl();
      else if (input === 'n') s.beginNewConnection();
      else if (input === 'e') s.beginEditConnection();
    } else {
      // Grid focus. A 'browse' surface is editable; a 'query' result is read-only
      // (navigation + cell inspect only). `D` flips Data/DDL on a browsed table.
      if (s.surface === 'browse' && input === 'D') s.toggleMainTab();
      else if (s.surface === 'browse' && s.mainTab === 'ddl') return; // static face
      else if (key.return) s.openCell();
      else if (key.upArrow || input === 'k') s.gridUp();
      else if (key.downArrow || input === 'j') s.gridDown();
      else if (key.leftArrow || input === 'h') s.gridLeft();
      else if (key.rightArrow || input === 'l') s.gridRight();
      else if (s.surface === 'browse') {
        if (input === 's') void s.applySort();
        else if (input === '/') s.beginFilter();
        else if (input === 'e') s.beginEdit();
        else if (input === 'd') s.beginDelete();
        else if (input === 'n') void s.pageNext();
        else if (input === 'p') void s.pagePrev();
      }
    }
  });

  const { rows: terminalRows, cols: terminalCols } = useTerminalSize();
  // Width available to the main pane: total minus the sidebar, the row gap, and
  // the main panel's own border + horizontal padding.
  const viewportCols = Math.max(24, terminalCols - SIDEBAR_WIDTH - 1 - 4);
  // The right side splits ~1:3 — a compact SQL editor on top, the results grid
  // below. The editor pane only exists for SQL-speaking sources (capability-
  // driven, like the rest of the UI); other sources get the full grid height.
  const editorRows = queryable
    ? Math.min(10, Math.max(5, Math.floor((terminalRows - 2) / 4)))
    : 0;
  const gridBodyRows = Math.max(3, terminalRows - 2 - editorRows - 4);
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
  const context: KeyContext =
    cellView
      ? 'cell'
      : mode === 'connform'
        ? 'connform'
        : mode === 'filter'
          ? 'filter'
          : mode === 'edit'
            ? 'edit'
            : mode === 'confirm'
              ? 'confirm'
              : nlMode
                ? 'nl'
                : focus === 'editor'
                  ? 'editor'
                  : focus === 'sidebar'
                    ? 'sidebar'
                    : 'grid';

  const rowsInPage = result?.rows.length ?? 0;
  const from = total === 0 ? 0 : page.offset + 1;
  const to = page.offset + rowsInPage;

  // The persistent background — ALWAYS rendered, so the `?` help and the cell
  // inspector float OVER it (lazygit-style) rather than replacing it.
  const background = connForm ? (
    <ConnectionForm form={connForm} />
  ) : status === 'connecting' ? (
    <Box flexGrow={1} alignItems="center" justifyContent="center">
      <Text color={theme.yellow}>◢◣◤◥ connecting…</Text>
    </Box>
  ) : (
    <Box flexDirection="row" gap={1} flexGrow={1}>
      <Sidebar
        rows={treeRows}
        selectedIndex={treeIndex}
        focused={focus === 'sidebar'}
        width={SIDEBAR_WIDTH}
      />
      {/* Right side: the SQL editor (top, ~1/4) over the results grid (~3/4). */}
      <Box flexDirection="column" flexGrow={1}>
        {queryable ? (
          <Box height={editorRows} flexShrink={0}>
            <QueryEditor
              queryText={queryText}
              focused={focus === 'editor'}
              completions={completions}
              nlMode={nlMode}
              nlDraft={nlDraft}
              generating={generating}
              nlExplanation={nlExplanation}
              nlKind={nlKind}
              error={queryError}
              viewportCols={viewportCols}
            />
          </Box>
        ) : null}
        <Box
          flexGrow={1}
          flexDirection="column"
          borderStyle="round"
          borderColor={gridFocused ? theme.borderFocus : theme.border}
          paddingX={1}
        >
          {surface === 'query' ? (
            <Box>
              <Text backgroundColor={theme.magenta} color={theme.onAccent} bold>
                {' Result '}
              </Text>
              <Text color={theme.border}>
                {'  '}
                {result?.rows.length ?? 0} rows
                {queryElapsedMs != null ? ` · ${queryElapsedMs}ms` : ''}
              </Text>
            </Box>
          ) : current ? (
            <Box>
              <Text
                backgroundColor={mainTab === 'data' ? theme.accent : undefined}
                color={mainTab === 'data' ? theme.onAccent : theme.border}
                bold={mainTab === 'data'}
              >
                {' Data '}
              </Text>
              <Text> </Text>
              <Text
                backgroundColor={mainTab === 'ddl' ? theme.accent : undefined}
                color={mainTab === 'ddl' ? theme.onAccent : theme.border}
                bold={mainTab === 'ddl'}
              >
                {' DDL '}
              </Text>
            </Box>
          ) : (
            <Text bold color={gridFocused ? theme.accent : theme.border}>
              RESULTS
            </Text>
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
              viewportRows={gridBodyRows}
              viewportCols={viewportCols}
              focused={gridFocused}
            />
          )}
        </Box>
      </Box>
    </Box>
  );

  // Floating layers, composited over the background by <Overlay> (absolute, so
  // they add no height to the frame → no full-clear, no flicker). Only one shows
  // at a time; the panes behind stay visible, exactly like lazygit's menus.
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
    // minHeight is terminalRows-1, NOT terminalRows: Ink full-clears the screen
    // (causing flicker on every keypress) whenever the frame height reaches the
    // terminal height. Staying one row short keeps it on the incremental path.
    <Box
      position="relative"
      flexDirection="column"
      minHeight={terminalRows - 1}
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
      <Box flexGrow={1} flexDirection="column">
        {background}
      </Box>
      <StatusBar
        width={terminalCols}
        status={status}
        error={error}
        context={context}
        flags={flags}
        mode={mode}
        filterDraft={filterDraft}
        filterColumn={result?.columns[gridCol]?.name ?? null}
        editDraft={editDraft}
        editColumn={result?.columns[gridCol]?.name ?? null}
        pendingMessage={pending?.message ?? null}
      />
      {/* drawn last so it composites on top of every pane and the status bar */}
      {overlay}
    </Box>
  );
};
