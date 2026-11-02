/**
 * Which backend this page load talks to (ARCHITECTURE.md §2, §10).
 *
 * - A build without VITE_API_URL is always the in-browser demo.
 * - A live build talks to Apps Script, but "?demo" in the address (or the
 *   sign-in screen's "See a demo with sample data" link) switches this browser
 *   to the demo until "Exit demo". The choice is kept in localStorage
 *   'tma.mode'; "?demo=0" switches back.
 *
 * Switching always reloads the page, so nothing held in memory (API client,
 * React state, the demo backend) carries over from one mode to the other. What
 * is stored per person (session, cached data, push registration, dismissed
 * nudges) lives under separate keys per mode (storageKeys in storage.ts).
 */
import {
  allKeys,
  DEMO_DB_KEY,
  getItem,
  removeItem,
  setItem,
  storageKeys,
  writeJson,
  type StorageMode,
} from './storage';

export type AppMode = StorageMode;

/** localStorage: 'demo' while a live build runs the demo in this browser. */
export const MODE_KEY = 'tma.mode';
/** localStorage: layout version of the per-mode keys (see migrateLegacyStorage). */
export const STORAGE_LAYOUT_KEY = 'tma.storage';
const STORAGE_LAYOUT_VERSION = '2';

const DEMO_PARAM = 'demo';
const OFF_VALUES = new Set(['0', 'false', 'off', 'no', 'live']);

/** The Apps Script web-app URL this build talks to ('' = demo-only build). */
export function liveApiUrl(): string {
  return (import.meta.env.VITE_API_URL ?? '').trim();
}

export function hasLiveBackend(): boolean {
  return liveApiUrl() !== '';
}

function currentUrl(): URL | null {
  try {
    return typeof window === 'undefined' ? null : new URL(window.location.href);
  } catch {
    return null;
  }
}

/** 'on' for "?demo" / "?demo=1", 'off' for "?demo=0", null when the address doesn't say. */
function demoParam(url: URL | null = currentUrl()): 'on' | 'off' | null {
  if (!url || !url.searchParams.has(DEMO_PARAM)) return null;
  const value = (url.searchParams.get(DEMO_PARAM) ?? '').trim().toLowerCase();
  return OFF_VALUES.has(value) ? 'off' : 'on';
}

/** The mode for this browser right now. No side effects. */
export function currentAppMode(): AppMode {
  if (!hasLiveBackend()) return 'demo';
  // The address wins (it stays in the address bar when storage is unavailable).
  const requested = demoParam();
  if (requested) return requested === 'on' ? 'demo' : 'live';
  return getItem(MODE_KEY) === 'demo' ? 'demo' : 'live';
}

/** True when this is the demo on a live build, so "Exit demo" can go back to the real app. */
export function canExitDemo(mode: AppMode = currentAppMode()): boolean {
  return mode === 'demo' && hasLiveBackend();
}

/** This page's address without the "demo" switch and without the in-app route. */
function cleanUrl(url: URL): string {
  const next = new URL(url.href);
  next.searchParams.delete(DEMO_PARAM);
  next.hash = '';
  return next.href;
}

function replaceAddress(href: string): void {
  try {
    window.history.replaceState(window.history.state, '', href);
  } catch {
    // Very old browsers: the reload below still lands in the right mode.
  }
}

/**
 * Call once at startup, before creating the API client: tidies up storage from
 * older versions, applies a "?demo" switch in the address (remembering it and
 * removing it from the address bar), and returns the mode for this page load.
 */
export function initAppMode(): AppMode {
  migrateLegacyStorage();
  const url = currentUrl();
  const requested = hasLiveBackend() ? demoParam(url) : null;
  if (url && requested) {
    let remembered: boolean;
    if (requested === 'on') {
      remembered = setItem(MODE_KEY, 'demo');
    } else {
      removeItem(MODE_KEY);
      remembered = getItem(MODE_KEY) === null;
    }
    // Without storage, keep "?demo" in the address so a reload stays in the demo.
    if (remembered) {
      const next = new URL(url.href);
      next.searchParams.delete(DEMO_PARAM);
      replaceAddress(next.href);
    }
  }
  return currentAppMode();
}

function defaultReload(): void {
  window.location.reload();
}

/** Switch this browser to the demo (live builds only) and reload into it. */
export function enterDemo(reload: () => void = defaultReload): void {
  const url = currentUrl();
  if (!url || !hasLiveBackend()) return;
  const remembered = setItem(MODE_KEY, 'demo');
  const next = new URL(cleanUrl(url));
  if (!remembered) next.searchParams.set(DEMO_PARAM, '1');
  replaceAddress(next.href);
  reload();
}

/** Leave the demo and reload into the live app. */
export function exitDemo(reload: () => void = defaultReload): void {
  const url = currentUrl();
  if (!url) return;
  removeItem(MODE_KEY);
  const next = new URL(cleanUrl(url));
  // If storage still says demo (it can't be changed), say so in the address instead.
  if (getItem(MODE_KEY) === 'demo') next.searchParams.set(DEMO_PARAM, '0');
  replaceAddress(next.href);
  reload();
}

// ---------------------------------------------------------------------------
// Storage layout
// ---------------------------------------------------------------------------

/** Keys every earlier version used for whichever mode the build ran in. */
const LEGACY = {
  session: 'tma.session',
  email: 'tma.email',
  cachePrefix: 'tma.cache.',
  dismissedPrefix: 'tma.dismissed.',
  pushToken: 'tma.pushToken',
  pushTokenAt: 'tma.pushToken.at',
} as const;

function move(from: string, to: string): void {
  const value = getItem(from);
  if (value === null) return;
  if (getItem(to) === null) setItem(to, value);
  removeItem(from);
}

/**
 * Before the demo could run on a live build, a build was either demo or live,
 * and both used the un-prefixed keys. A browser that has run the demo (its
 * database exists) kept demo state there, so move it under the demo keys;
 * otherwise the keys came from a live build and already are the live keys.
 * The old push token ('tma.pushToken': from the earlier push setup, or a demo token) is
 * replaced by the push registration record; a demo token is carried over.
 * Runs once per browser.
 */
export function migrateLegacyStorage(): void {
  if (getItem(STORAGE_LAYOUT_KEY) === STORAGE_LAYOUT_VERSION) return;
  const demo = storageKeys('demo');
  const legacyPush = getItem(LEGACY.pushToken);

  if (getItem(DEMO_DB_KEY) !== null) {
    move(LEGACY.session, demo.session);
    move(LEGACY.email, demo.email);
    for (const key of allKeys()) {
      if (key.startsWith(LEGACY.cachePrefix)) move(key, demo.cachePrefix + key.slice(LEGACY.cachePrefix.length));
      else if (key.startsWith(LEGACY.dismissedPrefix)) {
        move(key, demo.dismissedPrefix + key.slice(LEGACY.dismissedPrefix.length));
      }
    }
    if (legacyPush && legacyPush.startsWith('demo-') && getItem(demo.push) === null) {
      writeJson(demo.push, { token: legacyPush, at: getItem(LEGACY.pushTokenAt) ?? new Date().toISOString() });
    }
  }
  removeItem(LEGACY.pushToken);
  removeItem(LEGACY.pushTokenAt);
  setItem(STORAGE_LAYOUT_KEY, STORAGE_LAYOUT_VERSION);
}
