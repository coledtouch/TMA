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

// Per-isolate caches. A JWT entry holds the signing promise until it settles
// (then the plain token), so the up to 10 messages of a batch that miss the
// cache together (cold isolate, or the refresh point) share one signature.
interface JwtEntry {
  token: string | Promise<string>;
  exp: number;
}
let keyCache: { source: string; keys: VapidKeys } | null = null;
const jwtCache = new Map<string, JwtEntry>();
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

/** The stored JSON, re-reading KV when this isolate's cached "missing" may be stale. */
async function readStoredKeys(env: Env): Promise<string | null> {
  return (await kvGet(env, KV_VAPID)) ?? kvRead(env, KV_VAPID);
}

/** Imports the stored key pair, once per isolate per stored value. */
async function importStoredKeys(raw: string): Promise<VapidKeys> {
  if (keyCache && keyCache.source === raw) return keyCache.keys;
  const stored = parseStoredKeys(raw);
  const privateKey = await crypto.subtle.importKey('jwk', stored.privateJwk, EC_SIGN, false, ['sign']);
  const keys: VapidKeys = { publicKey: stored.publicKey, privateKey };
  keyCache = { source: raw, keys };
  jwtCache.clear(); // tokens signed by a previous key are useless now
  return keys;
}

/**
 * Returns the stored key pair, or null if none is stored. Never creates one:
 * /send uses this, because a key minted there could not match any
 * subscription and would overwrite the published key (KV's last write wins,
 * and a location can read "missing" for up to a minute after the first put).
 */
export async function loadVapidKeys(env: Env): Promise<VapidKeys | null> {
  const raw = await readStoredKeys(env);
  return raw === null ? null : importStoredKeys(raw);
}

/**
 * Returns the stored key pair, generating and storing one on first use (only
 * GET /vapid-public-key calls this). Two isolates can race to create it;
 * after writing, we read KV again and use whatever is stored there so
 * everyone converges on one pair.
 */
export async function getVapidKeys(env: Env): Promise<VapidKeys> {
  let raw = await readStoredKeys(env);
  if (raw === null) {
    const fresh = await generateVapidKeys();
    await kvPut(env, KV_VAPID, JSON.stringify(fresh));
    raw = (await kvRead(env, KV_VAPID)) ?? JSON.stringify(fresh);
  }
  return importStoredKeys(raw);
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
    const pending = signVapidJwt(keys, audience, subject, exp);
    const fresh: JwtEntry = { token: pending, exp };
    // Store before awaiting so concurrent callers for this origin reuse it.
    if (jwtCache.size >= JWT_CACHE_MAX) jwtCache.clear();
    jwtCache.set(cacheKey, fresh);
    pending.then(
      (token) => {
        fresh.token = token; // keep only the string once signed
      },
      () => {
        // A failed signature must not stay cached; every waiting caller still sees the error.
        if (jwtCache.get(cacheKey) === fresh) jwtCache.delete(cacheKey);
      },
    );
    entry = fresh;
  }
  return `vapid t=${await entry.token}, k=${keys.publicKey}`;
}
