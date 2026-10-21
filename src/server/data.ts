/**
 * Sheet rows -> domain records (ARCHITECTURE.md §3) and the per-request Model
 * that parses each tab once and rebuilds a view only after its tab changes.
 *
 * Records carry their sheet `row` so callers can update them; strip it with
 * the `to*` helpers before returning data to the browser.
 */
import { dollarsToCents } from '../shared/money';
import type { TableName } from '../shared/schema';
import type {
  Activity,
  ActivityKind,
  Announcement,
  Enrollment,
  EnrollmentStatus,
  EventItem,
  Family,
  Guardian,
  IsoDateTime,
  LedgerEntry,
  LogEntry,
  Payment,
  PaymentMethod,
  PaymentStatus,
  RecordStatus,
  RedemptionRequest,
  RedemptionStatus,
  Student,
} from '../shared/types';
import type { Db } from './db';
import { computeBooks, type Books } from './ledger';
import type { Services, StoredRow } from './services';
import { buildSettings, type AppSettings } from './settings';
import {
  canonical,
  idKey,
  isEmail,
  lettersOnly,
  normEmail,
  normalizeGrade,
  parseBool,
  parseDate,
  parseList,
  parseTimeText,
  parseTimestamp,
  safeUrl,
  str,
} from './util';

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

export interface FamilyRec extends Family {
  row: number;
  /** Guardian slots as stored: [Parent, Parent 2]; blank name/email when empty. */
  slots: [Guardian, Guardian];
}
export interface StudentRec extends Student {
  row: number;
}
export interface ActivityRec extends Activity {
  row: number;
}
export interface EnrollmentRec extends Enrollment {
  row: number;
}
export interface LedgerRec extends LedgerEntry {
  row: number;
}
export interface PaymentRec extends Payment {
  row: number;
  /** Reference column as typed ('' when blank). */
  reference: string;
}
export interface RedemptionRec extends RedemptionRequest {
  row: number;
  notifiedAt?: IsoDateTime;
}
export interface AnnouncementRec extends Announcement {
  row: number;
  /** ID column as typed ('' when blank; `id` is then derived from the row). */
  storedId: string;
  /** Sent column is non-blank (a timestamp, or anything the treasurer typed). */
  sent: boolean;
}
export interface EventRec extends EventItem {
  row: number;
}
export interface PrefsRec {
  row: number;
  email: string;
  familyId: string;
  json: string;
}
export interface DeviceRec {
  row: number;
  email: string;
  familyId: string;
  token: string;
  userAgent: string;
  createdAt?: IsoDateTime;
  lastSeen?: IsoDateTime;
}
export interface LogRec extends LogEntry {
  row: number;
}
export interface SnapshotRec {
  row: number;
  studentId: string;
  balanceCents: number;
}

// ---------------------------------------------------------------------------
// Field parsers
// ---------------------------------------------------------------------------

export function recordStatus(value: unknown, fallback: RecordStatus): RecordStatus {
  const s = lettersOnly(str(value));
  if (!s) return fallback;
  if (s === 'active' || s === 'verified' || s === 'approved') return 'Active';
  if (s === 'pending' || s === 'new' || s === 'review') return 'Pending';
  if (['inactive', 'archived', 'merged', 'rejected', 'graduated', 'left', 'closed', 'removed'].includes(s)) {
    return 'Inactive';
  }
  return fallback;
}

export function enrollmentStatus(value: unknown): EnrollmentStatus {
  const s = lettersOnly(str(value));
  if (!s) return 'Going';
  if (s.startsWith('wait')) return 'Waitlist';
  if (['withdrawn', 'withdrew', 'withdraw', 'cancelled', 'canceled', 'notgoing', 'dropped', 'no'].includes(s)) {
    return 'Withdrawn';
  }
  return 'Going';
}

export function activityKind(value: unknown): ActivityKind {
  const s = lettersOnly(str(value));
  if (s.includes('trip') || s === 'travel') return 'Trip';
  if (s.includes('lesson')) return 'Lessons';
  if (s.includes('camp')) return 'Camp';
  return 'Other';
}

