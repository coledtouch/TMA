/**
 * Scheduled work (ARCHITECTURE.md §7). Both ticks assume the caller holds the
 * write lock (see app.ts) and sends the queued notifications after releasing it.
 * Each step catches its own errors into report.errors.
 *
 * The treasurer edits these tabs by hand while the app runs, so:
 * - a row typed in the sheet (a fund decision, an announcement) is acted on only once it has
 *   stopped changing: Sheets saves each cell as it is typed (see settled());
 * - stamps (Notified, Sent) go to the row that holds the same item when they are written,
 *   found by re-reading the tab, never to a row number read earlier (see reread());
 * - a step whose columns can't be read (a renamed header) is skipped with an error rather than
 *   reading every row as blank (see requireColumns()).
 */
import { centsToDollars } from '../shared/money';
import type { TableName } from '../shared/schema';
import type { TickReport } from '../shared/types';
import type { Ctx } from './context';
import type { AnnouncementRec, RedemptionRec } from './data';
import { announcementNotice, creditNotice, debitNotice, eventTomorrowNotice, paymentReminderNotice } from './messages';
import { addCounts, allRecipients, deliver, notifyFamily, zeroCounts } from './notify';
import { ledgerHasReference, notifyDecision, postRedemptionLedger } from './redemptions';
import type { RowData } from './services';
import { addDays, daysBetween, errorMessage, idKey, nyParts } from './util';

/** A row typed in the sheet is acted on once it has looked exactly the same for this long. */
export const SETTLE_MS = 5 * 60 * 1000;
/** Announcements dated today go out from this hour (New York), not in the first sync after midnight. */
export const ANNOUNCE_FROM_HOUR = 8;
/** CacheService keeps values at most 6 hours. */
const SETTLE_TTL_SECONDS = 21600;

export function emptyReport(now: Date): TickReport {
  return {
    ranAt: now.toISOString(),
    balanceChanges: 0,
    redemptionsPosted: 0,
    announcementsSent: 0,
    remindersSent: 0,
    notifications: zeroCounts(),
    errors: [],
  };
}

function recordError(ctx: Ctx, report: TickReport, step: string, err: unknown): void {
  const message = `${step}: ${errorMessage(err)}`;
  report.errors.push(message);
  ctx.s.logger.error(`syncTick step failed: ${step}`, err);
  ctx.log('error', message);
}

function step(ctx: Ctx, report: TickReport, name: string, fn: () => void): void {
  try {
    fn();
  } catch (err) {
    recordError(ctx, report, name, err);
  }
}

/** Every ~15 minutes. */
export function runSync(ctx: Ctx): TickReport {
  const report = emptyReport(ctx.now);
  step(ctx, report, 'redemptions', () => postSheetDecisions(ctx, report));
  step(ctx, report, 'balances', () => detectBalanceChanges(ctx, report));
  step(ctx, report, 'announcements', () => sendQueuedAnnouncements(ctx, report));
  return report;
}

/** Once a day (morning). */
export function runDaily(ctx: Ctx): TickReport {
  const report = emptyReport(ctx.now);
  step(ctx, report, 'payment reminders', () => sendPaymentReminders(ctx, report));
  step(ctx, report, 'event reminders', () => sendEventReminders(ctx, report));
  return report;
}

// ---------------------------------------------------------------------------
// Reading the treasurer's tabs safely
// ---------------------------------------------------------------------------

/**
 * Throw (the step is then skipped and reported) when a tab lacks a column the step depends on:
 * a renamed header must not read as blank cells, which would e.g. re-send every announcement
 * ("Sent" blank) or tell every family their balance fell to $0 ("Amount" blank).
 * A missing tab is fine (nothing to read) unless `tabRequired`.
 */
