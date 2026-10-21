/**
 * Push enablement (ARCHITECTURE.md §10).
 *
 * Live mode uses the standard Push API. The browser subscribes with the VAPID
 * public key of TMA's push Worker (PublicSettings.pushPublicKey, from
 * me.bootstrap) and the subscription is saved to the sheet with push.register
 * as canonical JSON: {"endpoint":…,"keys":{"p256dh":…,"auth":…}}. Apps Script
 * hands it to the Worker, which encrypts and delivers each notification; the
 * service worker (sw.ts) shows it.
 *
 * Demo mode registers a fake `demo-…` token instead; the demo backend's push
 * sender shows those notifications as in-app banners (and as real
 * notifications when the browser allows it). The demo never touches the
 * browser's real push subscription, which belongs to the live app.
 *
 * What this device registered is remembered per mode in localStorage
 * (storageKeys(mode).push): {token, key?, email?, at}. A record another
 * account made doesn't count as "on" for whoever is signed in now.
 */
import { errorMessage, isApiError, readStoredToken, type ApiClient } from '../api/client';
import { currentAppMode } from './mode';
import { sessionEmail } from './session';
import { readJson, removeItem, storageKeys, writeJson } from './storage';

export type PushSupport = 'ready' | 'enabled' | 'needs-install' | 'blocked' | 'unsupported' | 'not-configured';
export type PushMode = 'demo' | 'live';
export type EnablePushResult = { ok: true } | { ok: false; reason: string };

export const DEMO_TOKEN_PREFIX = 'demo-';

const SW_READY_TIMEOUT_MS = 15_000;
/** Turning push off shouldn't hold up signing out for long. */
const SW_READY_TIMEOUT_OFF_MS = 3_000;
/** Re-register an unchanged subscription now and then so the server's "Last Seen" stays fresh. */
const REREGISTER_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
const USER_AGENT_MAX = 300;
/** Same limits as the push Worker (workers/push/src/webpush.ts). */
const ENDPOINT_MAX = 2048;
const PUBLIC_KEY_BYTES = 65;
const AUTH_BYTES = 16;
const BASE64_MAX = 200;
/** Push services the Worker delivers to (its SSRF allowlist). */
const PUSH_HOSTS = new Set(['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com']);
const PUSH_HOST_SUFFIXES = ['.push.apple.com', '.notify.windows.com'];

const REASONS: Record<Exclude<PushSupport, 'ready' | 'enabled'>, string> = {
  'needs-install':
    'On iPhone and iPad, add TMA to your Home Screen first (Share → Add to Home Screen), then turn on notifications from the Home Screen app.',
  blocked: 'Notifications are blocked for this site. Allow them in your browser or phone settings, then try again.',
  unsupported: "This browser can't receive notifications. Try Chrome, Edge, Firefox or Safari.",
  'not-configured': "TMA hasn't switched on app notifications yet. You'll still get updates by email.",
};
const GENERIC_FAILURE = "Couldn't turn on notifications on this device. Please try again.";
const SW_NOT_READY = 'The app is still getting ready on this device. Reload the page and try again.';
const STILL_OFF = 'Notifications are still off. Tap the button again and choose "Allow".';

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

