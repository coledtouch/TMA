import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { b64urlDecode, b64urlEncodeText, utf8 } from '../src/b64';
import { resetKvCache } from '../src/env';
import {
  getVapidKeys,
  JWT_LIFETIME_S,
  parseStoredKeys,
  resetVapidCache,
  vapidAuthorization,
  type StoredVapidKeys,
} from '../src/vapid';
import { b64, makeEnv, MemoryKV } from './helpers';

const SUBJECT = 'mailto:timberlanemusictma@gmail.com';
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/dQw4w9WgXcQ:APA91bHun4MxP5egoKMwt2KZFBaFUH';

function parseAuthorization(header: string): { jwt: string; k: string } {
  const match = /^vapid t=([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+), k=([A-Za-z0-9_-]+)$/.exec(header);
  if (!match) throw new Error(`unexpected Authorization header: ${header}`);
  return { jwt: match[1]!, k: match[2]! };
}

function decodeSegment(segment: string): Record<string, unknown> {
  return JSON.parse(new TextDecoder().decode(b64(segment))) as Record<string, unknown>;
}

async function verifyJwt(jwt: string, publicKey: string): Promise<boolean> {
  const [header, claims, signature] = jwt.split('.') as [string, string, string];
  const key = await crypto.subtle.importKey('raw', b64(publicKey), { name: 'ECDSA', namedCurve: 'P-256' }, false, [
    'verify',
  ]);
  const sig = b64(signature);
  expect(sig.length).toBe(64); // raw r || s, not DER
  return crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, sig, utf8(`${header}.${claims}`));
}

beforeEach(() => {
  resetKvCache();
  resetVapidCache();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('VAPID keys', () => {
  it('generates a key pair once, stores it in KV and reuses it', async () => {
    const env = makeEnv();
    const first = await getVapidKeys(env);
    const raw = env.TMA_PUSH.data.get('vapid:v1');
    expect(raw).toBeDefined();
    const stored = JSON.parse(raw!) as StoredVapidKeys;
    expect(stored.publicKey).toBe(first.publicKey);
    expect(stored.privateJwk).toMatchObject({ kty: 'EC', crv: 'P-256' });
    expect(typeof stored.privateJwk.d).toBe('string');
    expect(Number.isNaN(Date.parse(stored.createdAt))).toBe(false);
    expect(() => parseStoredKeys(raw!)).not.toThrow();

    const pub = b64urlDecode(first.publicKey)!;
    expect(pub.length).toBe(65);
    expect(pub[0]).toBe(4);
    expect(first.publicKey).not.toMatch(/[=+/]/);

    const writes = env.TMA_PUSH.writes;
    const second = await getVapidKeys(env);
    expect(second.publicKey).toBe(first.publicKey);
    expect(env.TMA_PUSH.writes).toBe(writes);
  });

  it('uses the stored pair when another isolate wrote first (race guard)', async () => {
    // The other isolate's pair, generated elsewhere.
    const otherKv = new MemoryKV();
    await getVapidKeys(makeEnv(otherKv));
    const otherRaw = otherKv.data.get('vapid:v1')!;
    resetKvCache();
    resetVapidCache();

    // Simulate the race: our put lands, then the other isolate's put overwrites it.
    const kv = new MemoryKV();
    const env = makeEnv(kv);
    const put = kv.put.bind(kv);
    kv.put = async (key, value) => {
      await put(key, value);
      kv.data.set(key, otherRaw);
    };
    const keys = await getVapidKeys(env);
    expect(keys.publicKey).toBe((JSON.parse(otherRaw) as StoredVapidKeys).publicKey);
  });
});

describe('VAPID JWT', () => {
  it('signs a verifiable ES256 JWT with aud, exp and sub', async () => {
    const env = makeEnv();
    const keys = await getVapidKeys(env);
    const now = Date.UTC(2026, 9, 21, 12, 0, 0);
    const header = await vapidAuthorization(keys, ENDPOINT, SUBJECT, now);
    const { jwt, k } = parseAuthorization(header);
    expect(k).toBe(keys.publicKey);

    const [h, c] = jwt.split('.') as [string, string];
    expect(decodeSegment(h)).toEqual({ typ: 'JWT', alg: 'ES256' });
    const claims = decodeSegment(c);
    expect(claims.aud).toBe('https://fcm.googleapis.com');
    expect(claims.sub).toBe(SUBJECT);
    expect(claims.exp).toBe(Math.floor(now / 1000) + JWT_LIFETIME_S);
    expect(JWT_LIFETIME_S).toBe(12 * 3600);

    expect(await verifyJwt(jwt, k)).toBe(true);
    // A tampered token must not verify.
    const forged = `${h}.${b64urlEncodeText(JSON.stringify({ ...claims, sub: 'mailto:x@y.z' }))}.${jwt.split('.')[2]}`;
    expect(await verifyJwt(forged, k)).toBe(false);
  });

  it('caches one JWT per origin and refreshes it when under an hour is left', async () => {
    const keys = await getVapidKeys(makeEnv());
    const t0 = Date.UTC(2026, 9, 21, 12, 0, 0);
    const a = parseAuthorization(await vapidAuthorization(keys, ENDPOINT, SUBJECT, t0)).jwt;
    const b = parseAuthorization(await vapidAuthorization(keys, `${ENDPOINT}other`, SUBJECT, t0 + 10 * 3600_000)).jwt;
    expect(b).toBe(a); // same origin, 2 h left: reused

    const mozilla = parseAuthorization(
      await vapidAuthorization(keys, 'https://updates.push.services.mozilla.com/wpush/v2/x', SUBJECT, t0),
    ).jwt;
    expect(decodeSegment(mozilla.split('.')[1]!).aud).toBe('https://updates.push.services.mozilla.com');

    const later = t0 + 11.5 * 3600_000; // 30 min left: refresh
    const c = parseAuthorization(await vapidAuthorization(keys, ENDPOINT, SUBJECT, later)).jwt;
    expect(c).not.toBe(a);
    expect(decodeSegment(c.split('.')[1]!).exp).toBe(Math.floor(later / 1000) + JWT_LIFETIME_S);
    expect(await verifyJwt(c, keys.publicKey)).toBe(true);
  });
});
