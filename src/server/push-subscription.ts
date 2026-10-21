/**
 * Web Push subscriptions as stored in the Devices tab (Devices.Token).
 *
 * A browser's `PushSubscription.toJSON()` is
 * `{endpoint, expirationTime, keys: {p256dh, auth}}`. The app keeps only the
 * canonical JSON `{"endpoint":…,"keys":{"p256dh":…,"auth":…}}`, with the
 * endpoint host lower-cased and both keys re-encoded as base64url without
 * padding, so the same browser always produces the same token.
 *
 * The checks mirror the push Worker's (workers/push/src/webpush.ts), so a
 * stored subscription is one the Worker will deliver to:
 *   - endpoint: `https://`, default port, no credentials, at most 2048
 *     characters, host on the push-service allowlist (an SSRF guard);
 *   - p256dh: a 65-byte uncompressed P-256 point (first byte 0x04);
 *   - auth: 16 bytes.
 * Keys may arrive as base64url or standard base64, with or without padding.
 *
 * Plain string/array code only (no URL, TextEncoder or atob), because the
 * core also runs in Apps Script.
 */
import { isRecord } from './util';

/** Push services the Worker posts to, by exact host. */
export const PUSH_SERVICE_HOSTS: readonly string[] = [
  'fcm.googleapis.com', // Chrome, Edge (Chromium) and Android
  'updates.push.services.mozilla.com', // Firefox
  'web.push.apple.com', // Safari and iPhone/iPad Home Screen apps
];
/** ... or by host suffix. */
export const PUSH_SERVICE_HOST_SUFFIXES: readonly string[] = ['.push.apple.com', '.notify.windows.com'];

export const MAX_ENDPOINT_CHARS = 2048;
/** Longest accepted key text: padded standard base64 of 65 and 16 bytes (as the Worker). */
const MAX_P256DH_CHARS = 88;
const MAX_AUTH_CHARS = 24;
const P256_POINT_BYTES = 65;
const AUTH_SECRET_BYTES = 16;
/** Raw subscription JSON from the browser: endpoint + keys + a little framing. */
export const MAX_SUBSCRIPTION_JSON_CHARS = 4096;

/**
 * `https://host` then an optional path/query starting with / ? or #. The host
 * part allows no port, credentials or IP-literal brackets: any of ":" "@" "["
 * right after the host fails the match. Printable ASCII only, and no
 * backslash (WHATWG URL parsing treats it as "/", which could move the host).
 */
const ENDPOINT_RE = /^https:\/\/([A-Za-z0-9.-]+)([/?#][\x21-\x5b\x5d-\x7e]*)?$/;
const HOST_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;

export interface PushSubscriptionKeys {
  p256dh: string;
  auth: string;
}

/** A validated subscription in canonical form. */
export interface StoredSubscription {
  endpoint: string;
  keys: PushSubscriptionKeys;
}

export type SubscriptionProblem = 'format' | 'endpoint' | 'push_service' | 'keys';

export type SubscriptionParse = { ok: true; subscription: StoredSubscription } | { ok: false; problem: SubscriptionProblem };

// ---------------------------------------------------------------------------
// base64url <-> bytes
// ---------------------------------------------------------------------------

const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function b64Value(code: number): number {
  if (code >= 65 && code <= 90) return code - 65; // A-Z
  if (code >= 97 && code <= 122) return code - 71; // a-z
  if (code >= 48 && code <= 57) return code + 4; // 0-9
  if (code === 45 || code === 43) return 62; // - or +
  if (code === 47 || code === 95) return 63; // / or _
  return -1;
}

/**
 * Bytes of base64url text. Also accepts standard base64 ("+", "/") and up to
 * two trailing "=", since browsers and libraries disagree on which they emit.
 * null for anything else.
 */
export function decodeBase64UrlBytes(input: string): number[] | null {
  let end = input.length;
  while (end > 0 && input.length - end < 2 && input.charCodeAt(end - 1) === 61) end--;
  if (end % 4 === 1) return null;
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < end; i++) {
    const v = b64Value(input.charCodeAt(i));
    if (v < 0) return null;
    buffer = ((buffer << 6) | v) & 0xffffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 0xff);
    }
  }
  return out;
}

