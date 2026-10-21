import { describe, expect, it } from 'vitest';
import { createFakePaymentGateway } from './memory';
import { SIGN_IN_EMAIL_RESERVE } from './notify';
import { TABLES, type TableName } from '../shared/schema';
import type { TickReport } from '../shared/types';
import type { PushSender } from './services';
import { harness, NGUYEN, ORTIZ, PARENT, PARENT2, storedToken, TEST_NOW, testSubscription, TREASURER } from './test-helpers';

const credit = (studentId: string, amount: number, description = 'Fall Fruit sale') => ({
  Date: '2026-10-21',
  StudentID: studentId,
  Type: 'Fundraiser',
  Description: description,
  Amount: amount,
});

const LATER = new Date(TEST_NOW.getTime() + 15 * 60 * 1000);

/**
 * Rows typed in the sheet go out once they have stayed the same across syncs SETTLE_MS apart:
 * run the sync that first sees them, then move the clock to the next scheduled sync.
 */
function seeThenWait(h: ReturnType<typeof harness>): TickReport {
  const first = h.app.syncTick();
  h.services.setNow(LATER);
  return first;
}

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

  it('texts only guardians of verified households (and admins), never a number a stranger saved', () => {
    const h = harness({ settings: { SMS_ENABLED: 'TRUE' } });
    const smsOnly = (phone: string) => ({ prefs: { channels: { push: false, email: false, sms: true }, smsPhone: phone } });
    h.ok('prefs.save', smsOnly('603-555-0142'), h.signIn(PARENT)); // Active household
    h.ok('prefs.save', smsOnly('603-555-0177'), h.signIn(ORTIZ)); // household still Pending review
    h.ok('prefs.save', smsOnly('603-555-0199'), h.signIn('stranger@example.org')); // signed in, no household
    h.ok('prefs.save', smsOnly('603-555-0111'), h.signIn(TREASURER)); // admin
    // A premium/international number is never stored.
    const pumped = h.ok('prefs.save', smsOnly('+882 1234 5678 901'), h.signIn('pump@example.org')).prefs;
    expect(pumped).toMatchObject({ channels: { sms: false } });
    expect(pumped.smsPhone).toBeUndefined();
    h.clearOutbox();
    const { delivered } = h.ok(
      'admin.announce',
      { title: 'Concert moved', body: 'Now at 7 PM.', audience: {}, channels: { push: false, email: false, sms: true } },
      h.signIn(TREASURER),
    );
    expect(h.services.outbox.sms.map((m) => m.to).sort()).toEqual(['6035550111', '6035550142']);
    expect(delivered.sms).toBe(2);
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
    expect(seeThenWait(h)).toMatchObject({ redemptionsPosted: 0, waiting: 1, errors: [] });
    expect(h.services.outbox.push).toHaveLength(0);
    const report = h.app.syncTick();
    expect(report).toMatchObject({ redemptionsPosted: 1, balanceChanges: 0, errors: [] });
    expect(report.waiting).toBeUndefined();
    expect(h.rows('Ledger').filter((r) => r.Reference === 'R-7f3a9c21')).toEqual([
      expect.objectContaining({ StudentID: 'S0001', Amount: -200, ActivityID: 'FL27', Type: 'Redemption', 'Entered By': 'treasurer@example.com' }),
    ]);
    const row = h.rows('Redemptions')[0];
    expect(row.Notified).toBe(LATER.toISOString());
    expect(row.Decided).toBe(LATER.toISOString());
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
    seeThenWait(h);
    const report = h.app.syncTick();
    expect(report.redemptionsPosted).toBe(0);
    expect(h.rows('Redemptions')[0].Notified).toBe(LATER.toISOString());
    expect(h.rows('Ledger').filter((r) => r.Reference === 'R-7f3a9c21')).toHaveLength(1);
  });

  it('notifies sheet denials with the admin note', () => {
    const h = harness();
    const req = h.services.db.tables.Redemptions?.[0];
    if (req) {
      req.Status = 'Denied';
      req['Admin Note'] = 'Funds are for camp first.';
    }
    seeThenWait(h);
    h.app.syncTick();
    expect(h.services.outbox.mail.find((m) => m.to === PARENT)?.text).toContain('was not approved. Note: Funds are for camp first.');
    expect(h.rows('Ledger').some((r) => r.Reference === 'R-7f3a9c21')).toBe(false);
  });
});

