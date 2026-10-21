import { describe, expect, it } from 'vitest';
import { KNOWN_EMAIL_CODE_RESERVE, NEW_EMAIL_CODES_PER_HOUR } from './auth';
import { base64UrlDecode, base64UrlEncode } from './util';
import { harness, NGUYEN, PARENT, TEST_NOW, TEST_SECRET } from './test-helpers';
import { hmacSha256Hex } from './sha256';

function lastCode(h: ReturnType<typeof harness>, email: string): string {
  const mail = h.services.outbox.mail.filter((m) => m.to === email).pop();
  const code = /(\d{6})/.exec(mail?.subject ?? '')?.[1];
  if (!code) throw new Error('no code mailed');
  return code;
}

describe('auth.requestCode', () => {
  it('emails a 6-digit code and always answers {sent:true}', () => {
    const h = harness();
    expect(h.ok('auth.requestCode', { email: '  Parent@Example.com ' })).toEqual({ sent: true });
    const mail = h.services.outbox.mail[0];
    expect(mail.to).toBe(PARENT);
    expect(mail.subject).toMatch(/^Your TMA sign-in code: \d{6}$/);
    expect(mail.html).toContain(lastCode(h, PARENT));
    expect(mail.text).toContain(lastCode(h, PARENT));

    // Unknown emails get the same answer (anyone may sign up).
    expect(h.ok('auth.requestCode', { email: 'stranger@example.org' })).toEqual({ sent: true });
  });

  it('returns devCode and skips email in demo mode', () => {
    const h = harness({ mode: 'demo' });
    const res = h.ok('auth.requestCode', { email: PARENT });
    expect(res.devCode).toMatch(/^\d{6}$/);
    expect(h.services.outbox.mail).toHaveLength(0);
  });

  it('rejects malformed emails', () => {
    const h = harness();
    expect(h.err('auth.requestCode', { email: 'not-an-email' }).code).toBe('BAD_REQUEST');
    expect(h.err('auth.requestCode', { email: 42 }).code).toBe('BAD_REQUEST');
    expect(h.err('auth.requestCode', {}).code).toBe('BAD_REQUEST');
  });

  it('allows 5 codes per email per hour', () => {
    const h = harness();
    for (let i = 0; i < 5; i++) h.ok('auth.requestCode', { email: PARENT });
    expect(h.err('auth.requestCode', { email: PARENT }).code).toBe('RATE_LIMITED');
    // Other emails are unaffected; an hour later it works again.
    h.ok('auth.requestCode', { email: NGUYEN });
    h.services.setNow(new Date(TEST_NOW.getTime() + 3601 * 1000));
    h.ok('auth.requestCode', { email: PARENT });
  });

  it('answers NOT_CONFIGURED without a TOKEN_SECRET', () => {
    const h = harness({ secrets: {} });
    h.services.secrets.set('TOKEN_SECRET', '');
    expect(h.err('auth.requestCode', { email: PARENT }).code).toBe('NOT_CONFIGURED');
    expect(h.err('me.bootstrap', {}, 'x.y').code).toBe('NOT_CONFIGURED');
  });

  it('refuses politely when the daily email quota is used up', () => {
    const h = harness({ mailQuota: 0 });
    expect(h.err('auth.requestCode', { email: PARENT }).code).toBe('RATE_LIMITED');
  });

  it('keeps sign-in working for families on the sheet when made-up addresses flood it', () => {
    const h = harness({ mailQuota: 100 });
    // Anyone can ask for codes for throwaway addresses; only NEW_EMAIL_CODES_PER_HOUR an hour go out.
    for (let i = 0; i < NEW_EMAIL_CODES_PER_HOUR; i++) h.ok('auth.requestCode', { email: `x${i}@throwaway.example` });
    expect(h.err('auth.requestCode', { email: 'one.more@throwaway.example' })).toMatchObject({
      code: 'RATE_LIMITED',
      message: expect.stringMatching(/new sign-ups are paused/),
    });
    expect(h.rows('Log').filter((r) => r.Kind === 'auth').map((r) => r.Detail)).toEqual([expect.stringMatching(/more than 30 in an hour/)]);
    // Known emails (guardians on the sheet, admins) are not affected.
    h.ok('auth.requestCode', { email: PARENT });
    h.ok('auth.requestCode', { email: 'treasurer@example.com' });

    // Hours later the flood resumes, but stops while KNOWN_EMAIL_CODE_RESERVE emails remain.
    let sent = 0;
    for (let hour = 1; hour <= 4; hour++) {
      h.services.setNow(new Date(TEST_NOW.getTime() + hour * 3601 * 1000));
      for (let i = 0; i < NEW_EMAIL_CODES_PER_HOUR; i++) {
        if (h.call('auth.requestCode', { email: `y${hour}-${i}@throwaway.example` }).ok) sent++;
      }
    }
    expect(h.services.mailer.remainingQuota()).toBe(KNOWN_EMAIL_CODE_RESERVE);
    expect(sent).toBe(100 - NEW_EMAIL_CODES_PER_HOUR - 2 - KNOWN_EMAIL_CODE_RESERVE);
    // Families on the sheet can still sign in with the reserve.
    h.signIn(NGUYEN);
  });

  it('does not replace a code already emailed when it refuses to send a new one', () => {
    const h = harness();
    h.ok('auth.requestCode', { email: PARENT });
    const code = lastCode(h, PARENT);
    h.services.mailer.remainingQuota = () => 0;
    expect(h.err('auth.requestCode', { email: PARENT }).code).toBe('RATE_LIMITED');
    expect(h.ok('auth.verifyCode', { email: PARENT, code }).token).toMatch(/\./);
  });
});

