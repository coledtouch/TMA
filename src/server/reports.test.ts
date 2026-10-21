import type { ActivityAccount, Report, ReportKind } from '../shared/types';
import { MAX_REPORT_ROWS, REPORT_KINDS, schoolYear, tripStatus } from './reports';
import type { RowData } from './services';
import { harness, NGUYEN, PARENT, PARENT2, TREASURER, type Harness } from './test-helpers';

// The sample data is relative to TEST_NOW (Wed 2026-10-21, New York), so these dates are fixed:
// FL27 deposit due 2026-11-15 and final 2027-01-29, CAMP27 due 2027-05-09, LESSONS due 2026-11-04,
// NYC25 (closed) due 2026-04-04. This school year is 2026-07-01 to 2027-06-30.

function report(h: Harness, kind: ReportKind, filters?: Record<string, unknown>, token = h.signIn(TREASURER)): Report {
  return h.ok('admin.report', filters === undefined ? { kind } : { kind, filters }, token).report;
}

function push(h: Harness, table: 'Activities' | 'Enrollments' | 'Payments' | 'Ledger' | 'Students' | 'Families' | 'Preferences' | 'Devices' | 'Redemptions', ...rows: RowData[]) {
  const list = h.services.db.tables[table] ?? (h.services.db.tables[table] = []);
  list.push(...rows);
}

const pick = (r: Report, ...keys: string[]) => r.rows.map((row) => keys.map((k) => row[k]));

describe('admin.report: access and contract', () => {
  it('is for board members only', () => {
    const h = harness();
    expect(h.err('admin.report', { kind: 'roster' }, h.signIn(PARENT))).toEqual({
      code: 'FORBIDDEN',
      message: 'Only TMA board members can do that.',
    });
    expect(h.err('admin.report', { kind: 'roster' }).code).toBe('UNAUTHORIZED');
  });

  it('answers every kind with columns, rows keyed by column, the applied filters and the filter choices', () => {
    const h = harness();
    const admin = h.signIn(TREASURER);
    for (const kind of REPORT_KINDS) {
      const { report: r, options } = h.ok('admin.report', { kind }, admin);
      expect(r.kind).toBe(kind);
      expect(r.generatedAt).toBe('2026-10-21T14:00:00.000Z');
      expect(r.title).toMatch(/^[A-Z]/);
      expect(r.description.length).toBeGreaterThan(20);
      const keys = r.columns.map((c) => c.key);
      expect(new Set(keys).size).toBe(keys.length);
      for (const row of r.rows) expect(Object.keys(row).sort()).toEqual([...keys].sort());
      // Totals are keyed by money/number columns (fund-activity: credits, debits, net).
      for (const key of Object.keys(r.totals ?? {})) {
        const column = r.columns.find((c) => c.key === key);
        if (column) expect(['money', 'number']).toContain(column.type);
        else expect(kind === 'fund-activity' && ['credits', 'debits', 'net'].includes(key)).toBe(true);
      }
      expect(options).toEqual({
        activities: [
          { id: 'FL27', name: 'Florida 2027 – Disney & Universal', open: true },
          { id: 'CAMP27', name: 'Marching Band Camp 2027', open: true },
          { id: 'LESSONS', name: 'TRSD Private Lessons 2026–27', open: true },
          { id: 'NYC25', name: 'New York City 2025', open: false },
        ],
        schools: ['High School', 'Middle School', 'Elementary'],
        ensembles: ['Band', 'Marching Band', 'Jazz Band', 'Orchestra', 'Chorus', 'Guitar'],
      });
    }
  });

  it('never writes to the sheet (the roster only adds its Log row)', () => {
    const h = harness();
    const admin = h.signIn(TREASURER);
    const before = JSON.stringify(h.services.db.tables);
    for (const kind of REPORT_KINDS.filter((k) => k !== 'roster')) report(h, kind, {}, admin);
    expect(JSON.stringify(h.services.db.tables)).toBe(before);
  });

  it('never includes push tokens, notification JSON or other secrets', () => {
    const h = harness();
    push(h, 'Preferences', { Email: PARENT, FamilyID: 'F0001', Prefs: JSON.stringify({ channels: { push: true, email: false, sms: false } }) });
    const admin = h.signIn(TREASURER);
    const all = JSON.stringify(REPORT_KINDS.map((k) => report(h, k, {}, admin)));
    expect(all).not.toContain('demo-device-parent');
    expect(all).not.toContain('"channels"');
    expect(all).not.toMatch(/TOKEN_SECRET|aaaaaaaa/);
  });
});