function requireColumns(ctx: Ctx, table: TableName, columns: readonly string[], tabRequired = false): void {
  const present = ctx.db.columns(table);
  if (present === undefined) return; // the store can't tell
  if (present === null) {
    if (tabRequired) throw new Error(`The ${table} tab is missing (was it renamed?), so this step was skipped. Rename it back to ${table}.`);
    return;
  }
  const missing = columns.filter((c) => !present.includes(c));
  if (missing.length > 0) {
    const names = missing.map((c) => `"${c}"`).join(', ');
    throw new Error(
      `The ${table} tab has no ${names} column, so this step was skipped rather than reading every row as blank. If a header was renamed (or the header row sorted), change it back.`,
    );
  }
}

/**
 * Whether a row typed in the sheet has stopped changing: the same content was first seen at least
 * SETTLE_MS ago. Sheets saves each cell as it is entered, so without this a sync could act on a row
 * whose Title is typed but not yet its Body, audience or Admin Note.
 */
function settled(ctx: Ctx, kind: string, content: unknown[]): boolean {
  const key = `settle:${kind}:${ctx.s.crypto.hmacSha256Hex('tma-settle', JSON.stringify(content))}`;
  const firstSeen = Number(ctx.s.cache.get(key));
  if (Number.isFinite(firstSeen) && firstSeen > 0) return ctx.now.getTime() - firstSeen >= SETTLE_MS;
  ctx.s.cache.put(key, String(ctx.now.getTime()), SETTLE_TTL_SECONDS);
  return false;
}

function countWaiting(report: TickReport): void {
  report.waiting = (report.waiting ?? 0) + 1;
}

/**
 * Re-read `table` and find the record that is still the same item (same key and content), preferring
 * the row it was on. null = it was deleted or edited meanwhile (it is looked at again next time).
 */
function reread<T extends { row: number }>(ctx: Ctx, table: TableName, list: () => T[], before: T, same: (rec: T) => boolean): T | null {
  ctx.db.refresh(table);
  const matches = list().filter(same);
  return matches.find((r) => r.row === before.row) ?? matches[0] ?? null;
}

function decisionContent(r: RedemptionRec): unknown[] {
  return [idKey(r.id), r.status, r.adminNote ?? '', r.amountCents, idKey(r.studentId), idKey(r.activityId), r.decidedBy ?? ''];
}