export function paymentMethod(value: unknown): PaymentMethod {
  const s = lettersOnly(str(value));
  if (s.includes('paypal')) return 'PayPal';
  if (s.includes('venmo')) return 'Venmo';
  if (s.startsWith('check') || s.startsWith('cheque') || s.startsWith('chk')) return 'Check';
  if (s.startsWith('cash')) return 'Cash';
  if (/card|credit|debit|visa|mastercard|amex|discover/.test(s)) return 'Card';
  return 'Other';
}

export function paymentStatus(value: unknown): PaymentStatus {
  const s = lettersOnly(str(value));
  if (!s) return 'Completed';
  if (s.startsWith('pend')) return 'Pending';
  if (s.startsWith('refund')) return 'Refunded';
  if (/^(fail|declin|void|cancel|bounce|reject)/.test(s)) return 'Failed';
  return 'Completed';
}

export function redemptionStatus(value: unknown): RedemptionStatus {
  const s = lettersOnly(str(value));
  if (!s) return 'Pending';
  if (s.startsWith('approv') || s === 'yes' || s === 'ok' || s === 'posted') return 'Approved';
  if (s.startsWith('den') || s.startsWith('declin') || s.startsWith('reject') || s === 'no') return 'Denied';
  if (s.startsWith('cancel') || s.startsWith('withdr')) return 'Cancelled';
  return 'Pending';
}

function guardian(name: unknown, email: unknown, phone: unknown): Guardian {
  const g: Guardian = { name: str(name), email: normEmail(email) };
  const p = str(phone);
  if (p) g.phone = p;
  return g;
}

/** Canonical-ID lookups for cross-tab references typed by hand. */
interface Resolver {
  student(id: string): string;
  activity(id: string): string;
  family(id: string): string;
}

// ---------------------------------------------------------------------------
// Row mappers
// ---------------------------------------------------------------------------

export function mapFamily(row: StoredRow): FamilyRec | null {
  const d = row.data;
  const id = str(d.FamilyID);
  if (!id) return null;
  const slots: [Guardian, Guardian] = [
    guardian(d['Parent Name'], d.Email, d.Phone),
    guardian(d['Parent 2 Name'], d['Parent 2 Email'], d['Parent 2 Phone']),
  ];
  const family: FamilyRec = {
    row: row.rowNumber,
    id,
    guardians: slots.filter((g) => g.name !== '' || g.email !== '').map((g) => ({ ...g })),
    slots,
    status: recordStatus(d.Status, 'Active'),
    member: parseBool(d.Member, false),
  };
  const created = parseTimestamp(d.Created);
  if (created) family.createdAt = created;
  return family;
}

export function mapStudent(row: StoredRow, settings: AppSettings, resolve: Pick<Resolver, 'family'>): StudentRec | null {
  const d = row.data;
  const id = str(d.StudentID);
  if (!id) return null;
  const familyId = str(d.FamilyID);
  const student: StudentRec = {
    row: row.rowNumber,
    id,
    familyId: familyId ? resolve.family(familyId) : null,
    firstName: str(d['First Name']),
    lastName: str(d['Last Name']),
    grade: normalizeGrade(d.Grade),
    school: canonical(str(d.School), settings.pub.schools),
    ensembles: parseList(d.Ensembles, settings.pub.ensembles),
    status: recordStatus(d.Status, 'Active'),
  };
  const instrument = str(d.Instrument);
  if (instrument) student.instrument = instrument;
  return student;
}

export function mapActivity(row: StoredRow, settings: AppSettings): ActivityRec | null {
  const d = row.data;
  const id = str(d.ActivityID);
  if (!id) return null;
  const activity: ActivityRec = {
    row: row.rowNumber,
    id,
    name: str(d.Name) || id,
    description: str(d.Description),
    kind: activityKind(d.Kind),
    ensembles: parseList(d.Ensembles, settings.pub.ensembles),
    schools: parseList(d.Schools, settings.pub.schools),
    costCents: Math.max(0, dollarsToCents(d.Cost)),
    status: /^(closed?|no|false|inactive|archived|done|completed?|cancell?ed)$/i.test(str(d.Status)) ? 'Closed' : 'Open',
    allowFunds: parseBool(d['Allow Funds'], true),
    allowOnlinePayment: parseBool(d['Allow Online Payment'], true),
  };
  const due = parseDate(d['Due Date']);
  if (due) activity.dueDate = due;
  const deposit = dollarsToCents(d.Deposit);
  if (deposit > 0) activity.depositCents = deposit;
  const depositDue = parseDate(d['Deposit Due']);
  if (depositDue) activity.depositDueDate = depositDue;
  const info = safeUrl(d['Info URL']);
  if (info) activity.infoUrl = info;
  return activity;
}

