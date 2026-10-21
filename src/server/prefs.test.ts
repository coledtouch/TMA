import { describe, expect, it } from 'vitest';
import { audienceMatches } from './prefs';
import { encodeBase64UrlBytes } from './push-subscription';
import { harness, NGUYEN, PARENT, storedToken, testSubscription } from './test-helpers';

describe('audienceMatches (§6)', () => {
  const hs = ['High School'];
  it.each([
    [{ schools: [], ensembles: [] }, { schools: hs, ensembles: ['Band'] }, true], // everyone
    [{ schools: hs, ensembles: ['Chorus'] }, { schools: [], ensembles: [] }, true], // no interests = everything
    [{ schools: hs, ensembles: ['Chorus'] }, { schools: hs, ensembles: ['Chorus', 'Band'] }, true],
    [{ schools: hs, ensembles: ['Chorus'] }, { schools: hs, ensembles: ['Band'] }, false], // needs both
    [{ schools: hs, ensembles: ['Chorus'] }, { schools: hs, ensembles: [] }, false],
    [{ schools: hs, ensembles: [] }, { schools: ['high school'], ensembles: [] }, true], // case-insensitive
    [{ schools: hs, ensembles: [] }, { schools: ['Middle School'], ensembles: ['Band'] }, false],
    [{ schools: [], ensembles: ['Jazz Band'] }, { schools: [], ensembles: ['Jazz Band'] }, true],
    [{ schools: [], ensembles: ['Jazz Band'] }, { schools: hs, ensembles: [] }, false],
  ])('%j vs %j -> %s', (audience, prefs, expected) => {
    expect(audienceMatches(audience, prefs)).toBe(expected);
  });
});

describe('prefs.save', () => {
  it('sanitizes and stores prefs per email', () => {
    const h = harness();
    const token = h.signIn(PARENT);
    const { prefs } = h.ok(
      'prefs.save',
      {
        prefs: {
          channels: { push: false, email: 'yes', sms: true },
          topics: { balance: false, payments: true, reminders: true, announcements: true },
          schools: ['high school', 'Hogwarts', 'High School'],
          ensembles: ['Band', 'Kazoo'],
          smsPhone: '+1 (603) 555-0142',
        },
      },
      token,
    );
    // email 'yes' is not a boolean -> keeps the previous value; sms needs SMS_ENABLED.
    expect(prefs).toEqual({
      channels: { push: false, email: true, sms: false },
      topics: { balance: false, payments: true, reminders: true, announcements: true },
      schools: ['High School'],
      ensembles: ['Band'],
      smsPhone: '16035550142',
    });
    const row = h.rows('Preferences')[0];
    expect(row).toMatchObject({ Email: PARENT, FamilyID: 'F0001' });
    expect(JSON.parse(String(row.Prefs))).toEqual(prefs);
    expect(h.ok('me.bootstrap', {}, token).prefs).toEqual(prefs);

    // Upsert, not append.
    h.ok('prefs.save', { prefs: { smsPhone: '123' } }, token);
    expect(h.rows('Preferences')).toHaveLength(1);
    expect(h.ok('me.bootstrap', {}, token).prefs.smsPhone).toBeUndefined();
  });

  it('allows SMS only when enabled and a phone is set', () => {
    const h = harness({ settings: { SMS_ENABLED: 'TRUE' } });
    const token = h.signIn(NGUYEN);
    expect(h.ok('prefs.save', { prefs: { channels: { sms: true } } }, token).prefs.channels.sms).toBe(false);
    expect(h.ok('prefs.save', { prefs: { channels: { sms: true }, smsPhone: '603-555-0187' } }, token).prefs.channels.sms).toBe(true);
    expect(h.ok('me.bootstrap', {}, token).settings.smsEnabled).toBe(true);
  });

  it('rejects malformed input', () => {
    const h = harness();
    const token = h.signIn(PARENT);
    expect(h.err('prefs.save', {}, token).code).toBe('BAD_REQUEST');
    expect(h.err('prefs.save', { prefs: { schools: 'High School' } }, token).code).toBe('BAD_REQUEST');
  });
});

