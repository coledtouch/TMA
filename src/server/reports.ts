/**
 * Board reports (ARCHITECTURE.md §5.4): `admin.report` in the app and the sheet's
 * TMA App → Reports menu (src/gas/reports-sheet.ts). Read-only: every number comes
 * from the same Model and Books the app shows parents and admins, so a report
 * never disagrees with the app.
 *
 * Cells: money is integer cents, dates are IsoDate strings, blanks are null.
 * Each builder sorts its rows in a fixed order (documented on the builder), so
 * the same sheet always gives the same report. Text compares ignore capitals.
 */
import { formatCents } from '../shared/money';
import type {
  ActivityAccount,
  IsoDate,
  Report,
  ReportCell,
  ReportColumn,
  ReportColumnType,
  ReportFilters,
  ReportKind,
  ReportOptions,
} from '../shared/types';
import { guardianName, guardianNames } from './access';
import { inWriteLock, type Ctx } from './context';
import { studentName, type ActivityRec, type EnrollmentRec, type FamilyRec, type StudentRec } from './data';
import { badRequest } from './errors';
import { prefsFor } from './prefs';
import { canonical, errorMessage, idKey, isBlank, isEmail, isKnown, joinList, nyDate, plural, truncate } from './util';
import * as v from './validate';

export const REPORT_KINDS: readonly ReportKind[] = [
  'trip-balances',
  'student-funds',
  'fundraiser-totals',
  'fund-activity',
  'payments',
  'roster',
  'open-items',
  'app-usage',
];

/** Report titles; the sheet menu writes each to a tab named "Report: <title>". */
export const REPORT_TITLES: Readonly<Record<ReportKind, string>> = {
  'trip-balances': 'Trip balances',
  'student-funds': 'Student funds',
  'fundraiser-totals': 'Fundraiser totals',
  'fund-activity': 'Fund activity',
  payments: 'Payments',
  roster: 'Roster',
  'open-items': 'Open items',
  'app-usage': 'App usage',
};

/** Most rows one report returns. Past it, a note says how many were left out (totals still count them). */
export const MAX_REPORT_ROWS = 5000;

/** Which filters each report uses; the others are validated and then dropped. */
const FILTERS_FOR: Readonly<Record<ReportKind, ReadonlyArray<keyof ReportFilters>>> = {
  'trip-balances': ['activityId', 'school', 'ensemble', 'includePaid'],
  'student-funds': ['school', 'ensemble'],
  'fundraiser-totals': ['from', 'to'],
  'fund-activity': ['from', 'to', 'activityId'],
  payments: ['from', 'to', 'activityId'],
  roster: ['school', 'ensemble'],
  'open-items': [],
  'app-usage': [],
};

type Row = Record<string, ReportCell>;

/** What a builder hands to finish(). */
interface Table {
  description: string;
  columns: ReportColumn[];
  rows: Row[];
  totals?: Record<string, number>;
  notes: string[];
  /** Forced true for the roster; otherwise worked out from the cells. */
  contactInfo?: boolean;
  /** How to see rows past MAX_REPORT_ROWS. */
  narrow: string;
}

const col = (key: string, label: string, type: ReportColumnType = 'text'): ReportColumn => ({ key, label, type });

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

/** admin.report: validate, build, and for the roster (contact details) leave a Log row. */
export function runReport(ctx: Ctx, adminEmail: string, params: v.Params): { report: Report; options: ReportOptions } {
  const kind = v.oneOf(params.kind, 'Report', REPORT_KINDS);
  const report = buildReport(ctx, kind, params.filters as ReportFilters | undefined);
  const options = reportOptions(ctx);
  if (kind === 'roster') logContactReport(ctx, adminEmail, report);
  return { report, options };
}

/** Build one report. Filters are validated here (BAD_REQUEST), so the API and the sheet menu share the rules. */
export function buildReport(ctx: Ctx, kind: ReportKind, filters?: ReportFilters): Report {
  const k = v.oneOf(kind, 'Report', REPORT_KINDS);
  const applied = reportFilters(ctx, k, filters);
  return finish(ctx, k, applied, BUILDERS[k](ctx, applied));
}

/** Choices for the Reports screen: activities (open first, then by name), schools and groups from Settings. */
export function reportOptions(ctx: Ctx): ReportOptions {
  const settings = ctx.m.settings().pub;
  const seen = new Set<string>();
  const activities: ReportOptions['activities'] = [];
  for (const a of ctx.m.activities()) {
    if (seen.has(idKey(a.id))) continue;
    seen.add(idKey(a.id));
    activities.push({ id: a.id, name: a.name, open: a.status === 'Open' });
  }
  activities.sort((a, b) => Number(b.open) - Number(a.open) || cmpText(a.name, b.name) || cmpText(a.id, b.id));
  return { activities, schools: settings.schools.slice(), ensembles: settings.ensembles.slice() };
}