describe('admin.report: filters', () => {
  const h = harness();
  const admin = h.signIn(TREASURER);
  const bad = (filters: unknown, kind: ReportKind = 'payments') => h.err('admin.report', { kind, filters }, admin);

  it('rejects unknown reports and malformed filters with a clear message', () => {
    expect(h.err('admin.report', { kind: 'everything' }, admin)).toEqual({
      code: 'BAD_REQUEST',
      message: expect.stringMatching(/^Report must be one of: trip-balances, student-funds, .*app-usage\.$/),
    });
    expect(h.err('admin.report', {}, admin).code).toBe('BAD_REQUEST');
    expect(bad('all')).toEqual({ code: 'BAD_REQUEST', message: 'Filters is missing or invalid.' });
    expect(bad({ activityId: 'ZZ99' }).message).toBe('Activity "ZZ99" is not in the Activities tab.');
    expect(bad({ school: 'College' }, 'roster').message).toBe('School "College" is not in Settings SCHOOLS.');
    expect(bad({ ensemble: 'Kazoo Choir' }, 'roster').message).toBe('Group "Kazoo Choir" is not in Settings ENSEMBLES.');
    expect(bad({ school: 7 }, 'roster').message).toBe('School must be text.');
    expect(bad({ from: '10/01/2026' }).message).toBe('From must be a date like 2026-07-01.');
    expect(bad({ to: 20261001 }).message).toBe('To must be a date like 2026-07-01.');
    expect(bad({ from: '2026-02-30' }).message).toBe('From is not a real date.');
    expect(bad({ from: '2026-07-01T00:00:00Z' }).message).toBe('From must be a date like 2026-07-01.');
    expect(bad({ from: '2026-10-02', to: '2026-10-01' }).message).toBe('The start date must be on or before the end date.');
    expect(bad({ includePaid: 'yes' }, 'trip-balances').message).toBe('Include paid must be true or false.');
  });

  it('checks every filter given, even ones the report does not use', () => {
    expect(bad({ activityId: 'NOPE' }, 'roster').message).toBe('Activity "NOPE" is not in the Activities tab.');
  });

  it('defaults the dates to this school year (Jul 1 – Jun 30), or the school year of the one date given', () => {
    expect(report(h, 'payments', {}, admin).filters).toEqual({ from: '2026-07-01', to: '2027-06-30' });
    expect(report(h, 'payments', { from: '2026-01-15' }, admin).filters).toEqual({ from: '2026-01-15', to: '2026-06-30' });
    expect(report(h, 'payments', { to: '2025-12-31' }, admin).filters).toEqual({ from: '2025-07-01', to: '2025-12-31' });
    expect(report(h, 'payments', { from: '2026-10-01', to: '2026-10-01' }, admin).filters).toEqual({ from: '2026-10-01', to: '2026-10-01' });
  });

  it('keeps only the filters a report uses, with the sheet spelling, and treats blanks as "all"', () => {
    expect(report(h, 'trip-balances', { activityId: ' fl27 ', school: 'high school', ensemble: 'JAZZ BAND' }, admin).filters).toEqual({
      activityId: 'FL27',
      school: 'High School',
      ensemble: 'Jazz Band',
      includePaid: false,
    });
    expect(report(h, 'student-funds', { from: '2026-01-01', activityId: 'FL27', includePaid: true }, admin).filters).toEqual({});
    expect(report(h, 'roster', { activityId: '', school: null, ensemble: '  ' }, admin).filters).toEqual({});
    expect(report(h, 'open-items', { school: 'Elementary' }, admin).filters).toEqual({});
    expect(report(h, 'fund-activity', { activityId: 'NYC25' }, admin).filters).toEqual({ from: '2026-07-01', to: '2027-06-30', activityId: 'NYC25' });
  });

  it('works out "this school year" from the New York date, not the UTC one', () => {
    // 11:30 PM on June 30 in New York is already July 1 in UTC.
    const june = harness({ now: new Date('2026-07-01T03:30:00.000Z') });
    expect(report(june, 'fund-activity').filters).toEqual({ from: '2025-07-01', to: '2026-06-30' });
    const july = harness({ now: new Date('2026-07-01T04:30:00.000Z') });
    expect(report(july, 'fund-activity').filters).toEqual({ from: '2026-07-01', to: '2027-06-30' });
  });

  it('schoolYear turns over on July 1', () => {
    expect(schoolYear('2026-06-30')).toEqual({ from: '2025-07-01', to: '2026-06-30' });
    expect(schoolYear('2026-07-01')).toEqual({ from: '2026-07-01', to: '2027-06-30' });
    expect(schoolYear('2027-01-01')).toEqual({ from: '2026-07-01', to: '2027-06-30' });
  });
});