function announcementContent(a: AnnouncementRec): unknown[] {
  return [a.storedId, a.date, a.title, a.body, a.audience.schools, a.audience.ensembles, a.link ?? ''];
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

/** 1. Redemptions the treasurer set to Approved/Denied in the sheet. */
function postSheetDecisions(ctx: Ctx, report: TickReport): void {
  requireColumns(ctx, 'Redemptions', ['RequestID', 'StudentID', 'ActivityID', 'Amount', 'Status', 'Notified']);
  const decided = ctx.m.redemptions().filter((r) => (r.status === 'Approved' || r.status === 'Denied') && !r.notifiedAt);
  // Posting needs the Ledger's own columns (and the Reference check that stops a second row).
  if (decided.some((r) => r.status === 'Approved')) requireColumns(ctx, 'Ledger', ['StudentID', 'Amount', 'Reference'], true);
  for (const candidate of decided) {
    try {
      if (!settled(ctx, 'decision', decisionContent(candidate))) {
        countWaiting(report);
        continue;
      }
      const content = JSON.stringify(decisionContent(candidate));
      const rec = reread(ctx, 'Redemptions', () => ctx.m.redemptions(), candidate, (r) => !r.notifiedAt && JSON.stringify(decisionContent(r)) === content);
      if (!rec) continue;
      if (rec.status === 'Approved' && !ledgerHasReference(ctx, rec.id)) {
        if (rec.amountCents <= 0 || !rec.studentId) throw new Error(`${rec.id} has no student or amount`);
        if (postRedemptionLedger(ctx, rec, rec.decidedBy || 'TMA sheet')) report.redemptionsPosted++;
      }
      const patch: RowData = { Notified: ctx.now };
      if (!rec.decidedAt) patch.Decided = ctx.now;
      // Mark first: a family should never get the same decision twice.
      ctx.db.update('Redemptions', rec.row, patch);
      ctx.log('redemption', `${rec.id}: ${rec.status.toLowerCase()} in the sheet${rec.status === 'Approved' ? ', ledger posted' : ''}`);
      addCounts(report.notifications, notifyDecision(ctx, rec));
    } catch (err) {
      recordError(ctx, report, `redemption ${candidate.id}`, err);
    }
  }
}

/** 2. Balance changes since the last snapshot -> notify verified households. */
function detectBalanceChanges(ctx: Ctx, report: TickReport): void {
  requireColumns(ctx, 'Ledger', ['StudentID', 'Amount'], true);
  const books = ctx.m.books();
  const current = new Map<string, { studentId: string; cents: number }>();
  for (const s of ctx.m.students()) current.set(idKey(s.id), { studentId: s.id, cents: books.balance(s.id) });
  for (const key of books.ledgerStudentKeys()) {
    if (!current.has(key)) current.set(key, { studentId: key, cents: books.balance(key) });
  }

  const snapshot = ctx.m.snapshot();
  const rows = (): RowData[] =>
    Array.from(current.values()).map((c) => ({
      StudentID: c.studentId,
      Balance: centsToDollars(c.cents),
      Updated: ctx.now,
    }));

  if (snapshot.size === 0) {
    if (current.size > 0) {
      ctx.db.overwrite('_Snapshot', rows());
      ctx.log('sync', `First run: saved ${current.size} balances (no notifications)`);
    }
    return;
  }

  // A Ledger tab that suddenly has no usable rows would read as every balance falling to $0.
  if (books.ledgerStudentKeys().length === 0 && Array.from(snapshot.values()).some((s) => s.balanceCents !== 0)) {
    throw new Error(
      'The Ledger tab has no rows with a StudentID and an Amount, but earlier runs saw balances, so no family was told about a change. If the Ledger really was emptied, clear the _Snapshot tab.',
    );
  }

  let changed = false;
  const alerts: Array<{ studentId: string; delta: number; balance: number }> = [];
  current.forEach((cur, key) => {
    const before = snapshot.get(key);
    const delta = cur.cents - (before ? before.balanceCents : 0);
    // A student missing from the snapshot counts as a previous balance of 0.
    if (delta === 0) return;
    changed = true;
    report.balanceChanges++;
    alerts.push({ studentId: cur.studentId, delta, balance: cur.cents });
  });
  snapshot.forEach((_, key) => {
    if (!current.has(key)) changed = true;
  });
  // Save first: a family should never get the same alert twice.
  if (changed) ctx.db.overwrite('_Snapshot', rows());

  for (const alert of alerts) {
    const student = ctx.m.studentById(alert.studentId);
    if (!student || !ctx.m.isVerified(student)) continue;
    try {
      const notice =
        alert.delta > 0
          ? creditNotice(student.firstName, alert.delta, alert.balance, student.id)
          : debitNotice(student.firstName, alert.delta, alert.balance, student.id);
      addCounts(report.notifications, notifyFamily(ctx, ctx.m.familyById(student.familyId), notice));
    } catch (err) {
      recordError(ctx, report, `balance ${student.id}`, err);
    }
  }
}

/**
 * 3. Announcements typed into the sheet with a blank Sent: Date blank (send now) or past, or today
 * from ANNOUNCE_FROM_HOUR (a dated announcement shouldn't buzz phones just after midnight).
 */
function sendQueuedAnnouncements(ctx: Ctx, report: TickReport): void {
  requireColumns(ctx, 'Announcements', ['Date', 'Title', 'Body', 'Schools', 'Ensembles', 'Sent']);
  const morning = nyParts(ctx.now).hour >= ANNOUNCE_FROM_HOUR;
  const isDue = (a: AnnouncementRec) => !a.date || a.date < ctx.today || (a.date === ctx.today && morning);
  let recipients: string[] | null = null;
  for (const candidate of ctx.m.announcements().filter((a) => !a.sent)) {
    try {
      // Rows typed ahead of their date settle meanwhile, so they go out at the first sync they're due.
      const stable = settled(ctx, 'announcement', announcementContent(candidate));
      if (!isDue(candidate)) continue;
      if (!stable) {
        countWaiting(report);
        continue;
      }
      const content = JSON.stringify(announcementContent(candidate));
      const a = reread(ctx, 'Announcements', () => ctx.m.announcements(), candidate, (x) => !x.sent && JSON.stringify(announcementContent(x)) === content);
      if (!a) continue;
      // Only Sent is written to this treasurer tab; mark first so it goes out at most once.
      ctx.db.update('Announcements', a.row, { Sent: ctx.now });
      recipients ??= allRecipients(ctx);
      addCounts(report.notifications, deliver(ctx, recipients, announcementNotice(a)));
      report.announcementsSent++;
    } catch (err) {
      recordError(ctx, report, `announcement ${candidate.id}`, err);
    }
  }
}

/** 4. Payment reminders N days before the final due date (REMINDER_DAYS), once per key. */
function sendPaymentReminders(ctx: Ctx, report: TickReport): void {
  const days = ctx.m.settings().reminderDays;
  if (days.length === 0) return;
  // A renamed money column would make every trip look unpaid (or every enrollment "Going").
  requireColumns(ctx, 'Ledger', ['StudentID', 'Amount', 'ActivityID'], true);
  requireColumns(ctx, 'Payments', ['StudentID', 'ActivityID', 'Amount', 'Status']);
  requireColumns(ctx, 'Enrollments', ['StudentID', 'ActivityID', 'Status']);
  const books = ctx.m.books();
  const sent = new Set(ctx.m.sentKeys());
  const newKeys: RowData[] = [];
  try {
    for (const student of ctx.m.students()) {
      if (!ctx.m.isVerified(student)) continue;
      const family = ctx.m.familyById(student.familyId);
      for (const account of books.accounts(student.id)) {
        if (account.enrollmentStatus !== 'Going' || !account.activityOpen) continue;
        if (account.remainingCents <= 0 || !account.dueDate) continue;
        const n = daysBetween(ctx.today, account.dueDate);
        if (!days.includes(n)) continue;
        const key = `rem:${student.id}:${account.activityId}:${n}`;
        if (sent.has(key)) continue;
        sent.add(key);
        newKeys.push({ Key: key, At: ctx.now });
        const notice = paymentReminderNotice({
          firstName: student.firstName,
          activityName: account.activityName,
          days: n,
          remainingCents: account.remainingCents,
          dueDate: account.dueDate,
          allowFunds: account.allowFunds,
          allowOnline: account.allowOnlinePayment && ctx.m.settings().pub.onlinePaymentsEnabled,
          tag: `rem-${student.id}-${account.activityId}`,
        });
        addCounts(report.notifications, notifyFamily(ctx, family, notice));
        report.remindersSent++;
      }
    }
  } finally {
    ctx.db.append('_Sent', newKeys);
  }
}

/** 5. Events happening tomorrow -> matching recipients, once per event. */
function sendEventReminders(ctx: Ctx, report: TickReport): void {
  requireColumns(ctx, 'Events', ['Date', 'Title', 'Schools', 'Ensembles']);
  const tomorrow = addDays(ctx.today, 1);
  const events = ctx.m.events().filter((e) => e.date === tomorrow);
  if (events.length === 0) return;
  const sent = new Set(ctx.m.sentKeys());
  const newKeys: RowData[] = [];
  const recipients = allRecipients(ctx);
  try {
    for (const event of events) {
      const key = `evt:${event.id}`;
      if (sent.has(key)) continue;
      sent.add(key);
      newKeys.push({ Key: key, At: ctx.now });
      addCounts(report.notifications, deliver(ctx, recipients, eventTomorrowNotice(event)));
      report.remindersSent++;
    }
  } finally {
    ctx.db.append('_Sent', newKeys);
  }
}