/** base64url without padding. */
export function encodeBase64UrlBytes(bytes: readonly number[]): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i] & 0xff;
    const b1 = i + 1 < bytes.length ? bytes[i + 1] & 0xff : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] & 0xff : 0;
    const n = (b0 << 16) | (b1 << 8) | b2;
    out += B64URL[(n >> 18) & 63] + B64URL[(n >> 12) & 63];
    if (i + 1 < bytes.length) out += B64URL[(n >> 6) & 63];
    if (i + 2 < bytes.length) out += B64URL[n & 63];
  }
  return out;
}

/** Canonical base64url of a P-256 public key (65 bytes, 0x04 first), or null. Used for the Worker's VAPID key too. */
export function canonicalP256Key(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (text.length === 0 || text.length > MAX_P256DH_CHARS) return null;
  const bytes = decodeBase64UrlBytes(text);
  if (!bytes || bytes.length !== P256_POINT_BYTES || bytes[0] !== 0x04) return null;
  return encodeBase64UrlBytes(bytes);
}

function canonicalAuthSecret(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (text.length === 0 || text.length > MAX_AUTH_CHARS) return null;
  const bytes = decodeBase64UrlBytes(text);
  if (!bytes || bytes.length !== AUTH_SECRET_BYTES) return null;
  return encodeBase64UrlBytes(bytes);
}

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

export function isPushServiceHost(host: string): boolean {
  const h = host.toLowerCase();
  if (!HOST_RE.test(h)) return false;
  return PUSH_SERVICE_HOSTS.includes(h) || PUSH_SERVICE_HOST_SUFFIXES.some((suffix) => h.endsWith(suffix));
}

function checkEndpoint(value: unknown): { ok: true; endpoint: string } | { ok: false; problem: 'endpoint' | 'push_service' } {
  if (typeof value !== 'string') return { ok: false, problem: 'endpoint' };
  const text = value.trim();
  if (text.length > MAX_ENDPOINT_CHARS) return { ok: false, problem: 'endpoint' };
  const m = ENDPOINT_RE.exec(text);
  if (!m) return { ok: false, problem: 'endpoint' };
  const host = m[1].toLowerCase();
  if (!isPushServiceHost(host)) return { ok: false, problem: 'push_service' };
  return { ok: true, endpoint: `https://${host}${m[2] ?? ''}` };
}

/** Canonical endpoint (host lower-cased) when it is an https URL on an allowed push service, else null. */
export function canonicalEndpoint(value: unknown): string | null {
  const result = checkEndpoint(value);
  return result.ok ? result.endpoint : null;
}

// ---------------------------------------------------------------------------
// Subscriptions
// ---------------------------------------------------------------------------

function parseJsonObject(value: unknown): Record<string, unknown> | null {
  if (isRecord(value)) return value;
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text.startsWith('{') || text.length > MAX_SUBSCRIPTION_JSON_CHARS) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Validate a subscription (JSON text or an object) and return its canonical form. */
export function parseSubscription(value: unknown): SubscriptionParse {
  const data = parseJsonObject(value);
  if (!data) return { ok: false, problem: 'format' };
  const endpoint = checkEndpoint(data.endpoint);
  if (!endpoint.ok) return { ok: false, problem: endpoint.problem };
  const keys = data.keys;
  if (!isRecord(keys)) return { ok: false, problem: 'keys' };
  const p256dh = canonicalP256Key(keys.p256dh);
  const auth = canonicalAuthSecret(keys.auth);
  if (!p256dh || !auth) return { ok: false, problem: 'keys' };
  return { ok: true, subscription: { endpoint: endpoint.endpoint, keys: { p256dh, auth } } };
}

/** The canonical subscription, or null when invalid. */
export function toSubscription(value: unknown): StoredSubscription | null {
  const result = parseSubscription(value);
  return result.ok ? result.subscription : null;
}

/** The Devices.Token text for a subscription: canonical JSON, endpoint and keys only. */
export function subscriptionToken(subscription: StoredSubscription): string {
  return JSON.stringify({
    endpoint: subscription.endpoint,
    keys: { p256dh: subscription.keys.p256dh, auth: subscription.keys.auth },
  });
}

/**
 * The canonical endpoint of a subscription JSON (stored token or raw browser
 * JSON) without checking its keys, or null. Identifies a browser across key
 * changes and lets push.unregister work with whatever the browser still has.
 */
export function subscriptionEndpoint(value: unknown): string | null {
  const data = parseJsonObject(value);
  return data ? canonicalEndpoint(data.endpoint) : null;
}
