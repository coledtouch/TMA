import { describe, expect, it } from 'vitest';
import { SIGN_IN_EMAIL_RESERVE } from './notify';
import type { MailMessage, MailResult } from './services';
import { harness, NGUYEN, ORTIZ, PARENT, PARENT2, storedToken, testSubscription, TREASURER } from './test-helpers';

describe('admin.overview', () => {
  it("shows the Gmail backup's quota when the mailer relays email (e.g. the push Worker as noreply@mytma.org)", () => {
    const h = harness();
    const admin = h.signIn(TREASURER);
    h.services.mailer.remainingQuota = () => 1000;
    h.services.mailer.relayStatus = () => ({ from: 'noreply@mytma.org', backupRemaining: 42 });
    expect(h.ok('admin.overview', {}, admin).stats).toMatchObject({
      emailQuotaRemaining: 1000,
      emailFrom: 'noreply@mytma.org',
      emailBackupRemaining: 42,
    });
    h.services.mailer.relayStatus = () => null;
    const stats = h.ok('admin.overview', {}, admin).stats;
    expect(stats.emailFrom).toBeUndefined();
    expect(stats.emailBackupRemaining).toBeUndefined();
  });

  it('summarizes stats, pending requests, pending households with match candidates, and the log', () => {
    const h = harness();
    const admin = h.signIn(TREASURER);
    const o = h.ok('admin.overview', {}, admin);
    expect(o.stats).toEqual({
      families: 3,
      activeFamilies: 2,
      pendingFamilies: 1,
      students: 6,
      totalFundsCents: 64000 + 8500 + 41000 + 3500 + 52000,
      pushDevices: 1,
      emailQuotaRemaining: expect.any(Number),
    });
    expect(o.pendingRedemptions).toHaveLength(1);
    expect(o.pendingRedemptions[0]).toMatchObject({
      id: 'R-7f3a9c21',
      studentName: 'Avery Thompson',
      activityName: 'Florida 2027 – Disney & Universal',
      availableCents: 64000, // excluding this request
      remainingCents: 150000,
    });

    expect(o.pendingHouseholds).toHaveLength(1);
    const ortiz = o.pendingHouseholds[0];
    expect(ortiz.family.id).toBe('F0003');
    expect(ortiz.students).toHaveLength(1);
    expect(ortiz.students[0].student.id).toBe('S0006');
    expect(ortiz.students[0].candidates).toEqual([
      { studentId: 'S0005', name: 'Sofia Ortiz', grade: '12', school: 'High School', familyId: null, balanceCents: 52000, score: 1 },
    ]);
    expect(Array.isArray(o.recentLog)).toBe(true);
  });

  it('scores candidates by last name, first name (exact or prefix) and grade, best first', () => {
    const h = harness();
    const students = h.services.db.tables.Students ?? [];
    students.push(
      { StudentID: 'S0100', 'First Name': 'Sofi', 'Last Name': "O'Ortiz", Grade: 12, School: 'High School', Status: 'Active' },
      { StudentID: 'S0101', 'First Name': 'Sofia', 'Last Name': 'Ortiz', Grade: 9, School: 'High School', Status: 'Active' },
      { StudentID: 'S0102', 'First Name': 'Mateo', 'Last Name': 'ORTIZ', Grade: 12, School: 'High School', Status: 'Active' },
      { StudentID: 'S0103', 'First Name': 'Sofia', 'Last Name': 'Ortiz', Grade: 12, School: 'High School', Status: 'Inactive' },
      { StudentID: 'S0104', 'First Name': 'Sofia', 'Last Name': 'Ortega', Grade: 12, School: 'High School', Status: 'Active' },
    );
    const o = h.ok('admin.overview', {}, h.signIn(TREASURER));
    const candidates = o.pendingHouseholds[0].students[0].candidates;
    expect(candidates.map((c) => [c.studentId, c.score])).toEqual([
      ['S0005', 1],
      ['S0101', 0.9],
      ['S0102', 0.7],
    ]);
  });

  it('lists Active households that added a Pending student', () => {
    const h = harness();
    h.ok(
      'household.save',
      { guardians: [{ name: 'Jordan Thompson', email: PARENT }, { name: 'Casey Thompson', email: PARENT2 }], students: [{ firstName: 'Nora', lastName: 'Thompson', grade: '3', school: 'Elementary', ensembles: [] }] },
      h.signIn(PARENT),
    );
    const o = h.ok('admin.overview', {}, h.signIn(TREASURER));
    const thompson = o.pendingHouseholds.find((p) => p.family.id === 'F0001');
    expect(thompson?.students.map((s) => s.student.firstName)).toEqual(['Nora']);
  });

  it('warns the reviewer about records that already point at a pending household or student', () => {
    const h = harness();
    // Rows left over from before this household signed up (e.g. a deleted family whose IDs were reused).
    h.services.db.tables.Families?.push({ FamilyID: 'F0009', 'Parent Name': 'Pat New', Email: 'pat.new@example.org', Status: 'Pending' });
    h.services.db.tables.Students?.push(
      { StudentID: 'S0090', FamilyID: 'F0009', 'First Name': 'Any', 'Last Name': 'Name', Grade: 9, School: 'High School', Status: 'Pending' },
      { StudentID: 'S0091', FamilyID: 'F0009', 'First Name': 'Riley', 'Last Name': 'Doe', Grade: 10, School: 'High School', Status: 'Active' },
    );
    h.services.db.tables.Ledger?.push({ Date: '2026-09-01', StudentID: 'S0090', Type: 'Credit', Description: 'Carried over', Amount: 450 });
    h.services.db.tables.Enrollments?.push({ StudentID: 'S0090', ActivityID: 'FL27', Status: 'Going' });
    h.services.db.tables.Redemptions?.push({ RequestID: 'R-00000009', FamilyID: 'F0009', StudentID: 'S0091', ActivityID: 'FL27', Amount: 5, Status: 'Denied' });

    const o = h.ok('admin.overview', {}, h.signIn(TREASURER));
    const pat = o.pendingHouseholds.find((p) => p.family.id === 'F0009');
    expect(pat?.students.map((s) => s.student.id)).toEqual(['S0090']);
    expect(pat?.warnings).toEqual([
      expect.stringMatching(/^S0090 \(Any Name\) already has rows in Ledger, Enrollments from an earlier student/),
      expect.stringMatching(/^S0091 \(Riley Doe, Active\) is already linked to F0009/),
      expect.stringMatching(/^F0009 already has 1 row\(s\) in Redemptions/),
    ]);
    // Households with nothing to check carry no warnings.
    expect(o.pendingHouseholds.find((p) => p.family.id === 'F0003')?.warnings).toBeUndefined();
  });

  it('is admin-only', () => {
    const h = harness();
    expect(h.err('admin.overview', {}, h.signIn(PARENT)).code).toBe('FORBIDDEN');
  });
});