// ---------------------------------------------------------------------------
// Keys and subscriptions
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Base64url (or base64) without or with padding → bytes; null when malformed. */
export function decodeBase64Url(input: string): Uint8Array<ArrayBuffer> | null {
  const trimmed = input.trim();
  if (trimmed.length > BASE64_MAX || !/^[A-Za-z0-9_\-+/]*={0,2}$/.test(trimmed)) return null;
  const b64 = trimmed.replace(/=+$/, '').replace(/-/g, '+').replace(/_/g, '/');
  if (b64.length % 4 === 1) return null;
  let binary: string;
  try {
    binary = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  } catch {
    return null;
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * The Worker's VAPID public key as the applicationServerKey bytes, or null
 * unless it is an uncompressed P-256 point (65 bytes starting with 0x04).
 */
export function applicationServerKey(publicKey: string | null | undefined): Uint8Array<ArrayBuffer> | null {
  if (typeof publicKey !== 'string' || !publicKey.trim()) return null;
  const bytes = decodeBase64Url(publicKey);
  return bytes && bytes.length === PUBLIC_KEY_BYTES && bytes[0] === 0x04 ? bytes : null;
}

/** An https endpoint on a push service the Worker delivers to (mirrors its allowlist). */
export function isDeliverableEndpoint(endpoint: string): boolean {
  if (endpoint.length > ENDPOINT_MAX) return false;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.port !== '' || url.username !== '' || url.password !== '') return false;
  const host = url.hostname.toLowerCase();
  return PUSH_HOSTS.has(host) || PUSH_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

function keyOfLength(value: unknown, bytes: number): value is string {
  if (typeof value !== 'string') return false;
  const decoded = decodeBase64Url(value);
  return decoded !== null && decoded.length === bytes && (bytes !== PUBLIC_KEY_BYTES || decoded[0] === 0x04);
}

/**
 * The token push.register stores for a subscription: canonical JSON with only
 * the endpoint and keys, always in this order (no expirationTime). Null for a
 * malformed subscription or a push service the Worker can't deliver to.
 */
export function canonicalToken(subscription: unknown): string | null {
  if (!isRecord(subscription) || typeof subscription.endpoint !== 'string' || !isRecord(subscription.keys)) return null;
  const endpoint = subscription.endpoint.trim();
  const { p256dh, auth } = subscription.keys;
  if (!isDeliverableEndpoint(endpoint) || !keyOfLength(p256dh, PUBLIC_KEY_BYTES) || !keyOfLength(auth, AUTH_BYTES)) {
    return null;
  }
  return JSON.stringify({ endpoint, keys: { p256dh: p256dh.trim(), auth: auth.trim() } });
}

function subscriptionToken(subscription: PushSubscription): string | null {
  try {
    return canonicalToken(subscription.toJSON());
  } catch {
    return null;
  }
}

/**
 * The applicationServerKey a subscription was made with (PushSubscription.options):
 * null when it was made without one, undefined when the browser doesn't say.
 */
function subscriptionKey(subscription: PushSubscription): Uint8Array | null | undefined {
  try {
    const options: PushSubscriptionOptions | undefined = subscription.options;
    if (!options) return undefined;
    const raw: unknown = options.applicationServerKey;
    if (raw === null || raw === undefined) return null;
    if (raw instanceof Uint8Array) return raw;
    // An ArrayBuffer, possibly from another realm (so no instanceof).
    if (typeof raw === 'object' && typeof (raw as ArrayBuffer).byteLength === 'number') {
      return new Uint8Array(raw as ArrayBuffer);
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Was this subscription made with `publicKey`? Falls back to what we recorded when the browser doesn't say. */
function madeWithKey(subscription: PushSubscription, key: Uint8Array, publicKey: string): boolean {
  const used = subscriptionKey(subscription);
  if (used === null) return false; // made without a key: the Worker's signed pushes would be refused
  if (used) return sameBytes(used, key);
  const recorded = readRecord('live')?.key;
  return recorded === undefined || recorded === publicKey.trim();
}

// ---------------------------------------------------------------------------
// What this device registered (per mode)
// ---------------------------------------------------------------------------

interface PushRecord {
  /** What push.register was given: canonical subscription JSON (live) or 'demo-…' (demo). */
  token: string;
  /** Live: the VAPID public key the subscription was made with. */
  key?: string;
  /** The account it was registered for (lower case), when known. */
  email?: string;
  /** When the token was last sent to TMA (ISO time). */
  at: string;
}

function readRecord(mode: PushMode): PushRecord | null {
  const raw = readJson<unknown>(storageKeys(mode).push);
  if (!isRecord(raw) || typeof raw.token !== 'string') return null;
  const token = raw.token;
  const valid = mode === 'demo' ? token.startsWith(DEMO_TOKEN_PREFIX) : canonicalToken(safeParse(token)) === token;
  if (!valid) return null;
  return {
    token,
    ...(typeof raw.key === 'string' && raw.key ? { key: raw.key } : {}),
    ...(typeof raw.email === 'string' && raw.email ? { email: raw.email } : {}),
    at: typeof raw.at === 'string' ? raw.at : '',
  };
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function saveRecord(mode: PushMode, token: string, key: string | undefined, email: string | null): void {
  const record: PushRecord = { token, ...(key ? { key } : {}), ...(email ? { email } : {}), at: new Date().toISOString() };
  writeJson(storageKeys(mode).push, record);
}

function clearRecord(mode: PushMode): void {
  removeItem(storageKeys(mode).push);
}

/**
 * Do two registered tokens name different devices? TMA matches devices by
 * subscription endpoint (or by the demo token itself), so unregistering an
 * old token with the same endpoint would remove the new registration.
 */
function differentDevice(a: string, b: string): boolean {
  if (a === b) return false;
  const endpoint = (token: string): string | null => {
    const parsed = safeParse(token);
    if (!isRecord(parsed) || typeof parsed.endpoint !== 'string') return null;
    try {
      return new URL(parsed.endpoint).href;
    } catch {
      return null;
    }
  };
  const ea = endpoint(a);
  return ea === null || ea !== endpoint(b);
}

/** Who is signed in through `api` (from the session token), or null when unknown. */
function signedInEmail(api: ApiClient): string | null {
  return sessionEmail(api.getToken(), api.mode);
}

/**
 * Did another account register this device? That happens when its sign-out
 * couldn't reach TMA or its session expired. Unknown on either side (records
 * from before the email was kept) counts as no.
 */
function registeredByOther(record: PushRecord, email: string | null): boolean {
  return record.email !== undefined && email !== null && record.email !== email;
}

function registeredLongAgo(record: PushRecord): boolean {
  const at = Date.parse(record.at);
  return Number.isNaN(at) || Date.now() - at > REREGISTER_AFTER_MS;
}

/** The demo calls this when it re-seeds its data (its device list is gone, so the demo token is too). */
export function forgetDemoPushToken(): void {
  clearRecord('demo');
}

/**
 * Bumped by every enable/disable/refresh. A refresh still running when the
 * parent turns push on or off (or a newer refresh starts) stops before
 * changing anything, so it can't undo their choice.
 */
let generation = 0;

// ---------------------------------------------------------------------------
// Support state
// ---------------------------------------------------------------------------

/** This device's record, unless another account made it (then push isn't on for whoever is signed in now). */
function ownRecord(mode: PushMode): PushRecord | null {
  const record = readRecord(mode);
  return record && !registeredByOther(record, sessionEmail(readStoredToken(mode), mode)) ? record : null;
}

function supportNow(mode: PushMode, publicKey: string | undefined): PushSupport {
  if (mode === 'demo') {
    // Demo notifications always reach the in-app banner, whatever the browser.
    return ownRecord('demo') ? 'enabled' : 'ready';
  }
  if (!applicationServerKey(publicKey)) return 'not-configured';
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return 'unsupported';
  // iOS/iPadOS only offer Web Push to Home Screen apps (16.4+).
  if (isIos() && !isStandalone()) return 'needs-install';
  if (!('serviceWorker' in navigator) || typeof Notification === 'undefined' || !('PushManager' in window)) {
    return 'unsupported';
  }
  if (Notification.permission === 'denied') return 'blocked';
  if (Notification.permission === 'granted' && ownRecord('live')) return 'enabled';
  return 'ready';
}

/**
 * What the notification button should offer on this device. `mode` defaults
 * to this page's (lib/mode.ts); `publicKey` is PublicSettings.pushPublicKey
 * (live mode without one is 'not-configured').
 */
export async function getPushSupport(options: { mode?: PushMode; publicKey?: string } = {}): Promise<PushSupport> {
  return supportNow(options.mode ?? currentAppMode(), options.publicKey);
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

function subscribe(registration: ServiceWorkerRegistration, key: Uint8Array<ArrayBuffer>): Promise<PushSubscription> {
  return registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
}

/** This device's subscription for `publicKey`: the current one, or a new one (dropping one made with another key). */
async function ensureSubscription(
  registration: ServiceWorkerRegistration,
  key: Uint8Array<ArrayBuffer>,
  publicKey: string,
): Promise<PushSubscription> {
  const existing = await registration.pushManager.getSubscription();
  if (existing) {
    if (madeWithKey(existing, key, publicKey)) return existing;
    // Made with another key (the Worker's keys were replaced): push services would refuse it,
    // and the browser won't subscribe with a new key while it exists.
    await existing.unsubscribe();
  }
  return subscribe(registration, key);
}

function userAgent(): string {
  return typeof navigator !== 'undefined' ? (navigator.userAgent || '').slice(0, USER_AGENT_MAX) : '';
}

/** Send the token to TMA, remember it, and drop this device's previous token (best effort). */
async function registerToken(api: ApiClient, mode: PushMode, token: string, key?: string): Promise<void> {
  const previous = readRecord(mode);
  await api.call('push.register', { token, userAgent: userAgent() });
  saveRecord(mode, token, key, signedInEmail(api));
  if (previous && differentDevice(previous.token, token)) {
    // The server only removes it if it belongs to the signed-in parent.
    await api.call('push.unregister', { token: previous.token }).catch(() => undefined);
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

function isDomError(err: unknown, name: string): boolean {
  return typeof err === 'object' && err !== null && (err as { name?: unknown }).name === name;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Turn on notifications for the signed-in parent on this device. Call it from
 * a click/tap handler: browsers only show the permission prompt for one.
 * `publicKey` is PublicSettings.pushPublicKey (ignored in demo mode).
 * Never throws.
 */
export async function enablePush(api: ApiClient, publicKey?: string): Promise<EnablePushResult> {
  if (api.mode === 'demo') return enableDemoPush(api);

  const unavailable = pushUnavailableReason(supportNow('live', publicKey));
  if (unavailable) return { ok: false, reason: unavailable };
  const key = applicationServerKey(publicKey);
  if (!key || !publicKey) return { ok: false, reason: REASONS['not-configured'] };

  // Ask before any other await, while the tap still counts as a user gesture (Safari).
  const permission = await requestPermission();
  if (permission === 'denied') return { ok: false, reason: REASONS.blocked };
  if (permission !== 'granted') return { ok: false, reason: STILL_OFF };

  generation++;
  try {
    const registration = await serviceWorkerReady(SW_READY_TIMEOUT_MS);
    const subscription = await ensureSubscription(registration, key, publicKey);
    const token = subscriptionToken(subscription);
    if (!token) {
      // A push service TMA's sender can't reach (or a broken subscription): don't keep it.
      await subscription.unsubscribe().catch(() => false);
      return { ok: false, reason: REASONS.unsupported };
    }
    await registerToken(api, 'live', token, publicKey.trim());
    return { ok: true };
  } catch (err) {
    if (isApiError(err)) return { ok: false, reason: errorMessage(err) };
    if (err instanceof Error && err.message === SW_NOT_READY) return { ok: false, reason: SW_NOT_READY };
    if (isDomError(err, 'NotAllowedError')) return { ok: false, reason: REASONS.blocked };
    if (isDomError(err, 'NotSupportedError')) return { ok: false, reason: REASONS.unsupported };
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
  generation++;
  try {
    await registerToken(api, 'demo', DEMO_TOKEN_PREFIX + randomId());
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: errorMessage(err) };
  }
}

/** Unsubscribe the browser's push subscription (live only). Best effort. */
async function unsubscribeBrowser(): Promise<void> {
  try {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    const registration = await serviceWorkerReady(SW_READY_TIMEOUT_OFF_MS);
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) await subscription.unsubscribe();
  } catch {
    // TMA no longer has the token; a subscription left behind just goes unused.
  }
}

export interface DisablePushOptions {
  /**
   * Signing out: the parent can't retry once signed out, so the browser is
   * unsubscribed and the record forgotten even when TMA can't be reached (or
   * is slow). The push service then answers "gone" and TMA drops the row on
   * its next send, so the household's notifications stop reaching this device.
   */
  signingOut?: boolean;
}

/**
 * Turn off notifications on this device: remove the token from TMA's list and
 * unsubscribe the browser. Throws ApiError when TMA can't be reached (nothing
 * changes then, so the parent can retry), except when signing out. An expired
 * session still clears the device.
 */
export async function disablePush(api: ApiClient, options: DisablePushOptions = {}): Promise<void> {
  const mode: PushMode = api.mode;
  const record = readRecord(mode);
  if (!record) {
    clearRecord(mode); // drop anything unreadable
    return;
  }
  generation++;
  // Sent now, while the session token is still there.
  const unregistered = api.getToken()
    ? api.call('push.unregister', { token: record.token }).then(
        () => undefined,
        (err: unknown) => {
          if (!isApiError(err, 'UNAUTHORIZED')) throw err;
        },
      )
    : Promise.resolve();
  if (options.signingOut) {
    clearRecord(mode);
    await Promise.all([unregistered.catch(() => undefined), mode === 'live' ? unsubscribeBrowser() : undefined]);
    return;
  }
  await unregistered;
  if (mode === 'live') await unsubscribeBrowser();
  clearRecord(mode);
}

/**
 * Keep this device's live registration current. Call on app start (signed in),
 * when the bootstrap brings a new public key, and when the service worker
 * reports 'pushsubscriptionchange'. Only acts when the parent turned push on
 * here and permission is still granted: gets the current subscription,
 * re-subscribes when it is missing or was made with another key, and
 * re-registers when the subscription changed (or once a week). Never turns
 * push on by itself: a registration another account left here is turned off.
 * Best effort; never throws.
 */
export async function refreshPushRegistration(api: ApiClient, publicKey?: string): Promise<void> {
  if (api.mode !== 'live' || !api.getToken()) return;
  const email = signedInEmail(api);
  const stale = readRecord('live');
  if (stale && registeredByOther(stale, email)) {
    // Someone else turned push on here and it never got turned off: stop their household's
    // notifications reaching whoever uses the device now (TMA drops their row once the push
    // service reports the subscription gone). This person can turn it on for themselves.
    generation++;
    clearRecord('live');
    await unsubscribeBrowser();
    return;
  }
  if (!publicKey) return;
  const key = applicationServerKey(publicKey);
  if (!key || supportNow('live', publicKey) !== 'enabled') return;
  const gen = ++generation;
  const current = () => gen === generation && readRecord('live') !== null;
  let lost = false;
  try {
    const registration = await serviceWorkerReady(SW_READY_TIMEOUT_MS);
    if (!current()) return;
    let subscription = await registration.pushManager.getSubscription();
    if (!current()) return;
    if (!subscription || !madeWithKey(subscription, key, publicKey)) {
      if (subscription) await subscription.unsubscribe();
      lost = true;
      subscription = await subscribe(registration, key);
      lost = false;
      if (!current()) return;
    }
    const token = subscriptionToken(subscription);
    const record = readRecord('live');
    if (!token || !record) return;
    const trimmedKey = publicKey.trim();
    if (token === record.token && record.key === trimmedKey && !registeredLongAgo(record)) return;
    await api.call('push.register', { token, userAgent: userAgent() });
    if (gen !== generation) {
      // Turned off while we were registering: take this one back out. (When a newer
      // refresh or "Turn on" took over instead, it owns the registration: leave it.)
      if (!readRecord('live')) await api.call('push.unregister', { token }).catch(() => undefined);
      return;
    }
    saveRecord('live', token, trimmedKey, email);
    if (differentDevice(record.token, token)) {
      await api.call('push.unregister', { token: record.token }).catch(() => undefined);
    }
  } catch {
    if (lost && gen === generation) {
      // No subscription any more and no new one: show "Turn on" again rather than a dead "on".
      const record = readRecord('live');
      if (record) await api.call('push.unregister', { token: record.token }).catch(() => undefined);
      clearRecord('live');
    }
    // Otherwise try again on the next start.
  }
}
