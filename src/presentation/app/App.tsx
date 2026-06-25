/**
 * App — composition of the three panes plus the context-aware key map. Input
 * handling dispatches to store actions (a thin stand-in for the Command pattern
 * that arrives in Phase 3); rendering is pure projection of store state.
 */

import React, { useEffect, useState } from 'react';
import { Box, Text, useApp as useInkApp, useInput } from 'ink';
import { useApp, useStoreApi } from './context.ts';
import { useShell } from './shell.ts';
import { Sidebar } from '../components/Sidebar.tsx';
import { DataGrid } from '../components/DataGrid.tsx';
import { QueryEditor } from '../components/QueryEditor.tsx';
import { StatusBar } from '../components/StatusBar.tsx';
import { HelpOverlay } from '../components/HelpOverlay.tsx';
import {
  helpGroups,
  type KeyContext,
  type KeyFlags,
} from '../keymap/keymap.ts';

const SIDEBAR_WIDTH = 26;

const useTerminalRows = (): number => {
  const [rows, setRows] = useState(process.stdout.rows || 24);
  useEffect(() => {
    const onResize = () => setRows(process.stdout.rows || 24);
    process.stdout.on('resize', onResize);
    return () => {
      process.stdout.off('resize', onResize);
    };
  }, []);
  return rows;
};