/**
 * Who looked at families' contact details goes in the Log tab. A report only reads, so this takes
 * the write lock just for that one row (as auth.ts does for its rate-limit row); if the lock is
 * busy the row is skipped, never the report.
 */
function logContactReport(ctx: Ctx, adminEmail: string, report: Report): void {
  const scope = [report.filters.school, report.filters.ensemble].filter(Boolean).join(', ') || 'all students';
  const detail = `Roster with contact details (${scope}, ${plural(report.rows.length, 'student')}) viewed by ${adminEmail}`;
  try {
    inWriteLock(ctx, () => ctx.log('report', detail));
  } catch (err) {
    ctx.s.logger.error('Could not write the Log row', errorMessage(err));
  }
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

/** The school year (Jul 1 – Jun 30) that contains `date`. */
export function schoolYear(date: IsoDate): { from: IsoDate; to: IsoDate } {
  const year = parseInt(date.slice(0, 4), 10);
  const start = parseInt(date.slice(5, 7), 10) >= 7 ? year : year - 1;
  return { from: `${start}-07-01`, to: `${start + 1}-06-30` };
}

/**
 * Validate every filter given (whatever the report), then keep the ones `kind` uses, with defaults:
 * includePaid false; dates = the school year containing the one date given, or today's school year.
 * Blank values ('' or null) count as not given, so a screen's "All" choice can send ''.
 */
export function reportFilters(ctx: Ctx, kind: ReportKind, raw: unknown): ReportFilters {
  const input: v.Params = raw === undefined || raw === null ? {} : v.obj(raw, 'Filters');
  const given = (key: string) => !isBlank(input[key]);
  const settings = ctx.m.settings().pub;

  let activityId: string | undefined;
  if (given('activityId')) {
    const id = v.id(input.activityId, 'Activity');
    const activity = ctx.m.activityById(id);
    if (!activity) badRequest(`Activity "${id}" is not in the Activities tab.`);
    activityId = activity.id;
  }
  const school = given('school') ? listed(input.school, 'School', settings.schools, 'SCHOOLS') : undefined;
  const ensemble = given('ensemble') ? listed(input.ensemble, 'Group', settings.ensembles, 'ENSEMBLES') : undefined;
  const from = given('from') ? v.isoDate(input.from, 'From') : undefined;
  const to = given('to') ? v.isoDate(input.to, 'To') : undefined;
  if (from && to && from > to) badRequest('The start date must be on or before the end date.');
  const includePaid = v.bool(input.includePaid, 'Include paid', false);

  const uses = FILTERS_FOR[kind];
  const out: ReportFilters = {};
  if (uses.includes('from')) {
    const year = schoolYear(from ?? to ?? ctx.today);
    out.from = from ?? year.from;
    out.to = to ?? year.to;
  }
  if (activityId && uses.includes('activityId')) out.activityId = activityId;
  if (school && uses.includes('school')) out.school = school;
  if (ensemble && uses.includes('ensemble')) out.ensemble = ensemble;
  if (uses.includes('includePaid')) out.includePaid = includePaid;
  return out;
}

function listed(value: unknown, label: string, known: readonly string[], setting: string): string {
  const s = v.text(value, label, v.LIMITS.name);
  if (!isKnown(s, known)) badRequest(`${label} "${s}" is not in Settings ${setting}.`);
  return canonical(s, known);
}

function studentMatches(student: StudentRec | null, f: ReportFilters): boolean {
  if (f.school && (!student || !isKnown(student.school, [f.school]))) return false;
  if (f.ensemble && (!student || !isKnown(f.ensemble, student.ensembles))) return false;
  return true;
}

function inRange(date: IsoDate, f: ReportFilters): boolean {
  return date >= (f.from ?? '') && date <= (f.to ?? '9999-12-31');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cmpText(a: string, b: string): number {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x < y ? -1 : x > y ? 1 : 0;
}

/** Last name, first name, StudentID. A StudentID with no Students row sorts by the ID. */
function cmpStudent(a: StudentRec | null, aId: string, b: StudentRec | null, bId: string): number {
  return (
    cmpText(a ? a.lastName : aId, b ? b.lastName : bId) ||
    cmpText(a ? a.firstName : '', b ? b.firstName : '') ||
    cmpText(aId, bId)
  );
}

/**
 * Students tab rows, one per StudentID: the first, as the app uses it (studentById). A later row
 * that repeats an ID is ignored, whatever its name, family or status.
 */
function uniqueStudents(ctx: Ctx): StudentRec[] {
  return ctx.m.students().filter((s) => ctx.m.studentById(s.id) === s);
}

/** Active students that match the school/group filters, by last name, first name, StudentID. */
function activeStudents(ctx: Ctx, f: ReportFilters): StudentRec[] {
  return uniqueStudents(ctx)
    .filter((s) => s.status === 'Active' && studentMatches(s, f))
    .sort((a, b) => cmpStudent(a, a.id, b, b.id));
}

function nameOf(ctx: Ctx, studentId: string): string {
  const s = ctx.m.studentById(studentId);
  return s ? studentName(s) || s.id : studentId;
}

function activityName(ctx: Ctx, activityId: string | undefined): string | null {
  if (!activityId) return null;
  return ctx.m.activityById(activityId)?.name ?? activityId;
}

function sum(rows: readonly Row[], keys: readonly string[], include: (row: Row) => boolean = () => true): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const key of keys) totals[key] = 0;
  for (const row of rows) {
    if (!include(row)) continue;
    for (const key of keys) {
      const value = row[key];
      if (typeof value === 'number') totals[key] += value;
    }
  }
  return totals;
}

