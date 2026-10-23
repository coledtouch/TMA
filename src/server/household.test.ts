import { describe, expect, it } from 'vitest';
import { harness, NGUYEN, ORTIZ, PARENT, PARENT2, TREASURER } from './test-helpers';

const NEW_PARENT = 'sam.rivera@example.org';

function signupInput(overrides: Record<string, unknown> = {}) {
  return {
    guardians: [
      { name: 'Sam Rivera', email: NEW_PARENT, phone: '(603) 555-0101' },
      { name: 'Alex Rivera', email: 'alex.rivera@example.org' },
    ],
    students: [
      { firstName: 'Mia', lastName: 'Rivera', grade: '9', school: 'high school', ensembles: ['band', 'Jazz Band'], instrument: 'Sax' },
      { firstName: 'Leo', lastName: 'Rivera', grade: 'k', school: 'Elementary', ensembles: [] },
    ],
    ...overrides,
  };
}

describe('household.save: sign-up', () => {
  it('creates a Pending household and Pending students, and tells the admins', () => {
    const h = harness();
    const token = h.signIn(NEW_PARENT);
    h.clearOutbox();
    const b = h.ok('household.save', signupInput(), token);

    expect(b.me).toMatchObject({ familyId: 'F0004', familyStatus: 'Pending', name: 'Sam Rivera' });
    expect(b.students.map((s) => [s.student.id, s.student.school, s.student.ensembles, s.verified])).toEqual([
      ['S0007', 'High School', ['Band', 'Jazz Band'], false],
      ['S0008', 'Elementary', [], false],
    ]);
    expect(b.students[1].student.grade).toBe('K');

    const family = h.rows('Families').find((r) => r.FamilyID === 'F0004');
    expect(family).toMatchObject({
      'Parent Name': 'Sam Rivera',
      Email: NEW_PARENT,
      Phone: '(603) 555-0101',
      'Parent 2 Email': 'alex.rivera@example.org',
      Status: 'Pending',
      Member: false,
    });
    expect(typeof family?.Created).toBe('string');
    const students = h.rows('Students').filter((r) => r.FamilyID === 'F0004');
    expect(students.map((r) => r.Status)).toEqual(['Pending', 'Pending']);
    expect(students[0].Ensembles).toBe('Band, Jazz Band');

    const adminMail = h.services.outbox.mail.find((m) => m.to === TREASURER);
    expect(adminMail?.subject).toBe('New family signed up');
    expect(adminMail?.text).toContain('Sam Rivera & Alex Rivera (2 students). Review in the app.');
  });

  it('refuses when a guardian email already belongs to another household', () => {
    const h = harness();
    const token = h.signIn(NEW_PARENT);
    const res = h.err(
      'household.save',
      signupInput({ guardians: [{ name: 'Sam Rivera', email: NEW_PARENT }, { name: 'Someone', email: NGUYEN }] }),
      token,
    );
    expect(res).toEqual({ code: 'CONFLICT', message: 'That email is already on a TMA household. Sign in with it or contact TMA.' });
    expect(h.rows('Families')).toHaveLength(3);
  });

  it('validates the input', () => {
    const h = harness();
    const token = h.signIn(NEW_PARENT);
    const bad = (input: Record<string, unknown>) => h.err('household.save', input, token);
    expect(bad(signupInput({ guardians: [] })).code).toBe('BAD_REQUEST');
    expect(bad(signupInput({ guardians: [{ name: 'Someone Else', email: 'else@example.org' }] })).message).toMatch(/own email/);
    expect(bad(signupInput({ guardians: [{ name: '', email: NEW_PARENT }] })).code).toBe('BAD_REQUEST');
    expect(bad(signupInput({ guardians: [{ name: 'x'.repeat(81), email: NEW_PARENT }] })).code).toBe('BAD_REQUEST');
    expect(bad(signupInput({ guardians: [{ name: 'Sam', email: NEW_PARENT, phone: 'call me' }] })).code).toBe('BAD_REQUEST');
    expect(
      bad(signupInput({ guardians: [{ name: 'A', email: NEW_PARENT }, { name: 'B', email: NEW_PARENT }] })).message,
    ).toMatch(/different email/);
    const student = (s: Record<string, unknown>) =>
      signupInput({ students: [{ firstName: 'Mia', lastName: 'Rivera', grade: '9', school: 'High School', ensembles: [], ...s }] });
    expect(bad(student({ grade: '13' })).message).toMatch(/grade/);
    expect(bad(student({ school: 'Hogwarts' })).message).toMatch(/school/);
    expect(bad(student({ ensembles: ['Kazoo'] })).message).toMatch(/groups/);
    expect(bad(student({ firstName: 'x'.repeat(41) })).code).toBe('BAD_REQUEST');
    expect(bad(signupInput({ students: Array.from({ length: 9 }, () => student({}).students[0]) })).code).toBe('BAD_REQUEST');
    expect(bad({ guardians: 'nope' }).code).toBe('BAD_REQUEST');
    expect(h.rows('Families')).toHaveLength(3);
  });

  it('makes the person signing up the first guardian', () => {
    const h = harness();
    h.ok(
      'household.save',
      { guardians: [{ name: 'Alex Rivera', email: 'alex.rivera@example.org' }, { name: 'Sam Rivera', email: NEW_PARENT }], students: [] },
      h.signIn(NEW_PARENT),
    );
    expect(h.rows('Families').pop()).toMatchObject({ Email: NEW_PARENT, 'Parent 2 Email': 'alex.rivera@example.org' });
  });

  it('never reuses a StudentID that other tabs still refer to', () => {
    const h = harness();
    // S0007's Students row is gone (deleted on request, or not imported yet), but its money rows remain.
    h.services.db.tables.Ledger?.push({ Date: '2026-09-01', StudentID: 'S0007', Type: 'Credit', Description: 'Carried over', Amount: 450 });
    h.services.db.tables.Enrollments?.push({ StudentID: 's0009', ActivityID: 'FL27', Status: 'Going' });
    h.services.db.tables.Payments?.push({ Date: '2026-09-01', StudentID: 'S0010', ActivityID: 'FL27', Amount: 100, Method: 'Check' });
    h.services.db.tables._Snapshot = [{ StudentID: 'S0011', Balance: 12, Updated: '2026-10-01' }];
    h.services.db.tables.Redemptions?.push({ RequestID: 'R-00000012', StudentID: 'S0012', ActivityID: 'FL27', Amount: 5, Status: 'Denied' });

    const token = h.signIn(NEW_PARENT);
    const b = h.ok('household.save', signupInput({ students: [{ firstName: 'Any', lastName: 'Name', grade: '10', school: 'High School', ensembles: [] }] }), token);
    expect(b.students.map((s) => s.student.id)).toEqual(['S0013']);

    // After a plain approval the new student starts from nothing.
    h.ok('admin.reviewHousehold', { familyId: b.me.familyId, decision: 'approve', links: [] }, h.signIn(TREASURER));
    const after = h.ok('me.bootstrap', {}, token);
    expect(after.students[0]).toMatchObject({ verified: true, balanceCents: 0, activities: [] });
    expect(after.ledger).toEqual([]);
  });

  it('never reuses a FamilyID that Students or Redemptions still refer to', () => {
    const h = harness();
    // F0004's Families row was deleted, but a treasurer student still points at it.
    h.services.db.tables.Students?.push({
      StudentID: 'S0100',
      FamilyID: 'F0004',
      'First Name': 'Riley',
      'Last Name': 'Doe',
      Grade: 10,
      School: 'High School',
      Status: 'Active',
    });
    h.services.db.tables.Ledger?.push({ Date: '2026-09-01', StudentID: 'S0100', Type: 'Credit', Description: 'Sale', Amount: 300 });
    h.services.db.tables.Redemptions?.push({ RequestID: 'R-00000005', FamilyID: 'F0005', StudentID: 'S0100', ActivityID: 'FL27', Amount: 5, Status: 'Denied' });

    const b = h.ok('household.save', signupInput({ students: [] }), h.signIn(NEW_PARENT));
    expect(b.me.familyId).toBe('F0006');
    expect(b.students).toEqual([]);
  });

  it('allows a household with no students yet', () => {
    const h = harness();
    const b = h.ok('household.save', { guardians: [{ name: 'Sam Rivera', email: NEW_PARENT }], students: [] }, h.signIn(NEW_PARENT));
    expect(b.me.familyStatus).toBe('Pending');
    expect(b.students).toEqual([]);
  });
});

