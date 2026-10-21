/**
 * Push enablement (ARCHITECTURE.md §10).
 *
 * Live mode uses Firebase Cloud Messaging (free) on top of standard Web Push,
 * with TMA's own service worker (sw.ts) receiving the messages. Firebase is
 * loaded only when a parent turns notifications on, so it never slows down
 * the first paint.
 *
 * Demo mode registers a fake `demo-…` token; the demo backend's push sender
 * shows those notifications as in-app banners (and as real notifications when
 * the browser allows it).
 *
 * The device token is kept in localStorage 'tma.pushToken'.
 */
import type { FirebaseOptions } from 'firebase/app';
import { errorMessage, isApiError, type ApiClient } from '../api/client';
import { getItem, removeItem, setItem } from './storage';

export type PushSupport = 'ready' | 'enabled' | 'needs-install' | 'blocked' | 'unsupported' | 'not-configured';
export type PushMode = 'demo' | 'live';
export type EnablePushResult = { ok: true } | { ok: false; reason: string };

export const PUSH_TOKEN_KEY = 'tma.pushToken';
/** When the current token was last sent to the server (ISO time). */
const REGISTERED_AT_KEY = 'tma.pushToken.at';
export const DEMO_TOKEN_PREFIX = 'demo-';

const FIREBASE_APP_NAME = 'tma';
const SW_READY_TIMEOUT_MS = 15_000;
/** Re-register an unchanged token now and then so the server's "Last Seen" stays fresh. */
const REREGISTER_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
const USER_AGENT_MAX = 300;

const REASONS: Record<Exclude<PushSupport, 'ready' | 'enabled'>, string> = {
  'needs-install':
    'On iPhone and iPad, add TMA to your Home Screen first (Share → Add to Home Screen), then turn on notifications from the Home Screen app.',
  blocked: 'Notifications are blocked for this site. Allow them in your browser or phone settings, then try again.',
  unsupported: "This browser can't receive notifications. Try Chrome, Edge, Firefox or Safari.",
  'not-configured': "TMA hasn't switched on app notifications yet. You'll still get updates by email.",
};
const GENERIC_FAILURE = "Couldn't turn on notifications on this device. Please try again.";
const SW_NOT_READY = 'The app is still getting ready on this device. Reload the page and try again.';

/** Why push can't be turned on, for a support state other than 'ready'/'enabled'. */
export function pushUnavailableReason(support: PushSupport): string | null {
  return support === 'ready' || support === 'enabled' ? null : REASONS[support];
}

// ---------------------------------------------------------------------------
// Platform
// ---------------------------------------------------------------------------

/** iPhone, iPod or iPad (including iPadOS, whose Safari reports a desktop Mac user agent). */
export function isIos(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  return /Macintosh/.test(ua) && (navigator.maxTouchPoints ?? 0) > 1;
}

