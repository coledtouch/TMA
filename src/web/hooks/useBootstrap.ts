/**
 * Loads `me.bootstrap` with a localStorage cache (`tma.cache.<email>`, or
 * `tma.demo.cache.<email>` in demo mode) for a
 * fast first paint and offline viewing (ARCHITECTURE.md §10 UX rules):
 * render the cache immediately, then refresh; refresh on focus/visibility at
 * most once per 60 s; refresh after every mutation (force).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Bootstrap, IsoDateTime } from '../../shared/types';
import { errorMessage, isApiError, type ApiClient } from '../api/client';
import { readJson, removeItem, storageKeys, writeJson, type StorageMode } from '../lib/storage';

export const REFRESH_MIN_INTERVAL_MS = 60_000;

export interface CachedBootstrap {
  savedAt: IsoDateTime;
  data: Bootstrap;
}

export function cacheKey(email: string, mode: StorageMode): string {
  return storageKeys(mode).cachePrefix + email.trim().toLowerCase();
}

export function readCachedBootstrap(email: string | null, mode: StorageMode): CachedBootstrap | null {
  if (!email) return null;
  const cached = readJson<CachedBootstrap>(cacheKey(email, mode));
  // Only trust a cache entry that is well-formed and belongs to this email.
  if (
    !cached ||
    typeof cached.savedAt !== 'string' ||
    !cached.data ||
    typeof cached.data !== 'object' ||
    !cached.data.me ||
    cached.data.me.email?.toLowerCase() !== email.trim().toLowerCase() ||
    !Array.isArray(cached.data.students) ||
    !cached.data.settings
  ) {
    return null;
  }
  return cached;
}

export function writeCachedBootstrap(data: Bootstrap, savedAt: IsoDateTime, mode: StorageMode): void {
  writeJson(cacheKey(data.me.email, mode), { savedAt, data } satisfies CachedBootstrap);
}

export function clearCachedBootstrap(email: string | null, mode: StorageMode): void {
  if (email) removeItem(cacheKey(email, mode));
}

export interface BootstrapState {
  data: Bootstrap | null;
  /** When `data` was fetched from the server. */
  savedAt: IsoDateTime | null;
  loading: boolean;
  /** Message from the last failed refresh (cleared on success). */
  error: string | null;
  /** True when showing cached data because the last refresh failed. */
  stale: boolean;
}

export interface BootstrapApi extends BootstrapState {
  refresh(options?: { force?: boolean }): Promise<void>;
  /** Use a fresh Bootstrap returned by a mutation (e.g. household.save). */
  replace(data: Bootstrap): void;
  patch(fn: (data: Bootstrap) => Bootstrap): void;
}

export function useBootstrap(api: ApiClient, email: string | null, onUnauthorized: () => void): BootstrapApi {
  const [state, setState] = useState<BootstrapState>(() => {
    const cached = readCachedBootstrap(email, api.mode);
    return {
      data: cached?.data ?? null,
      savedAt: cached?.savedAt ?? null,
      loading: true,
      error: null,
      stale: false,
    };
  });

  const seq = useRef(0);
  const inflight = useRef(0);
  const lastStart = useRef(0);
  const onUnauthorizedRef = useRef(onUnauthorized);
  useEffect(() => {
    onUnauthorizedRef.current = onUnauthorized;
  }, [onUnauthorized]);

  const refresh = useCallback(
    async ({ force = false }: { force?: boolean } = {}) => {
      const now = Date.now();
      if (!force && (inflight.current !== 0 || now - lastStart.current < REFRESH_MIN_INTERVAL_MS)) return;
      const id = ++seq.current;
      inflight.current = id;
      lastStart.current = now;
      setState((s) => (s.loading ? s : { ...s, loading: true }));
      try {
        const data = await api.call('me.bootstrap', {});
        if (id !== seq.current) return; // superseded by a newer request or a mutation result
        setState({ data, savedAt: new Date().toISOString(), loading: false, error: null, stale: false });
      } catch (err) {
        if (id !== seq.current) return;
        if (isApiError(err, 'UNAUTHORIZED')) {
          onUnauthorizedRef.current();
          return;
        }
        setState((s) => ({ ...s, loading: false, error: errorMessage(err), stale: s.data !== null }));
      } finally {
        if (inflight.current === id) inflight.current = 0;
      }
    },
    [api],
  );

  const replace = useCallback((data: Bootstrap) => {
    seq.current++; // drop any older in-flight response
    lastStart.current = Date.now();
    setState({ data, savedAt: new Date().toISOString(), loading: false, error: null, stale: false });
  }, []);

  const patch = useCallback((fn: (data: Bootstrap) => Bootstrap) => {
    setState((s) => (s.data ? { ...s, data: fn(s.data) } : s));
  }, []);

  // Persist whatever we show (only this device, only this email's own data).
  useEffect(() => {
    if (state.data && state.savedAt) writeCachedBootstrap(state.data, state.savedAt, api.mode);
  }, [state.data, state.savedAt, api.mode]);

  // Initial load, and stop applying results after unmount (e.g. sign-out).
  useEffect(() => {
    void refresh({ force: true });
    return () => {
      seq.current++;
    };
  }, [refresh]);

  // Refresh when the app comes back to the foreground or the network returns.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    const onFocus = () => void refresh();
    const onOnline = () => void refresh({ force: true });
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onOnline);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onOnline);
    };
  }, [refresh]);

  return { ...state, refresh, replace, patch };
}
