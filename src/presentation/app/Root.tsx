/**
 * Root — the thin composition shell. It builds the single long-lived workbench
 * store around the injected ConnectionService and renders App; the store owns
 * the connection lifecycle (list / connect / disconnect / save), so Root keeps
 * no connection state of its own. It only disconnects the active source on
 * teardown.
 */

import React, { useEffect, useMemo } from 'react';
import { StoreContext } from './context.ts';
import { createAppStore, type AppStore } from './store.ts';
import { App } from './App.tsx';
import type { ConnectionService } from '../../application/ports/ConnectionService.ts';
import type { ConnectionProfile } from '../../domain/connection/ConnectionProfile.ts';
import type { SqlGenerator } from '../../application/ports/SqlGenerator.ts';

interface Props {
  connectionService: ConnectionService;
  /** When set (e.g. from a CLI arg), connect immediately on startup. */
  initial?: ConnectionProfile | null;
  /** NL→SQL generator, or null when no API key is configured. */
  generator?: SqlGenerator | null;
}

export const Root: React.FC<Props> = ({
  connectionService,
  initial = null,
  generator = null,
}) => {
  const store = useMemo<AppStore>(
    () => createAppStore({ connectionService, generator, initial }),
    [connectionService, generator, initial],
  );

  // Tear down the active connection (if any) when the app exits.
  useEffect(() => () => store.getState().disconnect(), [store]);

  return (
    <StoreContext.Provider value={store}>
      <App />
    </StoreContext.Provider>
  );
};