/** Running as an installed app (Home Screen / app window) rather than in a browser tab. */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    if (typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches) return true;
  } catch {
    // Very old browsers: fall through to the iOS flag.
  }
  return (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function defaultMode(): PushMode {
  return (import.meta.env.VITE_API_URL ?? '').trim() ? 'live' : 'demo';
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface FirebasePushConfig {
  options: FirebaseOptions;
  vapidKey: string;
}

const REQUIRED_FIREBASE_KEYS = ['apiKey', 'projectId', 'messagingSenderId', 'appId'] as const;
const OPTIONAL_FIREBASE_KEYS = ['authDomain', 'storageBucket', 'measurementId'] as const;

/** VITE_FIREBASE_CONFIG (one-line JSON) + VITE_FIREBASE_VAPID_KEY, or null when missing or malformed. */
export function readFirebaseConfig(): FirebasePushConfig | null {
  const rawConfig = (import.meta.env.VITE_FIREBASE_CONFIG ?? '').trim();
  const vapidKey = (import.meta.env.VITE_FIREBASE_VAPID_KEY ?? '').trim();
  if (!rawConfig || !/^[A-Za-z0-9_-]{20,}={0,2}$/.test(vapidKey)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawConfig);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const source = parsed as Record<string, unknown>;
  const options: Record<string, string> = {};
  for (const key of REQUIRED_FIREBASE_KEYS) {
    const value = source[key];
    if (typeof value !== 'string' || !value.trim()) return null;
    options[key] = value.trim();
  }
  for (const key of OPTIONAL_FIREBASE_KEYS) {
    const value = source[key];
    if (typeof value === 'string' && value.trim()) options[key] = value.trim();
  }
  return { options: options as FirebaseOptions, vapidKey };
}

// ---------------------------------------------------------------------------
// Token storage
// ---------------------------------------------------------------------------

function storedToken(): string | null {
  const token = getItem(PUSH_TOKEN_KEY);
  return token && token.trim() ? token.trim() : null;
}

function registeredAt(): number {
  const t = Date.parse(getItem(REGISTERED_AT_KEY) ?? '');
  return Number.isNaN(t) ? 0 : t;
}

function saveToken(token: string): void {
  setItem(PUSH_TOKEN_KEY, token);
  setItem(REGISTERED_AT_KEY, new Date().toISOString());
}

function clearToken(): void {
  removeItem(PUSH_TOKEN_KEY);
  removeItem(REGISTERED_AT_KEY);
}

/** The demo calls this when it re-seeds its data (its device list is gone, so the demo token is too). */
export function forgetDemoPushToken(): void {
  if (storedToken()?.startsWith(DEMO_TOKEN_PREFIX)) clearToken();
}

// ---------------------------------------------------------------------------
// Support state
// ---------------------------------------------------------------------------

function supportNow(mode: PushMode): PushSupport {
  if (mode === 'demo') {
    // Demo notifications always reach the in-app banner, whatever the browser.
    return storedToken()?.startsWith(DEMO_TOKEN_PREFIX) ? 'enabled' : 'ready';
  }
  if (!readFirebaseConfig()) return 'not-configured';
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return 'unsupported';
  // iOS/iPadOS only offer Web Push to Home Screen apps (16.4+).
  if (isIos() && !isStandalone()) return 'needs-install';
  if (!('serviceWorker' in navigator) || typeof Notification === 'undefined' || !('PushManager' in window)) {
    return 'unsupported';
  }
  if (Notification.permission === 'denied') return 'blocked';
  const token = storedToken();
  if (Notification.permission === 'granted' && token && !token.startsWith(DEMO_TOKEN_PREFIX)) return 'enabled';
  return 'ready';
}

/** What the notification button should offer on this device. `mode` defaults to the build's (VITE_API_URL). */
export async function getPushSupport(options: { mode?: PushMode } = {}): Promise<PushSupport> {
  return supportNow(options.mode ?? defaultMode());
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Promise- and legacy-callback-style Notification.requestPermission (older Safari). */
function requestPermission(): Promise<NotificationPermission> {
  if (typeof Notification === 'undefined') return Promise.resolve('denied');
  if (Notification.permission !== 'default') return Promise.resolve(Notification.permission);
  return new Promise((resolve) => {
    let settled = false;
    const done = (permission: NotificationPermission) => {
      if (settled) return;
      settled = true;
      resolve(permission);
    };
    try {
      const result = Notification.requestPermission(done) as Promise<NotificationPermission> | undefined;
      if (result && typeof result.then === 'function') result.then(done, () => done('default'));
    } catch {
      done('default');
    }
  });
}

function serviceWorkerReady(timeoutMs: number): Promise<ServiceWorkerRegistration> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(SW_NOT_READY)), timeoutMs);
    navigator.serviceWorker.ready.then(
      (registration) => {
        clearTimeout(timer);
        resolve(registration);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(SW_NOT_READY));
      },
    );
  });
}

type MessagingModule = typeof import('firebase/messaging');
interface LoadedMessaging {
  mod: MessagingModule;
  messaging: ReturnType<MessagingModule['getMessaging']>;
}

/** Load Firebase on demand; null when this browser can't use FCM (e.g. no IndexedDB). */
async function loadMessaging(config: FirebasePushConfig): Promise<LoadedMessaging | null> {
  const [appMod, mod] = await Promise.all([import('firebase/app'), import('firebase/messaging')]);
  if (!(await mod.isSupported())) return null;
  const app =
    appMod.getApps().find((a) => a.name === FIREBASE_APP_NAME) ?? appMod.initializeApp(config.options, FIREBASE_APP_NAME);
  return { mod, messaging: mod.getMessaging(app) };
}