describe('trip-balances', () => {
  it('lists what each going student still owes on open activities, with the numbers the app shows', () => {
    const h = harness();
    const r = report(h, 'trip-balances');
    expect(r.title).toBe('Trip balances');
    expect(r.filters).toEqual({ includePaid: false });
    expect(r.containsContactInfo).toBe(true); // parent emails
    expect(r.columns.map((c) => c.key)).toEqual([
      'activity', 'activityId', 'student', 'studentId', 'familyId', 'parentName', 'parentEmail', 'school', 'enrollment',
      'cost', 'paidFromFunds', 'paidDirect', 'pending', 'remaining', 'deposit', 'depositDue', 'dueDate', 'status',
    ]);
    // Sorted by activity name, then student last/first name.
    expect(pick(r, 'activityId', 'studentId', 'cost', 'paidFromFunds', 'paidDirect', 'pending', 'remaining', 'status')).toEqual([
      ['FL27', 'S0003', 185000, 35000, 0, 0, 150000, 'Owes'], // Maya: $350 of funds applied to the deposit
      ['FL27', 'S0005', 185000, 0, 0, 0, 185000, 'Owes'], // Sofia: treasurer-only record, no household
      ['FL27', 'S0001', 185000, 0, 35000, 20000, 150000, 'Owes'], // Avery: $350 check + $200 request pending
      ['CAMP27', 'S0001', 27500, 0, 0, 0, 27500, 'Owes'],
      ['LESSONS', 'S0003', 36000, 0, 0, 0, 36000, 'Owes'], // cost from the Enrollments row
    ]);
    expect(r.rows[2]).toMatchObject({
      activity: 'Florida 2027 – Disney & Universal',
      student: 'Avery Thompson',
      familyId: 'F0001',
      parentName: 'Jordan Thompson',
      parentEmail: PARENT,
      school: 'High School',
      enrollment: 'Going',
      deposit: 35000,
      depositDue: '2026-11-15',
      dueDate: '2027-01-29',
    });
    expect(r.rows[1]).toMatchObject({ familyId: null, parentName: null, parentEmail: null });
    expect(r.rows[3]).toMatchObject({ deposit: null, depositDue: null, dueDate: '2027-05-09' });
    // 3 × $1,850 + $275 + $360 = $6,185; paid $350 + $350; $5,485 left.
    expect(r.totals).toEqual({ cost: 618500, paidFromFunds: 35000, paidDirect: 35000, pending: 20000, remaining: 548500 });
    expect(r.notes).toEqual([
      'Pending = fund requests waiting for approval plus payments still clearing. Left to pay already takes off payments still clearing.',
    ]);
  });

  it('matches what the family sees on their Trips tab', () => {
    const h = harness();
    const parent = h.ok('me.bootstrap', {}, h.signIn(PARENT));
    const avery = parent.students.find((s) => s.student.id === 'S0001');
    const r = report(h, 'trip-balances');
    for (const account of avery?.activities ?? []) {
      const row = r.rows.find((x) => x.studentId === 'S0001' && x.activityId === account.activityId);
      expect(row).toMatchObject({
        cost: account.costCents,
        paidFromFunds: account.paidFromFundsCents,
        paidDirect: account.paidDirectCents,
        remaining: account.remainingCents,
      });
    }
  });

  describe('with overdue, paid, clearing, waitlisted, withdrawn and closed enrollments', () => {
    function setUp(): Harness {
      const h = harness();
      push(
        h,
        'Activities',
        { ActivityID: 'DEP', Name: 'Boston Day Trip', Kind: 'Trip', Cost: 500, Deposit: 100, 'Deposit Due': '2026-10-10', 'Due Date': '2027-03-01', Status: 'Open' },
        { ActivityID: 'OLD', Name: 'Orchestra Festival', Kind: 'Trip', Cost: 100, 'Due Date': '2026-10-01', Status: 'Open' },
      );
      push(
        h,
        'Enrollments',
        { StudentID: 'S0004', ActivityID: 'DEP', Status: 'Going' }, // paid $50 of a $100 deposit due Oct 10
        { StudentID: 'S0002', ActivityID: 'DEP', Status: 'Going' }, // $500 eCheck still clearing
        { StudentID: 'S0002', ActivityID: 'OLD', Status: 'Going' }, // due Oct 1, nothing paid
        { StudentID: 'S0003', ActivityID: 'OLD', Status: 'Going' }, // paid in full
        { StudentID: 'S0004', ActivityID: 'CAMP27', Status: 'Waitlist' },
        { StudentID: 'S0002', ActivityID: 'CAMP27', Status: 'Withdrawn' }, // paid $20 before withdrawing
        { StudentID: 'S0001', ActivityID: 'NYC25', Status: 'Going' }, // closed trip
        { StudentID: 'S0005', ActivityID: 'GHOST', Status: 'Going' }, // not in Activities
      );
      push(
        h,
        'Payments',
        { Date: '2026-10-05', StudentID: 'S0004', ActivityID: 'DEP', Amount: 50, Method: 'Check', Status: 'Completed' },
        { Date: '2026-10-19', StudentID: 'S0002', ActivityID: 'DEP', Amount: 500, Method: 'PayPal', Status: 'Pending' },
        { Date: '2026-09-15', StudentID: 'S0003', ActivityID: 'OLD', Amount: 100, Method: 'Cash', Status: 'Completed' },
        { Date: '2026-09-01', StudentID: 'S0002', ActivityID: 'CAMP27', Amount: 20, Method: 'Cash', Status: 'Completed' },
      );
      return h;
    }

    it('gives each a plain status, lists waitlisted students after those going and leaves out the rest with a note', () => {
      const r = report(setUp(), 'trip-balances');
      expect(pick(r, 'activityId', 'studentId', 'enrollment', 'paidDirect', 'pending', 'remaining', 'status')).toEqual([
        ['DEP', 'S0004', 'Going', 5000, 0, 45000, 'Deposit overdue'],
        ['FL27', 'S0003', 'Going', 0, 0, 150000, 'Owes'],
        ['FL27', 'S0005', 'Going', 0, 0, 185000, 'Owes'],
        ['FL27', 'S0001', 'Going', 35000, 20000, 150000, 'Owes'],
        ['CAMP27', 'S0001', 'Going', 0, 0, 27500, 'Owes'],
        ['CAMP27', 'S0004', 'Waitlist', 0, 0, 27500, 'Waitlist'],
        ['OLD', 'S0002', 'Going', 0, 0, 10000, 'Past due'],
        ['LESSONS', 'S0003', 'Going', 0, 0, 36000, 'Owes'],
      ]);
      // Going only: the waitlisted $275 is not counted.
      expect(r.totals).toEqual({ cost: 678500, paidFromFunds: 35000, paidDirect: 40000, pending: 20000, remaining: 603500 });
      expect(r.notes).toEqual([
        'Pending = fund requests waiting for approval plus payments still clearing. Left to pay already takes off payments still clearing.',
        'Waitlisted students are listed after those going and are not counted in the totals.',
        '2 students with nothing left to pay are not listed.',
        '1 enrollment in closed activities is not listed; pick the activity to see it.',
        '1 withdrawn student had money paid toward the activity and is not listed: check whether a refund is owed.',
        "1 Enrollments row names an ActivityID that isn't in the Activities tab and is not listed.",
      ]);
    });

    it('includes paid-up students when asked, and a closed activity when picked', () => {
      const h = setUp();
      const admin = h.signIn(TREASURER);
      const all = report(h, 'trip-balances', { includePaid: true }, admin);
      expect(pick(all, 'activityId', 'studentId', 'paidDirect', 'pending', 'remaining', 'status').filter(([id]) => id === 'DEP' || id === 'OLD')).toEqual([
        ['DEP', 'S0004', 5000, 0, 45000, 'Deposit overdue'],
        ['DEP', 'S0002', 0, 50000, 0, 'Paid (payment clearing)'],
        ['OLD', 'S0003', 10000, 0, 0, 'Paid in full'],
        ['OLD', 'S0002', 0, 0, 10000, 'Past due'],
      ]);
      expect(all.totals).toMatchObject({ cost: 678500 + 50000 + 10000, paidDirect: 40000 + 10000, pending: 20000 + 50000, remaining: 603500 });

      const nyc = report(h, 'trip-balances', { activityId: 'NYC25' }, admin);
      expect(pick(nyc, 'studentId', 'cost', 'paidFromFunds', 'remaining', 'dueDate', 'status')).toEqual([
        ['S0001', 65000, 20000, 45000, '2026-04-04', 'Past due'],
      ]);
      expect(nyc.filters).toEqual({ activityId: 'NYC25', includePaid: false });
    });

    it('filters by school and group', () => {
      const h = setUp();
      const admin = h.signIn(TREASURER);
      expect(pick(report(h, 'trip-balances', { school: 'Elementary' }, admin), 'activityId', 'studentId')).toEqual([
        ['DEP', 'S0004'],
        ['CAMP27', 'S0004'],
      ]);
      expect(pick(report(h, 'trip-balances', { ensemble: 'Jazz Band' }, admin), 'activityId', 'studentId')).toEqual([
        ['FL27', 'S0001'],
        ['CAMP27', 'S0001'],
      ]);
      const fl = report(h, 'trip-balances', { activityId: 'FL27', school: 'High School', ensemble: 'Orchestra' }, admin);
      expect(pick(fl, 'studentId')).toEqual([['S0003']]);
      expect(fl.totals).toEqual({ cost: 185000, paidFromFunds: 35000, paidDirect: 0, pending: 0, remaining: 150000 });
    });
  });

  it('tripStatus: past due beats an overdue deposit, and a deposit counts payments still clearing', () => {
    const base: ActivityAccount = {
      studentId: 'S1', activityId: 'A1', activityName: 'Trip', kind: 'Trip', enrollmentStatus: 'Going',
      costCents: 50000, paidFromFundsCents: 0, paidDirectCents: 0, paidCents: 0, pendingRedemptionCents: 0,
      pendingPaymentCents: 0, remainingCents: 50000, depositCents: 10000, depositDueDate: '2026-10-01',
      dueDate: '2026-12-01', allowFunds: true, allowOnlinePayment: true, activityOpen: true,
    };
    expect(tripStatus(base, '2026-10-01')).toBe('Owes'); // due today is not late
    expect(tripStatus(base, '2026-10-02')).toBe('Deposit overdue');
    expect(tripStatus({ ...base, pendingPaymentCents: 10000, remainingCents: 40000 }, '2026-10-02')).toBe('Owes');
    expect(tripStatus(base, '2026-12-02')).toBe('Past due');
    expect(tripStatus({ ...base, paidCents: 50000, remainingCents: 0 }, '2026-12-02')).toBe('Paid in full');
    expect(tripStatus({ ...base, costCents: 0, remainingCents: 0 }, '2026-10-02')).toBe('No cost set');
    expect(tripStatus({ ...base, enrollmentStatus: 'Waitlist' }, '2026-12-02')).toBe('Waitlist');
  });
});