describe('syncTick: queued announcements', () => {
  it('sends due rows once, writes only Sent, and leaves future rows queued', () => {
    const h = harness();
    h.services.db.tables.Announcements?.push({ Title: 'Concert dress code', Body: 'Black on black, please.', Schools: '', Ensembles: '', Sent: '' });
    expect(seeThenWait(h)).toMatchObject({ announcementsSent: 0, waiting: 1 });
    const report = h.app.syncTick();
    expect(report.announcementsSent).toBe(1);
    const row = h.rows('Announcements').pop();
    expect(row).toEqual({ Title: 'Concert dress code', Body: 'Black on black, please.', Schools: '', Ensembles: '', Sent: LATER.toISOString() });
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

    // Five days later (in the morning) it goes out, to HS-interested recipients only.
    h.services.setNow(new Date(TEST_NOW.getTime() + 5 * 86400 * 1000));
    seeThenWait(h);
    h.services.setNow(new Date(TEST_NOW.getTime() + 5 * 86400 * 1000 + 15 * 60 * 1000));
    expect(h.app.syncTick().announcementsSent).toBe(1);
    expect(new Set(h.services.outbox.mail.map((m) => m.to))).toEqual(new Set([PARENT, PARENT2, NGUYEN, 'ortiz@example.com']));
  });

  it('respects a Sent column the treasurer filled by hand', () => {
    const h = harness();
    h.services.db.tables.Announcements?.push({ Title: 'Old news', Body: 'Already emailed', Sent: 'yes' });
    expect(h.app.syncTick().announcementsSent).toBe(0);
  });

  it('waits until a row typed in the sheet stops changing (Sheets saves cell by cell)', () => {
    const h = harness();
    const row: Record<string, string> = { Title: 'HS Chorus: robes', Body: '', Schools: '', Ensembles: '', Sent: '' };
    h.services.db.tables.Announcements?.push(row);
    // A sync lands right after the Title was typed: nothing goes out to everyone with an empty body.
    expect(h.app.syncTick()).toMatchObject({ announcementsSent: 0, waiting: 1 });
    Object.assign(row, { Body: 'Pick up robes Friday.', Schools: 'High School', Ensembles: 'Chorus' });
    h.services.setNow(LATER);
    expect(h.app.syncTick()).toMatchObject({ announcementsSent: 0, waiting: 1 }); // changed since: wait again
    h.services.setNow(new Date(LATER.getTime() + 15 * 60 * 1000));
    expect(h.app.syncTick().announcementsSent).toBe(1);
    const mail = h.services.outbox.mail.filter((m) => m.subject === 'HS Chorus: robes');
    expect(mail[0].text).toContain('Pick up robes Friday.');
    // Only HS + Chorus households (the Ortizes, by their students); not the elementary/orchestra Nguyens.
    expect(mail.map((m) => m.to)).not.toContain(NGUYEN);
  });

  it('sends a dated announcement in the morning of its date, not just after midnight', () => {
    const h = harness();
    // The sample's queued "information night" row is dated 2026-10-26.
    expect(h.rows('Announcements').find((r) => r.ID === 'A-9a6c3e52')?.Date).toBe('2026-10-26');
    h.services.setNow(new Date('2026-10-26T03:55:00.000Z')); // 11:55 PM the day before
    h.app.syncTick();
    h.services.setNow(new Date('2026-10-26T04:05:00.000Z')); // 12:05 AM
    expect(h.app.syncTick().announcementsSent).toBe(0);
    h.services.setNow(new Date('2026-10-26T11:50:00.000Z')); // 7:50 AM
    expect(h.app.syncTick().announcementsSent).toBe(0);
    expect(h.services.outbox.push).toHaveLength(0);
    h.services.setNow(new Date('2026-10-26T12:05:00.000Z')); // 8:05 AM: typed long ago, so it goes now
    expect(h.app.syncTick().announcementsSent).toBe(1);
    expect(h.rows('Announcements').find((r) => r.ID === 'A-9a6c3e52')?.Sent).toBe('2026-10-26T12:05:00.000Z');
  });
});

