// VAPID (RFC 8292): the Worker's P-256 signing key pair and the ES256 JWT
// that identifies it to push services.
//
// The key pair is generated on first use and stored in KV as
// "vapid:v1" = {"publicKey": <b64url raw point>, "privateJwk": <JWK>, "createdAt": <ISO>}.
// Each isolate imports the private key once and caches one JWT per push
// service origin for up to 12 hours.
import { b64urlDecode, b64urlEncode, b64urlEncodeText, utf8 } from './b64';
import { KV_VAPID, kvGet, kvPut, kvRead, type Env } from './env';

/** Default VAPID subject if the wrangler var is missing. */
export const DEFAULT_SUBJECT = 'mailto:timberlanemusictma@gmail.com';
/** JWT lifetime. RFC 8292 caps it at 24 hours; services prefer less. */
export const JWT_LIFETIME_S = 12 * 60 * 60;
/** Mint a new JWT when the cached one has less than this left. */
export const JWT_REFRESH_S = 60 * 60;

const EC_SIGN = { name: 'ECDSA', namedCurve: 'P-256' } as const;
const ES256 = { name: 'ECDSA', hash: 'SHA-256' } as const;

/** What KV stores under "vapid:v1". */
export interface StoredVapidKeys {
  publicKey: string;
  privateJwk: JsonWebKey;
  createdAt: string;
}

/** The imported key pair, ready to sign. */
export interface VapidKeys {
  /** base64url (no padding) of the 65-byte uncompressed public point. */
  publicKey: string;
  privateKey: CryptoKey;
}

// Per-isolate caches.
let keyCache: { source: string; keys: VapidKeys } | null = null;
const jwtCache = new Map<string, { token: string; exp: number }>();
const JWT_CACHE_MAX = 64;

/** Test hook: forget the imported key and every cached JWT. */
export function resetVapidCache(): void {
  keyCache = null;
  jwtCache.clear();
}

/** Parses and sanity-checks the stored JSON. Throws if it is unusable. */
export function parseStoredKeys(raw: string): StoredVapidKeys {
  const parsed = JSON.parse(raw) as Partial<StoredVapidKeys> | null;
  const pub = typeof parsed?.publicKey === 'string' ? b64urlDecode(parsed.publicKey) : null;
  if (!parsed || !pub || pub.length !== 65 || pub[0] !== 0x04 || typeof parsed.privateJwk !== 'object') {
    throw new Error('Stored VAPID keys are malformed');
  }
  return parsed as StoredVapidKeys;
}

/** Creates a fresh P-256 key pair in the stored format. */
export async function generateVapidKeys(): Promise<StoredVapidKeys> {
  const pair = (await crypto.subtle.generateKey(EC_SIGN, true, ['sign', 'verify'])) as CryptoKeyPair;
  const rawPublic = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const privateJwk: JsonWebKey = { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, d: jwk.d };
  return { publicKey: b64urlEncode(rawPublic), privateJwk, createdAt: new Date().toISOString() };
}

/** Whether a key pair is stored (cached read). */
export async function hasVapidKeys(env: Env): Promise<boolean> {
  return (await kvGet(env, KV_VAPID)) !== null;
}

/**
 * Returns the stored key pair, generating and storing one on first use.
 * Two isolates can race to create it; after writing, we read KV again and
 * use whatever is stored there so everyone converges on one pair.
 */
export async function getVapidKeys(env: Env): Promise<VapidKeys> {
  let raw = await kvGet(env, KV_VAPID);
  if (raw === null) raw = await kvRead(env, KV_VAPID); // the cached "missing" may be stale
  if (raw === null) {
    const fresh = await generateVapidKeys();
    await kvPut(env, KV_VAPID, JSON.stringify(fresh));
    raw = (await kvRead(env, KV_VAPID)) ?? JSON.stringify(fresh);
  }
  if (keyCache && keyCache.source === raw) return keyCache.keys;

  const stored = parseStoredKeys(raw);
  const privateKey = await crypto.subtle.importKey('jwk', stored.privateJwk, EC_SIGN, false, ['sign']);
  const keys: VapidKeys = { publicKey: stored.publicKey, privateKey };
  keyCache = { source: raw, keys };
  jwtCache.clear(); // tokens signed by a previous key are useless now
  return keys;
}

/** Signs a VAPID JWT for one push service origin. */
export async function signVapidJwt(
  keys: VapidKeys,
  audience: string,
  subject: string,
  expiresAt: number,
): Promise<string> {
  const header = b64urlEncodeText(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const claims = b64urlEncodeText(JSON.stringify({ aud: audience, exp: expiresAt, sub: subject }));
  const signingInput = `${header}.${claims}`;
  // WebCrypto ECDSA signatures are already the raw r || s form JWS wants.
  const signature = new Uint8Array(await crypto.subtle.sign(ES256, keys.privateKey, utf8(signingInput)));
  return `${signingInput}.${b64urlEncode(signature)}`;
}

/**
 * The Authorization header value for a push endpoint:
 * "vapid t=<jwt>, k=<public key>". The JWT is cached per audience origin.
 */
export async function vapidAuthorization(
  keys: VapidKeys,
  endpoint: string,
  subject: string,
  nowMs: number = Date.now(),
): Promise<string> {
  const audience = new URL(endpoint).origin;
  const now = Math.floor(nowMs / 1000);
  const cacheKey = `${keys.publicKey}|${subject}|${audience}`;
  let entry = jwtCache.get(cacheKey);
  if (!entry || entry.exp - now < JWT_REFRESH_S) {
    const exp = now + JWT_LIFETIME_S;
    entry = { token: await signVapidJwt(keys, audience, subject, exp), exp };
    if (jwtCache.size >= JWT_CACHE_MAX) jwtCache.clear();
    jwtCache.set(cacheKey, entry);
  }
  return `vapid t=${entry.token}, k=${keys.publicKey}`;
}
