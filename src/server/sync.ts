/**
 * Scheduled work (ARCHITECTURE.md §7). Both ticks assume the caller holds the
 * write lock (see app.ts). Each step catches its own errors into report.errors.
 */
import { centsToDollars } from '../shared/money';
import type { TickReport } from '../shared/types';
import { newAnnouncementId } from './admin';
import type { Ctx } from './context';
import { announcementNotice, creditNotice, debitNotice, eventTomorrowNotice, paymentReminderNotice } from './messages';
import { addCounts, allRecipients, deliver, notifyFamily, zeroCounts } from './notify';
import { notifyDecision, postRedemptionLedger } from './redemptions';
import type { RowData } from './services';
import { addDays, daysBetween, errorMessage, idKey } from './util';

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

/** 1. Redemptions the treasurer set to Approved/Denied in the sheet. */
function postSheetDecisions(ctx: Ctx, report: TickReport): void {
  const posted = new Set(ctx.m.ledger().filter((l) => l.reference).map((l) => idKey(l.reference)));
  for (const rec of ctx.m.redemptions()) {
    if ((rec.status !== 'Approved' && rec.status !== 'Denied') || rec.notifiedAt) continue;
    try {
      if (rec.status === 'Approved' && !posted.has(idKey(rec.id))) {
        if (rec.amountCents <= 0 || !rec.studentId) throw new Error(`${rec.id} has no student or amount`);
        postRedemptionLedger(ctx, rec, rec.decidedBy || 'TMA sheet');
        posted.add(idKey(rec.id));
        report.redemptionsPosted++;
      }
      const patch: RowData = { Notified: ctx.now };
      if (!rec.decidedAt) patch.Decided = ctx.now;
      // Mark first: a family should never get the same decision twice.
      ctx.db.update('Redemptions', rec.row, patch);
      ctx.log('redemption', `${rec.id}: ${rec.status.toLowerCase()} in the sheet${rec.status === 'Approved' ? ', ledger posted' : ''}`);
      addCounts(report.notifications, notifyDecision(ctx, rec));
    } catch (err) {
      recordError(ctx, report, `redemption ${rec.id}`, err);
    }
  }
}

/** 2. Balance changes since the last snapshot -> notify verified households. */
function detectBalanceChanges(ctx: Ctx, report: TickReport): void {
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

  let changed = false;
  current.forEach((cur, key) => {
    const before = snapshot.get(key);
    const delta = cur.cents - (before ? before.balanceCents : 0);
    if (!before && cur.cents === 0) return;
    if (delta === 0) {
      if (!before) changed = true;
      return;
    }
    changed = true;
    report.balanceChanges++;
    const student = ctx.m.studentById(cur.studentId);
    if (!student || !ctx.m.isVerified(student)) return;
    try {
      const notice =
        delta > 0
          ? creditNotice(student.firstName, delta, cur.cents, student.id)
          : debitNotice(student.firstName, delta, cur.cents, student.id);
      addCounts(report.notifications, notifyFamily(ctx, ctx.m.familyById(student.familyId), notice));
    } catch (err) {
      recordError(ctx, report, `balance ${student.id}`, err);
    }
  });
  snapshot.forEach((_, key) => {
    if (!current.has(key)) changed = true;
  });
  if (changed) ctx.db.overwrite('_Snapshot', rows());
}

/** 3. Announcements typed into the sheet with a blank Sent (and Date blank or due). */
function sendQueuedAnnouncements(ctx: Ctx, report: TickReport): void {
  const queued = ctx.m.announcements().filter((a) => !a.sent && (!a.date || a.date <= ctx.today));
  if (queued.length === 0) return;
  const recipients = allRecipients(ctx);
  for (const a of queued) {
    try {
      const id = a.storedId || newAnnouncementId(ctx);
      const patch: RowData = { Sent: ctx.now };
      if (!a.storedId) patch.ID = id;
      if (!a.date) patch.Date = ctx.today;
      // Mark first: at most once, even if delivery fails halfway.
      ctx.db.update('Announcements', a.row, patch);
      const counts = deliver(ctx, recipients, announcementNotice({ ...a, id }));
      addCounts(report.notifications, counts);
      report.announcementsSent++;
    } catch (err) {
      recordError(ctx, report, `announcement ${a.id}`, err);
    }
  }
}

/** 4. Payment reminders N days before the final due date (REMINDER_DAYS), once per key. */
function sendPaymentReminders(ctx: Ctx, report: TickReport): void {
  const days = ctx.m.settings().reminderDays;
  if (days.length === 0) return;
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
