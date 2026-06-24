/** React glue for the Zustand store: a context carrying the store instance and
 *  a selector hook. Keeping the store outside React (vanilla) makes it injectable
 *  and unit-testable without rendering. */

import { createContext, useContext } from 'react';
import { useStore } from 'zustand';
import type { AppStore, AppState } from './store.ts';

export const StoreContext = createContext<AppStore | null>(null);

export function useApp<T>(selector: (state: AppState) => T): T {
  const store = useContext(StoreContext);
  if (!store) throw new Error('StoreContext is not provided');
  return useStore(store, selector);
}

export function useStoreApi(): AppStore {
  const store = useContext(StoreContext);
  if (!store) throw new Error('StoreContext is not provided');
  return store;
}