describe('student-funds', () => {
  it('shows earned, applied, balance, pending and available for each active student', () => {
    const h = harness();
    const r = report(h, 'student-funds');
    expect(r.containsContactInfo).toBe(false);
    expect(pick(r, 'studentId', 'earned', 'applied', 'balance', 'pending', 'available', 'lastActivity')).toEqual([
      ['S0004', 3500, 0, 3500, 0, 3500, '2026-10-09'], // Ethan Nguyen
      ['S0003', 76000, -35000, 41000, 0, 41000, '2026-10-09'], // Maya Nguyen
      ['S0005', 52000, 0, 52000, 0, 52000, '2026-09-06'], // Sofia Ortiz
      ['S0001', 84000, -20000, 64000, 20000, 44000, '2026-10-09'], // Avery Thompson
      ['S0002', 8500, 0, 8500, 0, 8500, '2026-05-24'], // Liam Thompson
    ]);
    expect(r.rows[3]).toMatchObject({
      student: 'Avery Thompson',
      familyId: 'F0001',
      parent: 'Jordan Thompson & Casey Thompson',
      school: 'High School',
      groups: 'Band, Marching Band, Jazz Band',
    });
    expect(r.rows[2]).toMatchObject({ familyId: null, parent: null });
    expect(r.totals).toEqual({ earned: 224000, applied: -55000, balance: 169000, pending: 20000, available: 149000 });
  });

  it('filters by school and group', () => {
    const h = harness();
    const admin = h.signIn(TREASURER);
    expect(pick(report(h, 'student-funds', { school: 'High School' }, admin), 'studentId')).toEqual([['S0003'], ['S0005'], ['S0001']]);
    const orchestra = report(h, 'student-funds', { ensemble: 'Orchestra' }, admin);
    expect(pick(orchestra, 'studentId')).toEqual([['S0004'], ['S0003']]);
    expect(orchestra.totals).toMatchObject({ balance: 44500 });
  });

  it('says how much belongs to student IDs it does not list, so the total adds up to the dashboard', () => {
    const h = harness();
    push(
      h,
      'Ledger',
      { Date: '2026-09-01', StudentID: 'S0099', Type: 'Credit', Description: 'Carried over', Amount: 25 },
      { Date: '2026-09-01', StudentID: 'S0006', Type: 'Credit', Description: 'Before review', Amount: 10 },
    );
    const admin = h.signIn(TREASURER);
    const r = report(h, 'student-funds', {}, admin);
    expect(r.notes).toContain('$35.00 more belongs to 2 student IDs that are not an active student (pending, inactive, or not in the Students tab).');
    const dashboard = h.ok('admin.overview', {}, admin).stats.totalFundsCents;
    expect((r.totals?.balance ?? 0) + 3500).toBe(dashboard);
    // Not with a filter: the other students are left out on purpose then.
    expect(report(h, 'student-funds', { school: 'Elementary' }, admin).notes).toHaveLength(1);
  });

  it('shows a StudentID that has two Students rows once, as its first row (the student the app shows)', () => {
    const h = harness();
    // A new child in another family, typed in with Liam's StudentID.
    push(h, 'Students', { StudentID: 'S0002', FamilyID: 'F0002', 'First Name': 'Aaron', 'Last Name': 'Adams', School: 'Elementary', Status: 'Active' });
    const admin = h.signIn(TREASURER);
    const funds = report(h, 'student-funds', {}, admin);
    expect(pick(funds, 'studentId', 'student', 'familyId', 'balance').filter(([id]) => id === 'S0002')).toEqual([['S0002', 'Liam Thompson', 'F0001', 8500]]);
    expect(JSON.stringify(funds.rows)).not.toContain('Aaron');
    expect(funds.totals?.balance).toBe(169000);
    const roster = report(h, 'roster', {}, admin);
    expect(pick(roster, 'studentId', 'student').filter(([id]) => id === 'S0002')).toEqual([['S0002', 'Liam Thompson']]);
  });

  it('counts a pasted duplicate Students row once, so the reports and the dashboard agree', () => {
    const h = harness();
    const liam = h.services.db.tables.Students!.find((r) => r.StudentID === 'S0002')!;
    push(h, 'Students', { ...liam });
    const admin = h.signIn(TREASURER);
    const funds = report(h, 'student-funds', {}, admin);
    expect(funds.rows).toHaveLength(5);
    expect(report(h, 'roster', {}, admin).rows).toHaveLength(5);
    expect(report(h, 'app-usage', {}, admin).rows.find((r) => r.metric === 'Active students')?.value).toBe(5);
    expect(funds.totals?.balance).toBe(169000); // the Ledger's sum
    expect(h.ok('admin.overview', {}, admin).stats.totalFundsCents).toBe(169000);
  });
});