describe('auth.verifyCode', () => {
  it('signs in with the emailed code, once', () => {
    const h = harness();
    h.ok('auth.requestCode', { email: PARENT });
    const code = lastCode(h, PARENT);
    const res = h.ok('auth.verifyCode', { email: 'PARENT@example.com', code: ` ${code} ` });
    expect(res.token).toMatch(/^[A-Za-z0-9_-]+\.[0-9a-f]{64}$/);
    expect(res.expiresAt).toBe(new Date(TEST_NOW.getTime() + 120 * 86400 * 1000).toISOString());
    expect(h.ok('me.bootstrap', {}, res.token).me.email).toBe(PARENT);
    // The code is single-use.
    expect(h.err('auth.verifyCode', { email: PARENT, code }).code).toBe('UNAUTHORIZED');
  });

  it('allows at most 5 attempts per issued code', () => {
    const h = harness();
    h.ok('auth.requestCode', { email: PARENT });
    const code = lastCode(h, PARENT);
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) {
      expect(h.err('auth.verifyCode', { email: PARENT, code: wrong }).code).toBe('UNAUTHORIZED');
    }
    // Even the right code no longer works.
    expect(h.err('auth.verifyCode', { email: PARENT, code }).message).toMatch(/request a new code|expired/i);
  });

  it('expires codes after 10 minutes', () => {
    const h = harness();
    h.ok('auth.requestCode', { email: PARENT });
    const code = lastCode(h, PARENT);
    h.services.setNow(new Date(TEST_NOW.getTime() + 601 * 1000));
    expect(h.err('auth.verifyCode', { email: PARENT, code }).message).toMatch(/expired/);
  });

  it('does not accept a code issued to another email', () => {
    const h = harness();
    h.ok('auth.requestCode', { email: PARENT });
    const code = lastCode(h, PARENT);
    h.ok('auth.requestCode', { email: NGUYEN });
    const res = h.call('auth.verifyCode', { email: NGUYEN, code });
    if (lastCode(h, NGUYEN) !== code) expect(res.ok).toBe(false);
  });

  it('validates the code format', () => {
    const h = harness();
    expect(h.err('auth.verifyCode', { email: PARENT, code: '12345' }).code).toBe('BAD_REQUEST');
    expect(h.err('auth.verifyCode', { email: PARENT, code: 'abcdef' }).code).toBe('BAD_REQUEST');
  });
});