export const App: React.FC = () => {
  const ink = useInkApp();
  const store = useStoreApi();
  const shell = useShell();

  const status = useApp((s) => s.status);
  const error = useApp((s) => s.error);
  const connectionName = useApp((s) => s.connectionName);
  const objects = useApp((s) => s.objects);
  const selectedIndex = useApp((s) => s.selectedIndex);
  const focus = useApp((s) => s.focus);
  const current = useApp((s) => s.current);
  const result = useApp((s) => s.result);
  const total = useApp((s) => s.total);
  const page = useApp((s) => s.page);
  const gridRow = useApp((s) => s.gridRow);
  const gridCol = useApp((s) => s.gridCol);
  const sort = useApp((s) => s.sort);
  const filter = useApp((s) => s.filter);
  const mode = useApp((s) => s.mode);
  const filterDraft = useApp((s) => s.filterDraft);
  const editDraft = useApp((s) => s.editDraft);
  const pending = useApp((s) => s.pending);
  const loading = useApp((s) => s.loading);

  const queryable = useApp((s) => s.queryable);
  const helpOpen = useApp((s) => s.helpOpen);
  const view = useApp((s) => s.view);
  const queryFocus = useApp((s) => s.queryFocus);
  const queryText = useApp((s) => s.queryText);
  const queryResult = useApp((s) => s.queryResult);
  const queryError = useApp((s) => s.queryError);
  const queryElapsedMs = useApp((s) => s.queryElapsedMs);
  const queryGridRow = useApp((s) => s.queryGridRow);
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

  useInput((input, key) => {
    const s = store.getState();

    // Help overlay owns all input while open: ? or Esc closes, ^C still quits.
    if (s.helpOpen) {
      if (key.ctrl && input === 'c') ink.exit();
      else if (input === '?' || key.escape) s.toggleHelp();
      return;
    }

    // Query editor view owns all input while active.
    if (s.view === 'query') {
      if (key.ctrl && input === 'c') {
        ink.exit();
        return;
      }
      // NL→SQL prompt captures all keys until generate/cancel.
      if (s.nlMode) {
        if (key.return) void s.generateFromNl();
        else if (key.escape) s.cancelNl();
        else if (key.backspace || key.delete)
          s.updateNlDraft(s.nlDraft.slice(0, -1));
        else if (input && !key.ctrl && !key.meta)
          s.updateNlDraft(s.nlDraft + input);
        return;
      }
      if (s.generating) return; // ignore input while the model works
      if (s.queryFocus === 'editor') {
        if (key.escape) s.exitQueryView();
        else if (key.return) void s.executeQuery();
        else if (key.ctrl && input === 'g') s.beginNl(); // ask the AI
        else if (key.upArrow) s.historyPrev();
        else if (key.downArrow) s.historyNext();
        else if (key.tab) {
          // Tab completes the current word, or moves to the result grid.
          if (s.completions.length > 0) s.acceptCompletion();
          else s.toggleQueryFocus();
        } else if (key.backspace || key.delete)
          s.updateQueryText(s.queryText.slice(0, -1));
        else if (input && !key.ctrl && !key.meta)
          s.updateQueryText(s.queryText + input);
      } else {
        if (key.escape) s.exitQueryView();
        else if (input === '?') s.toggleHelp();
        else if (key.tab) s.toggleQueryFocus();
        else if (key.upArrow || input === 'k') s.queryGridUp();
        else if (key.downArrow || input === 'j') s.queryGridDown();
      }
      return;
    }

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

    // Confirmation: y runs the pending write, n/Esc cancels.
    if (s.mode === 'confirm') {
      if (input === 'y' || input === 'Y') void s.confirmPending();
      else if (input === 'n' || input === 'N' || key.escape) s.cancelPending();
      return;
    }

    if (input === 'q' || (key.ctrl && input === 'c')) {
      ink.exit();
      return;
    }
    if (input === '`') {
      shell.switchConnection();
      return;
    }
    if (input === '?') {
      s.toggleHelp();
      return;
    }
    if (input === ':') {
      s.enterQueryView();
      return;
    }
    if (key.tab) {
      s.toggleFocus();
      return;
    }
    if (s.focus === 'sidebar') {
      if (key.upArrow || input === 'k') s.selectPrev();
      else if (key.downArrow || input === 'j') s.selectNext();
      else if (key.return) void s.openSelected();
    } else {
      if (key.upArrow || input === 'k') s.gridUp();
      else if (key.downArrow || input === 'j') s.gridDown();
      else if (key.leftArrow || input === 'h') s.gridLeft();
      else if (key.rightArrow || input === 'l') s.gridRight();
      else if (input === 's') void s.applySort();
      else if (input === '/') s.beginFilter();
      else if (input === 'e') s.beginEdit();
      else if (input === 'd') s.beginDelete();
      else if (input === 'n') void s.pageNext();
      else if (input === 'p') void s.pagePrev();
    }
  });

  const terminalRows = useTerminalRows();
  const viewportRows = Math.max(3, terminalRows - 9);
  const gridFocused = focus === 'grid';

  const flags: KeyFlags = { queryable, nlAvailable };
  const context: KeyContext =
    mode === 'filter'
      ? 'filter'
      : mode === 'edit'
        ? 'edit'
        : mode === 'confirm'
          ? 'confirm'
          : view === 'query'
            ? nlMode
              ? 'nl'
              : queryFocus === 'editor'
                ? 'editor'
                : 'result'
            : focus === 'sidebar'
              ? 'sidebar'
              : 'grid';

  if (status === 'connecting') {
    return <Text color="yellow">Connecting…</Text>;
  }

  return (
    <Box flexDirection="column">
      {helpOpen ? (
        <HelpOverlay groups={helpGroups(context, flags)} />
      ) : (
        <Box flexDirection="row" gap={1}>
          <Sidebar
            objects={objects}
            selectedIndex={selectedIndex}
            focused={focus === 'sidebar'}
            width={SIDEBAR_WIDTH}
          />
          {view === 'query' ? (
          <QueryEditor
            queryText={queryText}
            editorFocused={queryFocus === 'editor'}
            resultFocused={queryFocus === 'result'}
            result={queryResult}
            error={queryError}
            elapsedMs={queryElapsedMs}
            gridRow={queryGridRow}
            completions={completions}
            loading={loading}
            nlMode={nlMode}
            nlDraft={nlDraft}
            generating={generating}
            nlExplanation={nlExplanation}
            nlKind={nlKind}
            viewportRows={Math.max(3, terminalRows - 13)}
          />
        ) : (
          <Box
            flexDirection="column"
            flexGrow={1}
            borderStyle="round"
            borderColor={gridFocused ? 'cyan' : 'gray'}
            paddingX={1}
          >
            <DataGrid
              result={result}
              cursor={gridRow}
              selectedCol={gridCol}
              sort={sort}
              loading={loading}
              hasTable={current !== null}
              viewportRows={viewportRows}
              focused={gridFocused}
            />
            </Box>
          )}
        </Box>
      )}
      <StatusBar
        status={status}
        error={error}
        connectionName={connectionName}
        view={view}
        context={context}
        flags={flags}
        current={current}
        total={total}
        page={page}
        rowsInPage={result?.rows.length ?? 0}
        filter={filter}
        mode={mode}
        filterDraft={filterDraft}
        filterColumn={result?.columns[gridCol]?.name ?? null}
        editDraft={editDraft}
        editColumn={result?.columns[gridCol]?.name ?? null}
        pendingMessage={pending?.message ?? null}
      />
    </Box>
  );
};