describe('fundraiser-totals', () => {
  it("groups this school year's credits by type and description, oldest first", () => {
    const r = report(harness(), 'fundraiser-totals');
    expect(r.filters).toEqual({ from: '2026-07-01', to: '2027-06-30' });
    expect(pick(r, 'type', 'description', 'students', 'total', 'firstDate', 'lastDate')).toEqual([
      ['Fundraiser', 'Car Wash', 3, 28500, '2026-07-23', '2026-07-23'],
      ['Donation', 'Donation from a family friend (designated)', 1, 25000, '2026-08-07', '2026-08-07'],
      ['Donation', 'Donation (designated)', 1, 5500, '2026-09-06', '2026-09-06'],
      ['Donation', 'Donation from grandparents (designated)', 1, 25000, '2026-09-06', '2026-09-06'],
      ['Fundraiser', 'Poinsettia sale', 3, 22000, '2026-10-09', '2026-10-09'],
    ]);
    // The -$350 applied to FL27 on 2026-08-22 is not a credit.
    expect(r.totals).toEqual({ total: 106000 });
  });

  it('covers any date range, ignores capitals and extra spaces when grouping, and notes undated credits', () => {
    const h = harness();
    push(
      h,
      'Ledger',
      { Date: '2026-06-01', StudentID: 'S0004', Type: 'fundraiser', Description: 'pizza  night', Amount: 15 },
      { Date: '', StudentID: 'S0004', Type: 'Fundraiser', Description: 'Pizza Night', Amount: 5 },
    );
    const r = report(h, 'fundraiser-totals', { from: '2025-07-01', to: '2026-06-30' });
    expect(pick(r, 'description', 'students', 'total', 'firstDate', 'lastDate')).toEqual([
      ['Poinsettia sale (last year)', 3, 35000, '2025-11-25', '2025-11-25'],
      ['Cookie Dough fundraiser', 4, 68000, '2026-02-23', '2026-02-23'],
      ['Pizza Night', 4, 16500, '2026-05-24', '2026-06-01'],
    ]);
    expect(r.totals).toEqual({ total: 119500 });
    expect(r.notes).toContain('1 credit with no date in the Ledger is not counted.');
  });
});