describe('push devices', () => {
  const tokensOf = (h: ReturnType<typeof harness>, email: string) =>
    h.rows('Devices').filter((r) => r.Email === email).map((r) => r.Token);

  it('registers a browser subscription in canonical form, upserts by endpoint and moves it between parents', () => {
    const h = harness();
    const parent = h.signIn(PARENT);
    const phone = testSubscription('phone-1');
    expect(h.ok('push.register', { token: JSON.stringify(phone), userAgent: 'iPhone Safari' }, parent)).toEqual({ devices: 2 });
    // Only endpoint + keys are kept (no expirationTime), in a fixed order.
    expect(tokensOf(h, PARENT)).toEqual(['demo-device-parent', storedToken(phone)]);
    expect(h.rows('Devices').at(-1)).toMatchObject({ FamilyID: 'F0001', 'User Agent': 'iPhone Safari' });

    // Same endpoint again: same row. Same endpoint with new keys (browser re-subscribed): the row's keys change.
    expect(h.ok('push.register', { token: JSON.stringify(phone) }, parent)).toEqual({ devices: 2 });
    const rekeyed = testSubscription('phone-1', { keySeed: 'new-keys' });
    expect(h.ok('push.register', { token: JSON.stringify(rekeyed) }, parent)).toEqual({ devices: 2 });
    expect(tokensOf(h, PARENT)).toEqual(['demo-device-parent', storedToken(rekeyed)]);
    expect(h.rows('Devices').filter((r) => String(r.Token).includes('device-phone-1'))).toHaveLength(1);

    // The same phone signs in as another parent: the device moves.
    const nguyen = h.signIn(NGUYEN);
    expect(h.ok('push.register', { token: JSON.stringify(rekeyed) }, nguyen)).toEqual({ devices: 1 });
    expect(h.ok('me.bootstrap', {}, parent).pushTokens).toBe(1);
    expect(h.rows('Devices').find((r) => r.Token === storedToken(rekeyed))).toMatchObject({ Email: NGUYEN, FamilyID: 'F0002' });
  });

  it('accepts standard base64 keys with padding and an upper-case host, and stores them canonically', () => {
    const h = harness();
    const parent = h.signIn(PARENT);
    const sub = testSubscription('b64', { host: 'web.push.apple.com' });
    const toStd = (b64url: string) => {
      const std = b64url.replace(/-/g, '+').replace(/_/g, '/');
      return std + '='.repeat((4 - (std.length % 4)) % 4);
    };
    const messy = {
      endpoint: ` ${sub.endpoint.replace('web.push.apple.com', 'Web.Push.Apple.COM')} `,
      keys: { p256dh: toStd(sub.keys.p256dh), auth: toStd(sub.keys.auth) },
    };
    expect(messy.keys.auth.endsWith('==')).toBe(true);
    h.ok('push.register', { token: JSON.stringify(messy) }, parent);
    expect(tokensOf(h, PARENT)).toContain(storedToken(sub));
  });

  it('accepts every push service on the Worker allowlist', () => {
    const h = harness();
    const parent = h.signIn(PARENT);
    for (const host of ['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com', 'api.push.apple.com', 'wns2-by3p.notify.windows.com']) {
      h.ok('push.register', { token: JSON.stringify(testSubscription(host, { host })) }, parent);
    }
    expect(tokensOf(h, PARENT)).toHaveLength(6);
  });

  it('rejects anything that is not a deliverable subscription', () => {
    const h = harness();
    const parent = h.signIn(PARENT);
    const sub = testSubscription('x');
    const with_ = (patch: Record<string, unknown>) => JSON.stringify({ ...sub, ...patch });
    const keys = (patch: Record<string, unknown>) => with_({ keys: { ...sub.keys, ...patch } });
    const point64 = encodeBase64UrlBytes([0x04, ...new Array<number>(63).fill(7)]);
    const compressed = encodeBase64UrlBytes([0x02, ...new Array<number>(64).fill(7)]);
    const cases: unknown[] = [
      undefined,
      '',
      '   ',
      42,
      { ...sub }, // must be JSON text
      'fcm-token-abcdefghijklmnop:APA91b', // an old Firebase token
      'demo-0123456789abcdef', // demo tokens only in demo mode
      'not json at all but long enough',
      '[1,2,3]',
      with_({ endpoint: 'http://fcm.googleapis.com/fcm/send/x' }),
      with_({ endpoint: 'https://fcm.googleapis.com:8443/fcm/send/x' }),
      with_({ endpoint: 'https://user:pw@fcm.googleapis.com/fcm/send/x' }),
      with_({ endpoint: 'https://evil.example\\@fcm.googleapis.com/x' }),
      with_({ endpoint: 'https://fcm.googleapis.com.evil.example/x' }),
      with_({ endpoint: 'https://push.apple.com/x' }), // suffix needs a label in front
      with_({ endpoint: 'https://[::1]/x' }),
      with_({ endpoint: `https://fcm.googleapis.com/${'a'.repeat(2048)}` }),
      with_({ endpoint: 'https://fcm.googleapis.com/fcm/send/has space' }),
      with_({ keys: undefined }),
      keys({ p256dh: point64 }), // 64 bytes
      keys({ p256dh: compressed }), // not an uncompressed point
      keys({ p256dh: `${sub.keys.p256dh}AAAA` }),
      keys({ p256dh: 'not*base64' }),
      keys({ auth: encodeBase64UrlBytes(new Array<number>(15).fill(1)) }),
      keys({ auth: 12345 }),
      `${JSON.stringify(sub)}${' '.repeat(4100)}`,
    ];
    for (const token of cases) {
      expect(h.err('push.register', { token }, parent).code, JSON.stringify(token)?.slice(0, 80)).toBe('BAD_REQUEST');
    }
    expect(h.err('push.register', { token: with_({ endpoint: 'https://push.example.org/x' }) }, parent).message).toMatch(/push service isn't supported/);
    expect(tokensOf(h, PARENT)).toEqual(['demo-device-parent']);
  });

  it('accepts demo- tokens in demo mode only', () => {
    const h = harness({ mode: 'demo' });
    const parent = h.signIn(PARENT);
    expect(h.ok('push.register', { token: 'demo-5f0c3a52-4f7e-4c8e-9a51-0b8f6b8f3c11' }, parent)).toEqual({ devices: 2 });
    expect(h.ok('push.unregister', { token: 'demo-5f0c3a52-4f7e-4c8e-9a51-0b8f6b8f3c11' }, parent)).toEqual({ devices: 1 });
    expect(h.err('push.register', { token: 'demo-x' }, parent).code).toBe('BAD_REQUEST');
    // Real subscriptions still work in the demo.
    expect(h.ok('push.register', { token: JSON.stringify(testSubscription('d')) }, parent)).toEqual({ devices: 2 });
  });

  it('unregisters by endpoint (stored token or the browser JSON), only the caller’s own rows', () => {
    const h = harness();
    const parent = h.signIn(PARENT);
    const nguyen = h.signIn(NGUYEN);
    const mine = testSubscription('mine');
    const theirs = testSubscription('theirs');
    h.ok('push.register', { token: JSON.stringify(mine) }, parent);
    h.ok('push.register', { token: JSON.stringify(theirs) }, nguyen);

    // Nobody can unregister someone else's device.
    expect(h.ok('push.unregister', { token: JSON.stringify(theirs) }, parent)).toEqual({ devices: 2 });
    expect(tokensOf(h, NGUYEN)).toEqual([storedToken(theirs)]);

    // The browser's raw JSON (with other keys and expirationTime) matches by endpoint.
    const sameEndpoint = testSubscription('mine', { keySeed: 'rotated' });
    expect(h.ok('push.unregister', { token: JSON.stringify(sameEndpoint) }, parent)).toEqual({ devices: 1 });
    expect(h.ok('push.unregister', { token: storedToken(theirs) }, nguyen)).toEqual({ devices: 0 });

    for (const token of [undefined, '', 'nope', 'demo-0123456789abcdef', JSON.stringify({ endpoint: 'https://evil.example/x' })]) {
      expect(h.err('push.unregister', { token }, parent).code).toBe('BAD_REQUEST');
    }
  });

  it('keeps at most 10 devices per email, dropping the least recently seen', () => {
    const h = harness();
    const parent = h.signIn(PARENT);
    for (let i = 0; i < 11; i++) {
      h.services.setNow(new Date(Date.UTC(2026, 9, 21, 15, i)));
      h.ok('push.register', { token: JSON.stringify(testSubscription(`n${i}`)) }, parent);
    }
    const tokens = tokensOf(h, PARENT);
    expect(tokens).toHaveLength(10);
    expect(tokens).not.toContain('demo-device-parent');
    expect(tokens).not.toContain(storedToken(testSubscription('n0')));
    expect(tokens).toContain(storedToken(testSubscription('n10')));
    // Re-registering a kept device doesn't count as new.
    expect(h.ok('push.register', { token: JSON.stringify(testSubscription('n1')) }, parent)).toEqual({ devices: 10 });
  });

  it('sends a test push to the caller’s devices only', () => {
    const h = harness();
    const parent = h.signIn(PARENT);
    h.ok('prefs.save', { prefs: { channels: { push: false, email: false, sms: false } } }, parent);
    h.clearOutbox();
    expect(h.ok('push.test', {}, parent)).toEqual({ push: 1, email: 0, sms: 0 });
    expect(h.services.outbox.push[0]).toEqual({
      tokens: ['demo-device-parent'],
      message: { title: 'Test notification ✅', body: 'Notifications are working on this device.', url: '#/', tag: 'test', topic: 'test' },
    });
    expect(h.ok('push.test', {}, h.signIn(NGUYEN))).toEqual({ push: 0, email: 0, sms: 0 });
  });
});