/** 5000 -> "5,000". */
function count(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** Capitals and runs of spaces ignored: "Car  wash" and "Car Wash" are one fundraiser. */
function groupKey(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

const EMAIL_IN_TEXT = /[^\s@<>()"']+@[^\s@<>()"']+\.[a-z]{2,}/i;

function hasContactInfo(columns: readonly ReportColumn[], rows: readonly Row[]): boolean {
  for (const row of rows) {
    for (const c of columns) {
      const value = row[c.key];
      if (value === null || value === '') continue;
      if (c.type === 'email' || c.type === 'phone') return true;
      if (typeof value === 'string' && EMAIL_IN_TEXT.test(value)) return true;
    }
  }
  return false;
}

function finish(ctx: Ctx, kind: ReportKind, filters: ReportFilters, table: Table): Report {
  const notes = table.notes.slice();
  let rows = table.rows;
  if (rows.length > MAX_REPORT_ROWS) {
    const totals = table.totals ? ' (the totals include all of them)' : '';
    notes.push(`Showing the first ${count(MAX_REPORT_ROWS)} of ${count(rows.length)} rows${totals}. ${table.narrow}`);
    rows = rows.slice(0, MAX_REPORT_ROWS);
  }
  const report: Report = {
    kind,
    title: REPORT_TITLES[kind],
    description: table.description,
    generatedAt: ctx.now.toISOString(),
    filters,
    columns: table.columns,
    rows,
    containsContactInfo: table.contactInfo ?? hasContactInfo(table.columns, rows),
  };
  if (table.totals) report.totals = table.totals;
  if (notes.length > 0) report.notes = notes;
  return report;
}

// ---------------------------------------------------------------------------
// trip-balances
// ---------------------------------------------------------------------------

/**
 * Plain status of one enrollment on `today`. "Paid in full" needs the money to be in: when a
 * payment still clearing covers the rest, it says so instead.
 */
export function tripStatus(a: ActivityAccount, today: IsoDate): string {
  if (a.enrollmentStatus === 'Waitlist') return 'Waitlist';
  if (a.costCents <= 0) return 'No cost set';
  const clearing = a.pendingPaymentCents ?? 0;
  if (a.remainingCents <= 0) return a.paidCents >= a.costCents ? 'Paid in full' : 'Paid (payment clearing)';
  if (a.dueDate && a.dueDate < today) return 'Past due';
  if (a.depositCents && a.depositDueDate && a.depositDueDate < today && a.paidCents + clearing < a.depositCents) {
    return 'Deposit overdue';
  }
  return 'Owes';
}

/**
 * One row per enrollment, Going and Waitlist (Withdrawn left out), with the numbers families see on
 * their Trips tab. Default: open activities only (any activity when one is picked) and only rows
 * with something left to pay. Sorted by activity name, activity ID, Going before Waitlist, then
 * student. Totals count Going rows only.
 */
function tripBalances(ctx: Ctx, f: ReportFilters): Table {
  const m = ctx.m;
  const books = m.books();
  // The last Enrollments row for a (student, activity) pair wins, as in the app.
  const pairs = new Map<string, EnrollmentRec>();
  for (const e of m.enrollments()) pairs.set(`${idKey(e.studentId)}|${idKey(e.activityId)}`, e);

  interface Entry {
    account: ActivityAccount;
    activity: ActivityRec;
    student: StudentRec | null;
  }
  const entries: Entry[] = [];
  let unknownActivity = 0;
  let closed = 0;
  let paidUp = 0;
  let withdrawnPaid = 0;
  pairs.forEach((e) => {
    const activity = m.activityById(e.activityId);
    if (!activity) {
      if (!f.activityId) unknownActivity += 1;
      return;
    }
    if (f.activityId && idKey(activity.id) !== idKey(f.activityId)) return;
    const student = m.studentById(e.studentId);
    if (!studentMatches(student, f)) return;
    if (!f.activityId && activity.status !== 'Open') {
      if (e.status !== 'Withdrawn') closed += 1;
      return;
    }
    const account = books.account(e.studentId, activity.id);
    if (!account) return;
    if (account.enrollmentStatus === 'Withdrawn') {
      if (account.paidCents > 0) withdrawnPaid += 1;
      return;
    }
    if (account.remainingCents <= 0 && !f.includePaid) {
      paidUp += 1;
      return;
    }
    entries.push({ account, activity, student });
  });

  const rank = (x: Entry) => (x.account.enrollmentStatus === 'Waitlist' ? 1 : 0);
  entries.sort(
    (a, b) =>
      cmpText(a.activity.name, b.activity.name) ||
      cmpText(a.activity.id, b.activity.id) ||
      rank(a) - rank(b) ||
      cmpStudent(a.student, a.account.studentId, b.student, b.account.studentId),
  );

  const rows: Row[] = entries.map(({ account: a, activity, student }) => {
    const family = student ? m.familyById(student.familyId) : null;
    const parent = family?.guardians[0];
    return {
      activity: activity.name,
      activityId: activity.id,
      student: student ? studentName(student) || student.id : a.studentId,
      studentId: student?.id ?? a.studentId,
      familyId: student?.familyId ?? null,
      parentName: parent?.name || null,
      parentEmail: parent?.email || null,
      school: student?.school || null,
      enrollment: a.enrollmentStatus,
      cost: a.costCents,
      paidFromFunds: a.paidFromFundsCents,
      paidDirect: a.paidDirectCents,
      pending: a.pendingRedemptionCents + (a.pendingPaymentCents ?? 0),
      remaining: a.remainingCents,
      deposit: a.depositCents ?? null,
      depositDue: a.depositDueDate ?? null,
      dueDate: a.dueDate ?? null,
      status: tripStatus(a, ctx.today),
    };
  });

  const notes = [
    'Pending = fund requests waiting for approval plus payments still clearing. Left to pay already takes off payments still clearing.',
  ];
  if (rows.some((r) => r.enrollment === 'Waitlist')) {
    notes.push('Waitlisted students are listed after those going and are not counted in the totals.');
  }
  if (paidUp > 0) notes.push(`${plural(paidUp, 'student')} with nothing left to pay ${paidUp === 1 ? 'is' : 'are'} not listed.`);
  if (closed > 0) notes.push(`${plural(closed, 'enrollment')} in closed activities ${closed === 1 ? 'is' : 'are'} not listed; pick the activity to see ${closed === 1 ? 'it' : 'them'}.`);
  if (withdrawnPaid > 0) {
    notes.push(`${plural(withdrawnPaid, 'withdrawn student')} had money paid toward the activity and ${withdrawnPaid === 1 ? 'is' : 'are'} not listed: check whether a refund is owed.`);
  }
  if (unknownActivity > 0) {
    notes.push(`${plural(unknownActivity, 'Enrollments row')} name${unknownActivity === 1 ? 's' : ''} an ActivityID that isn't in the Activities tab and ${unknownActivity === 1 ? 'is' : 'are'} not listed.`);
  }

  return {
    description: 'One row per student going on a trip or activity: cost, paid from activity funds, paid directly, pending, and what is left to pay, the same numbers families see in the app.',
    columns: [
      col('activity', 'Activity'),
      col('activityId', 'Activity ID'),
      col('student', 'Student'),
      col('studentId', 'Student ID'),
      col('familyId', 'Family ID'),
      col('parentName', 'Parent'),
      col('parentEmail', 'Parent email', 'email'),
      col('school', 'School'),
      col('enrollment', 'Enrollment'),
      col('cost', 'Cost', 'money'),
      col('paidFromFunds', 'Paid from funds', 'money'),
      col('paidDirect', 'Paid directly', 'money'),
      col('pending', 'Pending', 'money'),
      col('remaining', 'Left to pay', 'money'),
      col('deposit', 'Deposit', 'money'),
      col('depositDue', 'Deposit due', 'date'),
      col('dueDate', 'Final due', 'date'),
      col('status', 'Status'),
    ],
    rows,
    totals: sum(rows, ['cost', 'paidFromFunds', 'paidDirect', 'pending', 'remaining'], (r) => r.enrollment === 'Going'),
    notes,
    narrow: 'Pick one activity, school or group to see the rest.',
  };
}

// ---------------------------------------------------------------------------
// student-funds
// ---------------------------------------------------------------------------

/**
 * One row per Active student: earned (positive Ledger rows), applied (negative rows), balance,
 * pending requests and available, all time. Sorted by last name, first name, StudentID.
 */
function studentFunds(ctx: Ctx, f: ReportFilters): Table {
  const m = ctx.m;
  const books = m.books();
  const earned = new Map<string, number>();
  const applied = new Map<string, number>();
  const lastDate = new Map<string, IsoDate>();
  for (const l of m.ledger()) {
    const key = idKey(l.studentId);
    const into = l.amountCents > 0 ? earned : applied;
    into.set(key, (into.get(key) ?? 0) + l.amountCents);
    if (l.date && (lastDate.get(key) ?? '') < l.date) lastDate.set(key, l.date);
  }

  const students = activeStudents(ctx, f);
  const listedKeys = new Set<string>();
  const rows: Row[] = [];
  for (const s of students) {
    const key = idKey(s.id);
    listedKeys.add(key);
    const family = m.familyById(s.familyId);
    rows.push({
      student: studentName(s) || s.id,
      studentId: s.id,
      familyId: s.familyId,
      parent: family ? guardianNames(family) : null,
      school: s.school || null,
      groups: joinList(s.ensembles) || null,
      earned: earned.get(key) ?? 0,
      applied: applied.get(key) ?? 0,
      balance: books.balance(s.id),
      pending: books.pending(s.id),
      available: books.available(s.id),
      lastActivity: lastDate.get(key) ?? null,
    });
  }

  const notes = ['Applied is what was used for trips and other activities (negative Ledger rows), so Earned + Applied = Balance.'];
  if (!f.school && !f.ensemble) {
    // Funds recorded for students who aren't listed still belong to TMA's earmarked total (as in admin.overview).
    let elsewhere = 0;
    let ids = 0;
    for (const key of books.ledgerStudentKeys()) {
      if (listedKeys.has(key) || books.balance(key) === 0) continue;
      elsewhere += books.balance(key);
      ids += 1;
    }
    if (ids > 0) {
      notes.push(`${formatCents(elsewhere)} more belongs to ${plural(ids, 'student ID')} that ${ids === 1 ? 'is' : 'are'} not an active student (pending, inactive, or not in the Students tab).`);
    }
  }

  return {
    description: 'One row per active student: activity funds earned, applied to trips and activities, the balance, requests waiting for approval, and what is available.',
    columns: [
      col('student', 'Student'),
      col('studentId', 'Student ID'),
      col('familyId', 'Family ID'),
      col('parent', 'Parents'),
      col('school', 'School'),
      col('groups', 'Groups'),
      col('earned', 'Earned', 'money'),
      col('applied', 'Applied', 'money'),
      col('balance', 'Balance', 'money'),
      col('pending', 'Pending requests', 'money'),
      col('available', 'Available', 'money'),
      col('lastActivity', 'Last fund activity', 'date'),
    ],
    rows,
    totals: sum(rows, ['earned', 'applied', 'balance', 'pending', 'available']),
    notes,
    narrow: 'Pick a school or group to see the rest.',
  };
}

// ---------------------------------------------------------------------------
// fundraiser-totals
// ---------------------------------------------------------------------------

/**
 * Positive Ledger rows dated from `from` to `to`, grouped by Type + Description (capitals and
 * extra spaces ignored; the first spelling is shown). Sorted by first date, type, description.
 */
function fundraiserTotals(ctx: Ctx, f: ReportFilters): Table {
  interface Group {
    type: string;
    description: string;
    students: Set<string>;
    total: number;
    first: IsoDate;
    last: IsoDate;
  }
  const groups = new Map<string, Group>();
  let undated = 0;
  for (const l of ctx.m.ledger()) {
    if (l.amountCents <= 0) continue;
    if (!l.date) {
      undated += 1;
      continue;
    }
    if (!inRange(l.date, f)) continue;
    const key = `${groupKey(l.type)}|${groupKey(l.description)}`;
    let g = groups.get(key);
    if (!g) {
      g = { type: l.type, description: l.description, students: new Set(), total: 0, first: l.date, last: l.date };
      groups.set(key, g);
    }
    g.students.add(idKey(l.studentId));
    g.total += l.amountCents;
    if (l.date < g.first) g.first = l.date;
    if (l.date > g.last) g.last = l.date;
  }

  const sorted = Array.from(groups.values()).sort(
    (a, b) => cmpText(a.first, b.first) || cmpText(a.type, b.type) || cmpText(a.description, b.description),
  );
  const rows: Row[] = sorted.map((g) => ({
    type: g.type,
    description: g.description || null,
    students: g.students.size,
    total: g.total,
    firstDate: g.first,
    lastDate: g.last,
  }));

  const notes = ['Only credits (positive Ledger rows) are counted. Fund activity lists every row, including funds used.'];
  if (undated > 0) notes.push(`${plural(undated, 'credit')} with no date in the Ledger ${undated === 1 ? 'is' : 'are'} not counted.`);
  return {
    description: 'Fund credits in the date range (positive Ledger rows: fundraisers, donations, refunds), grouped by Type and Description.',
    columns: [
      col('type', 'Type'),
      col('description', 'Description'),
      col('students', 'Students credited', 'number'),
      col('total', 'Total', 'money'),
      col('firstDate', 'First date', 'date'),
      col('lastDate', 'Last date', 'date'),
    ],
    rows,
    totals: sum(rows, ['total']),
    notes,
    narrow: 'Pick a shorter date range to see the rest.',
  };
}

// ---------------------------------------------------------------------------
// fund-activity
// ---------------------------------------------------------------------------

/** Every Ledger row dated from `from` to `to` (one activity's rows when picked). Oldest first, then sheet order. */
function fundActivity(ctx: Ctx, f: ReportFilters): Table {
  const enteredBy = new Map<number, string>();
  for (const row of ctx.db.rows('Ledger')) {
    const who = row.data['Entered By'];
    if (!isBlank(who)) enteredBy.set(row.rowNumber, String(who).trim());
  }
  let undated = 0;
  const entries = ctx.m.ledger().filter((l) => {
    if (f.activityId && (!l.activityId || idKey(l.activityId) !== idKey(f.activityId))) return false;
    if (!l.date) {
      undated += 1;
      return false;
    }
    return inRange(l.date, f);
  });
  entries.sort((a, b) => cmpText(a.date, b.date) || a.row - b.row);

  const rows: Row[] = entries.map((l) => ({
    date: l.date,
    student: nameOf(ctx, l.studentId),
    studentId: l.studentId,
    type: l.type,
    description: l.description || null,
    amount: l.amountCents,
    activity: activityName(ctx, l.activityId),
    reference: l.reference ?? null,
    enteredBy: enteredBy.get(l.row) ?? null,
  }));

  let credits = 0;
  let debits = 0;
  for (const l of entries) {
    if (l.amountCents > 0) credits += l.amountCents;
    else debits += l.amountCents;
  }
  const notes = ['Credits add to students\' funds; debits (negative amounts) are funds used or taken off.'];
  if (undated > 0) notes.push(`${plural(undated, 'Ledger row')} with no date ${undated === 1 ? 'is' : 'are'} not listed.`);
  return {
    description: 'Every Ledger row in the date range: credits add to a student\'s activity funds, negative rows spend them.',
    columns: [
      col('date', 'Date', 'date'),
      col('student', 'Student'),
      col('studentId', 'Student ID'),
      col('type', 'Type'),
      col('description', 'Description'),
      col('amount', 'Amount', 'money'),
      col('activity', 'Activity'),
      col('reference', 'Reference'),
      col('enteredBy', 'Entered by'),
    ],
    rows,
    totals: { credits, debits, net: credits + debits },
    notes,
    narrow: 'Pick a shorter date range or one activity to see the rest.',
  };
}

// ---------------------------------------------------------------------------
// payments
// ---------------------------------------------------------------------------

/** Every Payments row dated from `from` to `to` (one activity's when picked). Oldest first, then sheet order. */
function paymentsReport(ctx: Ctx, f: ReportFilters): Table {
  let undated = 0;
  const payments = ctx.m.payments().filter((p) => {
    if (f.activityId && idKey(p.activityId) !== idKey(f.activityId)) return false;
    if (!p.date) {
      undated += 1;
      return false;
    }
    return inRange(p.date, f);
  });
  payments.sort((a, b) => cmpText(a.date, b.date) || a.row - b.row);

  const rows: Row[] = payments.map((p) => ({
    date: p.date,
    student: nameOf(ctx, p.studentId),
    studentId: p.studentId,
    activity: activityName(ctx, p.activityId),
    amount: p.amountCents,
    fee: p.feeCents,
    gross: p.grossCents,
    method: p.method,
    reference: p.reference || null,
    payerEmail: p.payerEmail ?? null,
    status: p.status,
  }));

  const notes = ['Totals count Completed payments only; Pending (still clearing), Refunded and Failed rows are listed but not counted.'];
  if (undated > 0) notes.push(`${plural(undated, 'payment')} with no date ${undated === 1 ? 'is' : 'are'} not listed.`);
  return {
    description: 'Every Payments row in the date range: checks, cash and online payments toward trips and activities.',
    columns: [
      col('date', 'Date', 'date'),
      col('student', 'Student'),
      col('studentId', 'Student ID'),
      col('activity', 'Activity'),
      col('amount', 'Amount', 'money'),
      col('fee', 'Fee covered', 'money'),
      col('gross', 'Gross', 'money'),
      col('method', 'Method'),
      col('reference', 'Reference'),
      col('payerEmail', 'Payer email', 'email'),
      col('status', 'Status'),
    ],
    rows,
    totals: sum(rows, ['amount', 'fee', 'gross'], (r) => r.status === 'Completed'),
    notes,
    narrow: 'Pick a shorter date range or one activity to see the rest.',
  };
}

// ---------------------------------------------------------------------------
// roster
// ---------------------------------------------------------------------------

/** One row per Active student with the household's guardians. Sorted by last name, first name, StudentID. */
function roster(ctx: Ctx, f: ReportFilters): Table {
  const m = ctx.m;
  const students = activeStudents(ctx, f);
  const rows: Row[] = students.map((s) => {
    const family: FamilyRec | null = m.familyById(s.familyId);
    const [p1, p2] = family ? family.slots : [null, null];
    return {
      student: studentName(s) || s.id,
      studentId: s.id,
      grade: s.grade || null,
      school: s.school || null,
      groups: joinList(s.ensembles) || null,
      instrument: s.instrument ?? null,
      familyId: s.familyId,
      familyStatus: family?.status ?? null,
      member: family ? (family.member ? 'Yes' : 'No') : null,
      parent1Name: p1?.name || null,
      parent1Email: p1?.email || null,
      parent1Phone: p1?.phone || null,
      parent2Name: p2?.name || null,
      parent2Email: p2?.email || null,
      parent2Phone: p2?.phone || null,
    };
  });
  return {
    description: "Active students with their grade, school, groups and instrument, and their parents' contact details.",
    columns: [
      col('student', 'Student'),
      col('studentId', 'Student ID'),
      col('grade', 'Grade'),
      col('school', 'School'),
      col('groups', 'Groups'),
      col('instrument', 'Instrument'),
      col('familyId', 'Family ID'),
      col('familyStatus', 'Household status'),
      col('member', 'TMA member'),
      col('parent1Name', 'Parent 1'),
      col('parent1Email', 'Parent 1 email', 'email'),
      col('parent1Phone', 'Parent 1 phone', 'phone'),
      col('parent2Name', 'Parent 2'),
      col('parent2Email', 'Parent 2 email', 'email'),
      col('parent2Phone', 'Parent 2 phone', 'phone'),
    ],
    rows,
    notes: ["Contains parents' emails and phone numbers: keep it private, and delete downloaded copies when you are done."],
    contactInfo: true,
    narrow: 'Pick a school or group to see the rest.',
  };
}

// ---------------------------------------------------------------------------
// open-items
// ---------------------------------------------------------------------------

/**
 * Fund requests waiting for a decision, households and students waiting for review, and payments
 * still clearing. Sorted by that order of kinds, then oldest first, then sheet order.
 */
function openItems(ctx: Ctx): Table {
  const m = ctx.m;
  interface Item {
    order: number;
    sheetRow: number;
    row: Row;
  }
  const items: Item[] = [];
  const dateOf = (timestamp: string | undefined): IsoDate | null => (timestamp ? nyDate(new Date(timestamp)) : null);

  const requests = m.redemptions().filter((r) => r.status === 'Pending');
  for (const r of requests) {
    const family = m.familyById(r.familyId);
    const asker = r.email ? ` (asked by ${guardianName(family, r.email)})` : '';
    const note = r.note ? ` Note: "${truncate(r.note, 200)}"` : '';
    items.push({
      order: 0,
      sheetRow: r.row,
      row: {
        kind: 'Fund request',
        date: dateOf(r.requestedAt),
        who: `${nameOf(ctx, r.studentId)}${asker}`,
        detail: `Apply to ${activityName(ctx, r.activityId) ?? 'an activity'}.${note}`,
        amount: r.amountCents,
        reference: r.id,
      },
    });
  }

  let households = 0;
  let newStudents = 0;
  for (const family of m.families()) {
    if (family.status === 'Inactive') continue;
    const pending = m.studentsOfFamily(family.id).filter((s) => s.status === 'Pending');
    if (family.status === 'Pending') {
      households += 1;
      const names = pending.map((s) => studentName(s) || s.id);
      items.push({
        order: 1,
        sheetRow: family.row,
        row: {
          kind: 'New household',
          date: dateOf(family.createdAt),
          who: guardianNames(family),
          detail: names.length > 0 ? `${plural(names.length, 'student')} to review: ${names.join(', ')}` : 'No students yet',
          amount: null,
          reference: family.id,
        },
      });
      continue;
    }
    for (const s of pending) {
      newStudents += 1;
      items.push({
        order: 2,
        sheetRow: s.row,
        row: {
          kind: 'New student',
          date: null,
          who: studentName(s) || s.id,
          detail: `Added to ${guardianNames(family)} (${family.id}), which is already verified`,
          amount: null,
          reference: s.id,
        },
      });
    }
  }

  const clearing = m.payments().filter((p) => p.status === 'Pending');
  for (const p of clearing) {
    const reference = p.reference ? ` · ${p.reference}` : '';
    items.push({
      order: 3,
      sheetRow: p.row,
      row: {
        kind: 'Payment clearing',
        date: p.date || null,
        who: nameOf(ctx, p.studentId),
        detail: `${activityName(ctx, p.activityId) ?? 'No activity'} · ${p.method}${reference}`,
        amount: p.amountCents,
        reference: p.id,
      },
    });
  }

  items.sort(
    (a, b) =>
      a.order - b.order ||
      cmpText(String(a.row.date ?? '9999-12-31'), String(b.row.date ?? '9999-12-31')) ||
      a.sheetRow - b.sheetRow,
  );
  const summary = [
    plural(requests.length, 'fund request'),
    plural(households, 'new household'),
    plural(newStudents, 'new student'),
    plural(clearing.length, 'payment') + ' still clearing',
  ];
  return {
    description: 'What is waiting on the treasurer: fund requests to approve or deny, households and students to review, and payments still clearing.',
    columns: [
      col('kind', 'Item'),
      col('date', 'Date', 'date'),
      col('who', 'Who'),
      col('detail', 'Detail'),
      col('amount', 'Amount', 'money'),
      col('reference', 'ID / reference'),
    ],
    rows: items.map((i) => i.row),
    notes: [`${summary.join(', ')}. Decide requests and review households in the app under Board tools.`],
    narrow: 'Work through the oldest items first.',
  };
}

// ---------------------------------------------------------------------------
// app-usage
// ---------------------------------------------------------------------------

/** Counts only, no names: households, students, devices and notification choices. Fixed metric order. */
function appUsage(ctx: Ctx): Table {
  const m = ctx.m;
  const settings = m.settings();
  const families = m.families().filter((f) => f.status !== 'Inactive');
  const prefs = m.preferences();
  const devices = m.devices();
  const withDevice = new Set(devices.map((d) => d.email).filter((e) => e !== ''));
  const students = uniqueStudents(ctx);

  let used = 0;
  let push = 0;
  let email = 0;
  let sms = 0;
  const guardianEmails = new Set<string>();
  for (const f of families) {
    const emails = f.guardians.map((g) => g.email).filter(isEmail);
    emails.forEach((e) => guardianEmails.add(e));
    const choices = emails.map((e) => ({ email: e, prefs: prefsFor(ctx, e) }));
    if (f.status === 'Pending' || emails.some((e) => prefs.has(e) || withDevice.has(e))) used += 1;
    if (choices.some((c) => c.prefs.channels.push && withDevice.has(c.email))) push += 1;
    if (choices.some((c) => c.prefs.channels.email)) email += 1;
    if (choices.some((c) => c.prefs.channels.sms)) sms += 1;
  }
  const noHousehold = new Set<string>();
  prefs.forEach((_, e) => {
    if (!guardianEmails.has(e)) noHousehold.add(e);
  });
  withDevice.forEach((e) => {
    if (!guardianEmails.has(e)) noHousehold.add(e);
  });

  const metrics: Array<[string, number]> = [
    ['Households (not counting inactive ones)', families.length],
    ['Households verified by TMA', families.filter((f) => f.status === 'Active').length],
    ['Households waiting for review', families.filter((f) => f.status === 'Pending').length],
    ['Active students', students.filter((s) => s.status === 'Active').length],
    ['Students waiting for review', students.filter((s) => s.status === 'Pending').length],
    ['Households that have used the app (signed up, saved settings or turned on notifications)', used],
    ['Phones and computers with notifications on', devices.length],
    ['Households getting phone notifications', push],
    ['Households getting email', email],
    ['Households getting text messages', sms],
    ['Parents who changed their notification settings', prefs.size],
    ['People who signed in but have no household yet', noHousehold.size],
  ];
  const notes = [
    'Signing in leaves no trace in the sheet, so more households may use the app than counted here.',
    'Parents who never changed their settings get phone notifications (on phones where they turned them on) and email.',
  ];
  if (!settings.emailEnabled) notes.push('Email notifications are switched off in Settings (EMAIL_ENABLED), so nobody gets them right now.');
  return {
    description: 'How many households use the app and how they get notifications. Counts only, no names.',
    columns: [col('metric', 'What'), col('value', 'Count', 'number')],
    rows: metrics.map(([metric, value]) => ({ metric, value })),
    notes,
    narrow: '',
  };
}

const BUILDERS: Readonly<Record<ReportKind, (ctx: Ctx, f: ReportFilters) => Table>> = {
  'trip-balances': tripBalances,
  'student-funds': studentFunds,
  'fundraiser-totals': fundraiserTotals,
  'fund-activity': fundActivity,
  payments: paymentsReport,
  roster,
  'open-items': (ctx) => openItems(ctx),
  'app-usage': (ctx) => appUsage(ctx),
};