describe('fund-activity', () => {
  it('lists every Ledger row in the range with credits, debits and net', () => {
    const r = report(harness(), 'fund-activity');
    expect(r.rows).toHaveLength(10);
    expect(pick(r, 'date', 'studentId', 'amount', 'activity')).toEqual([
      ['2026-07-23', 'S0001', 9500, null],
      ['2026-07-23', 'S0003', 9500, null],
      ['2026-07-23', 'S0005', 9500, null],
      ['2026-08-07', 'S0003', 25000, null],
      ['2026-08-22', 'S0003', -35000, 'Florida 2027 – Disney & Universal'],
      ['2026-09-06', 'S0001', 25000, null],
      ['2026-09-06', 'S0005', 5500, null],
      ['2026-10-09', 'S0001', 13000, null],
      ['2026-10-09', 'S0003', 5500, null],
      ['2026-10-09', 'S0004', 3500, null],
    ]);
    expect(r.rows[4]).toMatchObject({
      student: 'Maya Nguyen',
      type: 'Redemption',
      description: 'Applied to Florida 2027 deposit',
      reference: null,
      enteredBy: TREASURER,
    });
    expect(r.totals).toEqual({ credits: 106000, debits: -35000, net: 71000 });
    // "Entered By" holds board members' emails.
    expect(r.containsContactInfo).toBe(true);
  });

  it("shows one activity's rows, with references and students that have no Students row", () => {
    const h = harness();
    push(h, 'Ledger', { Date: '2026-10-20', StudentID: 'S0077', Type: 'Redemption', Description: 'Applied', Amount: -40, ActivityID: 'fl27', Reference: 'R-0000abcd', 'Entered By': 'Jen' });
    const r = report(h, 'fund-activity', { activityId: 'FL27' });
    expect(pick(r, 'date', 'student', 'amount', 'reference', 'enteredBy')).toEqual([
      ['2026-08-22', 'Maya Nguyen', -35000, null, TREASURER],
      ['2026-10-20', 'S0077', -4000, 'R-0000abcd', 'Jen'],
    ]);
    expect(r.totals).toEqual({ credits: 0, debits: -39000, net: -39000 });
  });

  it('caps the rows it returns, says so, and still totals them all', () => {
    const h = harness();
    const bulk: RowData[] = [];
    for (let i = 0; i < 5001; i++) bulk.push({ Date: '2026-09-01', StudentID: 'S0004', Type: 'Fundraiser', Description: `Raffle ticket ${i}`, Amount: 1 });
    push(h, 'Ledger', ...bulk);
    const r = report(h, 'fund-activity');
    expect(r.rows).toHaveLength(MAX_REPORT_ROWS);
    expect(r.rows[MAX_REPORT_ROWS - 1].date).toBe('2026-09-01');
    expect(r.notes).toContain(
      'Showing the first 5,000 of 5,011 rows (the totals include all of them). Pick a shorter date range or one activity to see the rest.',
    );
    expect(r.totals).toEqual({ credits: 106000 + 500100, debits: -35000, net: 71000 + 500100 });
  });
});

