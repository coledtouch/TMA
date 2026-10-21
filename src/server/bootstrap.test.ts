import { describe, expect, it } from 'vitest';
import { harness, NGUYEN, ORTIZ, PARENT, PARENT2, TREASURER } from './test-helpers';

describe('me.bootstrap for a verified family', () => {
  it('returns the household, balances and activity accounts', () => {
    const h = harness();
    const b = h.ok('me.bootstrap', {}, h.signIn(PARENT));
    expect(b.me).toEqual({ email: PARENT, name: 'Jordan Thompson', familyId: 'F0001', familyStatus: 'Active', isAdmin: false });
    expect(b.family?.guardians.map((g) => g.email)).toEqual([PARENT, PARENT2]);
    expect(b.students.map((s) => s.student.id)).toEqual(['S0001', 'S0002']);

    const avery = b.students[0];
    expect(avery.verified).toBe(true);
    expect(avery.balanceCents).toBe(64000);
    expect(avery.pendingCents).toBe(20000);
    expect(avery.availableCents).toBe(44000);
    const fl = avery.activities.find((a) => a.activityId === 'FL27');
    expect(fl).toMatchObject({
      costCents: 185000,
      paidDirectCents: 35000,
      paidFromFundsCents: 0,
      paidCents: 35000,
      pendingRedemptionCents: 20000,
      remainingCents: 150000,
      depositCents: 35000,
      allowFunds: true,
      allowOnlinePayment: true,
      activityOpen: true,
    });
    expect(avery.activities.map((a) => a.activityId)).toEqual(['FL27', 'CAMP27']);
    expect(b.students[1].balanceCents).toBe(8500);
  });

  it('only includes this household’s ledger, payments and requests, newest first', () => {
    const h = harness();
    const b = h.ok('me.bootstrap', {}, h.signIn(PARENT));
    const ids = new Set(['S0001', 'S0002']);
    expect(b.ledger.length).toBeGreaterThan(0);
    expect(b.ledger.every((l) => ids.has(l.studentId))).toBe(true);
    expect(b.payments.every((p) => ids.has(p.studentId))).toBe(true);
    expect(b.redemptions.map((r) => r.id)).toEqual(['R-7f3a9c21']);
    const dates = b.ledger.map((l) => l.date);
    expect(dates).toEqual(dates.slice().sort().reverse());
    // Nothing about the Nguyens or Sofia leaks.
    const json = JSON.stringify(b);
    for (const other of ['S0003', 'S0004', 'S0005', 'Maya', 'nguyen.family', 'Sofia']) expect(json).not.toContain(other);
  });

  it('filters announcements and events by the default prefs audience', () => {
    const h = harness();
    // Thompsons: High School + Middle School; Band, Marching Band, Jazz Band, Chorus.
    const thompson = h.ok('me.bootstrap', {}, h.signIn(PARENT));
    expect(thompson.prefs.schools).toEqual(['High School', 'Middle School']);
    expect(thompson.prefs.ensembles).toEqual(['Band', 'Marching Band', 'Jazz Band', 'Chorus']);
    expect(thompson.prefs.channels).toEqual({ push: true, email: true, sms: false });
    expect(thompson.announcements.map((a) => a.title)).toEqual([
      'Florida 2027 deposit reminder',
      'Winter Concert volunteers needed',
      'Poinsettia credits posted',
    ]);
    expect(thompson.events.map((e) => e.title)).toEqual([
      'Jazz Night',
      'TMA monthly meeting',
      'Middle School Winter Concert',
      'High School Winter Concert',
    ]);

    // Nguyens: High School + Elementary; Orchestra. No HS+Chorus item, no Jazz Night, no MS concert.
    const nguyen = h.ok('me.bootstrap', {}, h.signIn(NGUYEN));
    expect(nguyen.announcements.map((a) => a.title)).toEqual(['Florida 2027 deposit reminder', 'Poinsettia credits posted']);
    expect(nguyen.events.map((e) => e.title)).toEqual(['TMA monthly meeting', 'High School Winter Concert']);
    // Unsent (future) announcement is never shown.
    expect(JSON.stringify(nguyen)).not.toContain('information night');
  });

  it('uses stored prefs for the audience and lets admins see every announcement', () => {
    const h = harness();
    const token = h.signIn(NGUYEN);
    h.ok('prefs.save', { prefs: { schools: ['Middle School'], ensembles: [] } }, token);
    const b = h.ok('me.bootstrap', {}, token);
    expect(b.prefs.schools).toEqual(['Middle School']);
    expect(b.announcements.map((a) => a.title)).toEqual(['Poinsettia credits posted']);
    expect(b.events.map((e) => e.title)).toEqual(['TMA monthly meeting', 'Middle School Winter Concert']);

    const admin = h.ok('me.bootstrap', {}, h.signIn(TREASURER));
    expect(admin.me).toMatchObject({ isAdmin: true, familyId: null, familyStatus: 'None', name: 'treasurer' });
    expect(admin.announcements).toHaveLength(3);
  });

  it('returns settings, open activities and device counts', () => {
    const h = harness();
    const b = h.ok('me.bootstrap', {}, h.signIn(PARENT));
    expect(b.settings).toMatchObject({
      orgName: 'Timberlane Music Association',
      onlinePaymentsEnabled: true,
      paypalClientId: 'demo',
      feePercent: 1.99,
      feeFixedCents: 49,
      minPaymentCents: 500,
      schools: ['High School', 'Middle School', 'Elementary'],
      smsEnabled: false,
    });
    expect(b.activities.map((a) => a.id)).toEqual(['FL27', 'CAMP27', 'LESSONS']);
    expect(b.pushTokens).toBe(1);
    expect(b.serverTime).toBe('2026-10-21T14:00:00.000Z');
  });

  it('turns online payments off unless ONLINE_PAYMENTS, PAYPAL_CLIENT_ID and the gateway are all set', () => {
    const h = harness({ settings: { PAYPAL_CLIENT_ID: '' } });
    expect(h.ok('me.bootstrap', {}, h.signIn(PARENT)).settings.onlinePaymentsEnabled).toBe(false);
    const h2 = harness({ payments: { enabled: () => false, createOrder: () => ({ orderId: 'x' }), captureOrder: () => ({ status: 'FAILED' }) } });
    expect(h2.ok('me.bootstrap', {}, h2.signIn(PARENT)).settings.onlinePaymentsEnabled).toBe(false);
  });
});

