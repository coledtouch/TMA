// @vitest-environment jsdom
/**
 * The push subscription contract between the three places that check it
 * (ARCHITECTURE.md §5 push.register, §9.1, §10): the web app decides what to
 * register (lib/push.ts), Apps Script validates and stores it
 * (src/server/push-subscription.ts), and the push Worker delivers to it
 * (workers/push/src/webpush.ts). The endpoint allowlist is copied in all three,
 * so this test fails as soon as one copy drifts from the others.
 */
import { describe, expect, it } from 'vitest';
import { allowedEndpoint, decodeKeys } from '../../../workers/push/src/webpush';
import { canonicalEndpoint, parseSubscription, subscriptionEndpoint, subscriptionToken } from '../../server/push-subscription';
import { canonicalToken, isDeliverableEndpoint } from './push';

const url64 = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** Keys like a browser's PushSubscription.toJSON(): a real P-256 point and 16 random bytes. */
async function browserKeys(): Promise<{ p256dh: string; auth: string }> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  return { p256dh: url64(raw), auth: url64(crypto.getRandomValues(new Uint8Array(16))) };
}

/** Endpoints in the shape each push service hands out. */
const REAL_ENDPOINTS = [
  'https://fcm.googleapis.com/fcm/send/dXyZ123:APA91bHk-abc_DEF',
  'https://updates.push.services.mozilla.com/wpush/v2/gAAAAABk-abc_DEF',
  'https://web.push.apple.com/QGuQyavXutnMXzEwV9cK0ZTL_abc',
  'https://api.push.apple.com/3/device/abc',
  'https://wns2-by3p.notify.windows.com/w/?token=BQYAAAB%2bAbC',
];

describe('push subscription contract: web app, Apps Script and push Worker agree', () => {
  it.each([
    ...REAL_ENDPOINTS.map((endpoint) => [endpoint, true] as const),
    ['https://FCM.GoogleAPIs.com/fcm/send/x', true],
    ['https://fcm.googleapis.com', true],
    ['http://fcm.googleapis.com/fcm/send/x', false],
    ['https://fcm.googleapis.com:8443/fcm/send/x', false],
    ['https://user:pass@fcm.googleapis.com/fcm/send/x', false],
    ['https://fcm.googleapis.com.evil.example/x', false],
    ['https://evilpush.apple.com/x', false],
    ['https://push.apple.com/x', false],
    ['https://notify.windows.com/x', false],
    ['https://example.com/fcm.googleapis.com', false],
    ['https://169.254.169.254/latest', false],
    ['https://localhost/x', false],
    ['fcm.googleapis.com/fcm/send/x', false],
    [`https://fcm.googleapis.com/${'a'.repeat(2048)}`, false],
    // Not listed: an explicit ":443". URL parsers (web, Worker) drop it, Apps
    // Script (no URL parser) refuses it; browsers never write it.
  ] as const)('%s → %s everywhere', (endpoint, allowed) => {
    expect(isDeliverableEndpoint(endpoint)).toBe(allowed); // web: offered to push.register at all
    expect(canonicalEndpoint(endpoint) !== null).toBe(allowed); // Apps Script: stored
    expect(allowedEndpoint(endpoint) !== null).toBe(allowed); // Worker: delivered to
  });

  it.each(REAL_ENDPOINTS)('the token the app registers for %s is stored unchanged and deliverable', async (endpoint) => {
    const keys = await browserKeys();
    // What PushSubscription.toJSON() returns, including the field the token drops.
    const token = canonicalToken({ endpoint, expirationTime: null, keys: { auth: keys.auth, p256dh: keys.p256dh } });
    expect(token).toBe(JSON.stringify({ endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } }));

    // Apps Script's canonical form is byte for byte the app's, so the app's
    // record and the Devices row describe the same subscription.
    const parsed = parseSubscription(token);
    if (!parsed.ok) throw new Error(`push.register would refuse it: ${parsed.problem}`);
    expect(subscriptionToken(parsed.subscription)).toBe(token);
    expect(subscriptionEndpoint(token)).toBe(endpoint);

    // The Worker accepts what Apps Script hands it.
    expect(allowedEndpoint(parsed.subscription.endpoint)?.href).toBeTruthy();
    const decoded = decodeKeys(parsed.subscription.keys);
    expect(decoded?.uaPublic.length).toBe(65);
    expect(decoded?.authSecret.length).toBe(16);
  });

  it('a subscription none of them should accept is refused by all three', async () => {
    const keys = await browserKeys();
    const shortAuth = { p256dh: keys.p256dh, auth: keys.auth.slice(0, 12) };
    const endpoint = REAL_ENDPOINTS[0];
    expect(canonicalToken({ endpoint, keys: shortAuth })).toBeNull();
    expect(parseSubscription(JSON.stringify({ endpoint, keys: shortAuth })).ok).toBe(false);
    expect(decodeKeys(shortAuth)).toBeNull();
  });
});