export function mapEnrollment(
  row: StoredRow,
  resolve: Resolver,
  activityCost: (activityId: string) => number,
): EnrollmentRec | null {
  const d = row.data;
  const studentId = str(d.StudentID);
  const activityId = str(d.ActivityID);
  if (!studentId || !activityId) return null;
  const canonicalActivity = resolve.activity(activityId);
  const override = str(d.Cost);
  return {
    row: row.rowNumber,
    studentId: resolve.student(studentId),
    activityId: canonicalActivity,
    costCents: override ? Math.max(0, dollarsToCents(d.Cost)) : activityCost(canonicalActivity),
    status: enrollmentStatus(d.Status),
  };
}

export function mapLedger(row: StoredRow, resolve: Resolver): LedgerRec | null {
  const d = row.data;
  const studentId = str(d.StudentID);
  const amountCents = dollarsToCents(d.Amount);
  if (!studentId || amountCents === 0) return null;
  const reference = str(d.Reference);
  const entry: LedgerRec = {
    row: row.rowNumber,
    id: reference || `L${row.rowNumber}`,
    date: parseDate(d.Date) ?? '',
    studentId: resolve.student(studentId),
    type: str(d.Type) || (amountCents > 0 ? 'Credit' : 'Adjustment'),
    description: str(d.Description),
    amountCents,
  };
  const activityId = str(d.ActivityID);
  if (activityId) entry.activityId = resolve.activity(activityId);
  if (reference) entry.reference = reference;
  return entry;
}

export function mapPayment(row: StoredRow, resolve: Resolver): PaymentRec | null {
  const d = row.data;
  const studentId = str(d.StudentID);
  const amountCents = dollarsToCents(d.Amount);
  if (!studentId || amountCents === 0) return null;
  const reference = str(d.Reference);
  const feeCents = Math.max(0, dollarsToCents(d['Fee Covered']));
  const grossTyped = dollarsToCents(d.Gross);
  const activityId = str(d.ActivityID);
  const payment: PaymentRec = {
    row: row.rowNumber,
    reference,
    id: reference || `P${row.rowNumber}`,
    date: parseDate(d.Date) ?? '',
    studentId: resolve.student(studentId),
    activityId: activityId ? resolve.activity(activityId) : '',
    amountCents,
    feeCents,
    grossCents: grossTyped !== 0 ? grossTyped : amountCents + feeCents,
    method: paymentMethod(d.Method),
    status: paymentStatus(d.Status),
  };
  const payer = normEmail(d['Payer Email']);
  if (payer) payment.payerEmail = payer;
  return payment;
}

export function mapRedemption(row: StoredRow, resolve: Resolver): RedemptionRec | null {
  const d = row.data;
  const id = str(d.RequestID);
  if (!id) return null;
  const familyId = str(d.FamilyID);
  const r: RedemptionRec = {
    row: row.rowNumber,
    id,
    requestedAt: parseTimestamp(d.Requested) ?? '',
    email: normEmail(d.Email),
    familyId: familyId ? resolve.family(familyId) : '',
    studentId: resolve.student(str(d.StudentID)),
    activityId: resolve.activity(str(d.ActivityID)),
    amountCents: Math.max(0, dollarsToCents(d.Amount)),
    status: redemptionStatus(d.Status),
  };
  const note = str(d.Note);
  if (note) r.note = note;
  const decidedAt = parseTimestamp(d.Decided);
  if (decidedAt) r.decidedAt = decidedAt;
  const decidedBy = str(d['Decided By']);
  if (decidedBy) r.decidedBy = decidedBy;
  const adminNote = str(d['Admin Note']);
  if (adminNote) r.adminNote = adminNote;
  // Anything typed in Notified counts as "already notified".
  if (str(d.Notified)) r.notifiedAt = parseTimestamp(d.Notified) ?? str(d.Notified);
  return r;
}

