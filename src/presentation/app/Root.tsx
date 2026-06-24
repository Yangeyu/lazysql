/**
 * Root — the connection lifecycle shell. It shows the ConnectionPicker, opens a
 * selected profile (via the injected `open`), then renders App against a freshly
 * built store. It also provides the Shell so App can switch connections, and
 * disconnects the active source on teardown. The store stays connection-scoped;
 * Root owns the picker ↔ browsing transition.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApp as useInkApp, useInput } from 'ink';
import { StoreContext } from './context.ts';
import { ShellContext, type Shell } from './shell.ts';
import { createAppStore, type AppStore } from './store.ts';
import { App } from './App.tsx';
import { ConnectionPicker } from '../components/ConnectionPicker.tsx';
import type { ConnectionProfile } from '../../domain/connection/ConnectionProfile.ts';
import type { DataSource } from '../../domain/datasource/DataSource.ts';
import type { ConnectionError } from '../../domain/errors/errors.ts';
import type { Result } from '../../shared/Result.ts';

interface Props {
  profiles: ConnectionProfile[];
  open: (
    profile: ConnectionProfile,
  ) => Promise<Result<DataSource, ConnectionError>>;
  /** When set (e.g. from a CLI arg), connect immediately and skip the picker. */
  initial?: ConnectionProfile | null;
}

export const Root: React.FC<Props> = ({ profiles, open, initial }) => {
  const ink = useInkApp();
  const [store, setStore] = useState<AppStore | null>(null);
  const [index, setIndex] = useState(0);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sourceRef = useRef<DataSource | null>(null);

  const connect = useCallback(
    async (profile: ConnectionProfile) => {
      setConnecting(true);
      setError(null);
      const result = await open(profile);
      if (result.ok) {
        sourceRef.current = result.value;
        setStore(createAppStore(result.value, profile.name));
      } else {
        setError(result.error.message);
      }
      setConnecting(false);
    },
    [open],
  );

  // Auto-open when launched with an explicit connection.
  useEffect(() => {
    if (initial) void connect(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Disconnect whatever is active when the app tears down.
  useEffect(
    () => () => {
      void sourceRef.current?.disconnect();
    },
    [],
  );

  const shell = useMemo<Shell>(
    () => ({
      switchConnection: () => {
        void sourceRef.current?.disconnect();
        sourceRef.current = null;
        setStore(null);
        setError(null);
      },
    }),
    [],
  );

  useInput(
    (input, key) => {
      if (connecting) return;
      if (input === 'q' || (key.ctrl && input === 'c')) {
        ink.exit();
        return;
      }
      if (key.upArrow || input === 'k') setIndex((i) => Math.max(0, i - 1));
      else if (key.downArrow || input === 'j')
        setIndex((i) => Math.min(profiles.length - 1, i + 1));
      else if (key.return) {
        const profile = profiles[index];
        if (profile) void connect(profile);
      }
    },
    { isActive: store === null },
  );

  if (store) {
    return (
      <StoreContext.Provider value={store}>
        <ShellContext.Provider value={shell}>
          <App />
        </ShellContext.Provider>
      </StoreContext.Provider>
    );
  }

  return (
    <ConnectionPicker
      profiles={profiles}
      index={index}
      connecting={connecting}
      error={error}
    />
  );
};
