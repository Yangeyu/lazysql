/**
 * Root — the thin composition shell. It builds the single long-lived workbench
 * store around the injected ConnectionService and renders App; the store owns
 * the connection lifecycle (list / connect / disconnect / save), so Root keeps
 * no connection state of its own. It releases the active source when the renderer
 * is destroyed (the single exit path: `q` / ^C / a signal all call
 * renderer.destroy()).
 */

import { useEffect, useMemo } from 'react';
import { useRenderer } from '@opentui/react';
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

export const Root = ({
  connectionService,
  initial = null,
  generator = null,
}: Props) => {
  const renderer = useRenderer();
  const store = useMemo<AppStore>(
    () => createAppStore({ connectionService, generator, initial }),
    [connectionService, generator, initial],
  );

  // Release the active connection when the renderer tears down, so the DB handle
  // is closed before the process exits.
  useEffect(() => {
    const onDestroy = (): void => {
      void store.getState().disconnect();
    };
    renderer.on('destroy', onDestroy);
    return () => {
      renderer.off('destroy', onDestroy);
    };
  }, [renderer, store]);

  return (
    <StoreContext.Provider value={store}>
      <App />
    </StoreContext.Provider>
  );
};
