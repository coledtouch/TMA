// Web Push message encryption (RFC 8291, aes128gcm per RFC 8188) and the
// HTTP request to the push service (RFC 8030), using only WebCrypto.
import { b64urlDecode, concat, utf8 } from './b64';
import type { Bytes } from './env';
import { vapidAuthorization, type VapidKeys } from './vapid';

/** Max payload in UTF-8 bytes. Push services accept ~4 KB of ciphertext. */
export const MAX_PAYLOAD_BYTES = 3000;
export const DEFAULT_TTL = 86_400;
export const MAX_TTL = 2_419_200; // 28 days
export const DEFAULT_URGENCY = 'high';
/** RFC 8188 record size advertised in the header (single record). */
export const RECORD_SIZE = 4096;
/** Give up on a push service after this long. */
export const FETCH_TIMEOUT_MS = 15_000;

const URGENCIES = ['very-low', 'low', 'normal', 'high'] as const;
export type Urgency = (typeof URGENCIES)[number];
const TOPIC_RE = /^[A-Za-z0-9_-]{1,32}$/;

/** Push service hosts we will POST to (SSRF guard). */
const ALLOWED_HOSTS = new Set(['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com']);
const ALLOWED_SUFFIXES = ['.push.apple.com', '.notify.windows.com'];

export interface PushSubscriptionJson {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface SendResult {
  status: 'ok' | 'invalid' | 'error';
  code?: number;
  reason?: string;
}

/** The application server's ephemeral ECDH key pair for one message. */
export interface ServerKeyPair {
  privateKey: CryptoKey;
  /** 65-byte uncompressed public point. */
  publicKey: Uint8Array;
}

const ECDH = { name: 'ECDH', namedCurve: 'P-256' } as const;

// ---------------------------------------------------------------------------
// Encryption (RFC 8291 §3.4)
// ---------------------------------------------------------------------------

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number): Promise<Bytes> {
  const key = await crypto.subtle.importKey('raw', ikm as Bytes, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: salt as Bytes, info: info as Bytes },
    key,
    bytes * 8,
  );
  return new Uint8Array(bits);
}

/**
 * Encrypts one push message with the given keys and salt. The result is the
 * whole aes128gcm body: salt | rs | idlen | keyid(as_public) | ciphertext.
 * Exposed for the RFC 8291 test vector; production code uses encryptPayload.
 */
export async function encryptWithKeys(
  payload: Uint8Array,
  uaPublic: Uint8Array,
  authSecret: Uint8Array,
  asKeyPair: ServerKeyPair,
  salt: Uint8Array,
): Promise<Bytes> {
  if (salt.length !== 16) throw new Error('salt must be 16 bytes');
  if (asKeyPair.publicKey.length !== 65) throw new Error('as_public must be 65 bytes');
  const uaKey = await crypto.subtle.importKey('raw', uaPublic as Bytes, ECDH, false, []);
  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, asKeyPair.privateKey, 256),
  );

  // IKM = HKDF(auth_secret, ecdh_secret, "WebPush: info" 0x00 ua_public as_public, 32)
  const keyInfo = concat(utf8('WebPush: info\0'), uaPublic, asKeyPair.publicKey);
  const ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 32);
  const cek = await hkdf(salt, ikm, utf8('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, utf8('Content-Encoding: nonce\0'), 12);

  // One record: the payload followed by the last-record delimiter, no padding.
  const plaintext = concat(payload, Uint8Array.of(0x02));
  const aesKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, aesKey, plaintext),
  );

  const header = new Uint8Array(16 + 4 + 1 + 65);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, RECORD_SIZE, false);
  header[20] = 65;
  header.set(asKeyPair.publicKey, 21);
  return concat(header, ciphertext);
}

/** Encrypts with a fresh ephemeral key pair and random salt (production path). */
export async function encryptPayload(payload: Uint8Array, uaPublic: Uint8Array, authSecret: Uint8Array): Promise<Bytes> {
  const pair = (await crypto.subtle.generateKey(ECDH, true, ['deriveBits'])) as CryptoKeyPair;
  const publicKey = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return encryptWithKeys(payload, uaPublic, authSecret, { privateKey: pair.privateKey, publicKey }, salt);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Parses an endpoint and checks it against the push service allowlist. */
export function allowedEndpoint(endpoint: unknown): URL | null {
  if (typeof endpoint !== 'string' || endpoint.length > 2048) return null;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.port !== '' || url.username !== '' || url.password !== '') return null;
  const host = url.hostname.toLowerCase();
  if (ALLOWED_HOSTS.has(host) || ALLOWED_SUFFIXES.some((suffix) => host.endsWith(suffix))) return url;
  return null;
}

