import { describe, expect, it } from 'vitest';
import { audienceMatches } from './prefs';
import { harness, NGUYEN, PARENT } from './test-helpers';

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
  it('registers, upserts by token, counts per email and unregisters only own tokens', () => {
    const h = harness();
    const parent = h.signIn(PARENT);
    const token = 'fcm-token-abcdefghijklmnop:APA91b';
    expect(h.ok('push.register', { token, userAgent: 'iPhone Safari' }, parent)).toEqual({ devices: 2 });
    expect(h.ok('push.register', { token }, parent)).toEqual({ devices: 2 });
    expect(h.rows('Devices').filter((r) => r.Token === token)).toHaveLength(1);

    // The same phone signs in as another parent: the token moves.
    const nguyen = h.signIn(NGUYEN);
    expect(h.ok('push.register', { token }, nguyen)).toEqual({ devices: 1 });
    expect(h.ok('me.bootstrap', {}, parent).pushTokens).toBe(1);

    // Nobody can unregister someone else's device.
    expect(h.ok('push.unregister', { token }, parent)).toEqual({ devices: 1 });
    expect(h.ok('push.unregister', { token }, nguyen)).toEqual({ devices: 0 });

    expect(h.err('push.register', { token: 'short' }, parent).code).toBe('BAD_REQUEST');
    expect(h.err('push.register', { token: 'has spaces in it but long enough' }, parent).code).toBe('BAD_REQUEST');
  });

  it('keeps at most 10 devices per email, dropping the least recently seen', () => {
    const h = harness();
    const parent = h.signIn(PARENT);
    for (let i = 0; i < 11; i++) {
      h.services.setNow(new Date(Date.UTC(2026, 9, 21, 15, i)));
      h.ok('push.register', { token: `device-token-number-${String(i).padStart(4, '0')}` }, parent);
    }
    const tokens = h.rows('Devices').filter((r) => r.Email === PARENT).map((r) => r.Token);
    expect(tokens).toHaveLength(10);
    expect(tokens).not.toContain('demo-device-parent');
    expect(tokens).not.toContain('device-token-number-0000');
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
