/**
 * Shell context — lets the browsing UI ask the Root to tear down the current
 * connection and return to the connection picker. Defaults to a no-op so
 * components (and tests) render fine without a provider.
 */

import { createContext, useContext } from 'react';

export interface Shell {
  switchConnection: () => void;
}

export const ShellContext = createContext<Shell>({ switchConnection: () => {} });

export const useShell = (): Shell => useContext(ShellContext);