describe('household.save: existing household', () => {
  it('updates guardians and students, appends new students as Pending, never deletes', () => {
    const h = harness();
    const token = h.signIn(PARENT);
    h.clearOutbox();
    const b = h.ok(
      'household.save',
      {
        guardians: [
          { name: 'Jordan R. Thompson', email: PARENT, phone: '603-555-0199' },
          { name: 'Casey Thompson', email: PARENT2, phone: '603-555-0123' },
        ],
        students: [
          // Active student: grade/school/groups change, the name change is only logged.
          { id: 'S0001', firstName: 'Avery-Lynn', lastName: 'Thompson', grade: '12', school: 'High School', ensembles: ['Band'], instrument: 'Cornet' },
          { firstName: 'Nora', lastName: 'Thompson', grade: '3', school: 'Elementary', ensembles: ['Chorus'] },
        ],
      },
      token,
    );
    expect(b.me.familyStatus).toBe('Active');
    const fam = h.rows('Families').find((r) => r.FamilyID === 'F0001');
    expect(fam).toMatchObject({ 'Parent Name': 'Jordan R. Thompson', Phone: '603-555-0199', 'Parent 2 Phone': '603-555-0123' });

    const avery = h.rows('Students').find((r) => r.StudentID === 'S0001');
    expect(avery).toMatchObject({ 'First Name': 'Avery', Grade: '12', Ensembles: 'Band', Instrument: 'Cornet', Status: 'Active' });
    expect(h.rows('Log').some((r) => r.Kind === 'name-change' && String(r.Detail).includes('Avery-Lynn'))).toBe(true);

    // Liam was omitted but not deleted; Nora is new and Pending.
    expect(b.students.map((s) => [s.student.firstName, s.student.status])).toEqual([
      ['Avery', 'Active'],
      ['Liam', 'Active'],
      ['Nora', 'Pending'],
    ]);
    expect(h.services.outbox.mail.find((m) => m.to === TREASURER)?.subject).toBe('New student to review');
  });

  it("keeps groups the treasurer typed that aren't on the Settings list when a parent saves", () => {
    const h = harness();
    const avery = h.services.db.tables.Students?.find((r) => r.StudentID === 'S0001');
    if (!avery) throw new Error('missing S0001');
    avery.Ensembles = 'Band, Pit Orchestra';
    const token = h.signIn(PARENT);
    // The app has no checkbox for "Pit Orchestra", so the form sends only the groups on the list.
    h.ok(
      'household.save',
      {
        guardians: [{ name: 'Jordan Thompson', email: PARENT }],
        students: [{ id: 'S0001', firstName: 'Avery', lastName: 'Thompson', grade: '11', school: 'High School', ensembles: ['Band', 'Jazz Band'] }],
      },
      token,
    );
    expect(h.rows('Students').find((r) => r.StudentID === 'S0001')?.Ensembles).toBe('Band, Jazz Band, Pit Orchestra');
    // Groups on the list are still the parent's to change.
    h.ok(
      'household.save',
      {
        guardians: [{ name: 'Jordan Thompson', email: PARENT }],
        students: [{ id: 'S0001', firstName: 'Avery', lastName: 'Thompson', grade: '11', school: 'High School', ensembles: [] }],
      },
      token,
    );
    expect(h.rows('Students').find((r) => r.StudentID === 'S0001')?.Ensembles).toBe('Pit Orchestra');
  });

  it('updates names of Pending students', () => {
    const h = harness();
    const token = h.signIn(ORTIZ);
    h.ok(
      'household.save',
      {
        guardians: [{ name: 'Marcus Ortiz', email: ORTIZ }],
        students: [{ id: 'S0006', firstName: 'Sofía', lastName: 'Ortiz', grade: '12', school: 'High School', ensembles: ['Chorus'] }],
      },
      token,
    );
    expect(h.rows('Students').find((r) => r.StudentID === 'S0006')?.['First Name']).toBe('Sofía');
  });

  it('rejects students of another household', () => {
    const h = harness();
    const token = h.signIn(PARENT);
    const res = h.err(
      'household.save',
      {
        guardians: [{ name: 'Jordan Thompson', email: PARENT }, { name: 'Casey Thompson', email: PARENT2 }],
        students: [{ id: 'S0003', firstName: 'Maya', lastName: 'Nguyen', grade: '10', school: 'High School', ensembles: [] }],
      },
      token,
    );
    expect(res.code).toBe('NOT_FOUND');
    expect(h.rows('Students').find((r) => r.StudentID === 'S0003')?.FamilyID).toBe('F0002');
  });

  it('keeps the first guardian and lets only them change the second', () => {
    const h = harness();
    const casey = h.signIn(PARENT2);
    // Casey (second guardian) cannot drop Jordan.
    expect(h.err('household.save', { guardians: [{ name: 'Casey Thompson', email: PARENT2 }], students: [] }, casey).code).toBe(
      'BAD_REQUEST',
    );
    // Jordan may replace Casey with a new email...
    const jordan = h.signIn(PARENT);
    h.ok(
      'household.save',
      { guardians: [{ name: 'Jordan Thompson', email: PARENT }, { name: 'Pat Thompson', email: 'pat@example.org' }], students: [] },
      jordan,
    );
    const fam = h.rows('Families').find((r) => r.FamilyID === 'F0001');
    expect(fam).toMatchObject({ 'Parent 2 Name': 'Pat Thompson', 'Parent 2 Email': 'pat@example.org' });
    // ...but not with an email already on another household.
    expect(
      h.err('household.save', { guardians: [{ name: 'Jordan Thompson', email: PARENT }, { name: 'Priya', email: NGUYEN }] }, jordan).code,
    ).toBe('CONFLICT');
  });

  it('lets an email someone else typed in as second guardian leave, and sign up on its own', () => {
    const h = harness();
    const VICTIM = 'real.parent@example.org';
    const mallory = h.signIn(NEW_PARENT);
    h.ok('household.save', { guardians: [{ name: 'Mallory', email: NEW_PARENT }, { name: 'Pat Real', email: VICTIM }], students: [] }, mallory);
    const victim = h.signIn(VICTIM);
    expect(h.ok('me.bootstrap', {}, victim).me).toMatchObject({ familyId: 'F0004', familyStatus: 'Pending' });

    const left = h.ok('household.save', { guardians: [{ name: 'Pat Real', email: VICTIM }], students: [], leave: true }, victim);
    expect(left.me).toMatchObject({ familyId: null, familyStatus: 'None' });
    expect(h.rows('Families').find((r) => r.FamilyID === 'F0004')).toMatchObject({ Email: NEW_PARENT, 'Parent 2 Email': '', 'Parent 2 Name': '' });

    const own = h.ok(
      'household.save',
      { guardians: [{ name: 'Pat Real', email: VICTIM }], students: [{ firstName: 'Avery', lastName: 'Real', grade: '11', school: 'High School', ensembles: [] }] },
      victim,
    );
    expect(own.me).toMatchObject({ familyId: 'F0005', familyStatus: 'Pending' });
    expect(h.ok('me.bootstrap', {}, mallory).students).toEqual([]);
    // A first guardian (now including Pat, of their own household) can't leave in the app.
    expect(h.err('household.save', { guardians: [{ name: 'Pat Real', email: VICTIM }], students: [], leave: true }, victim).code).toBe('BAD_REQUEST');
    expect(h.err('household.save', { guardians: [], students: [], leave: true }, h.signIn(PARENT)).code).toBe('BAD_REQUEST');
  });

  it('does not lock a second guardian out when the household that listed them is rejected', () => {
    const h = harness();
    const VICTIM = 'real.parent@example.org';
    h.ok('household.save', { guardians: [{ name: 'Mallory', email: NEW_PARENT }, { name: 'Pat Real', email: VICTIM }], students: [] }, h.signIn(NEW_PARENT));
    h.ok('admin.reviewHousehold', { familyId: 'F0004', decision: 'reject' }, h.signIn(TREASURER));

    const victim = h.signIn(VICTIM);
    expect(h.ok('me.bootstrap', {}, victim).me.familyStatus).toBe('None');
    const own = h.ok('household.save', { guardians: [{ name: 'Pat Real', email: VICTIM }], students: [] }, victim);
    expect(own.me).toMatchObject({ familyId: 'F0005', familyStatus: 'Pending' });
    // The rejected household's own first guardian still has to contact TMA.
    expect(h.err('household.save', { guardians: [{ name: 'Mallory', email: NEW_PARENT }], students: [] }, h.signIn(NEW_PARENT)).code).toBe('FORBIDDEN');
  });

  it('refuses Inactive households', () => {
    const h = harness();
    const fam = h.services.db.tables.Families?.find((r) => r.FamilyID === 'F0002');
    if (fam) fam.Status = 'Inactive';
    const res = h.err(
      'household.save',
      { guardians: [{ name: 'Priya Nguyen', email: NGUYEN }], students: [] },
      h.signIn(NGUYEN),
    );
    expect(res.code).toBe('FORBIDDEN');
  });

  it('caps students per household', () => {
    const h = harness();
    const token = h.signIn(PARENT);
    const kid = (n: number) => ({ firstName: `Kid${n}`, lastName: 'Thompson', grade: '1', school: 'Elementary', ensembles: [] });
    const guardians = [{ name: 'Jordan Thompson', email: PARENT }, { name: 'Casey Thompson', email: PARENT2 }];
    h.ok('household.save', { guardians, students: [1, 2, 3, 4, 5, 6, 7, 8].map(kid) }, token);
    expect(h.err('household.save', { guardians, students: [kid(9)] }, token).message).toMatch(/at most 10/);
  });
});
