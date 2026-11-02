/**
 * Display helpers: dates, names, due dates and audiences. Money formatting
 * lives in src/shared/money.ts (formatCents) and is re-exported here so screens
 * import one module.
 */
import { formatCents } from '../../shared/money';
import type {
  ActivityAccount,
  Audience,
  Cents,
  IsoDate,
  IsoDateTime,
  Student,
} from '../../shared/types';

export { formatCents };

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Parse YYYY-MM-DD as a local calendar date (no timezone drift). Null when invalid. */
export function parseIsoDate(value: IsoDate | undefined | null): Date | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Local calendar date as YYYY-MM-DD. */
export function toIsoDate(d: Date): IsoDate {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function todayIso(now: Date = new Date()): IsoDate {
  return toIsoDate(now);
}

/** "Feb 1" this year, "Feb 1, 2027" otherwise. */
export function formatDate(value: IsoDate | undefined | null, now: Date = new Date()): string {
  const d = parseIsoDate(value);
  if (!d) return value ?? '';
  const base = `${MONTHS[d.getMonth()]} ${d.getDate()}`;
  return d.getFullYear() === now.getFullYear() ? base : `${base}, ${d.getFullYear()}`;
}

/** "Mon, Feb 1". */
export function formatWeekdayDate(value: IsoDate, now: Date = new Date()): string {
  const d = parseIsoDate(value);
  if (!d) return value;
  const weekday = d.toLocaleDateString('en-US', { weekday: 'short' });
  return `${weekday}, ${formatDate(value, now)}`;
}

/** Month abbreviation and day number for date badges. */
export function dateBadge(value: IsoDate): { month: string; day: string } {
  const d = parseIsoDate(value);
  if (!d) return { month: '', day: '' };
  return { month: MONTHS[d.getMonth()].toUpperCase(), day: String(d.getDate()) };
}

/** "2:15 PM". */
export function formatTime(value: IsoDateTime): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

/** "Oct 21, 2:15 PM" (or "Today, 2:15 PM"). */
export function formatDateTime(value: IsoDateTime | undefined | null, now: Date = new Date()): string {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  const day = toIsoDate(d) === toIsoDate(now) ? 'Today' : formatDate(toIsoDate(d), now);
  return `${day}, ${formatTime(value)}`;
}

/** Whole days from today to `date` (negative = past). Null when invalid. */
export function daysUntil(date: IsoDate | undefined | null, now: Date = new Date()): number | null {
  const d = parseIsoDate(date);
  if (!d) return null;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((d.getTime() - today.getTime()) / 86_400_000);
}

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? '';
}

export function studentName(s: Pick<Student, 'firstName' | 'lastName'>): string {
  return `${s.firstName} ${s.lastName}`.trim();
}

export function gradeLabel(grade: string): string {
  const g = grade.trim();
  if (!g) return '';
  if (/^k$/i.test(g)) return 'Kindergarten';
  return /^\d+$/.test(g) ? `Grade ${g}` : g;
}

export function plural(n: number, singular: string, pluralForm = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : pluralForm}`;
}

export function greeting(now: Date = new Date()): string {
  const h = now.getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

/** Cents → what goes in an amount box ("1050.00"). */
export function centsToInput(cents: Cents): string {
  return (Math.max(0, Math.round(cents)) / 100).toFixed(2);
}

/** Audience as display labels; empty = everyone. */
export function audienceLabels(audience: Audience | undefined): string[] {
  if (!audience) return [];
  return [...audience.schools, ...audience.ensembles];
}

export function audienceSummary(audience: Audience): string {
  const labels = audienceLabels(audience);
  return labels.length ? labels.join(', ') : 'Everyone';
}

/** Only http(s) links are rendered as links. */
export function safeHref(url: string | undefined | null): string | null {
  if (!url) return null;
  return /^https?:\/\/[^\s<>"'`]+$/i.test(url.trim()) ? url.trim() : null;
}

// ---------------------------------------------------------------------------
// Activity accounts
// ---------------------------------------------------------------------------

export interface DueInfo {
  label: 'Deposit' | 'Final payment';
  date: IsoDate;
  /** Still owed for this milestone. */
  amountCents: Cents;
  days: number;
}

/** The next unpaid milestone (deposit, then final balance), or null when nothing is owed or no dates are set. */
export function nextDue(acc: ActivityAccount, now: Date = new Date()): DueInfo | null {
  if (acc.remainingCents <= 0) return null;
  if (acc.depositCents && acc.depositDueDate && acc.paidCents < acc.depositCents) {
    const days = daysUntil(acc.depositDueDate, now);
    if (days !== null) {
      return {
        label: 'Deposit',
        date: acc.depositDueDate,
        amountCents: Math.min(acc.depositCents - acc.paidCents, acc.remainingCents),
        days,
      };
    }
  }
  if (acc.dueDate) {
    const days = daysUntil(acc.dueDate, now);
    if (days !== null) return { label: 'Final payment', date: acc.dueDate, amountCents: acc.remainingCents, days };
  }
  return null;
}

export const DUE_SOON_DAYS = 14;

export type AccountStatus = 'paid' | 'overdue' | 'due-soon' | 'open';

export function accountStatus(acc: ActivityAccount, now: Date = new Date()): AccountStatus {
  if (acc.remainingCents <= 0) return 'paid';
  const due = nextDue(acc, now);
  if (due && due.days < 0) return 'overdue';
  if (due && due.days <= DUE_SOON_DAYS) return 'due-soon';
  return 'open';
}

/** "due today", "due in 3 days", "was due Feb 1". */
export function duePhrase(due: DueInfo, now: Date = new Date()): string {
  if (due.days === 0) return 'due today';
  if (due.days === 1) return 'due tomorrow';
  if (due.days < 0) return `was due ${formatDate(due.date, now)}`;
  if (due.days <= DUE_SOON_DAYS) return `due in ${due.days} days`;
  return `due ${formatDate(due.date, now)}`;
}

/** Largest amount of funds that can still be requested for this account. */
export function maxRedeemableCents(acc: ActivityAccount, availableCents: Cents): Cents {
  return Math.max(0, Math.min(availableCents, acc.remainingCents - acc.pendingRedemptionCents));
}