export function mapAnnouncement(row: StoredRow, settings: AppSettings): AnnouncementRec | null {
  const d = row.data;
  const title = str(d.Title);
  const body = str(d.Body);
  if (!title && !body) return null;
  const storedId = str(d.ID);
  const sentAt = parseTimestamp(d.Sent);
  const a: AnnouncementRec = {
    row: row.rowNumber,
    storedId,
    id: storedId || `A${row.rowNumber}`,
    date: parseDate(d.Date) ?? (sentAt ? parseDate(sentAt) ?? '' : ''),
    title: title || 'TMA update',
    body,
    audience: {
      schools: parseList(d.Schools, settings.pub.schools),
      ensembles: parseList(d.Ensembles, settings.pub.ensembles),
    },
    sent: str(d.Sent) !== '',
  };
  const link = safeUrl(d.Link);
  if (link) a.link = link;
  if (sentAt) a.sentAt = sentAt;
  return a;
}

export function mapEvent(row: StoredRow, settings: AppSettings): EventRec | null {
  const d = row.data;
  const title = str(d.Title);
  const date = parseDate(d.Date);
  if (!title || !date) return null;
  const storedId = str(d.ID);
  const slug = lettersOnly(title).slice(0, 24);
  const e: EventRec = {
    row: row.rowNumber,
    id: storedId || `E-${date}-${slug}`,
    date,
    title,
    audience: {
      schools: parseList(d.Schools, settings.pub.schools),
      ensembles: parseList(d.Ensembles, settings.pub.ensembles),
    },
  };
  const time = parseTimeText(d.Time);
  if (time) e.time = time;
  const location = str(d.Location);
  if (location) e.location = location;
  const details = str(d.Details);
  if (details) e.details = details;
  return e;
}

// ---------------------------------------------------------------------------
// API shapes (strip sheet bookkeeping)
// ---------------------------------------------------------------------------

export function toFamily(f: FamilyRec): Family {
  const out: Family = {
    id: f.id,
    guardians: f.guardians.map((g) => ({ ...g })),
    status: f.status,
    member: f.member,
  };
  if (f.createdAt) out.createdAt = f.createdAt;
  return out;
}

export function toStudent(s: StudentRec): Student {
  const out: Student = {
    id: s.id,
    familyId: s.familyId,
    firstName: s.firstName,
    lastName: s.lastName,
    grade: s.grade,
    school: s.school,
    ensembles: s.ensembles.slice(),
    status: s.status,
  };
  if (s.instrument) out.instrument = s.instrument;
  return out;
}

export function toActivity(a: ActivityRec): Activity {
  const out: Activity = {
    id: a.id,
    name: a.name,
    description: a.description,
    kind: a.kind,
    ensembles: a.ensembles.slice(),
    schools: a.schools.slice(),
    costCents: a.costCents,
    status: a.status,
    allowFunds: a.allowFunds,
    allowOnlinePayment: a.allowOnlinePayment,
  };
  if (a.dueDate) out.dueDate = a.dueDate;
  if (a.depositCents) out.depositCents = a.depositCents;
  if (a.depositDueDate) out.depositDueDate = a.depositDueDate;
  if (a.infoUrl) out.infoUrl = a.infoUrl;
  return out;
}

export function toLedgerEntry(l: LedgerRec): LedgerEntry {
  const out: LedgerEntry = {
    id: l.id,
    date: l.date,
    studentId: l.studentId,
    type: l.type,
    description: l.description,
    amountCents: l.amountCents,
  };
  if (l.activityId) out.activityId = l.activityId;
  if (l.reference) out.reference = l.reference;
  return out;
}

