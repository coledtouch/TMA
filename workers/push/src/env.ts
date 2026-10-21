// Minimal types for the Worker's bindings. We deliberately do not depend on
// @cloudflare/workers-types: the Worker only needs get/put on one KV namespace.

/** The part of a Workers KV namespace this Worker uses. */
export interface KVLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
}

/** An address with an optional display name, as Cloudflare Email Sending takes it. */
export interface EmailAddressLike {
  email: string;
  name?: string;
}

/** The part of a Cloudflare Email Sending message this Worker builds (one recipient, no attachments). */
export interface OutgoingEmail {
  from: EmailAddressLike;
  to: string;
  subject: string;
  html?: string;
  text?: string;
  replyTo?: string;
}

/**
 * The `send_email` binding (Cloudflare Email Service, Email Sending). It
 * throws an Error with a string `code` such as "E_SENDER_NOT_VERIFIED".
 */
export interface EmailBinding {
  send(message: OutgoingEmail): Promise<{ messageId: string }>;
}

/** Bindings declared in wrangler.toml. */
export interface Env {
  /** KV namespace holding the VAPID key pair and the relay secret hash. */
  TMA_PUSH: KVLike;
  /** VAPID "sub" claim, e.g. "mailto:someone@example.org". */
  VAPID_SUBJECT?: string;
  /** Email Sending binding ([[send_email]] name = "EMAIL"). Missing until it is configured. */
  EMAIL?: EmailBinding;
  /** Sender address of every email (default "noreply@mytma.org"). Never taken from a request. */
  EMAIL_FROM?: string;
  /** Sender display name (default "Timberlane Music Association"). */
  EMAIL_FROM_NAME?: string;
}

/** Byte array backed by a plain ArrayBuffer (what WebCrypto accepts). */
export type Bytes = Uint8Array<ArrayBuffer>;

/** KV key of the VAPID key pair: JSON {publicKey, privateJwk, createdAt}. */
export const KV_VAPID = 'vapid:v1';
/** KV key of the lowercase hex SHA-256 of the relay secret. */
export const KV_SECRET = 'relay:secret-sha256';

// ---------------------------------------------------------------------------
// Per-isolate KV cache.
//
// The free plan allows 100k KV reads a day, and the two values we store
// almost never change, so each isolate keeps what it read in module scope.
// Positive values are trusted for KV_TTL_MS; "missing" only for
// KV_NEGATIVE_TTL_MS so a fresh registration is seen quickly. Callers that
// are about to reject a request (wrong secret) re-read with a short max age,
// so deleting the keys to rotate them takes effect without waiting.
// ---------------------------------------------------------------------------

export const KV_TTL_MS = 5 * 60_000;
export const KV_NEGATIVE_TTL_MS = 10_000;
/** Max age used when re-checking before a rejection (rate-limits KV reads). */
export const KV_RECHECK_MS = 10_000;

interface CacheEntry {
  value: string | null;
  at: number;
}

const kvCache = new Map<string, CacheEntry>();

/** Reads a KV value, served from the isolate cache when fresh enough. */
export async function kvGet(env: Env, key: string, maxAgeMs: number = KV_TTL_MS): Promise<string | null> {
  const now = Date.now();
  const hit = kvCache.get(key);
  if (hit) {
    const limit = hit.value === null ? Math.min(maxAgeMs, KV_NEGATIVE_TTL_MS) : maxAgeMs;
    if (now - hit.at < limit) return hit.value;
  }
  return kvRead(env, key);
}

/** Reads a KV value straight from KV (bypassing the cache) and caches it. */
export async function kvRead(env: Env, key: string): Promise<string | null> {
  const value = await env.TMA_PUSH.get(key);
  kvCache.set(key, { value, at: Date.now() });
  return value;
}

/** Writes a KV value and caches it. */
export async function kvPut(env: Env, key: string, value: string): Promise<void> {
  await env.TMA_PUSH.put(key, value);
  kvCache.set(key, { value, at: Date.now() });
}

/** Test hook: forget everything this isolate cached from KV. */
export function resetKvCache(): void {
  kvCache.clear();
}
