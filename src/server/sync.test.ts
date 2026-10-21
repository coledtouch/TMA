import { describe, expect, it } from 'vitest';
import { SIGN_IN_EMAIL_RESERVE } from './notify';
import type { PushSender } from './services';
import { harness, NGUYEN, PARENT, PARENT2, storedToken, TEST_NOW, testSubscription } from './test-helpers';

const credit = (studentId: string, amount: number, description = 'Fall Fruit sale') => ({
  Date: '2026-10-21',
  StudentID: studentId,
  Type: 'Fundraiser',
  Description: description,
  Amount: amount,
});

describe('syncTick: balance changes', () => {
  it('first run only writes the snapshot', () => {
    const h = harness({ tables: { _Snapshot: [] } });
    const report = h.app.syncTick();
    expect(report).toMatchObject({ balanceChanges: 0, notifications: { push: 0, email: 0, sms: 0 }, errors: [] });
    expect(h.services.outbox.push).toHaveLength(0);
    expect(h.services.outbox.mail).toHaveLength(0);
    const snap = h.rows('_Snapshot');
    expect(snap.map((r) => [r.StudentID, r.Balance])).toEqual([
      ['S0001', 640],
      ['S0002', 85],
      ['S0003', 410],
      ['S0004', 35],
      ['S0005', 520],
      ['S0006', 0],
    ]);
    expect(h.app.syncTick().balanceChanges).toBe(0);
  });

  it('notifies both guardians of a credit by push and email, using first names only', () => {
    const h = harness();
    h.services.db.tables.Ledger?.push(credit('S0001', 50));
    const report = h.app.syncTick();
    expect(report.balanceChanges).toBe(1);
    expect(report.notifications).toEqual({ push: 1, email: 2, sms: 0 });

    expect(h.services.outbox.push).toHaveLength(1);
    expect(h.services.outbox.push[0]).toEqual({
      tokens: ['demo-device-parent'],
      message: {
        title: '+$50.00 for Avery',
        body: "$50.00 was added to Avery's TMA activity funds. New balance: $690.00.",
        url: '#/funds',
        tag: 'bal-S0001',
        topic: 'balance',
      },
    });
    expect(h.services.outbox.mail.map((m) => m.to).sort()).toEqual([PARENT2, PARENT].sort());
    expect(h.services.outbox.mail[0].subject).toBe('+$50.00 for Avery');
    expect(h.services.outbox.mail[0].html).not.toContain('Thompson');
    expect(h.rows('_Snapshot').find((r) => r.StudentID === 'S0001')?.Balance).toBe(690);
    expect(h.rows('Log').some((r) => r.Kind === 'notify' && String(r.Detail).includes('push 1, email 2, sms 0'))).toBe(true);

    // Nothing new on the next run.
    h.clearOutbox();
    expect(h.app.syncTick().balanceChanges).toBe(0);
    expect(h.services.outbox.push).toHaveLength(0);
  });

  it('honors each guardian’s prefs (topic and channels)', () => {
    const h = harness();
    h.ok('prefs.save', { prefs: { topics: { balance: false } } }, h.signIn(PARENT2));
    h.ok('prefs.save', { prefs: { channels: { push: true, email: false, sms: false } } }, h.signIn(PARENT));
    h.clearOutbox();
    h.services.db.tables.Ledger?.push(credit('S0002', 20));
    const report = h.app.syncTick();
    expect(report.notifications).toEqual({ push: 1, email: 0, sms: 0 });
    expect(h.services.outbox.push[0].message.title).toBe('+$20.00 for Liam');
  });

  it('reports reductions made outside the app as adjustments', () => {
    const h = harness();
    h.services.db.tables.Ledger?.push(credit('S0003', -20, 'Correction'));
    h.app.syncTick();
    const mail = h.services.outbox.mail.find((m) => m.to === NGUYEN);
    expect(mail?.subject).toBe("Maya's activity funds changed");
    expect(mail?.text).toContain('−$20.00 adjustment. New balance: $390.00.');
  });

  it('does not notify unverified households or students without a household', () => {
    const h = harness();
    h.services.db.tables.Ledger?.push(credit('S0005', 30), credit('S0006', 10));
    const report = h.app.syncTick();
    expect(report.balanceChanges).toBe(2);
    expect(report.notifications).toEqual({ push: 0, email: 0, sms: 0 });
    expect(h.rows('_Snapshot').find((r) => r.StudentID === 'S0005')?.Balance).toBe(550);
  });

  it('removes device tokens the push service reports as invalid', () => {
    const gone: PushSender = {
      enabled: () => true,
      publicKey: () => '',
      send: (tokens) => tokens.map((t) => (t.includes('device-expired') ? 'invalid' : 'ok')),
    };
    const h = harness({ push: gone });
    const token = h.signIn(PARENT);
    const expired = testSubscription('expired');
    h.ok('push.register', { token: JSON.stringify(expired) }, token);
    h.services.db.tables.Ledger?.push(credit('S0001', 5));
    const report = h.app.syncTick();
    expect(report.notifications.push).toBe(1);
    expect(h.services.outbox.push[0].tokens.sort()).toEqual(['demo-device-parent', storedToken(expired)].sort());
    expect(h.ok('me.bootstrap', {}, token).pushTokens).toBe(1);
    expect(h.rows('Devices').some((r) => r.Token === storedToken(expired))).toBe(false);
  });

  it('skips email (with a log) when the daily quota is used up', () => {
    const h = harness({ mailQuota: SIGN_IN_EMAIL_RESERVE + 1 });
    h.services.db.tables.Ledger?.push(credit('S0001', 5));
    const report = h.app.syncTick();
    expect(report.notifications.email).toBe(1);
    expect(h.rows('Log').some((r) => String(r.Detail).includes('daily quota'))).toBe(true);
  });

  it('keeps the last emails of the day for sign-in codes', () => {
    const h = harness({ mailQuota: SIGN_IN_EMAIL_RESERVE });
    h.services.db.tables.Ledger?.push(credit('S0001', 5));
    const report = h.app.syncTick();
    expect(report.notifications.email).toBe(0);
    expect(report.notifications.push).toBe(1);
    expect(h.services.mailer.remainingQuota()).toBe(SIGN_IN_EMAIL_RESERVE);
    // A parent can still get a code.
    expect(h.signIn(PARENT)).toBeTruthy();
  });

  it('keeps going when the push service throws', () => {
    const broken: PushSender = {
      enabled: () => true,
      publicKey: () => '',
      send: () => {
        throw new Error('push Worker down');
      },
    };
    const h = harness({ push: broken });
    h.services.db.tables.Ledger?.push(credit('S0001', 5));
    const report = h.app.syncTick();
    expect(report.errors).toEqual([]);
    expect(report.notifications).toEqual({ push: 0, email: 2, sms: 0 });
  });

  it('sends SMS only when enabled in Settings and the parent opted in with a phone', () => {
    const h = harness({ settings: { SMS_ENABLED: 'TRUE' } });
    h.ok('prefs.save', { prefs: { channels: { push: false, email: false, sms: true }, smsPhone: '(603) 555-0142' } }, h.signIn(PARENT));
    h.clearOutbox();
    h.services.db.tables.Ledger?.push(credit('S0001', 5));
    h.app.syncTick();
    expect(h.services.outbox.sms).toEqual([{ to: '6035550142', body: expect.stringContaining('+$5.00 for Avery') }]);
  });
});