export function toPayment(p: PaymentRec): Payment {
  const out: Payment = {
    id: p.id,
    date: p.date,
    studentId: p.studentId,
    activityId: p.activityId,
    amountCents: p.amountCents,
    feeCents: p.feeCents,
    grossCents: p.grossCents,
    method: p.method,
    status: p.status,
  };
  if (p.payerEmail) out.payerEmail = p.payerEmail;
  return out;
}

export function toRedemption(r: RedemptionRec): RedemptionRequest {
  const out: RedemptionRequest = {
    id: r.id,
    requestedAt: r.requestedAt,
    email: r.email,
    familyId: r.familyId,
    studentId: r.studentId,
    activityId: r.activityId,
    amountCents: r.amountCents,
    status: r.status,
  };
  if (r.note) out.note = r.note;
  if (r.decidedAt) out.decidedAt = r.decidedAt;
  if (r.decidedBy) out.decidedBy = r.decidedBy;
  if (r.adminNote) out.adminNote = r.adminNote;
  return out;
}

export function toAnnouncement(a: AnnouncementRec): Announcement {
  const out: Announcement = {
    id: a.id,
    date: a.date,
    title: a.title,
    body: a.body,
    audience: { schools: a.audience.schools.slice(), ensembles: a.audience.ensembles.slice() },
  };
  if (a.link) out.link = a.link;
  if (a.sentAt) out.sentAt = a.sentAt;
  return out;
}

export function toEvent(e: EventRec): EventItem {
  const out: EventItem = {
    id: e.id,
    date: e.date,
    title: e.title,
    audience: { schools: e.audience.schools.slice(), ensembles: e.audience.ensembles.slice() },
  };
  if (e.time) out.time = e.time;
  if (e.location) out.location = e.location;
  if (e.details) out.details = e.details;
  return out;
}

export function studentName(s: Pick<Student, 'firstName' | 'lastName'>): string {
  return `${s.firstName} ${s.lastName}`.trim();
}

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

const PEOPLE: readonly TableName[] = ['Families', 'Students', 'Settings'];
const CATALOG: readonly TableName[] = ['Activities', 'Settings'];
const REFS: readonly TableName[] = [...PEOPLE, 'Activities'];

const STATUS_RANK: Record<RecordStatus, number> = { Active: 0, Pending: 1, Inactive: 2 };

export class Model {
  private readonly memos = new Map<string, { key: string; value: unknown }>();

  constructor(
    private readonly services: Services,
    private readonly db: Db,
  ) {}

  /** Memoize `build` until one of `deps` is written. */
  private memo<T>(name: string, deps: readonly TableName[], build: () => T): T {
    const key = deps.map((t) => this.db.version(t)).join('|');
    const hit = this.memos.get(name);
    if (hit && hit.key === key) return hit.value as T;
    const value = build();
    this.memos.set(name, { key, value });
    return value;
  }

  private parse<T>(table: TableName, map: (row: StoredRow) => T | null): T[] {
    const out: T[] = [];
    for (const row of this.db.rows(table)) {
      const rec = map(row);
      if (rec) out.push(rec);
    }
    return out;
  }

  settings(): AppSettings {
    return this.memo('settings', ['Settings'], () => buildSettings(this.db.rows('Settings'), this.services));
  }

  // Families ---------------------------------------------------------------

  families(): FamilyRec[] {
    return this.memo('families', ['Families'], () => this.parse('Families', mapFamily));
  }

  private familyIndex(): Map<string, FamilyRec> {
    return this.memo('familyIndex', ['Families'], () => {
      const index = new Map<string, FamilyRec>();
      for (const f of this.families()) if (!index.has(idKey(f.id))) index.set(idKey(f.id), f);
      return index;
    });
  }

  familyById(id: string | null | undefined): FamilyRec | null {
    return id ? (this.familyIndex().get(idKey(id)) ?? null) : null;
  }

