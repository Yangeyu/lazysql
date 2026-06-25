/**
 * Root — the connection-lifecycle shell. Unlike the old separate picker screen,
 * connections now live in the sidebar tree (App), so Root keeps one long-lived
 * "workbench" store and swaps the *active* DataSource into it on demand: it
 * opens a selected profile, rebuilds the store around the new source, and
 * provides the Workbench the store calls to switch / save / remove connections.
 * Infrastructure (factory, secrets, repository) is injected; Root only
 * orchestrates. (DIP)
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Text, useApp as useInkApp, useInput } from 'ink';
import { StoreContext } from './context.ts';
import { ShellContext, type Shell } from './shell.ts';
import {
  createAppStore,
  type AppStore,
  type Workbench,
} from './store.ts';
import { App } from './App.tsx';
import { shortTag, type ConnNode } from '../tree/tree.ts';
import type {
  ConnectionProfile,
  DriverId,
} from '../../domain/connection/ConnectionProfile.ts';
import type { DataSource } from '../../domain/datasource/DataSource.ts';
import type { ConnectionError } from '../../domain/errors/errors.ts';
import type { Result } from '../../shared/Result.ts';
import type { SqlGenerator } from '../../application/ports/SqlGenerator.ts';

interface Props {
  profiles: ConnectionProfile[];
  open: (
    profile: ConnectionProfile,
  ) => Promise<Result<DataSource, ConnectionError>>;
  /** Persist a profile (and optional password); returns the refreshed list. */
  saveProfile?: (
    profile: ConnectionProfile,
    password: string | null,
  ) => Promise<ConnectionProfile[]>;
  /** Forget a profile by id; returns the refreshed list. */
  removeProfile?: (id: string) => Promise<ConnectionProfile[]>;
  /** When set (e.g. from a CLI arg), connect immediately on startup. */
  initial?: ConnectionProfile | null;
  /** NL→SQL generator, or null when no API key is configured. */
  generator?: SqlGenerator | null;
}

const DIALECT_LABEL: Record<DriverId, string> = {
  sqlite: 'SQLite',
  postgres: 'PostgreSQL',
  mysql: 'MySQL',
  mongodb: 'MongoDB',
  redis: 'Redis',
};

/** Project the saved profiles into sidebar connection roots. */
const connNodes = (
  profiles: ConnectionProfile[],
  activeId: string | null,
): ConnNode[] =>
  profiles.map((p) => ({
    id: p.id,
    name: p.name,
    tag: shortTag(DIALECT_LABEL[p.driver]),
    active: p.id === activeId,
  }));

export const Root: React.FC<Props> = ({
  profiles: initialProfiles,
  open,
  saveProfile,
  removeProfile,
  initial,
  generator = null,
}) => {
  const ink = useInkApp();
  const [profiles, setProfiles] = useState(initialProfiles);
  const [store, setStore] = useState<AppStore | null>(null);

  const sourceRef = useRef<DataSource | null>(null);
  const storeRef = useRef<AppStore | null>(null);
  const profilesRef = useRef(profiles);
  profilesRef.current = profiles;
  const activeIdRef = useRef<string | null>(null);
  // Late-bound action handles so the (stable) Workbench can reach fresh closures.
  const fns = useRef({
    connectById: (_id: string) => {},
    connectProfile: async (_p: ConnectionProfile) => {},
  });

  const workbench = useMemo<Workbench>(
    () => ({
      connect: (id) => fns.current.connectById(id),
      saveConnection: async (profile, password) => {
        if (!saveProfile) return;
        const next = await saveProfile(profile, password);
        profilesRef.current = next;
        setProfiles(next);
        storeRef.current
          ?.getState()
          .setConnections(connNodes(next, activeIdRef.current));
      },
      removeConnection: async (id) => {
        if (!removeProfile) return;
        const next = await removeProfile(id);
        profilesRef.current = next;
        setProfiles(next);
        storeRef.current
          ?.getState()
          .setConnections(connNodes(next, activeIdRef.current));
      },
    }),
    [saveProfile, removeProfile],
  );

  /** Build (and install) a fresh store around the given active source. */
  const makeStore = (
    source: DataSource | null,
    profile: ConnectionProfile | null,
    error: string | null = null,
  ): void => {
    const activeId = profile?.id ?? null;
    activeIdRef.current = activeId;
    const list = profile && !profilesRef.current.some((p) => p.id === profile.id)
      ? [...profilesRef.current, profile]
      : profilesRef.current;
    const s = createAppStore(
      source,
      profile?.name ?? null,
      generator,
      profile ? DIALECT_LABEL[profile.driver] : 'SQL',
      {
        connections: connNodes(list, activeId),
        activeId,
        workbench,
        initialError: error,
      },
    );
    storeRef.current = s;
    setStore(s);
  };

  fns.current.connectProfile = async (profile) => {
    const result = await open(profile);
    if (result.ok) {
      void sourceRef.current?.disconnect();
      sourceRef.current = result.value;
      if (!profilesRef.current.some((p) => p.id === profile.id)) {
        const next = [...profilesRef.current, profile];
        profilesRef.current = next;
        setProfiles(next);
      }
      makeStore(result.value, profile);
    } else {
      makeStore(null, null, result.error.message);
    }
  };
  fns.current.connectById = (id) => {
    const p = profilesRef.current.find((x) => x.id === id);
    if (p) void fns.current.connectProfile(p);
  };

  // Start on the connection list; auto-connect when launched with a profile.
  useEffect(() => {
    makeStore(null, null);
    if (initial) void fns.current.connectProfile(initial);
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
      // Backtick disconnects the active connection, back to the connection list.
      switchConnection: () => {
        void sourceRef.current?.disconnect();
        sourceRef.current = null;
        makeStore(null, null);
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  useInput(
    (input, key) => {
      if (key.ctrl && input === 'c') ink.exit();
    },
    { isActive: store === null },
  );

  if (!store) return <Text color="yellow">Loading…</Text>;

  return (
    <StoreContext.Provider value={store}>
      <ShellContext.Provider value={shell}>
        <App />
      </ShellContext.Provider>
    </StoreContext.Provider>
  );
};