describe('payments', () => {
  it('lists Payments rows in the range and totals Completed ones only', () => {
    const h = harness();
    push(
      h,
      'Payments',
      { Date: '2026-10-10', StudentID: 'S0003', ActivityID: 'FL27', Amount: 100, 'Fee Covered': 2.5, Method: 'PayPal', Reference: '9XK1', 'Payer Email': NGUYEN, Status: 'Completed' },
      { Date: '2026-10-12', StudentID: 'S0003', ActivityID: 'FL27', Amount: 40, Method: 'PayPal', Status: 'Pending' },
      { Date: '2026-10-13', StudentID: 'S0001', ActivityID: 'CAMP27', Amount: 30, Method: 'Check', Status: 'Refunded' },
      { Date: '2026-10-14', StudentID: 'S0001', ActivityID: 'CAMP27', Amount: 20, Method: 'Check', Status: 'Bounced' },
      { Date: '2026-06-30', StudentID: 'S0001', ActivityID: 'CAMP27', Amount: 99, Method: 'Cash', Status: 'Completed' }, // last school year
    );
    const admin = h.signIn(TREASURER);
    const r = report(h, 'payments', {}, admin);
    expect(pick(r, 'date', 'studentId', 'activity', 'amount', 'fee', 'gross', 'method', 'status')).toEqual([
      ['2026-10-01', 'S0001', 'Florida 2027 – Disney & Universal', 35000, 0, 35000, 'Check', 'Completed'],
      ['2026-10-10', 'S0003', 'Florida 2027 – Disney & Universal', 10000, 250, 10250, 'PayPal', 'Completed'],
      ['2026-10-12', 'S0003', 'Florida 2027 – Disney & Universal', 4000, 0, 4000, 'PayPal', 'Pending'],
      ['2026-10-13', 'S0001', 'Marching Band Camp 2027', 3000, 0, 3000, 'Check', 'Refunded'],
      ['2026-10-14', 'S0001', 'Marching Band Camp 2027', 2000, 0, 2000, 'Check', 'Failed'],
    ]);
    expect(r.rows[0]).toMatchObject({ student: 'Avery Thompson', reference: 'Check #1043 (deposit)', payerEmail: PARENT });
    expect(r.totals).toEqual({ amount: 45000, fee: 250, gross: 45250 });
    expect(r.notes).toEqual([
      'Totals count Completed payments only; Pending (still clearing), Refunded and Failed rows are listed but not counted.',
    ]);
    expect(r.containsContactInfo).toBe(true);
    expect(pick(report(h, 'payments', { activityId: 'CAMP27', from: '2026-06-01', to: '2026-12-31' }, admin), 'amount', 'status')).toEqual([
      [9900, 'Completed'],
      [3000, 'Refunded'],
      [2000, 'Failed'],
    ]);
  });
});

describe('roster', () => {
  it("lists active students with their parents' contact details and logs who looked", () => {
    const h = harness();
    const r = report(h, 'roster');
    expect(r.containsContactInfo).toBe(true);
    expect(pick(r, 'studentId', 'grade', 'school', 'familyStatus', 'member')).toEqual([
      ['S0004', '5', 'Elementary', 'Active', 'Yes'],
      ['S0003', '10', 'High School', 'Active', 'Yes'],
      ['S0005', '12', 'High School', null, null],
      ['S0001', '11', 'High School', 'Active', 'Yes'],
      ['S0002', '7', 'Middle School', 'Active', 'Yes'],
    ]);
    expect(r.rows[3]).toEqual({
      student: 'Avery Thompson',
      studentId: 'S0001',
      grade: '11',
      school: 'High School',
      groups: 'Band, Marching Band, Jazz Band',
      instrument: 'Trumpet',
      familyId: 'F0001',
      familyStatus: 'Active',
      member: 'Yes',
      parent1Name: 'Jordan Thompson',
      parent1Email: PARENT,
      parent1Phone: '603-555-0142',
      parent2Name: 'Casey Thompson',
      parent2Email: PARENT2,
      parent2Phone: null,
    });
    expect(h.rows('Log').at(-1)).toEqual({
      At: '2026-10-21T14:00:00.000Z',
      Kind: 'report',
      Detail: 'Roster with contact details (all students, 5 students) viewed by treasurer@example.com',
    });
  });

  it('filters by school and group, and says which in the Log row', () => {
    const h = harness();
    const r = report(h, 'roster', { school: 'High School', ensemble: 'chorus' });
    expect(pick(r, 'studentId')).toEqual([['S0005']]);
    expect(h.rows('Log').at(-1)?.Detail).toBe('Roster with contact details (High School, Chorus, 1 student) viewed by treasurer@example.com');
  });

  it('still answers when the Log row cannot be written', () => {
    const h = harness();
    const admin = h.signIn(TREASURER);
    h.services.withLock = () => {
      throw new Error('Lock timeout');
    };
    expect(report(h, 'roster', {}, admin).rows).toHaveLength(5);
    expect(h.services.logs.some((l) => l.message === 'Could not write the Log row')).toBe(true);
  });

  it('does not log the other reports', () => {
    const h = harness();
    const admin = h.signIn(TREASURER);
    const before = h.rows('Log').length;
    for (const kind of REPORT_KINDS.filter((k) => k !== 'roster')) report(h, kind, {}, admin);
    expect(h.rows('Log')).toHaveLength(before);
  });
});