describe('me.bootstrap for pending and new families', () => {
  it('hides money while a household is pending', () => {
    const h = harness();
    const b = h.ok('me.bootstrap', {}, h.signIn(ORTIZ));
    expect(b.me).toMatchObject({ familyId: 'F0003', familyStatus: 'Pending', name: 'Marcus Ortiz' });
    expect(b.students).toHaveLength(1);
    expect(b.students[0]).toMatchObject({ verified: false, balanceCents: 0, pendingCents: 0, availableCents: 0, activities: [] });
    expect(b.ledger).toEqual([]);
    expect(b.payments).toEqual([]);
    // The treasurer's record for the other Sofia (S0005, $520) is not visible.
    expect(JSON.stringify(b)).not.toContain('S0005');
  });

  it('hides money for a pending student in a verified family', () => {
    const h = harness();
    const token = h.signIn(PARENT);
    h.ok(
      'household.save',
      {
        guardians: [{ name: 'Jordan Thompson', email: PARENT }],
        students: [{ firstName: 'Nora', lastName: 'Thompson', grade: '3', school: 'Elementary', ensembles: [] }],
      },
      token,
    );
    const b = h.ok('me.bootstrap', {}, token);
    const nora = b.students.find((s) => s.student.firstName === 'Nora');
    expect(nora).toMatchObject({ verified: false, balanceCents: 0 });
    expect(b.students.find((s) => s.student.id === 'S0001')?.verified).toBe(true);
  });

  it('works for someone with no household yet', () => {
    const h = harness();
    const b = h.ok('me.bootstrap', {}, h.signIn('new.parent@example.org'));
    expect(b.me).toEqual({
      email: 'new.parent@example.org',
      name: 'new.parent',
      familyId: null,
      familyStatus: 'None',
      isAdmin: false,
    });
    expect(b.family).toBeNull();
    expect(b.students).toEqual([]);
    expect(b.prefs.schools).toEqual([]);
    // No interests yet -> sees all sent announcements.
    expect(b.announcements).toHaveLength(3);
  });

  it('never shows students of an inactive record or Inactive students', () => {
    const h = harness();
    h.services.db.tables.Students?.push({ StudentID: 'S0099', FamilyID: 'F0001', 'First Name': 'Old', 'Last Name': 'Record', Status: 'Inactive' });
    const b = h.ok('me.bootstrap', {}, h.signIn(PARENT));
    expect(b.students.map((s) => s.student.id)).toEqual(['S0001', 'S0002']);
  });

  it('matches hand-typed IDs case-insensitively', () => {
    const h = harness();
    h.services.db.tables.Ledger?.push({ Date: '2026-10-20', StudentID: 's0002', Type: 'Fundraiser', Description: 'Bake sale', Amount: 15 });
    const b = h.ok('me.bootstrap', {}, h.signIn(PARENT));
    expect(b.students[1].balanceCents).toBe(10000);
    expect(b.ledger[0]).toMatchObject({ studentId: 'S0002', description: 'Bake sale', amountCents: 1500 });
  });
});
