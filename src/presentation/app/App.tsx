/**
 * App — composition of the three panes plus the context-aware key map. Input
 * handling dispatches to store actions (a thin stand-in for the Command pattern
 * that arrives in Phase 3); rendering is pure projection of store state.
 */

import React, { useEffect, useState } from 'react';
import { Box, Text, useApp as useInkApp, useInput } from 'ink';
import { useApp, useStoreApi } from './context.ts';
import { Sidebar } from '../components/Sidebar.tsx';
import { DataGrid } from '../components/DataGrid.tsx';
import { StatusBar } from '../components/StatusBar.tsx';

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

  const status = useApp((s) => s.status);
  const error = useApp((s) => s.error);
  const objects = useApp((s) => s.objects);
  const selectedIndex = useApp((s) => s.selectedIndex);
  const focus = useApp((s) => s.focus);
  const current = useApp((s) => s.current);
  const result = useApp((s) => s.result);
  const total = useApp((s) => s.total);
  const page = useApp((s) => s.page);
  const gridRow = useApp((s) => s.gridRow);
  const loading = useApp((s) => s.loading);

  useEffect(() => {
    void store.getState().init();
  }, [store]);

  useInput((input, key) => {
    const s = store.getState();
    if (input === 'q' || (key.ctrl && input === 'c')) {
      ink.exit();
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
      else if (input === 'n') void s.pageNext();
      else if (input === 'p') void s.pagePrev();
    }
  });

  const terminalRows = useTerminalRows();
  const viewportRows = Math.max(3, terminalRows - 9);
  const gridFocused = focus === 'grid';

  if (status === 'connecting') {
    return <Text color="yellow">Connecting…</Text>;
  }

  return (
    <Box flexDirection="column">
      <Box flexDirection="row" gap={1}>
        <Sidebar
          objects={objects}
          selectedIndex={selectedIndex}
          focused={focus === 'sidebar'}
          width={SIDEBAR_WIDTH}
        />
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
            loading={loading}
            hasTable={current !== null}
            viewportRows={viewportRows}
            focused={gridFocused}
          />
        </Box>
      </Box>
      <StatusBar
        status={status}
        error={error}
        current={current}
        total={total}
        page={page}
        rowsInPage={result?.rows.length ?? 0}
        focus={focus}
      />
    </Box>
  );
};