/** Decodes the subscription keys; null unless p256dh is a 65-byte point and auth 16 bytes. */
export function decodeKeys(keys: unknown): { uaPublic: Bytes; authSecret: Bytes } | null {
  if (!isObject(keys) || typeof keys.p256dh !== 'string' || typeof keys.auth !== 'string') return null;
  const uaPublic = b64urlDecode(keys.p256dh.trim());
  const authSecret = b64urlDecode(keys.auth.trim());
  if (!uaPublic || uaPublic.length !== 65 || uaPublic[0] !== 0x04) return null;
  if (!authSecret || authSecret.length !== 16) return null;
  return { uaPublic, authSecret };
}

export function normalizeTtl(ttl: unknown): number {
  if (typeof ttl !== 'number' || !Number.isFinite(ttl)) return DEFAULT_TTL;
  return Math.min(MAX_TTL, Math.max(0, Math.floor(ttl)));
}

export function normalizeUrgency(urgency: unknown): Urgency {
  return (URGENCIES as readonly unknown[]).includes(urgency) ? (urgency as Urgency) : DEFAULT_URGENCY;
}

export function normalizeTopic(topic: unknown): string | undefined {
  return typeof topic === 'string' && TOPIC_RE.test(topic) ? topic : undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

/** Maps a push service HTTP status to a result (RFC 8030 §5, RFC 8292 §4). */
export function mapStatus(code: number): SendResult {
  if (code === 200 || code === 201 || code === 202) return { status: 'ok', code };
  if (code === 404 || code === 410) return { status: 'invalid', code, reason: 'gone' };
  if (code === 403) return { status: 'invalid', code, reason: 'vapid_rejected' };
  if (code === 413) return { status: 'error', code, reason: 'payload_too_large' };
  if (code === 429) return { status: 'error', code, reason: 'rate_limited' };
  if (code >= 500) return { status: 'error', code, reason: 'push_service_error' };
  return { status: 'error', code, reason: 'unexpected_status' };
}

export interface SendContext {
  vapid: VapidKeys;
  subject: string;
}

/**
 * Validates, encrypts and delivers one message. Never throws: every outcome
 * becomes a SendResult. Logs only the push service host and the status.
 */
export async function sendOne(message: unknown, ctx: SendContext): Promise<SendResult> {
  try {
    if (!isObject(message)) return { status: 'error', reason: 'bad_message' };
    if (typeof message.payload !== 'string') return { status: 'error', reason: 'bad_payload' };
    const payload = utf8(message.payload);
    if (payload.length > MAX_PAYLOAD_BYTES) return { status: 'error', reason: 'payload_too_large' };

    const subscription = isObject(message.subscription) ? message.subscription : {};
    const url = allowedEndpoint(subscription.endpoint);
    if (!url) return { status: 'invalid', reason: 'endpoint_not_allowed' };
    const keys = decodeKeys(subscription.keys);
    if (!keys) return { status: 'invalid', reason: 'bad_keys' };

    let body: Bytes;
    try {
      body = await encryptPayload(payload, keys.uaPublic, keys.authSecret);
    } catch {
      // p256dh had the right shape but is not a point on P-256.
      return { status: 'invalid', reason: 'bad_keys' };
    }

    const headers: Record<string, string> = {
      TTL: String(normalizeTtl(message.ttl)),
      Urgency: normalizeUrgency(message.urgency),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      Authorization: await vapidAuthorization(ctx.vapid, url.href, ctx.subject),
    };
    const topic = normalizeTopic(message.topic);
    if (topic) headers.Topic = topic;

    let response: Response;
    try {
      response = await fetch(url.href, {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
    } catch {
      console.log(`push ${url.hostname} network_error`);
      return { status: 'error', reason: 'network' };
    }
    console.log(`push ${url.hostname} ${response.status}`);
    try {
      await response.body?.cancel();
    } catch {
      // Nothing to release.
    }
    return mapStatus(response.status);
  } catch {
    return { status: 'error', reason: 'internal' };
  }
}

/** Sends a batch concurrently; one result per message, in the same order. */
export function sendAll(messages: unknown[], ctx: SendContext): Promise<SendResult[]> {
  return Promise.all(messages.map((m) => sendOne(m, ctx)));
}
