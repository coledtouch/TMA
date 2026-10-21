/**
 * Safe localStorage helpers. Storage can be missing or throw (Safari private
 * mode, blocked site data, quota), so every access is guarded and the app keeps
 * working without it.
 */

/** localStorage keys used by the web app (push.ts owns 'tma.pushToken'). */
export const STORAGE_KEYS = {
  session: 'tma.session',
  email: 'tma.email',
  cachePrefix: 'tma.cache.',
  dismissedPrefix: 'tma.dismissed.',
} as const;

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
export function isDismissed(id: string): boolean {
  return getItem(STORAGE_KEYS.dismissedPrefix + id) !== null;
}

export function dismiss(id: string): void {
  setItem(STORAGE_KEYS.dismissedPrefix + id, new Date().toISOString());
}
