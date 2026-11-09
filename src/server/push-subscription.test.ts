import { describe, expect, it } from 'vitest';
import {
  canonicalEndpoint,
  canonicalP256Key,
  decodeBase64UrlBytes,
  encodeBase64UrlBytes,
  isPushServiceHost,
  parseSubscription,
  subscriptionEndpoint,
  subscriptionToken,
  toSubscription,
} from './push-subscription';
import { storedToken, testSubscription } from './test-helpers';

// Web-standard reference implementations (no Node types in this tsconfig).
const randomBytes = (n: number): number[] => Array.from(crypto.getRandomValues(new Uint8Array(n)));
const std64 = (bytes: readonly number[]): string => btoa(String.fromCharCode(...bytes));
const url64 = (bytes: readonly number[]): string => std64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

describe('base64url bytes', () => {
  it('round-trips random bytes of every length mod 3, matching Node', () => {
    for (let n = 0; n < 70; n++) {
      const bytes = randomBytes(n);
      const encoded = encodeBase64UrlBytes(bytes);
      expect(encoded).toBe(url64(bytes));
      expect(decodeBase64UrlBytes(encoded)).toEqual(bytes);
      // Standard base64 with padding decodes to the same bytes.
      expect(decodeBase64UrlBytes(std64(bytes))).toEqual(bytes);
    }
  });

  it('rejects bad characters, impossible lengths and extra padding', () => {
    expect(decodeBase64UrlBytes('ab*d')).toBeNull();
    expect(decodeBase64UrlBytes('abcde')).toBeNull(); // length % 4 == 1
    expect(decodeBase64UrlBytes('ab===')).toBeNull();
    expect(decodeBase64UrlBytes('a=bc')).toBeNull();
    expect(decodeBase64UrlBytes('é')).toBeNull();
    expect(decodeBase64UrlBytes('')).toEqual([]);
  });
});

describe('canonicalP256Key', () => {
  const point = [0x04, ...randomBytes(64)];
  it('accepts a 65-byte uncompressed point in any base64 flavor and returns base64url', () => {
    const b64url = url64(point);
    expect(canonicalP256Key(b64url)).toBe(b64url);
    expect(canonicalP256Key(` ${std64(point)} `)).toBe(b64url);
  });

  it('rejects other lengths, compressed points, junk and non-strings', () => {
    expect(canonicalP256Key(url64(point.slice(0, 64)))).toBeNull();
    expect(canonicalP256Key(url64([0x02, ...point.slice(1)]))).toBeNull();
    expect(canonicalP256Key(`${url64(point)}AAAA`)).toBeNull();
    expect(canonicalP256Key('')).toBeNull();
    expect(canonicalP256Key(null)).toBeNull();
    expect(canonicalP256Key(65)).toBeNull();
  });
});

describe('push service hosts', () => {
  it.each([
    ['fcm.googleapis.com', true],
    ['FCM.GoogleAPIs.com', true],
    ['updates.push.services.mozilla.com', true],
    ['web.push.apple.com', true],
    ['api.push.apple.com', true],
    ['api.sandbox.push.apple.com', true],
    ['db5p.notify.windows.com', true],
    ['push.apple.com', false],
    ['notify.windows.com', false],
    ['evilpush.apple.com', false],
    ['fcm.googleapis.com.evil.example', false],
    ['googleapis.com', false],
    ['localhost', false],
    ['169.254.169.254', false],
    ['a..push.apple.com', false],
    ['-x.push.apple.com', false],
  ])('%s -> %s', (host, allowed) => {
    expect(isPushServiceHost(host)).toBe(allowed);
  });

  it('canonicalEndpoint lower-cases the host and keeps the path', () => {
    expect(canonicalEndpoint(' https://Web.Push.Apple.com/QGuQyavXut0kZ1D1?x=1 ')).toBe('https://web.push.apple.com/QGuQyavXut0kZ1D1?x=1');
    expect(canonicalEndpoint('https://fcm.googleapis.com')).toBe('https://fcm.googleapis.com');
    expect(canonicalEndpoint('https://fcm.googleapis.com:443/x')).toBeNull();
    expect(canonicalEndpoint('https://fcm.googleapis.com\\@evil.example/')).toBeNull();
    expect(canonicalEndpoint('https://fcm.googleapis.com/aé')).toBeNull();
    expect(canonicalEndpoint('HTTPS://fcm.googleapis.com/x')).toBeNull();
    expect(canonicalEndpoint(42)).toBeNull();
  });
});

describe('parseSubscription', () => {
  it('returns the canonical subscription and token for browser JSON', () => {
    const sub = testSubscription('a');
    const parsed = parseSubscription(JSON.stringify(sub));
    expect(parsed).toEqual({ ok: true, subscription: { endpoint: sub.endpoint, keys: sub.keys } });
    expect(subscriptionToken(toSubscription(JSON.stringify(sub))!)).toBe(storedToken(sub));
    // Objects work too, and the canonical token parses to itself.
    expect(toSubscription(sub)).toEqual({ endpoint: sub.endpoint, keys: sub.keys });
    expect(subscriptionToken(toSubscription(storedToken(sub))!)).toBe(storedToken(sub));
  });

  it('names the problem', () => {
    const sub = testSubscription('a');
    expect(parseSubscription('demo-123')).toEqual({ ok: false, problem: 'format' });
    expect(parseSubscription('{"endpoint":')).toEqual({ ok: false, problem: 'format' });
    expect(parseSubscription('null')).toEqual({ ok: false, problem: 'format' });
    expect(parseSubscription(JSON.stringify({ ...sub, endpoint: 'ftp://x' }))).toEqual({ ok: false, problem: 'endpoint' });
    expect(parseSubscription(JSON.stringify({ ...sub, endpoint: 'https://push.example.org/x' }))).toEqual({ ok: false, problem: 'push_service' });
    expect(parseSubscription(JSON.stringify({ endpoint: sub.endpoint }))).toEqual({ ok: false, problem: 'keys' });
    expect(parseSubscription(JSON.stringify({ ...sub, keys: { p256dh: sub.keys.p256dh } }))).toEqual({ ok: false, problem: 'keys' });
    expect(parseSubscription(`{"endpoint":"${sub.endpoint}","pad":"${'x'.repeat(5000)}"}`)).toEqual({ ok: false, problem: 'format' });
  });

  it('subscriptionEndpoint reads the endpoint without checking keys', () => {
    expect(subscriptionEndpoint(JSON.stringify({ endpoint: 'https://FCM.googleapis.com/fcm/send/z' }))).toBe('https://fcm.googleapis.com/fcm/send/z');
    expect(subscriptionEndpoint(JSON.stringify({ endpoint: 'https://evil.example/z' }))).toBeNull();
    expect(subscriptionEndpoint('demo-device-parent')).toBeNull();
    expect(subscriptionEndpoint('')).toBeNull();
  });
});