describe('syncTick: the treasurer edits rows while it runs', () => {
  it('stamps Sent on the right rows when rows are deleted during delivery', () => {
    const h = harness();
    const table = h.services.db.tables.Announcements ?? [];
    table.push(
      { ID: 'A-alpha', Title: 'Alpha', Body: 'a', Sent: '' },
      { ID: 'A-beta', Title: 'Beta', Body: 'b', Sent: '' },
      { ID: 'A-gamma', Date: '2026-10-28', Title: 'Gamma (next week)', Body: 'g', Sent: '' },
    );
    seeThenWait(h);
    // The treasurer deletes the first row while the first email goes out.
    const send = h.services.mailer.send.bind(h.services.mailer);
    let deleted = false;
    h.services.mailer.send = (msg) => {
      if (!deleted) {
        deleted = true;
        table.splice(0, 1);
      }
      send(msg);
    };
    expect(h.app.syncTick().announcementsSent).toBe(2);
    const sent = (id: string) => h.rows('Announcements').find((r) => r.ID === id)?.Sent;
    expect([sent('A-alpha'), sent('A-beta'), sent('A-gamma')]).toEqual([LATER.toISOString(), LATER.toISOString(), '']);
    h.clearOutbox();
    h.services.setNow(new Date(LATER.getTime() + 15 * 60 * 1000));
    expect(h.app.syncTick().announcementsSent).toBe(0);
    expect(h.services.outbox.mail).toHaveLength(0);
  });

  it('finds the row again when rows move between reading the tab and stamping it', () => {
    const h = harness();
    const table = h.services.db.tables.Announcements ?? [];
    table.push({ ID: 'A-alpha', Title: 'Alpha', Body: 'a', Sent: '' }, { ID: 'A-beta', Title: 'Beta', Body: 'b', Sent: '' });
    seeThenWait(h);
    // Act out an insert at the top of the tab right after the sync read it.
    const get = h.services.cache.get.bind(h.services.cache);
    let inserted = false;
    h.services.cache.get = (key) => {
      if (!inserted && key.startsWith('settle:announcement:') && h.rows('Announcements').some((r) => r.Sent === LATER.toISOString())) {
        inserted = true;
        table.unshift({ ID: 'A-new', Title: 'Typed later', Body: 'n', Sent: '' });
      }
      return get(key);
    };
    expect(h.app.syncTick().announcementsSent).toBe(2);
    const sent = (id: string) => h.rows('Announcements').find((r) => r.ID === id)?.Sent;
    expect([sent('A-alpha'), sent('A-beta'), sent('A-new')]).toEqual([LATER.toISOString(), LATER.toISOString(), '']);
  });

  it('never stamps Notified on a different request, so a later sheet approval still posts', () => {
    const h = harness();
    const table = h.services.db.tables.Redemptions ?? [];
    const base = { Requested: '2026-10-20T12:00:00.000Z', Email: NGUYEN, FamilyID: 'F0002', StudentID: 'S0003', ActivityID: 'FL27', Amount: 20 };
    table.push(
      { ...base, RequestID: 'R-aaaa0001', Status: 'Approved' },
      { ...base, RequestID: 'R-bbbb0002', Status: 'Approved' },
      { ...base, RequestID: 'R-cccc0003', Status: 'Pending' },
    );
    seeThenWait(h);
    const send = h.services.mailer.send.bind(h.services.mailer);
    let deleted = false;
    h.services.mailer.send = (msg) => {
      if (!deleted) {
        deleted = true;
        table.splice(0, 1); // the treasurer deletes a row mid-run
      }
      send(msg);
    };
    expect(h.app.syncTick().redemptionsPosted).toBe(2);
    const notified = (id: string) => h.rows('Redemptions').find((r) => r.RequestID === id)?.Notified;
    expect(notified('R-bbbb0002')).toBe(LATER.toISOString());
    expect(notified('R-cccc0003')).toBeUndefined();

    const pending = table.find((r) => r.RequestID === 'R-cccc0003');
    if (pending) pending.Status = 'Approved';
    h.services.setNow(new Date(LATER.getTime() + 15 * 60 * 1000));
    h.app.syncTick();
    h.services.setNow(new Date(LATER.getTime() + 30 * 60 * 1000));
    expect(h.app.syncTick().redemptionsPosted).toBe(1);
    expect(h.rows('Ledger').filter((r) => String(r.Reference).startsWith('R-')).map((r) => r.Reference).sort()).toEqual(
      ['R-aaaa0001', 'R-bbbb0002', 'R-cccc0003'],
    );
  });
});