describe('admin.reviewHousehold', () => {
  it('approves and merges a self-registered student into the treasurer record', () => {
    const h = harness();
    const admin = h.signIn(TREASURER);
    h.clearOutbox();
    const { family } = h.ok(
      'admin.reviewHousehold',
      { familyId: 'F0003', decision: 'approve', links: [{ pendingStudentId: 'S0006', existingStudentId: 'S0005' }] },
      admin,
    );
    expect(family.status).toBe('Active');
    const rows = h.rows('Students');
    expect(rows.find((r) => r.StudentID === 'S0005')).toMatchObject({ FamilyID: 'F0003', Status: 'Active' });
    expect(rows.find((r) => r.StudentID === 'S0006')).toMatchObject({ Status: 'Inactive' });
    expect(h.rows('Log').some((r) => String(r.Detail).includes('S0006 (Sofia Ortiz) merged into S0005'))).toBe(true);

    const mail = h.services.outbox.mail.find((m) => m.to === ORTIZ);
    expect(mail?.subject).toBe("You're all set!");

    // Marcus now sees Sofia's existing balance and trip, and no balance-change alert fires.
    const b = h.ok('me.bootstrap', {}, h.signIn(ORTIZ));
    expect(b.students.map((s) => [s.student.id, s.verified, s.balanceCents])).toEqual([['S0005', true, 52000]]);
    expect(b.students[0].activities.map((a) => a.activityId)).toEqual(['FL27']);
    h.clearOutbox();
    expect(h.app.syncTick().balanceChanges).toBe(0);
  });

  it('approves without links: pending students become Active', () => {
    const h = harness();
    h.ok('admin.reviewHousehold', { familyId: 'F0003', decision: 'approve' }, h.signIn(TREASURER));
    expect(h.rows('Students').find((r) => r.StudentID === 'S0006')?.Status).toBe('Active');
    expect(h.rows('Families').find((r) => r.FamilyID === 'F0003')?.Status).toBe('Active');
  });

  it('rejects a pending household and its pending students', () => {
    const h = harness();
    h.clearOutbox();
    const { family } = h.ok('admin.reviewHousehold', { familyId: 'F0003', decision: 'reject' }, h.signIn(TREASURER));
    expect(family.status).toBe('Inactive');
    expect(h.rows('Students').find((r) => r.StudentID === 'S0006')?.Status).toBe('Inactive');
    expect(h.services.outbox.mail.filter((m) => m.to === ORTIZ)).toHaveLength(0);
    // The rejected household can no longer change anything.
    expect(h.err('household.save', { guardians: [{ name: 'Marcus Ortiz', email: ORTIZ }] }, h.signIn(ORTIZ)).code).toBe('FORBIDDEN');
  });

  it('rejecting a new student keeps a verified household Active', () => {
    const h = harness();
    h.ok(
      'household.save',
      { guardians: [{ name: 'Jordan Thompson', email: PARENT }, { name: 'Casey Thompson', email: PARENT2 }], students: [{ firstName: 'Nora', lastName: 'Thompson', grade: '3', school: 'Elementary', ensembles: [] }] },
      h.signIn(PARENT),
    );
    const { family } = h.ok('admin.reviewHousehold', { familyId: 'F0001', decision: 'reject' }, h.signIn(TREASURER));
    expect(family.status).toBe('Active');
    expect(h.rows('Students').find((r) => r['First Name'] === 'Nora')?.Status).toBe('Inactive');
  });

  it('validates links and never moves a student out of another active household', () => {
    const h = harness();
    const admin = h.signIn(TREASURER);
    const review = (links: unknown) => h.err('admin.reviewHousehold', { familyId: 'F0003', decision: 'approve', links }, admin);
    expect(review([{ pendingStudentId: 'S0001', existingStudentId: 'S0005' }]).code).toBe('BAD_REQUEST');
    expect(review([{ pendingStudentId: 'S0006', existingStudentId: 'S9999' }]).code).toBe('BAD_REQUEST');
    expect(review([{ pendingStudentId: 'S0006', existingStudentId: 'S0003' }]).code).toBe('CONFLICT');
    expect(review('nope').code).toBe('BAD_REQUEST');
    // Nothing changed.
    expect(h.rows('Families').find((r) => r.FamilyID === 'F0003')?.Status).toBe('Pending');
    expect(h.rows('Students').find((r) => r.StudentID === 'S0003')?.FamilyID).toBe('F0002');
    expect(h.err('admin.reviewHousehold', { familyId: 'F0404', decision: 'approve' }, admin).code).toBe('NOT_FOUND');
    expect(h.err('admin.reviewHousehold', { familyId: 'F0003', decision: 'approve' }, h.signIn(PARENT)).code).toBe('FORBIDDEN');
  });
});

