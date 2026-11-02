/**
 * What every signed-in screen can reach: the API client, the caller's
 * Bootstrap, and ways to refresh or update it.
 */
import { createContext, useContext } from 'react';
import type { Bootstrap } from '../../shared/types';
import type { ApiClient } from '../api/client';

export interface AppContextValue {
  api: ApiClient;
  data: Bootstrap;
  /** Reload the bootstrap. `force` skips the 60 s focus throttle (use after mutations). */
  refresh(options?: { force?: boolean }): Promise<void>;
  /** Show a fresh Bootstrap returned by a mutation. */
  replaceData(data: Bootstrap): void;
  patchData(fn: (data: Bootstrap) => Bootstrap): void;
  signOut(): Promise<void>;
}

export const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const value = useContext(AppContext);
  if (!value) throw new Error('useApp() must be used inside <AppContext.Provider>.');
  return value;
}
