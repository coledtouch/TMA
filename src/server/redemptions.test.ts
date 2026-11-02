import { describe, expect, it } from 'vitest';
import { harness, NGUYEN, ORTIZ, PARENT, PARENT2, TREASURER } from './test-helpers';

describe('redemption.request', () => {
  it('records a Pending request and notifies the admins', () => {
    const h = harness();
    const token = h.signIn(NGUYEN);
    h.clearOutbox();
    const { redemption } = h.ok(
      'redemption.request',
      { studentId: 'S0003', activityId: 'FL27', amountCents: 25000, note: 'Car wash money, please' },
      token,
    );
    expect(redemption).toMatchObject({
      email: NGUYEN,
      familyId: 'F0002',
      studentId: 'S0003',
      activityId: 'FL27',
      amountCents: 25000,
      note: 'Car wash money, please',
      status: 'Pending',
      requestedAt: '2026-10-21T14:00:00.000Z',
    });
    expect(redemption.id).toMatch(/^R-[0-9a-f]{8}$/);
    expect(h.rows('Redemptions').pop()).toMatchObject({ RequestID: redemption.id, Amount: 250, Status: 'Pending' });

    const b = h.ok('me.bootstrap', {}, token);
    expect(b.students[0]).toMatchObject({ balanceCents: 41000, pendingCents: 25000, availableCents: 16000 });

    const mail = h.services.outbox.mail.find((m) => m.to === TREASURER);
    expect(mail?.subject).toBe('Funds request: $250.00');
    expect(mail?.text).toContain("Priya Nguyen asked to apply $250.00 from Maya's funds to Florida 2027");
  });

  it('enforces available funds and what is left on the trip (minus pending requests)', () => {
    const h = harness();
    const token = h.signIn(PARENT);
    // Avery: balance 640, pending 200 -> available 440.
    expect(h.err('redemption.request', { studentId: 'S0001', activityId: 'FL27', amountCents: 44001 }, token).message).toMatch(
      /available activity funds \(\$440\.00\)/,
    );
    h.ok('redemption.request', { studentId: 'S0001', activityId: 'FL27', amountCents: 44000 }, token);
    // Liam (Chorus, 7th grade) is not going on Florida.
    expect(h.err('redemption.request', { studentId: 'S0002', activityId: 'FL27', amountCents: 1000 }, token).message).toMatch(
      /isn't signed up/,
    );

    // CAMP27 costs $275: room is checked against remaining minus pending.
    const h2 = harness();
    const t2 = h2.signIn(PARENT);
    h2.ok('redemption.request', { studentId: 'S0001', activityId: 'CAMP27', amountCents: 20000 }, t2);
    expect(h2.err('redemption.request', { studentId: 'S0001', activityId: 'CAMP27', amountCents: 7600 }, t2).message).toMatch(
      /\$75\.00 after pending/,
    );
    h2.ok('redemption.request', { studentId: 'S0001', activityId: 'CAMP27', amountCents: 7500 }, t2);
  });

  it('validates amount, ownership and activity rules', () => {
    const h = harness();
    const token = h.signIn(PARENT);
    const req = (p: Record<string, unknown>) => h.err('redemption.request', { studentId: 'S0001', activityId: 'FL27', amountCents: 1000, ...p }, token);
    expect(req({ amountCents: 99 }).code).toBe('BAD_REQUEST'); // < $1
    expect(req({ amountCents: 1000.5 }).code).toBe('BAD_REQUEST');
    expect(req({ amountCents: '1000' }).code).toBe('BAD_REQUEST');
    expect(req({ amountCents: 10000001 }).code).toBe('BAD_REQUEST');
    expect(req({ note: 'x'.repeat(501) }).code).toBe('BAD_REQUEST');
    expect(req({ studentId: 'S0003' }).code).toBe('NOT_FOUND'); // another family's student
    expect(req({ studentId: 'S0005' }).code).toBe('NOT_FOUND'); // treasurer-only record
    expect(req({ activityId: 'NOPE' }).code).toBe('NOT_FOUND');
    expect(req({ activityId: 'NYC25' }).code).toBe('CONFLICT'); // closed
    // Lessons allow funds but Avery isn't enrolled.
    expect(req({ activityId: 'LESSONS' }).code).toBe('BAD_REQUEST');
  });

  it('requires a verified household and rejects activities that do not allow funds', () => {
    const h = harness();
    expect(h.err('redemption.request', { studentId: 'S0006', activityId: 'FL27', amountCents: 1000 }, h.signIn(ORTIZ)).code).toBe(
      'FORBIDDEN',
    );
    const act = h.services.db.tables.Activities?.find((r) => r.ActivityID === 'FL27');
    if (act) act['Allow Funds'] = 'N';
    expect(h.err('redemption.request', { studentId: 'S0001', activityId: 'FL27', amountCents: 1000 }, h.signIn(PARENT)).message).toMatch(
      /can't be used/,
    );
  });
});

