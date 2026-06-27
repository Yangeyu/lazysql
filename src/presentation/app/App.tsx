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
import { helpGroups, deriveContext, type KeyFlags } from '../keymap/keymap.ts';
import { SIDEBAR_WIDTH, computeLayout } from './layout.ts';
import { buildTree, toConnNodes, dialectLabel, shortTag } from '../tree/tree.ts';
import { theme } from '../theme/theme.ts';
import { printableChar } from '../input/keys.ts';
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
  const filterDraft = useApp((s) => s.filterDraft);
  const editDraft = useApp((s) => s.editDraft);
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
  const nlDraft = useApp((s) => s.nlDraft);
  const generating = useApp((s) => s.generating);
  const nlExplanation = useApp((s) => s.nlExplanation);
  const nlKind = useApp((s) => s.nlKind);

  useEffect(() => {
    void store.getState().init();
  }, [store]);

  // One context-switched key handler. OpenTUI delivers a KeyEvent: special keys
  // are read off `key.name`, the typed glyph (for the hand-rolled text fields)
  // off `printableChar`, which returns null for chords so a binding like `q`
  // never fires on ⌃q.
  useKeyboard((key) => {
    const s = store.getState();
    const ch = printableChar(key);
    const quit = (): void => {
      renderer.destroy();
    };

    // Cell inspector owns all input while open: Esc/⏎ closes, j/k scrolls.
    if (s.cellView) {
      if (key.ctrl && key.name === 'c') quit();
      else if (key.name === 'escape' || key.name === 'return') s.closeCell();
      else if (key.name === 'down' || ch === 'j') s.scrollCell(1);
      else if (key.name === 'up' || ch === 'k') s.scrollCell(-1);
      return;
    }

    // Help overlay owns all input while open: ? or Esc closes, ^C still quits.
    if (s.helpOpen) {
      if (key.ctrl && key.name === 'c') quit();
      else if (ch === '?' || key.name === 'escape') s.toggleHelp();
      return;
    }

    // NL→SQL prompt captures all keys until generate/cancel (an editor sub-mode).
    if (s.nlMode) {
      if (key.ctrl && key.name === 'c') quit();
      else if (key.name === 'return') void s.generateFromNl();
      else if (key.name === 'escape') s.cancelNl();
      else if (key.name === 'backspace' || key.name === 'delete')
        s.updateNlDraft(s.nlDraft.slice(0, -1));
      else if (ch !== null) s.updateNlDraft(s.nlDraft + ch);
      return;
    }
    if (s.generating) return; // ignore input while the model works

    // Filter input mode captures all keys until commit/cancel.
    if (s.mode === 'filter') {
      if (key.name === 'return') void s.commitFilter();
      else if (key.name === 'escape') s.cancelFilter();
      else if (key.name === 'backspace' || key.name === 'delete')
        s.updateFilterDraft(s.filterDraft.slice(0, -1));
      else if (ch !== null) s.updateFilterDraft(s.filterDraft + ch);
      return;
    }

    // Cell-edit input mode: type a new value, Enter → confirm, Esc → cancel.
    if (s.mode === 'edit') {
      if (key.name === 'return') s.submitEdit();
      else if (key.name === 'escape') s.cancelEdit();
      else if (key.name === 'backspace' || key.name === 'delete')
        s.updateEditDraft(s.editDraft.slice(0, -1));
      else if (ch !== null) s.updateEditDraft(s.editDraft + ch);
      return;
    }

    // New-connection form owns all input while open.
    if (s.mode === 'connform') {
      if (key.name === 'return') void s.connFormSubmit();
      else if (key.name === 'escape') s.connFormCancel();
      else if (key.name === 'up') s.connFormMove(-1);
      else if (key.name === 'down' || key.name === 'tab') s.connFormMove(1);
      else if (key.name === 'left') s.connFormCycleDriver(-1);
      else if (key.name === 'right') s.connFormCycleDriver(1);
      else if (key.name === 'backspace' || key.name === 'delete') s.connFormBackspace();
      else if (ch !== null) s.connFormType(ch);
      return;
    }

    // Confirmation: y runs the pending write, n/Esc cancels.
    if (s.mode === 'confirm') {
      if (ch === 'y' || ch === 'Y') void s.confirmPending();
      else if (ch === 'n' || ch === 'N' || key.name === 'escape') s.cancelPending();
      return;
    }

    // ^C always quits, even from the editor.
    if (key.ctrl && key.name === 'c') {
      quit();
      return;
    }

    // Editor focus captures typing — handled BEFORE the global letter shortcuts,
    // so `q`/`:`/`?` are literal characters while you write SQL.
    if (s.focus === 'editor') {
      if (key.name === 'escape') s.focusPane('grid');
      else if (key.name === 'return') void s.executeQuery();
      else if (key.ctrl && key.name === 'g') s.beginNl(); // ask the AI
      else if (key.name === 'up') s.historyPrev();
      else if (key.name === 'down') s.historyNext();
      else if (key.name === 'tab') {
        // Tab completes the current word, else cycles to the next pane.
        if (s.completions.length > 0) s.acceptCompletion();
        else s.cycleFocus();
      } else if (key.name === 'backspace' || key.name === 'delete')
        s.updateQueryText(s.queryText.slice(0, -1));
      else if (ch !== null) s.updateQueryText(s.queryText + ch);
      return;
    }

    // Global keys (sidebar / grid focus only).
    if (ch === 'q') {
      quit();
      return;
    }
    if (ch === '`') {
      s.disconnect();
      return;
    }
    if (ch === '?') {
      s.toggleHelp();
      return;
    }
    if (ch === ':') {
      s.focusPane('editor'); // activate the SQL editor pane
      return;
    }
    if (key.name === 'tab') {
      s.cycleFocus();
      return;
    }
    if (s.focus === 'sidebar') {
      if (key.name === 'up' || ch === 'k') s.treeUp();
      else if (key.name === 'down' || ch === 'j') s.treeDown();
      else if (key.name === 'return' || ch === ' ') void s.treeToggle();
      else if (key.name === 'right' || ch === 'l') void s.treeExpand();
      else if (key.name === 'left' || ch === 'h') s.treeCollapse();
      else if (ch === 'D') void s.treeShowDdl();
      else if (ch === 'n') s.beginNewConnection();
      else if (ch === 'e') s.beginEditConnection();
    } else {
      // Grid focus. A 'browse' surface is editable; a 'query' result is read-only
      // (navigation + cell inspect only). `D` flips Data/DDL on a browsed table.
      if (s.surface === 'browse' && ch === 'D') s.toggleMainTab();
      else if (s.surface === 'browse' && s.mainTab === 'ddl') return; // static face
      else if (key.name === 'return') s.openCell();
      else if (key.name === 'up' || ch === 'k') s.gridUp();
      else if (key.name === 'down' || ch === 'j') s.gridDown();
      else if (key.name === 'left' || ch === 'h') s.gridLeft();
      else if (key.name === 'right' || ch === 'l') s.gridRight();
      else if (s.surface === 'browse') {
        if (ch === 's') void s.applySort();
        else if (ch === '/') s.beginFilter();
        else if (ch === 'e') s.beginEdit();
        else if (ch === 'd') s.beginDelete();
        else if (ch === 'n') void s.pageNext();
        else if (ch === 'p') void s.pagePrev();
      }
    }
  });

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
  const context = deriveContext({ cellView, mode, nlMode, focus });

  const rowsInPage = result?.rows.length ?? 0;
  const from = total === 0 ? 0 : page.offset + 1;
  const to = page.offset + rowsInPage;

  // The persistent background — ALWAYS rendered, so the `?` help and the cell
  // inspector float OVER it (lazygit-style) rather than replacing it.
  const background = connForm ? (
    <ConnectionForm form={connForm} />
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
      <box flexDirection="column" flexGrow={1} gap={1}>
        {queryable ? (
          <QueryEditor
            queryText={queryText}
            browsePreview={browseSql}
            focused={focus === 'editor'}
            nlMode={nlMode}
            nlDraft={nlDraft}
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
          onRowClick={(i) => store.getState().clickGrid(i)}
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
        filterDraft={filterDraft}
        filterColumn={result?.columns[gridCol]?.name ?? null}
        editDraft={editDraft}
        editColumn={result?.columns[gridCol]?.name ?? null}
        pendingMessage={pending?.message ?? null}
      />
      {/* drawn last so it composites on top of every pane and the status bar */}
      {overlay}
    </box>
  );
};