async function fcmToken(config: FirebasePushConfig): Promise<string | null> {
  const registration = await serviceWorkerReady(SW_READY_TIMEOUT_MS);
  const loaded = await loadMessaging(config);
  if (!loaded) return null;
  const token = await loaded.mod.getToken(loaded.messaging, {
    vapidKey: config.vapidKey,
    serviceWorkerRegistration: registration,
  });
  return token || null;
}

/** Send the token to TMA, remember it, and drop this device's previous token (best effort). */
async function registerToken(api: ApiClient, token: string): Promise<void> {
  const previous = storedToken();
  const userAgent = typeof navigator !== 'undefined' ? (navigator.userAgent || '').slice(0, USER_AGENT_MAX) : '';
  await api.call('push.register', { token, userAgent });
  saveToken(token);
  if (previous && previous !== token) {
    // The server only removes it if it belongs to the signed-in parent.
    await api.call('push.unregister', { token: previous }).catch(() => undefined);
  }
}

function randomId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Turn on notifications for the signed-in parent on this device. Call it from
 * a click/tap handler: browsers only show the permission prompt for one.
 * Never throws.
 */
export async function enablePush(api: ApiClient): Promise<EnablePushResult> {
  if (api.mode === 'demo') return enableDemoPush(api);

  const support = supportNow('live');
  const unavailable = pushUnavailableReason(support);
  if (unavailable) return { ok: false, reason: unavailable };
  const config = readFirebaseConfig();
  if (!config) return { ok: false, reason: REASONS['not-configured'] };

  // Ask before any other await, while the tap still counts as a user gesture (Safari).
  const permission = await requestPermission();
  if (permission === 'denied') return { ok: false, reason: REASONS.blocked };
  if (permission !== 'granted') {
    return { ok: false, reason: 'Notifications are still off. Tap the button again and choose "Allow".' };
  }

  try {
    const token = await fcmToken(config);
    if (!token) return { ok: false, reason: REASONS.unsupported };
    await registerToken(api, token);
    return { ok: true };
  } catch (err) {
    if (isApiError(err)) return { ok: false, reason: errorMessage(err) };
    if (err instanceof Error && err.message === SW_NOT_READY) return { ok: false, reason: SW_NOT_READY };
    return { ok: false, reason: GENERIC_FAILURE };
  }
}

async function enableDemoPush(api: ApiClient): Promise<EnablePushResult> {
  // Real pop-up notifications need permission; the in-app banner works either way.
  try {
    await requestPermission();
  } catch {
    // Ignore: demo pushes still show in the app.
  }
  try {
    await registerToken(api, DEMO_TOKEN_PREFIX + randomId());
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: errorMessage(err) };
  }
}

/**
 * Turn off notifications on this device: remove the token from TMA's list and
 * from Firebase. Throws ApiError when TMA can't be reached (nothing changes
 * then, so the parent can retry). An expired session still clears the device.
 */
export async function disablePush(api: ApiClient): Promise<void> {
  const token = storedToken();
  if (!token) return;
  if (api.getToken()) {
    try {
      await api.call('push.unregister', { token });
    } catch (err) {
      if (!isApiError(err, 'UNAUTHORIZED')) throw err;
    }
  }
  if (api.mode === 'live' && !token.startsWith(DEMO_TOKEN_PREFIX)) {
    const config = readFirebaseConfig();
    if (config) {
      try {
        const loaded = await loadMessaging(config);
        if (loaded) await loaded.mod.deleteToken(loaded.messaging);
      } catch {
        // The server copy is gone; a token Firebase still holds just expires unused.
      }
    }
  }
  clearToken();
}

/**
 * Call on app start (signed in). When this device has notifications on,
 * refresh the FCM token and re-register it if it changed (or once a week).
 * Best effort; never throws.
 */
export async function refreshPushRegistration(api: ApiClient): Promise<void> {
  if (api.mode !== 'live' || !api.getToken()) return;
  const previous = storedToken();
  if (!previous || supportNow('live') !== 'enabled') return;
  const config = readFirebaseConfig();
  if (!config) return;
  try {
    const token = await fcmToken(config);
    if (!token) return;
    if (token !== previous || Date.now() - registeredAt() > REREGISTER_AFTER_MS) await registerToken(api, token);
  } catch {
    // Try again on the next start.
  }
}