describe('admin.announce', () => {
  it('targets by audience and each recipient’s prefs, on the chosen channels', () => {
    const h = harness();
    // A signed-in parent without a household gets "everything" (no interests).
    const newbie = h.signIn('newbie@example.org');
    const newbieDevice = testSubscription('newbie');
    h.ok('push.register', { token: JSON.stringify(newbieDevice) }, newbie);
    // Casey turned email off; Priya turned announcements off.
    h.ok('prefs.save', { prefs: { channels: { push: true, email: false, sms: false } } }, h.signIn(PARENT2));
    h.ok('prefs.save', { prefs: { topics: { balance: true, payments: true, reminders: true, announcements: false } } }, h.signIn(NGUYEN));
    const admin = h.signIn(TREASURER);
    h.clearOutbox();

    const { announcement, delivered } = h.ok(
      'admin.announce',
      {
        title: 'Jazz Band rehearsal moved',
        body: 'Thursday rehearsal moves to 6 PM in the band room.\n\nThanks!',
        audience: { schools: ['high school'], ensembles: ['Jazz Band'] },
        channels: { push: true, email: true, sms: false },
        link: 'https://example.org/jazz',
      },
      admin,
    );
    expect(announcement).toMatchObject({
      title: 'Jazz Band rehearsal moved',
      audience: { schools: ['High School'], ensembles: ['Jazz Band'] },
      date: '2026-10-21',
      link: 'https://example.org/jazz',
    });
    expect(announcement.id).toMatch(/^A-[0-9a-f]{8}$/);
    expect(h.rows('Announcements').pop()).toMatchObject({ Schools: 'High School', Ensembles: 'Jazz Band', Sent: '2026-10-21T14:00:00.000Z' });

    // Thompsons match (HS + Jazz Band). Jordan: push (demo device) + email. Casey: no email, no device.
    // Newbie: push. Nguyens: Orchestra only and announcements off. Ortiz: Chorus only.
    const mailTo = h.services.outbox.mail.map((m) => m.to).sort();
    expect(mailTo).toEqual([PARENT, 'newbie@example.org'].sort());
    const pushedTokens = h.services.outbox.push.flatMap((p) => p.tokens).sort();
    expect(pushedTokens).toEqual(['demo-device-parent', storedToken(newbieDevice)].sort());
    expect(delivered).toEqual({ push: 2, email: 2, sms: 0 });

    const email = h.services.outbox.mail[0];
    expect(email.html).toContain('href="https://example.org/jazz"');
    expect(email.text).toContain('Thursday rehearsal moves to 6 PM');

    // The parents now see it in News; the Nguyens don't (audience mismatch).
    expect(h.ok('me.bootstrap', {}, h.signIn(PARENT)).announcements[0].title).toBe('Jazz Band rehearsal moved');
    expect(h.ok('me.bootstrap', {}, h.signIn(NGUYEN)).announcements.map((a) => a.title)).not.toContain('Jazz Band rehearsal moved');

    // The sync does not send it again.
    h.clearOutbox();
    expect(h.app.syncTick().announcementsSent).toBe(0);
    expect(h.services.outbox.mail).toHaveLength(0);
  });

  it('respects the admin channel choice and validates input', () => {
    const h = harness();
    const admin = h.signIn(TREASURER);
    h.clearOutbox();
    const { delivered } = h.ok(
      'admin.announce',
      { title: 'Hello', body: 'Everyone', audience: { schools: [], ensembles: [] }, channels: { push: true, email: false, sms: false } },
      admin,
    );
    expect(delivered.email).toBe(0);
    expect(h.services.outbox.mail).toHaveLength(0);
    expect(delivered.push).toBe(1);

    const bad = (p: Record<string, unknown>) =>
      h.err('admin.announce', { title: 'T', body: 'B', audience: { schools: [], ensembles: [] }, channels: { push: true }, ...p }, admin);
    expect(bad({ title: '' }).code).toBe('BAD_REQUEST');
    expect(bad({ title: 'x'.repeat(121) }).code).toBe('BAD_REQUEST');
    expect(bad({ body: 'x'.repeat(2001) }).code).toBe('BAD_REQUEST');
    expect(bad({ audience: { schools: ['Hogwarts'], ensembles: [] } }).code).toBe('BAD_REQUEST');
    expect(bad({ channels: { push: false, email: false, sms: false } }).code).toBe('BAD_REQUEST');
    expect(bad({ link: 'javascript:alert(1)' }).code).toBe('BAD_REQUEST');
    expect(h.err('admin.announce', { title: 'T', body: 'B', channels: { push: true } }, h.signIn(PARENT)).code).toBe('FORBIDDEN');
  });

  it('emails through mailer.sendMany in one batch when the mailer has it, logging each failed recipient', () => {
    const h = harness();
    const admin = h.signIn(TREASURER);
    h.clearOutbox();
    const batches: MailMessage[][] = [];
    h.services.mailer.sendMany = (msgs) => {
      batches.push(msgs);
      return msgs.map((m, i): MailResult => (i === 0 ? { ok: false, error: `refused ${m.to}` } : { ok: true }));
    };
    const { delivered } = h.ok(
      'admin.announce',
      { title: 'Concert', body: 'Friday', audience: { schools: [], ensembles: [] }, channels: { email: true } },
      admin,
    );
    expect(batches).toHaveLength(1);
    const recipients = batches[0].map((m) => m.to);
    expect(recipients.length).toBeGreaterThan(1);
    expect(new Set(recipients).size).toBe(recipients.length);
    expect(batches[0].every((m) => m.subject === 'Concert' && m.html.includes('Friday') && m.text.includes('Friday'))).toBe(true);
    expect(delivered.email).toBe(recipients.length - 1);
    expect(h.services.outbox.mail).toHaveLength(0); // send() was not used
    expect(h.services.logs.filter((l) => l.level === 'error').map((l) => l.message)).toEqual([`email to ${recipients[0]} failed`]);
  });

  it('with sendMany, keeps to the quota minus the sign-in reserve, and a failed email does not use up quota', () => {
    const h = harness();
    const admin = h.signIn(TREASURER);
    h.clearOutbox();
    h.services.mailer.remainingQuota = () => SIGN_IN_EMAIL_RESERVE + 2;
    const batches: string[][] = [];
    h.services.mailer.sendMany = (msgs) => {
      batches.push(msgs.map((m) => m.to));
      // The very first email fails; everything else goes out.
      return msgs.map((_, i): MailResult => (batches.length === 1 && i === 0 ? { ok: false, error: 'x' } : { ok: true }));
    };
    const { delivered } = h.ok(
      'admin.announce',
      { title: 'Concert', body: 'Friday', audience: { schools: [], ensembles: [] }, channels: { email: true } },
      admin,
    );
    expect(delivered.email).toBe(2);
    expect(batches.map((b) => b.length)).toEqual([2, 1]);
    expect(h.rows('Log').some((r) => String(r.Detail).includes('email skipped: daily quota used up'))).toBe(true);
  });

  it('refuses to send the same announcement twice in a row (a retry after the app timed out)', () => {
    const h = harness();
    const admin = h.signIn(TREASURER);
    const params = { title: 'Concert moved', body: 'Now at 7 PM.', audience: {}, channels: { push: true, email: true } };
    h.ok('admin.announce', params, admin);
    h.clearOutbox();
    expect(h.err('admin.announce', params, admin)).toEqual({ code: 'CONFLICT', message: expect.stringMatching(/already sent 1 minute ago/) });
    expect(h.services.outbox.mail).toHaveLength(0);
    expect(h.rows('Announcements').filter((r) => r.Title === 'Concert moved')).toHaveLength(1);
    // A different message, or the same one much later, is fine.
    h.ok('admin.announce', { ...params, body: 'Now at 7:30 PM.' }, admin);
    h.services.setNow(new Date(Date.parse('2026-10-21T14:00:00.000Z') + 16 * 60 * 1000));
    h.ok('admin.announce', params, h.signIn(TREASURER));
  });

  it('escapes HTML from titles and bodies in emails', () => {
    const h = harness();
    const admin = h.signIn(TREASURER);
    h.clearOutbox();
    h.ok(
      'admin.announce',
      { title: '<b>Bold</b> & "quotes"', body: '<script>alert(1)</script>', audience: { schools: [], ensembles: [] }, channels: { email: true } },
      admin,
    );
    const mail = h.services.outbox.mail[0];
    expect(mail.html).not.toContain('<script>');
    expect(mail.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(mail.html).toContain('&lt;b&gt;Bold&lt;/b&gt; &amp; &quot;quotes&quot;');
    expect(mail.subject).toBe('<b>Bold</b> & "quotes"');
  });
});