describe('redemption.cancel', () => {
  it('cancels only the household’s own Pending request', () => {
    const h = harness();
    expect(h.err('redemption.cancel', { id: 'R-7f3a9c21' }, h.signIn(NGUYEN)).code).toBe('NOT_FOUND');
    // Either guardian of the household may cancel.
    const { redemption } = h.ok('redemption.cancel', { id: 'R-7f3a9c21' }, h.signIn(PARENT2));
    expect(redemption.status).toBe('Cancelled');
    expect(h.err('redemption.cancel', { id: 'R-7f3a9c21' }, h.signIn(PARENT)).code).toBe('CONFLICT');
    expect(h.ok('me.bootstrap', {}, h.signIn(PARENT)).students[0].availableCents).toBe(64000);
  });
});

describe('admin.decideRedemption', () => {
  it('approves: posts the ledger row once, updates the request and snapshot, notifies the family', () => {
    const h = harness();
    const admin = h.signIn(TREASURER);
    h.clearOutbox();
    const { redemption } = h.ok('admin.decideRedemption', { id: 'R-7f3a9c21', decision: 'Approved', adminNote: 'Enjoy Florida!' }, admin);
    expect(redemption).toMatchObject({ status: 'Approved', decidedBy: TREASURER, adminNote: 'Enjoy Florida!' });

    const ledgerRows = h.rows('Ledger').filter((r) => r.Reference === 'R-7f3a9c21');
    expect(ledgerRows).toEqual([
      {
        Date: '2026-10-21',
        StudentID: 'S0001',
        Type: 'Redemption',
        Description: 'Applied to Florida 2027 – Disney & Universal',
        Amount: -200,
        ActivityID: 'FL27',
        Reference: 'R-7f3a9c21',
        'Entered By': TREASURER,
      },
    ]);
    expect(h.rows('Redemptions')[0]).toMatchObject({ Status: 'Approved', 'Decided By': TREASURER, Notified: '2026-10-21T14:00:00.000Z' });
    expect(h.rows('_Snapshot').find((r) => r.StudentID === 'S0001')?.Balance).toBe(440);

    const pushes = h.services.outbox.push.map((p) => p.message.title);
    expect(pushes).toContain('Funds applied to Florida 2027 – Disney & Universal');
    const parentMail = h.services.outbox.mail.filter((m) => m.subject.startsWith('Funds applied'));
    expect(parentMail.map((m) => m.to).sort()).toEqual([PARENT2, PARENT].sort());
    expect(parentMail[0].text).toContain("$200.00 of Avery's activity funds was applied to Florida 2027 – Disney & Universal. Remaining: $1,300.00.");

    // Second decision conflicts; the sync does not re-post or re-notify.
    expect(h.err('admin.decideRedemption', { id: 'R-7f3a9c21', decision: 'Denied' }, admin).code).toBe('CONFLICT');
    h.clearOutbox();
    const report = h.app.syncTick();
    expect(report).toMatchObject({ redemptionsPosted: 0, balanceChanges: 0, errors: [] });
    expect(h.services.outbox.push).toHaveLength(0);
    expect(h.rows('Ledger').filter((r) => r.Reference === 'R-7f3a9c21')).toHaveLength(1);

    const avery = h.ok('me.bootstrap', {}, h.signIn(PARENT)).students[0];
    expect(avery).toMatchObject({ balanceCents: 44000, pendingCents: 0, availableCents: 44000 });
    expect(avery.activities[0]).toMatchObject({ paidFromFundsCents: 20000, paidDirectCents: 35000, remainingCents: 130000 });
  });

  it('does not post a second Ledger row when the treasurer already typed it (Reference = request ID)', () => {
    const h = harness();
    // SHEET.md: "make sure its Reference is the RequestID, and the app won't add a second one".
    h.services.db.tables.Ledger?.push({
      Date: '2026-10-21',
      StudentID: 'S0001',
      Type: 'Redemption',
      Description: 'Applied to FL27',
      Amount: -200,
      ActivityID: 'FL27',
      Reference: 'R-7f3a9c21',
    });
    const admin = h.signIn(TREASURER);
    h.clearOutbox();
    const { redemption } = h.ok('admin.decideRedemption', { id: 'R-7f3a9c21', decision: 'Approved' }, admin);
    expect(redemption.status).toBe('Approved');
    expect(h.rows('Ledger').filter((r) => r.Reference === 'R-7f3a9c21').map((r) => r.Amount)).toEqual([-200]);
    expect(h.rows('Redemptions')[0]).toMatchObject({ Status: 'Approved', Notified: '2026-10-21T14:00:00.000Z' });
    expect(h.services.outbox.mail.find((m) => m.to === PARENT)?.text).toContain('Remaining: $1,300.00.');

    const avery = h.ok('me.bootstrap', {}, h.signIn(PARENT)).students[0];
    expect(avery).toMatchObject({ balanceCents: 44000, pendingCents: 0, availableCents: 44000 });
    expect(avery.activities[0]).toMatchObject({ paidFromFundsCents: 20000, remainingCents: 130000 });
  });

  it('denies with a note and notifies the family', () => {
    const h = harness();
    const admin = h.signIn(TREASURER);
    h.clearOutbox();
    h.ok('admin.decideRedemption', { id: 'R-7f3a9c21', decision: 'Denied', adminNote: 'Please use it for camp.' }, admin);
    expect(h.rows('Ledger').some((r) => r.Reference === 'R-7f3a9c21')).toBe(false);
    const mail = h.services.outbox.mail.find((m) => m.to === PARENT);
    expect(mail?.subject).toBe('Funds request not approved');
    expect(mail?.text).toContain('Your request to apply $200.00 to Florida 2027 – Disney & Universal was not approved. Note: Please use it for camp.');
  });

  it('refuses to approve more than the student has available or the trip has left', () => {
    const h = harness();
    // The treasurer spent most of Avery's funds by hand after the request.
    h.services.db.tables.Ledger?.push({ Date: '2026-10-20', StudentID: 'S0001', Type: 'Adjustment', Description: 'Camp fee', Amount: -500 });
    const admin = h.signIn(TREASURER);
    expect(h.err('admin.decideRedemption', { id: 'R-7f3a9c21', decision: 'Approved' }, admin).message).toMatch(/only has \$140\.00 available/);

    const h2 = harness();
    h2.services.db.tables.Payments?.push({ Date: '2026-10-20', StudentID: 'S0001', ActivityID: 'FL27', Amount: 1400, Method: 'Check', Status: 'Completed' });
    expect(h2.err('admin.decideRedemption', { id: 'R-7f3a9c21', decision: 'Approved' }, h2.signIn(TREASURER)).message).toMatch(
      /Only \$100\.00 is left/,
    );
    expect(h2.rows('Redemptions')[0].Status).toBe('Pending');
  });

  it('is admin-only and validates input', () => {
    const h = harness();
    expect(h.err('admin.decideRedemption', { id: 'R-7f3a9c21', decision: 'Approved' }, h.signIn(PARENT)).code).toBe('FORBIDDEN');
    const admin = h.signIn(TREASURER);
    expect(h.err('admin.decideRedemption', { id: 'R-7f3a9c21', decision: 'Maybe' }, admin).code).toBe('BAD_REQUEST');
    expect(h.err('admin.decideRedemption', { id: 'R-nope', decision: 'Approved' }, admin).code).toBe('NOT_FOUND');
  });
});
