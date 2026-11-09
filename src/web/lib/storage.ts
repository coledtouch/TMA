/**
 * Safe localStorage helpers. Storage can be missing or throw (Safari private
 * mode, blocked site data, quota), so every access is guarded and the app keeps
 * working without it.
 *
 * Live and demo keep their per-person state under separate keys (see
 * storageKeys), so a browser that tries the demo on a live build never mixes
 * a demo sign-in, cached data or push registration with the real ones.
 */

export type StorageMode = 'demo' | 'live';

/** Per-mode localStorage keys. */
export interface ModeStorageKeys {
  /** Session token (ApiClient). */
  readonly session: string;
  /** Last email used to sign in (lib/session.ts). */
  readonly email: string;
  /** + lower-case email: cached Bootstrap (hooks/useBootstrap.ts). */
  readonly cachePrefix: string;
  /** + nudge id: remembered "Not now" (components/Nudge.tsx). */
  readonly dismissedPrefix: string;
  /** This device's push registration (lib/push.ts). */
  readonly push: string;
}

const LIVE_KEYS: ModeStorageKeys = Object.freeze({
  session: 'tma.session',
  email: 'tma.email',
  cachePrefix: 'tma.cache.',
  dismissedPrefix: 'tma.dismissed.',
  push: 'tma.push',
});

const DEMO_KEYS: ModeStorageKeys = Object.freeze({
  session: 'tma.demo.session',
  email: 'tma.demo.email',
  cachePrefix: 'tma.demo.cache.',
  dismissedPrefix: 'tma.demo.dismissed.',
  push: 'tma.demo.push',
});

export function storageKeys(mode: StorageMode): ModeStorageKeys {
  return mode === 'demo' ? DEMO_KEYS : LIVE_KEYS;
}

/** The in-browser demo's copy of the sample sheet (src/demo). */
export const DEMO_DB_KEY = 'tma.demo.db.v1';

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function getItem(key: string): string | null {
  try {
    return storage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function setItem(key: string, value: string): boolean {
  try {
    const s = storage();
    if (!s) return false;
    s.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function removeItem(key: string): void {
  try {
    storage()?.removeItem(key);
  } catch {
    // ignore
  }
}

/** Every key currently stored (empty when storage is unavailable). */
export function allKeys(): string[] {
  try {
    const s = storage();
    if (!s) return [];
    const keys: string[] = [];
    for (let i = 0; i < s.length; i++) {
      const key = s.key(i);
      if (key !== null) keys.push(key);
    }
    return keys;
  } catch {
    return [];
  }
}

export function readJson<T>(key: string): T | null {
  const raw = getItem(key);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function writeJson(key: string, value: unknown): boolean {
  try {
    return setItem(key, JSON.stringify(value));
  } catch {
    return false;
  }
}

/** Remembered "Not now" on a dismissible nudge. */
export function isDismissed(id: string, mode: StorageMode): boolean {
  return getItem(storageKeys(mode).dismissedPrefix + id) !== null;
}

export function dismiss(id: string, mode: StorageMode): void {
  setItem(storageKeys(mode).dismissedPrefix + id, new Date().toISOString());
}
