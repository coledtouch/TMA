/**
 * Online payments through PayPal (ARCHITECTURE.md §5): the server creates the
 * order with the exact amount (plus the optional fee contribution) and
 * records the capture. The browser never decides amounts.
 */
import { centsToDollars, formatCents, grossUpCents } from '../shared/money';
import type { Cents, Payment } from '../shared/types';
import { requireActivity, requireFamily, requireOwnStudent } from './access';
import type { Ctx } from './context';
import { rateLimit } from './context';
import { toPayment, type PaymentRec } from './data';
import { badRequest, conflict, fail, forbidden, notFound } from './errors';
import { paymentReceivedNotice, paymentReviewNotice, paymentUnconfirmedNotice } from './messages';
import { notifyAdmins, notifyFamily } from './notify';
import type { CaptureResult } from './services';
import { errorMessage, hex8, idKey, isRecord, truncate } from './util';
import * as v from './validate';

/** Apps Script's CacheService maximum (6 hours). */
const ORDER_TTL_SECONDS = 21600;
const ORDER_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

interface PendingOrder {
  email: string;
  familyId: string;
  studentId: string;
  activityId: string;
  amountCents: Cents;
  feeCents: Cents;
  grossCents: Cents;
  captureId?: string;
  /** An earlier capture got no definite answer: PayPal may already hold this payment. */
  unconfirmed?: boolean;
}

function orderKey(orderId: string): string {
  return `order:${orderId}`;
}

function readOrder(raw: string | null): PendingOrder | null {
  if (!raw) return null;
  try {
    const o: unknown = JSON.parse(raw);
    if (!isRecord(o)) return null;
    const strings = ['email', 'familyId', 'studentId', 'activityId'] as const;
    const numbers = ['amountCents', 'feeCents', 'grossCents'] as const;
    if (!strings.every((k) => typeof o[k] === 'string') || !numbers.every((k) => Number.isInteger(o[k]))) return null;
    return o as unknown as PendingOrder;
  } catch {
    return null;
  }
}

function paymentsUnavailable(): never {
  return fail('NOT_CONFIGURED', 'Online payments are not available right now. See "Other ways to pay".');
}

/** payment.createOrder */
export function createOrder(
  ctx: Ctx,
  email: string,
  params: v.Params,
): { orderId: string; amountCents: Cents; feeCents: Cents; grossCents: Cents } {
  const studentId = v.id(params.studentId, 'Student');
  const activityId = v.id(params.activityId, 'Activity');
  const amount = v.cents(params.amountCents, 'Amount', 1);
  const coverFee = v.bool(params.coverFee, 'Cover the fee', false);

  const settings = ctx.m.settings().pub;
  if (!settings.onlinePaymentsEnabled) paymentsUnavailable();
  rateLimit(ctx, `pay-rl:${email}`, 30, 3600, 'Too many payment attempts in a short time. Please try again later.');

  const family = requireFamily(ctx, email, { active: true });
  const student = requireOwnStudent(ctx, family, studentId);
  const activity = requireActivity(ctx, activityId);
  if (activity.status !== 'Open') conflict(`${activity.name} is closed.`);
  if (!activity.allowOnlinePayment) badRequest(`${activity.name} can't be paid online. See "Other ways to pay".`);
  const account = ctx.m.books().account(student.id, activity.id);
  if (!account || account.enrollmentStatus !== 'Going') {
    badRequest(`${student.firstName} isn't signed up as going on ${activity.name}.`);
  }
  // remainingCents already leaves out payments still clearing, so nothing is paid twice.
  const remaining = account.remainingCents;
  if (remaining <= 0) {
    conflict(
      account.pendingPaymentCents
        ? `A payment toward ${activity.name} is still being processed, so nothing is left to pay right now.`
        : `${activity.name} is already paid in full.`,
    );
  }
  // A final balance smaller than the minimum may still be paid in full.
  const minimum = Math.min(settings.minPaymentCents, remaining);
  if (amount < minimum) badRequest(`The smallest online payment is ${formatCents(minimum)}.`);
  if (amount > remaining) badRequest(`That's more than what's left to pay (${formatCents(remaining)}).`);

  const { grossCents, feeCents } = coverFee
    ? grossUpCents(amount, settings.feePercent, settings.feeFixedCents)
    : { grossCents: amount, feeCents: 0 };

  let orderId: string;
  try {
    orderId = ctx.s.payments.createOrder({
      amountCents: amount,
      feeCents,
      grossCents,
      itemName: truncate(`${activity.name} – ${student.firstName} ${student.lastName.charAt(0)}.`.replace(/ \.$/, ''), 127),
      description: truncate(`${settings.orgName}: payment toward ${activity.name}`, 127),
      referenceId: `${student.id}:${activity.id}`,
      customId: `PO-${hex8(ctx.s.crypto.uuid())}`,
      brandName: truncate(settings.orgName, 127),
    }).orderId;
  } catch (err) {
    ctx.s.logger.error('PayPal createOrder failed', errorMessage(err));
    return fail('PAYMENT_FAILED', "We couldn't start the PayPal payment. Please try again in a minute.");
  }
  if (typeof orderId !== 'string' || !ORDER_ID_RE.test(orderId)) {
    ctx.s.logger.error('PayPal returned an unexpected order id', orderId);
    fail('PAYMENT_FAILED', "We couldn't start the PayPal payment. Please try again in a minute.");
  }

  const order: PendingOrder = {
    email,
    familyId: family.id,
    studentId: student.id,
    activityId: activity.id,
    amountCents: amount,
    feeCents,
    grossCents,
  };
  ctx.s.cache.put(orderKey(orderId), JSON.stringify(order), ORDER_TTL_SECONDS);
  return { orderId, amountCents: amount, feeCents, grossCents };
}

