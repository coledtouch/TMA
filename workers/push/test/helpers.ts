// Test helpers: an in-memory KV, a fake browser (user agent) that can
// decrypt what the Worker sends, and key import helpers.
import { b64urlDecode, b64urlEncode, concat, utf8 } from '../src/b64';
import type { Bytes, Env, KVLike } from '../src/env';

export class MemoryKV implements KVLike {
  readonly data = new Map<string, string>();
  reads = 0;
  writes = 0;
  async get(key: string): Promise<string | null> {
    this.reads++;
    return this.data.get(key) ?? null;
  }
  async put(key: string, value: string): Promise<void> {
    this.writes++;
    this.data.set(key, value);
  }
}

export function makeEnv(kv: MemoryKV = new MemoryKV()): Env & { TMA_PUSH: MemoryKV } {
  return { TMA_PUSH: kv, VAPID_SUBJECT: 'mailto:timberlanemusictma@gmail.com' };
}

/** Decodes base64url that the test knows is valid. */
export function b64(value: string): Bytes {
  const bytes = b64urlDecode(value);
  if (!bytes) throw new Error(`bad base64url in test: ${value}`);
  return bytes;
}

const ECDH = { name: 'ECDH', namedCurve: 'P-256' } as const;

/** Imports a P-256 private key from its raw scalar and 65-byte public point. */
export function importEcPrivate(
  d: Uint8Array,
  publicPoint: Uint8Array,
  algorithm: 'ECDH' | 'ECDSA',
  usages: KeyUsage[],
): Promise<CryptoKey> {
  const jwk: JsonWebKey = {
    kty: 'EC',
    crv: 'P-256',
    d: b64urlEncode(d),
    x: b64urlEncode(publicPoint.subarray(1, 33)),
    y: b64urlEncode(publicPoint.subarray(33, 65)),
  };
  return crypto.subtle.importKey('jwk', jwk, { name: algorithm, namedCurve: 'P-256' }, false, usages);
}

/** A browser's push subscription keys, with the private half kept for decrypting. */
export interface FakeUserAgent {
  privateKey: CryptoKey;
  publicKey: Bytes;
  authSecret: Bytes;
  p256dh: string;
  auth: string;
}

export async function makeUserAgent(): Promise<FakeUserAgent> {
  const pair = (await crypto.subtle.generateKey(ECDH, true, ['deriveBits'])) as CryptoKeyPair;
  const publicKey = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const authSecret = crypto.getRandomValues(new Uint8Array(16));
  return {
    privateKey: pair.privateKey,
    publicKey,
    authSecret,
    p256dh: b64urlEncode(publicKey),
    auth: b64urlEncode(authSecret),
  };
}

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
 * The receiving side of RFC 8291 / RFC 8188, written independently of the
 * Worker's code: parse the header, derive the keys from the user agent's
 * private key, decrypt the single record and strip the padding delimiter.
 */
export async function decryptAsUserAgent(body: Uint8Array, ua: FakeUserAgent): Promise<string> {
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
  const salt = body.slice(0, 16);
  const rs = view.getUint32(16, false);
  const idlen = body[20]!;
  const asPublic = body.slice(21, 21 + idlen);
  const record = body.slice(21 + idlen);
  if (rs < 18 || record.length > rs) throw new Error('bad record size');
  if (idlen !== 65) throw new Error('bad keyid length');

  const asKey = await crypto.subtle.importKey('raw', asPublic, ECDH, false, []);
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey }, ua.privateKey, 256));
  const ikm = await hkdf(ua.authSecret, ecdhSecret, concat(utf8('WebPush: info\0'), ua.publicKey, asPublic), 32);
  const cek = await hkdf(salt, ikm, utf8('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, utf8('Content-Encoding: nonce\0'), 12);
  const aesKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
  const padded = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, aesKey, record));

  // Strip trailing zero padding, then require the last-record delimiter 0x02.
  let end = padded.length - 1;
  while (end >= 0 && padded[end] === 0) end--;
  if (end < 0 || padded[end] !== 0x02) throw new Error('missing last-record delimiter');
  return new TextDecoder('utf-8', { fatal: true }).decode(padded.subarray(0, end));
}

/** Reads a request body (as the mocked fetch received it) into bytes. */
export async function bodyBytes(init: RequestInit | undefined): Promise<Bytes> {
  return new Uint8Array(await new Response(init?.body ?? null).arrayBuffer());
}