describe('open-items', () => {
  it("lists what is waiting on the treasurer, oldest first within each kind, without contact details", () => {
    const h = harness();
    push(h, 'Students', { StudentID: 'S0050', FamilyID: 'F0002', 'First Name': 'Nora', 'Last Name': 'Nguyen', Grade: 3, School: 'Elementary', Status: 'Pending' });
    push(h, 'Payments', { Date: '2026-10-18', StudentID: 'S0003', ActivityID: 'FL27', Amount: 250, Method: 'PayPal', Reference: '5TY0', Status: 'Pending' });
    push(h, 'Redemptions', {
      RequestID: 'R-00aa11bb',
      Requested: '2026-10-02T15:00:00.000Z',
      Email: NGUYEN,
      FamilyID: 'F0002',
      StudentID: 'S0003',
      ActivityID: 'LESSONS',
      Amount: 60,
      Status: 'Pending',
    });
    const r = report(h, 'open-items');
    expect(r.rows).toEqual([
      {
        kind: 'Fund request',
        date: '2026-10-02',
        who: 'Maya Nguyen (asked by Priya Nguyen)',
        detail: 'Apply to TRSD Private Lessons 2026–27.',
        amount: 6000,
        reference: 'R-00aa11bb',
      },
      {
        kind: 'Fund request',
        date: '2026-10-20',
        who: 'Avery Thompson (asked by Jordan Thompson)',
        detail: 'Apply to Florida 2027 – Disney & Universal. Note: "Please use Avery\'s Car Wash and Poinsettia credits."',
        amount: 20000,
        reference: 'R-7f3a9c21',
      },
      { kind: 'New household', date: '2026-10-19', who: 'Marcus Ortiz', detail: '1 student to review: Sofia Ortiz', amount: null, reference: 'F0003' },
      { kind: 'New student', date: null, who: 'Nora Nguyen', detail: 'Added to Priya Nguyen (F0002), which is already verified', amount: null, reference: 'S0050' },
      { kind: 'Payment clearing', date: '2026-10-18', who: 'Maya Nguyen', detail: 'Florida 2027 – Disney & Universal · PayPal · 5TY0', amount: 25000, reference: '5TY0' },
    ]);
    expect(r.notes).toEqual([
      '2 fund requests, 1 new household, 1 new student, 1 payment still clearing. Decide requests and review households in the app under Board tools.',
    ]);
    expect(r.totals).toBeUndefined();
    expect(r.containsContactInfo).toBe(false);
  });

  it('is empty when nothing is waiting', () => {
    const h = harness({ tables: { Redemptions: [], Families: [], Payments: [] } });
    const r = report(h, 'open-items');
    expect(r.rows).toEqual([]);
    expect(r.notes?.[0]).toMatch(/^0 fund requests, 0 new households, 0 new students, 0 payments still clearing\./);
  });
});

describe('app-usage', () => {
  const value = (r: Report, metric: RegExp) => r.rows.find((row) => metric.test(String(row.metric)))?.value;

  it('counts households, students, devices and notification choices, with no personal data', () => {
    const h = harness({ settings: { SMS_ENABLED: 'TRUE' } });
    push(
      h,
      'Preferences',
      // Priya turned email off and texts on; someone without a household saved settings too.
      { Email: NGUYEN, FamilyID: 'F0002', Prefs: JSON.stringify({ channels: { push: true, email: false, sms: true }, smsPhone: '6035550187' }) },
      { Email: 'new.parent@example.com', FamilyID: '', Prefs: '{}' },
    );
    push(h, 'Devices', { Email: 'visitor@example.com', Token: 'demo-device-visitor' });
    const r = report(h, 'app-usage');
    expect(r.columns).toEqual([
      { key: 'metric', label: 'What', type: 'text' },
      { key: 'value', label: 'Count', type: 'number' },
    ]);
    expect(r.rows.map((row) => row.value)).toEqual([3, 2, 1, 5, 1, 3, 2, 1, 2, 1, 2, 2]);
    expect(value(r, /^Households \(not counting/)).toBe(3);
    expect(value(r, /used the app/)).toBe(3); // F0001 (device), F0002 (settings), F0003 (signed up)
    expect(value(r, /^Phones and computers/)).toBe(2);
    expect(value(r, /phone notifications/)).toBe(1); // F0001's device
    expect(value(r, /getting email/)).toBe(2); // F0001 and F0003 by default; Priya turned it off
    expect(value(r, /text messages/)).toBe(1);
    expect(value(r, /no household yet/)).toBe(2);
    expect(r.containsContactInfo).toBe(false);
    expect(JSON.stringify(r.rows)).not.toMatch(/@|Nguyen|Thompson|F000/);
  });

  it('says when email notifications are switched off', () => {
    const r = report(harness({ settings: { EMAIL_ENABLED: 'FALSE' } }), 'app-usage');
    expect(r.notes).toContain('Email notifications are switched off in Settings (EMAIL_ENABLED), so nobody gets them right now.');
  });
});