function findPayment(ctx: Ctx, references: Array<string | undefined>): PaymentRec | null {
  const keys = new Set(references.filter((r): r is string => !!r).map(idKey));
  if (keys.size === 0) return null;
  return ctx.m.payments().find((p) => p.reference !== '' && keys.has(idKey(p.reference))) ?? null;
}

/** payment.captureOrder (runs under the write lock). Idempotent per order. */
export function captureOrder(ctx: Ctx, email: string, params: v.Params): { payment: Payment } {
  const orderId = v.id(params.orderId, 'Order');
  if (!ORDER_ID_RE.test(orderId)) badRequest('Order is invalid.');
  const order = readOrder(ctx.s.cache.get(orderKey(orderId)));
  if (!order) notFound('This payment session expired. Please start the payment again.');
  if (order.email !== email) forbidden('This payment was started by a different account.');

  const existing = findPayment(ctx, [order.captureId, orderId]);
  if (existing) return { payment: toPayment(existing) };

  const student = ctx.m.studentById(order.studentId);
  const activity = ctx.m.activityById(order.activityId);
  const firstName = student?.firstName ?? order.studentId;
  const activityName = activity?.name ?? order.activityId;

  // Re-check what's left (we hold the write lock): the other guardian, a second tab or an eCheck
  // still clearing may have paid since this order was created. Not capturing means no charge.
  // (Not after an unconfirmed capture: that payment may be what was recorded meanwhile, and asking
  // PayPal again with the same PayPal-Request-Id can't charge twice.)
  if (!order.captureId && !order.unconfirmed) {
    const left = ctx.m.books().account(order.studentId, order.activityId)?.remainingCents ?? 0;
    if (order.amountCents > left) {
      ctx.log('payment', `${orderId}: not captured; ${formatCents(order.amountCents)} is more than the ${formatCents(left)} left for ${order.studentId} / ${order.activityId}`);
      fail(
        'PAYMENT_FAILED',
        left > 0
          ? `Part of this was paid in the meantime and only ${formatCents(left)} is left, so this payment was stopped and you were not charged. Please start again with the new amount.`
          : `${activityName} was paid in the meantime, so this payment was stopped and you were not charged.`,
      );
    }
  }

  let result: CaptureResult;
  try {
    result = ctx.s.payments.captureOrder(orderId, `cap-${orderId}`);
  } catch (err) {
    // We can't tell whether PayPal took the money.
    ctx.s.logger.error('PayPal captureOrder failed', errorMessage(err));
    result = { status: 'UNKNOWN', message: errorMessage(err) };
  }
  if (result.status === 'UNKNOWN') {
    // Never "you were not charged" here. Keep the cached order: capturing it again with the same
    // PayPal-Request-Id records the payment if it went through. Admins check PayPal meanwhile.
    ctx.s.cache.put(orderKey(orderId), JSON.stringify({ ...order, unconfirmed: true }), ORDER_TTL_SECONDS);
    const detail = `${orderId}: PayPal did not confirm the capture of ${formatCents(order.grossCents)} (${result.message ?? 'no answer'}); check PayPal (${email}, ${order.studentId}, ${order.activityId})`;
    ctx.log('payment-error', detail);
    ctx.s.logger.error('Capture outcome unknown', detail);
    // Once per order: the app asks again by itself after an unclear answer.
    if (!order.unconfirmed) notifyAdmins(ctx, paymentUnconfirmedNotice(firstName, activityName, order.grossCents, orderId));
    fail(
      'INTERNAL',
      "We couldn't confirm the payment with PayPal. If PayPal emailed you a receipt, it went through and TMA will record it. Please don't pay again until it shows in the app.",
    );
  }

  const captureId = typeof result.captureId === 'string' && result.captureId.trim() !== '' ? result.captureId.trim() : undefined;
  if (captureId) {
    // Remember the capture so a retry finds the recorded row even after a partial failure.
    ctx.s.cache.put(orderKey(orderId), JSON.stringify({ ...order, captureId }), ORDER_TTL_SECONDS);
    const already = findPayment(ctx, [captureId]);
    if (already) return { payment: toPayment(already) };
  }

  if (result.status === 'COMPLETED') {
    if (result.grossCents !== order.grossCents) {
      const detail = `${orderId}/${captureId ?? '?'}: PayPal captured ${result.grossCents === undefined ? 'an unknown amount' : formatCents(result.grossCents)}, expected ${formatCents(order.grossCents)} (${email}, ${order.studentId}, ${order.activityId})`;
      ctx.log('payment-error', detail);
      ctx.s.logger.error('Capture amount mismatch', detail);
      notifyAdmins(ctx, paymentReviewNotice(firstName, activityName, captureId ?? orderId));
      fail('PAYMENT_FAILED', 'PayPal reported a different amount than expected. TMA will check it and contact you.');
    }
  } else if (result.status !== 'PENDING') {
    ctx.log('payment', `${orderId}: capture ${result.status}${result.message ? ` (${result.message})` : ''}`);
    fail('PAYMENT_FAILED', "The payment didn't go through, and you were not charged. Please try another payment method.");
  }

  const status = result.status === 'COMPLETED' ? 'Completed' : 'Pending';
  const reference = captureId ?? orderId;
  ctx.db.append('Payments', [
    {
      Date: ctx.today,
      StudentID: order.studentId,
      ActivityID: order.activityId,
      Amount: centsToDollars(order.amountCents),
      'Fee Covered': centsToDollars(order.feeCents),
      Gross: centsToDollars(order.grossCents),
      Method: 'PayPal',
      Reference: reference,
      'Payer Email': email,
      Status: status,
    },
  ]);
  ctx.log('payment', `${reference}: ${formatCents(order.grossCents)} via PayPal from ${email} for ${order.studentId} / ${order.activityId} (${status})`);

  const recorded = findPayment(ctx, [reference]);
  if (!recorded) throw new Error(`Payment ${reference} was not saved`);
  if (status === 'Completed') {
    const remaining = ctx.m.books().account(order.studentId, order.activityId)?.remainingCents ?? 0;
    notifyFamily(
      ctx,
      ctx.m.familyById(order.familyId),
      paymentReceivedNotice(firstName, order.amountCents, activityName, remaining, reference),
    );
  }
  return { payment: toPayment(recorded) };
}