describe('syncTick: a renamed header is not read as blank cells', () => {
  const without = (table: TableName, column: string) => TABLES[table].headers.filter((h) => h !== column);

  it('does not tell every family their balance fell to $0 when Ledger "Amount" is renamed', () => {
    const h = harness();
    h.app.syncTick(); // first run: snapshot
    const snapshot = h.rows('_Snapshot');
    h.clearOutbox();
    h.services.db.headers = { Ledger: without('Ledger', 'Amount') };
    const report = h.app.syncTick();
    expect(report.balanceChanges).toBe(0);
    expect(report.errors).toEqual([expect.stringMatching(/^balances: The Ledger tab has no "Amount" column/)]);
    expect(h.services.outbox.mail).toHaveLength(0);
    expect(h.rows('_Snapshot')).toEqual(snapshot);
    // Header fixed: nothing changed, nothing to send.
    h.services.db.headers = {};
    expect(h.app.syncTick()).toMatchObject({ balanceChanges: 0, errors: [] });
    expect(h.services.outbox.mail).toHaveLength(0);
  });

  it('does not read a renamed or emptied Ledger as every balance at $0', () => {
    const h = harness();
    h.app.syncTick();
    h.clearOutbox();
    h.services.db.headers = { Ledger: null }; // tab renamed
    expect(h.app.syncTick().errors).toEqual([expect.stringMatching(/^balances: The Ledger tab is missing/)]);
    h.services.db.headers = {};
    for (const row of h.services.db.tables.Ledger ?? []) row.Amount = 'n/a'; // unreadable amounts
    expect(h.app.syncTick().errors).toEqual([expect.stringMatching(/^balances: The Ledger tab has no rows with a StudentID and an Amount/)]);
    expect(h.services.outbox.mail).toHaveLength(0);
  });

  it('does not post a fund decision into a new Ledger tab when the real one was renamed', () => {
    const h = harness();
    const req = h.services.db.tables.Redemptions?.[0];
    if (req) req.Status = 'Approved';
    h.services.db.headers = { Ledger: null };
    seeThenWait(h);
    expect(h.app.syncTick().errors).toEqual([
      expect.stringMatching(/^redemptions: The Ledger tab is missing/),
      expect.stringMatching(/^balances: The Ledger tab is missing/),
    ]);
    expect(h.rows('Ledger').some((r) => r.Reference === 'R-7f3a9c21')).toBe(false);
    expect(h.rows('Redemptions')[0].Notified).toBeFalsy();
  });

  it('does not re-send every announcement when "Sent" is renamed', () => {
    const h = harness();
    h.services.db.headers = { Announcements: without('Announcements', 'Sent') };
    seeThenWait(h);
    const report = h.app.syncTick();
    expect(report.announcementsSent).toBe(0);
    expect(report.errors).toEqual([expect.stringMatching(/^announcements: The Announcements tab has no "Sent" column/)]);
    expect(h.services.outbox.mail).toHaveLength(0);
  });

  it('does not re-send every fund decision when "Notified" is renamed', () => {
    const h = harness();
    const req = h.services.db.tables.Redemptions?.[0];
    if (req) Object.assign(req, { Status: 'Approved', Notified: '2026-10-01T12:00:00.000Z' });
    h.services.db.tables.Ledger?.push({ ...credit('S0001', -200), ActivityID: 'FL27', Reference: 'R-7f3a9c21' });
    h.services.db.headers = { Redemptions: without('Redemptions', 'Notified') };
    seeThenWait(h);
    expect(h.app.syncTick().errors).toEqual([expect.stringMatching(/^redemptions: The Redemptions tab has no "Notified" column/)]);
    expect(h.services.outbox.mail.some((m) => m.subject.startsWith('Funds applied'))).toBe(false);
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

describe('the script lock is not held while notifications go out', () => {
  /** Record every push/email/SMS sent while the write lock is held. */
  function watchLock(h: ReturnType<typeof harness>) {
    let held = false;
    const whileLocked: string[] = [];
    h.services.withLock = <T>(fn: () => T): T => {
      held = true;
      try {
        return fn();
      } finally {
        held = false;
      }
    };
    const { mailer, push, sms } = h.services;
    const send = mailer.send.bind(mailer);
    mailer.send = (msg) => {
      if (held) whileLocked.push(`email ${msg.to}`);
      send(msg);
    };
    const pushSend = push.send.bind(push);
    push.send = (tokens, message) => {
      if (held) whileLocked.push(`push ${message.title}`);
      return pushSend(tokens, message);
    };
    const smsSend = sms.send.bind(sms);
    sms.send = (to, body) => {
      if (held) whileLocked.push(`sms ${to}`);
      smsSend(to, body);
    };
    return whileLocked;
  }

  it('syncTick writes under the lock and delivers after releasing it, with the same report', () => {
    const h = harness({ settings: { SMS_ENABLED: 'TRUE' } });
    h.ok('prefs.save', { prefs: { channels: { push: true, email: true, sms: true }, smsPhone: '603-555-0142' } }, h.signIn(PARENT));
    h.services.db.tables.Devices?.push({ Email: PARENT, Token: 'bad-expired', 'Last Seen': '2026-10-01' });
    const whileLocked = watchLock(h);
    h.clearOutbox();
    h.services.db.tables.Ledger?.push(credit('S0001', 50));
    const report = h.app.syncTick();
    expect(whileLocked).toEqual([]);
    expect(report).toMatchObject({ balanceChanges: 1, errors: [], notifications: { push: 1, email: 2, sms: 1 } });
    // The rejected device is still cleaned up, and the deliveries logged.
    expect(h.rows('Devices').some((d) => d.Token === 'bad-expired')).toBe(false);
    expect(h.rows('Log').map((r) => r.Detail)).toContain('balance: +$50.00 for Avery → push 1, email 2, sms 1');
  });

  it('write actions answer with what was delivered, sent after the lock', () => {
    const h = harness();
    const admin = h.signIn(TREASURER);
    const whileLocked = watchLock(h);
    const { delivered } = h.ok(
      'admin.announce',
      { title: 'Concert moved', body: 'Now at 7 PM.', audience: {}, channels: { push: true, email: true } },
      admin,
    );
    expect(whileLocked).toEqual([]);
    expect(delivered).toEqual({ push: 1, email: 4, sms: 0 });
    // Alerts queued by an action that then fails still go out (here: an admin alert about a payment).
    const fake = createFakePaymentGateway();
    const h2 = harness({ payments: { enabled: () => true, createOrder: (i) => fake.createOrder(i), captureOrder: () => ({ status: 'UNKNOWN' }) } });
    const token = h2.signIn(PARENT);
    const { orderId } = h2.ok('payment.createOrder', { studentId: 'S0001', activityId: 'FL27', amountCents: 25000, coverFee: false }, token);
    const locked2 = watchLock(h2);
    h2.clearOutbox();
    expect(h2.err('payment.captureOrder', { orderId }, token).code).toBe('INTERNAL');
    expect(locked2).toEqual([]);
    expect(h2.services.outbox.mail.map((m) => m.subject)).toEqual(['Payment needs review']);
  });
});

describe('admin.runSync', () => {
  it('runs the sync for admins and returns its report', () => {
    const h = harness();
    h.services.db.tables.Ledger?.push(credit('S0001', 50));
    const report = h.ok('admin.runSync', {}, h.signIn('treasurer@example.com'));
    expect(report.balanceChanges).toBe(1);
    expect(report.notifications).toEqual({ push: 1, email: 2, sms: 0 }); // counted after sending, outside the lock
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