describe('session tokens', () => {
  it('requires a token for everything except auth.*', () => {
    const h = harness();
    expect(h.err('me.bootstrap', {}).code).toBe('UNAUTHORIZED');
    expect(h.err('me.bootstrap', {}, '').code).toBe('UNAUTHORIZED');
    expect(h.err('admin.overview', {}, 'garbage').code).toBe('UNAUTHORIZED');
  });

  it('rejects tampered tokens', () => {
    const h = harness();
    const token = h.signIn(PARENT);
    const [payload, sig] = token.split('.');
    const claims = JSON.parse(base64UrlDecode(payload) ?? '{}') as { e: string };
    claims.e = 'treasurer@example.com';
    const forged = `${base64UrlEncode(JSON.stringify(claims))}.${sig}`;
    expect(h.err('me.bootstrap', {}, forged).code).toBe('UNAUTHORIZED');
    const flipped = token.slice(0, -1) + (token.endsWith('0') ? '1' : '0');
    expect(h.err('me.bootstrap', {}, flipped).code).toBe('UNAUTHORIZED');
    expect(h.err('me.bootstrap', {}, `${token}.extra`).code).toBe('UNAUTHORIZED');
    expect(h.err('me.bootstrap', {}, 'x'.repeat(5000)).code).toBe('UNAUTHORIZED');
  });

  it('rejects tokens signed with another secret even when well-formed', () => {
    const h = harness();
    const payload = base64UrlEncode(JSON.stringify({ e: PARENT, v: '1', x: TEST_NOW.getTime() / 1000 + 3600 }));
    const good = `${payload}.${hmacSha256Hex(TEST_SECRET, payload)}`;
    expect(h.ok('me.bootstrap', {}, good).me.email).toBe(PARENT);
    expect(h.err('me.bootstrap', {}, `${payload}.${hmacSha256Hex('other-secret', payload)}`).code).toBe('UNAUTHORIZED');
  });

  it('expires sessions after SESSION_DAYS', () => {
    const h = harness({ settings: { SESSION_DAYS: '2' } });
    const token = h.signIn(PARENT);
    h.services.setNow(new Date(TEST_NOW.getTime() + 2 * 86400 * 1000 - 1000));
    expect(h.call('me.bootstrap', {}, token).ok).toBe(true);
    h.services.setNow(new Date(TEST_NOW.getTime() + 2 * 86400 * 1000 + 1000));
    expect(h.err('me.bootstrap', {}, token).message).toMatch(/expired/);
  });

  it('signs everyone out when TOKEN_VERSION changes', () => {
    const h = harness();
    const token = h.signIn(PARENT);
    expect(h.call('me.bootstrap', {}, token).ok).toBe(true);
    h.setSetting('TOKEN_VERSION', '2');
    expect(h.err('me.bootstrap', {}, token).code).toBe('UNAUTHORIZED');
    const fresh = h.signIn(PARENT);
    expect(h.call('me.bootstrap', {}, fresh).ok).toBe(true);
  });

  it('looks up admin status on every request', () => {
    const h = harness();
    const token = h.signIn(PARENT);
    expect(h.err('admin.overview', {}, token).code).toBe('FORBIDDEN');
    h.setSetting('ADMIN_EMAILS', `treasurer@example.com, ${PARENT}`);
    expect(h.call('admin.overview', {}, token).ok).toBe(true);
  });
});

describe('router', () => {
  it('never throws and answers BAD_REQUEST for unknown or malformed requests', () => {
    const h = harness();
    const token = h.signIn(PARENT);
    expect(h.err('nope' as never, {}, token).code).toBe('BAD_REQUEST');
    expect(h.err('constructor' as never, {}, token).code).toBe('BAD_REQUEST');
    expect(h.err('__proto__' as never, {}, token).code).toBe('BAD_REQUEST');
    expect(h.app.handle(null as never)).toMatchObject({ ok: false, error: { code: 'BAD_REQUEST' } });
    expect(h.app.handle({ action: 'me.bootstrap', params: [] } as never)).toMatchObject({ ok: false });
  });

  it('turns unexpected exceptions into a generic INTERNAL error', () => {
    const h = harness();
    const token = h.signIn(PARENT);
    h.services.store.read = () => {
      throw new Error('Sheets exploded: secret detail');
    };
    const res = h.call('me.bootstrap', {}, token);
    expect(res).toEqual({ ok: false, error: { code: 'INTERNAL', message: 'Something went wrong. Please try again.' } });
    expect(h.services.logs.some((l) => l.level === 'error')).toBe(true);
  });
});