describe('syncTick: redemptions decided in the sheet', () => {
  it('posts the ledger row once, marks Notified, and notifies without a second balance alert', () => {
    const h = harness();
    const req = h.services.db.tables.Redemptions?.[0];
    if (req) {
      req.Status = 'approved';
      req['Decided By'] = 'treasurer@example.com';
    }
    const report = h.app.syncTick();
    expect(report).toMatchObject({ redemptionsPosted: 1, balanceChanges: 0, errors: [] });
    expect(h.rows('Ledger').filter((r) => r.Reference === 'R-7f3a9c21')).toEqual([
      expect.objectContaining({ StudentID: 'S0001', Amount: -200, ActivityID: 'FL27', Type: 'Redemption', 'Entered By': 'treasurer@example.com' }),
    ]);
    const row = h.rows('Redemptions')[0];
    expect(row.Notified).toBe(TEST_NOW.toISOString());
    expect(row.Decided).toBe(TEST_NOW.toISOString());
    const titles = h.services.outbox.push.map((p) => p.message.title);
    expect(titles).toEqual(['Funds applied to Florida 2027 – Disney & Universal']);

    h.clearOutbox();
    expect(h.app.syncTick()).toMatchObject({ redemptionsPosted: 0, balanceChanges: 0 });
    expect(h.services.outbox.push).toHaveLength(0);
    expect(h.rows('Ledger').filter((r) => r.Reference === 'R-7f3a9c21')).toHaveLength(1);
  });

  it('does not double-post when the treasurer already added the ledger row', () => {
    const h = harness();
    const req = h.services.db.tables.Redemptions?.[0];
    if (req) req.Status = 'Approved';
    h.services.db.tables.Ledger?.push({ ...credit('S0001', -200, 'Applied to FL27'), ActivityID: 'FL27', Reference: 'R-7f3a9c21' });
    const report = h.app.syncTick();
    expect(report.redemptionsPosted).toBe(0);
    expect(h.rows('Ledger').filter((r) => r.Reference === 'R-7f3a9c21')).toHaveLength(1);
  });

  it('notifies sheet denials with the admin note', () => {
    const h = harness();
    const req = h.services.db.tables.Redemptions?.[0];
    if (req) {
      req.Status = 'Denied';
      req['Admin Note'] = 'Funds are for camp first.';
    }
    h.app.syncTick();
    expect(h.services.outbox.mail.find((m) => m.to === PARENT)?.text).toContain('was not approved. Note: Funds are for camp first.');
    expect(h.rows('Ledger').some((r) => r.Reference === 'R-7f3a9c21')).toBe(false);
  });
});

