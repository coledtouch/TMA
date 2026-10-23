/**
 * Applying activity funds to a trip: families request, the treasurer decides
 * (in the app or by typing Approved/Denied in the sheet; see sync.ts).
 */
import { centsToDollars, formatCents } from '../shared/money';
import type { RedemptionRequest } from '../shared/types';
import { guardianName, requireActivity, requireFamily, requireOwnStudent } from './access';
import type { Ctx } from './context';
import { rateLimit } from './context';
import { toRedemption, type RedemptionRec } from './data';
import { badRequest, conflict, notFound } from './errors';
import { fundsRequestNotice, redemptionApprovedNotice, redemptionDeniedNotice } from './messages';
import { notifyAdmins, notifyFamily } from './notify';
import type { RowData } from './services';
import { hex8, idKey } from './util';
import * as v from './validate';

const MIN_REDEMPTION_CENTS = 100;
const MAX_PENDING_PER_FAMILY = 20;

export function newRequestId(ctx: Ctx): string {
  const taken = new Set(ctx.m.redemptions().map((r) => idKey(r.id)));
  for (let i = 0; i < 5; i++) {
    const id = `R-${hex8(ctx.s.crypto.uuid())}`;
    if (!taken.has(idKey(id))) return id;
  }
  throw new Error('Could not generate a unique request ID');
}

/** redemption.request */
export function requestRedemption(ctx: Ctx, email: string, params: v.Params): { redemption: RedemptionRequest } {
  const studentId = v.id(params.studentId, 'Student');
  const activityId = v.id(params.activityId, 'Activity');
  const amount = v.cents(params.amountCents, 'Amount', MIN_REDEMPTION_CENTS);
  const note = v.optText(params.note, 'Note', v.LIMITS.note, true);
  rateLimit(ctx, `red-rl:${email}`, 20, 3600, 'Too many requests in a short time. Please try again later.');

  const family = requireFamily(ctx, email, { active: true });
  const student = requireOwnStudent(ctx, family, studentId);
  const activity = requireActivity(ctx, activityId);
  if (activity.status !== 'Open') conflict(`${activity.name} is closed.`);
  if (!activity.allowFunds) badRequest(`Activity funds can't be used for ${activity.name}.`);

  const books = ctx.m.books();
  const account = books.account(student.id, activity.id);
  if (!account || account.enrollmentStatus !== 'Going') {
    badRequest(`${student.firstName} isn't signed up as going on ${activity.name}.`);
  }
  const available = books.available(student.id);
  if (amount > available) {
    badRequest(`That's more than ${student.firstName}'s available activity funds (${formatCents(available)}).`);
  }
  const room = Math.max(0, account.remainingCents - books.pendingFor(student.id, activity.id));
  if (amount > room) {
    badRequest(
      room === 0
        ? `Nothing is left to cover on ${activity.name} after pending requests.`
        : `That's more than what's left to pay on ${activity.name} (${formatCents(room)} after pending requests).`,
    );
  }
  const pendingCount = ctx.m.redemptions().filter((r) => r.status === 'Pending' && idKey(r.familyId) === idKey(family.id)).length;
  if (pendingCount >= MAX_PENDING_PER_FAMILY) conflict('You have many pending requests. Please wait for TMA to review them.');

  const id = newRequestId(ctx);
  ctx.db.append('Redemptions', [
    {
      RequestID: id,
      Requested: ctx.now,
      Email: email,
      FamilyID: family.id,
      StudentID: student.id,
      ActivityID: activity.id,
      Amount: centsToDollars(amount),
      Note: note,
      Status: 'Pending',
    },
  ]);
  ctx.log('redemption', `${id}: ${email} requested ${formatCents(amount)} from ${student.id} for ${activity.id}`);
  notifyAdmins(ctx, fundsRequestNotice(guardianName(family, email), amount, student.firstName, activity.name, id));

  const created = ctx.m.redemptionById(id);
  if (!created) throw new Error(`Redemption ${id} was not saved`);
  return { redemption: toRedemption(created) };
}

/** redemption.cancel: only the caller's household's own Pending request. */
export function cancelRedemption(ctx: Ctx, email: string, params: v.Params): { redemption: RedemptionRequest } {
  const id = v.id(params.id, 'Request');
  const family = requireFamily(ctx, email);
  const rec = ctx.m.redemptionById(id);
  if (!rec || idKey(rec.familyId) !== idKey(family.id)) return notFound('Request not found.');
  if (rec.status !== 'Pending') conflict(`This request was already ${rec.status.toLowerCase()}.`);
  ctx.db.update('Redemptions', rec.row, {
    Status: 'Cancelled',
    Decided: ctx.now,
    'Decided By': email,
    Notified: ctx.now,
  });
  ctx.log('redemption', `${rec.id}: cancelled by ${email}`);
  return { redemption: toRedemption(ctx.m.redemptionById(rec.id) ?? rec) };
}

/** A Ledger row already carries this request's ID as its Reference (posted by the app or typed by the treasurer). */
export function ledgerHasReference(ctx: Ctx, requestId: string): boolean {
  const key = idKey(requestId);
  return ctx.m.ledger().some((l) => l.reference !== undefined && idKey(l.reference) === key);
}