  /** Families listing `email` as a guardian, best status first (Active, Pending, Inactive), then sheet order. */
  familiesWithEmail(email: string): FamilyRec[] {
    const byEmail = this.memo('familiesByEmail', ['Families'], () => {
      const index = new Map<string, FamilyRec[]>();
      for (const f of this.families()) {
        for (const g of f.guardians) {
          if (!g.email) continue;
          const list = index.get(g.email) ?? [];
          if (!list.includes(f)) list.push(f);
          index.set(g.email, list);
        }
      }
      index.forEach((list) => list.sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || a.row - b.row));
      return index;
    });
    return (byEmail.get(normEmail(email)) ?? []).slice();
  }

  /**
   * The caller's household (Inactive only when it is the sole match). An Inactive household counts
   * only for its first guardian: anyone can type an email into the second-guardian slot, so a
   * rejected household must not lock that email's owner out of signing up with their own.
   */
  familyForEmail(email: string): FamilyRec | null {
    const key = normEmail(email);
    return this.familiesWithEmail(key).find((f) => f.status !== 'Inactive' || f.slots[0].email === key) ?? null;
  }

  // Students ---------------------------------------------------------------

  students(): StudentRec[] {
    return this.memo('students', PEOPLE, () => {
      const settings = this.settings();
      const resolve = { family: (id: string) => this.familyById(id)?.id ?? id };
      const out: StudentRec[] = [];
      for (const row of this.db.rows('Students')) {
        const s = mapStudent(row, settings, resolve);
        if (s) out.push(s);
        else if (str(row.data['First Name']) || str(row.data['Last Name'])) {
          this.services.logger.info(`Students row ${row.rowNumber} has no StudentID; ignored`);
        }
      }
      return out;
    });
  }

  private studentIndex(): Map<string, StudentRec> {
    return this.memo('studentIndex', PEOPLE, () => {
      const index = new Map<string, StudentRec>();
      for (const s of this.students()) if (!index.has(idKey(s.id))) index.set(idKey(s.id), s);
      return index;
    });
  }

  studentById(id: string | null | undefined): StudentRec | null {
    return id ? (this.studentIndex().get(idKey(id)) ?? null) : null;
  }

  /** Students linked to a family (Inactive ones only when asked). */
  studentsOfFamily(familyId: string, includeInactive = false): StudentRec[] {
    const byFamily = this.memo('studentsByFamily', PEOPLE, () => {
      const index = new Map<string, StudentRec[]>();
      for (const s of this.students()) {
        if (s.familyId === null) continue;
        const list = index.get(idKey(s.familyId)) ?? [];
        list.push(s);
        index.set(idKey(s.familyId), list);
      }
      return index;
    });
    const all = byFamily.get(idKey(familyId)) ?? [];
    return includeInactive ? all.slice() : all.filter((s) => s.status !== 'Inactive');
  }

  /** Verified = family Active and student Active (money is only shown/notified then). */
  isVerified(student: StudentRec): boolean {
    if (student.status !== 'Active') return false;
    return this.familyById(student.familyId)?.status === 'Active';
  }

  // Activities ---------------------------------------------------------------

  activities(): ActivityRec[] {
    return this.memo('activities', CATALOG, () => {
      const settings = this.settings();
      return this.parse('Activities', (row) => mapActivity(row, settings));
    });
  }

  activityById(id: string | null | undefined): ActivityRec | null {
    if (!id) return null;
    const index = this.memo('activityIndex', CATALOG, () => {
      const map = new Map<string, ActivityRec>();
      for (const a of this.activities()) if (!map.has(idKey(a.id))) map.set(idKey(a.id), a);
      return map;
    });
    return index.get(idKey(id)) ?? null;
  }

  private resolver(): Resolver {
    return {
      student: (id) => this.studentById(id)?.id ?? id,
      activity: (id) => this.activityById(id)?.id ?? id,
      family: (id) => this.familyById(id)?.id ?? id,
    };
  }

  // Money tabs -----------------------------------------------------------------

  enrollments(): EnrollmentRec[] {
    return this.memo('enrollments', [...REFS, 'Enrollments'], () => {
      const resolve = this.resolver();
      const cost = (activityId: string) => this.activityById(activityId)?.costCents ?? 0;
      return this.parse('Enrollments', (row) => mapEnrollment(row, resolve, cost));
    });
  }

  ledger(): LedgerRec[] {
    return this.memo('ledger', [...REFS, 'Ledger'], () => {
      const resolve = this.resolver();
      return this.parse('Ledger', (row) => mapLedger(row, resolve));
    });
  }

  payments(): PaymentRec[] {
    return this.memo('payments', [...REFS, 'Payments'], () => {
      const resolve = this.resolver();
      return this.parse('Payments', (row) => mapPayment(row, resolve));
    });
  }

  redemptions(): RedemptionRec[] {
    return this.memo('redemptions', [...REFS, 'Redemptions'], () => {
      const resolve = this.resolver();
      return this.parse('Redemptions', (row) => mapRedemption(row, resolve));
    });
  }

  redemptionById(id: string): RedemptionRec | null {
    const key = idKey(id);
    return this.redemptions().find((r) => idKey(r.id) === key) ?? null;
  }

  books(): Books {
    return this.memo('books', [...REFS, 'Enrollments', 'Ledger', 'Payments', 'Redemptions'], () =>
      computeBooks({
        ledger: this.ledger(),
        payments: this.payments(),
        redemptions: this.redemptions(),
        enrollments: this.enrollments(),
        activities: this.activities(),
      }),
    );
  }

  // News -----------------------------------------------------------------------

  announcements(): AnnouncementRec[] {
    return this.memo('announcements', ['Announcements', 'Settings'], () => {
      const settings = this.settings();
      return this.parse('Announcements', (row) => mapAnnouncement(row, settings));
    });
  }

  events(): EventRec[] {
    return this.memo('events', ['Events', 'Settings'], () => {
      const settings = this.settings();
      return this.parse('Events', (row) => mapEvent(row, settings));
    });
  }

  // App-managed tabs -----------------------------------------------------------

  /** Stored notification prefs by email (last row wins). */
  preferences(): Map<string, PrefsRec> {
    return this.memo('preferences', ['Preferences'], () => {
      const map = new Map<string, PrefsRec>();
      for (const row of this.db.rows('Preferences')) {
        const email = normEmail(row.data.Email);
        if (!isEmail(email)) continue;
        map.set(email, { row: row.rowNumber, email, familyId: str(row.data.FamilyID), json: str(row.data.Prefs) });
      }
      return map;
    });
  }

  devices(): DeviceRec[] {
    return this.memo('devices', ['Devices'], () =>
      this.parse('Devices', (row): DeviceRec | null => {
        const token = str(row.data.Token);
        if (!token) return null;
        const device: DeviceRec = {
          row: row.rowNumber,
          email: normEmail(row.data.Email),
          familyId: str(row.data.FamilyID),
          token,
          userAgent: str(row.data['User Agent']),
        };
        const created = parseTimestamp(row.data.Created);
        if (created) device.createdAt = created;
        const seen = parseTimestamp(row.data['Last Seen']);
        if (seen) device.lastSeen = seen;
        return device;
      }),
    );
  }

  devicesFor(email: string): DeviceRec[] {
    const key = normEmail(email);
    return key ? this.devices().filter((d) => d.email === key) : [];
  }

  logEntries(): LogRec[] {
    return this.memo('log', ['Log'], () =>
      this.parse('Log', (row): LogRec | null => {
        const kind = str(row.data.Kind);
        const detail = str(row.data.Detail);
        if (!kind && !detail) return null;
        return { row: row.rowNumber, at: parseTimestamp(row.data.At) ?? '', kind, detail };
      }),
    );
  }

  /** Last balances the sync saw, by idKey(StudentID). */
  snapshot(): Map<string, SnapshotRec> {
    return this.memo('snapshot', ['_Snapshot'], () => {
      const map = new Map<string, SnapshotRec>();
      for (const row of this.db.rows('_Snapshot')) {
        const studentId = str(row.data.StudentID);
        if (!studentId) continue;
        map.set(idKey(studentId), { row: row.rowNumber, studentId, balanceCents: dollarsToCents(row.data.Balance) });
      }
      return map;
    });
  }

  sentKeys(): Set<string> {
    return this.memo('sent', ['_Sent'], () => {
      const keys = new Set<string>();
      for (const row of this.db.rows('_Sent')) {
        const key = str(row.data.Key);
        if (key) keys.add(key);
      }
      return keys;
    });
  }
}