describe('syncTick: queued announcements', () => {
  it('sends due rows once, writes only Sent, and leaves future rows queued', () => {
    const h = harness();
    h.services.db.tables.Announcements?.push({ Title: 'Concert dress code', Body: 'Black on black, please.', Schools: '', Ensembles: '', Sent: '' });
    const report = h.app.syncTick();
    expect(report.announcementsSent).toBe(1);
    const row = h.rows('Announcements').pop();
    expect(row).toEqual({ Title: 'Concert dress code', Body: 'Black on black, please.', Schools: '', Ensembles: '', Sent: TEST_NOW.toISOString() });
    // The news feed derives its id and date.
    const news = h.ok('me.bootstrap', {}, h.signIn(NGUYEN)).announcements[0];
    expect(news).toMatchObject({ id: 'A6', title: 'Concert dress code', date: '2026-10-21' });
    // Recipients: all guardians of non-Inactive families (+ prefs/devices emails).
    const to = new Set(h.services.outbox.mail.filter((m) => m.subject === 'Concert dress code').map((m) => m.to));
    expect(to).toEqual(new Set([PARENT, PARENT2, NGUYEN, 'ortiz@example.com']));
    // The future "information night" row stays queued.
    expect(h.rows('Announcements').find((r) => r.ID === 'A-9a6c3e52')?.Sent).toBe('');

    h.clearOutbox();
    expect(h.app.syncTick().announcementsSent).toBe(0);
    expect(h.services.outbox.mail).toHaveLength(0);

    // Five days later it goes out, to HS-interested recipients only.
    h.services.setNow(new Date(TEST_NOW.getTime() + 5 * 86400 * 1000));
    expect(h.app.syncTick().announcementsSent).toBe(1);
    expect(new Set(h.services.outbox.mail.map((m) => m.to))).toEqual(new Set([PARENT, PARENT2, NGUYEN, 'ortiz@example.com']));
  });

  it('respects a Sent column the treasurer filled by hand', () => {
    const h = harness();
    h.services.db.tables.Announcements?.push({ Title: 'Old news', Body: 'Already emailed', Sent: 'yes' });
    expect(h.app.syncTick().announcementsSent).toBe(0);
  });
});