/**
 * Post the Ledger row for an approved request and move the student's
 * _Snapshot by the same amount so the sync doesn't also send a "funds changed" alert.
 * Does nothing (returns false) when a Ledger row with Reference == the request ID
 * already exists: SHEET.md lets the treasurer type that row by hand.
 */
export function postRedemptionLedger(ctx: Ctx, rec: RedemptionRec, enteredBy: string): boolean {
  if (ledgerHasReference(ctx, rec.id)) return false;
  const activity = ctx.m.activityById(rec.activityId);
  ctx.db.append('Ledger', [
    {
      Date: ctx.today,
      StudentID: rec.studentId,
      Type: 'Redemption',
      Description: `Applied to ${activity?.name ?? rec.activityId}`,
      Amount: -centsToDollars(rec.amountCents),
      ActivityID: activity?.id ?? rec.activityId,
      Reference: rec.id,
      'Entered By': enteredBy,
    },
  ]);
  adjustSnapshot(ctx, rec.studentId, -rec.amountCents);
  return true;
}

/** Shift one student's snapshot balance (no-op before the first sync wrote a snapshot). */
export function adjustSnapshot(ctx: Ctx, studentId: string, deltaCents: number): void {
  const snapshot = ctx.m.snapshot();
  if (snapshot.size === 0) return;
  const current = snapshot.get(idKey(studentId));
  if (current) {
    ctx.db.update('_Snapshot', current.row, {
      Balance: centsToDollars(current.balanceCents + deltaCents),
      Updated: ctx.now,
    });
  } else {
    ctx.db.append('_Snapshot', [{ StudentID: studentId, Balance: centsToDollars(deltaCents), Updated: ctx.now }]);
  }
}

/** Notify the requesting household about a decision (approved or denied). */
export function notifyDecision(ctx: Ctx, rec: RedemptionRec): ReturnType<typeof notifyFamily> {
  const family = ctx.m.familyById(rec.familyId);
  const student = ctx.m.studentById(rec.studentId);
  const activity = ctx.m.activityById(rec.activityId);
  if (!family || family.status !== 'Active' || !student) return { push: 0, email: 0, sms: 0 };
  const activityName = activity?.name ?? rec.activityId;
  if (rec.status === 'Approved') {
    const remaining = ctx.m.books().account(student.id, rec.activityId)?.remainingCents ?? 0;
    return notifyFamily(ctx, family, redemptionApprovedNotice(student.firstName, rec.amountCents, activityName, remaining, rec.id));
  }
  return notifyFamily(ctx, family, redemptionDeniedNotice(rec.amountCents, activityName, rec.adminNote, rec.id));
}

/** admin.decideRedemption */
export function decideRedemption(ctx: Ctx, adminEmail: string, params: v.Params): { redemption: RedemptionRequest } {
  const id = v.id(params.id, 'Request');
  const decision = v.oneOf(params.decision, 'Decision', ['Approved', 'Denied'] as const);
  const adminNote = v.optText(params.adminNote, 'Note', v.LIMITS.note, true);

  const rec = ctx.m.redemptionById(id);
  if (!rec) return notFound('Request not found.');
  if (rec.status !== 'Pending') conflict(`This request was already ${rec.status.toLowerCase()}.`);

  // The treasurer may already have typed this request's Ledger row (Reference = request ID):
  // the funds have moved, so don't re-check them or post a second row.
  if (decision === 'Approved' && ledgerHasReference(ctx, rec.id)) {
    ctx.log('redemption', `${rec.id}: Ledger row already in the sheet; not posting another`);
  } else if (decision === 'Approved') {
    const books = ctx.m.books();
    const student = ctx.m.studentById(rec.studentId);
    const name = student?.firstName ?? rec.studentId;
    // Available funds excluding this request itself.
    const available = Math.max(0, books.balance(rec.studentId) - (books.pending(rec.studentId) - rec.amountCents));
    if (rec.amountCents > available) {
      conflict(`${name} only has ${formatCents(available)} available, less than the ${formatCents(rec.amountCents)} requested. Deny it or ask the family to request less.`);
    }
    const remaining = books.account(rec.studentId, rec.activityId)?.remainingCents ?? 0;
    if (rec.amountCents > remaining) {
      conflict(`Only ${formatCents(remaining)} is left to pay on this activity, less than the ${formatCents(rec.amountCents)} requested.`);
    }
    postRedemptionLedger(ctx, rec, adminEmail);
  }

  const patch: RowData = {
    Status: decision,
    Decided: ctx.now,
    'Decided By': adminEmail,
    'Admin Note': adminNote,
    Notified: ctx.now,
  };
  ctx.db.update('Redemptions', rec.row, patch);
  ctx.log('redemption', `${rec.id}: ${decision.toLowerCase()} by ${adminEmail}`);

  const updated = ctx.m.redemptionById(rec.id) ?? rec;
  notifyDecision(ctx, updated);
  return { redemption: toRedemption(updated) };
}