describe('dailyTick', () => {
  it('sends payment reminders on REMINDER_DAYS, once per key', () => {
    const h = harness();
    const first = h.app.dailyTick();
    // LESSONS (Maya, $360 left) is due in 14 days.
    const lessons = h.services.outbox.mail.find((m) => m.to === NGUYEN && m.subject.startsWith('TRSD'));
    expect(lessons?.subject).toBe('TRSD Private Lessons 2026–27 payment due in 14 days');
    expect(lessons?.text).toContain('Maya has $360.00 left to pay by Nov 4. You can use activity funds in the app.');
    expect(h.rows('_Sent').map((r) => r.Key)).toContain('rem:S0003:LESSONS:14');
    expect(first.remindersSent).toBe(2); // + Jazz Night tomorrow

    h.clearOutbox();
    const again = h.app.dailyTick();
    expect(again.remindersSent).toBe(0);
    expect(h.services.outbox.mail).toHaveLength(0);

    // A week later the 7-day reminder goes out.
    h.services.setNow(new Date(TEST_NOW.getTime() + 7 * 86400 * 1000));
    const week = h.app.dailyTick();
    expect(week.remindersSent).toBe(1);
    expect(h.services.outbox.mail.find((m) => m.to === NGUYEN)?.subject).toBe('TRSD Private Lessons 2026–27 payment due in 7 days');
  });

  it('reminds about events happening tomorrow, to matching recipients, once', () => {
    const h = harness();
    h.app.dailyTick();
    const jazz = h.services.outbox.push.find((p) => p.message.title === 'Tomorrow: Jazz Night');
    expect(jazz?.message).toMatchObject({ body: '7:00 PM at TRHS Cafeteria.', url: '#/news', topic: 'announcements' });
    const jazzMail = h.services.outbox.mail.filter((m) => m.subject === 'Tomorrow: Jazz Night').map((m) => m.to);
    // Only the Thompsons follow Jazz Band; the other households have no matching ensemble.
    expect(jazzMail.sort()).toEqual([PARENT2, PARENT].sort());
    expect(h.rows('_Sent').map((r) => r.Key)).toContain('evt:EV-JAZZ');
    h.clearOutbox();
    h.app.dailyTick();
    expect(h.services.outbox.push.find((p) => p.message.title === 'Tomorrow: Jazz Night')).toBeUndefined();
  });

  it('skips paid-up, closed or unverified accounts', () => {
    const h = harness();
    h.services.db.tables.Payments?.push({ Date: '2026-10-01', StudentID: 'S0003', ActivityID: 'LESSONS', Amount: 360, Method: 'Check', Status: 'Completed' });
    expect(h.app.dailyTick().remindersSent).toBe(1); // only Jazz Night
  });
});

describe('admin.runSync', () => {
  it('runs the sync for admins and returns its report', () => {
    const h = harness();
    h.services.db.tables.Ledger?.push(credit('S0001', 50));
    const report = h.ok('admin.runSync', {}, h.signIn('treasurer@example.com'));
    expect(report.balanceChanges).toBe(1);
    expect(h.err('admin.runSync', {}, h.signIn(PARENT)).code).toBe('FORBIDDEN');
  });

  it('collects step errors instead of throwing', () => {
    const h = harness();
    const original = h.services.store.overwrite;
    h.services.store.overwrite = () => {
      throw new Error('quota exceeded');
    };
    h.services.db.tables.Ledger?.push(credit('S0001', 50));
    const report = h.app.syncTick();
    expect(report.errors).toEqual(['balances: quota exceeded']);
    h.services.store.overwrite = original;
  });
});
