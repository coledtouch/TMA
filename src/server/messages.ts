/**
 * Notification copy (ARCHITECTURE.md §6 table). Students are named by first
 * name only, because these show up on lock screens.
 */
import { formatCents } from '../shared/money';
import type { Audience, Cents, PushMessage } from '../shared/types';
import { plural, shortDate, truncate } from './util';

export interface Notice {
  topic: PushMessage['topic'];
  title: string;
  body: string;
  /** In-app route, e.g. "#/funds". */
  url: string;
  tag?: string;
  /** Announcements/events only: who it is for. */
  audience?: Audience;
  /** Shorter push text (announcements: first 180 chars). */
  pushBody?: string;
  /** External link shown in emails. */
  link?: string;
}

const MINUS = '−';

export function creditNotice(firstName: string, deltaCents: Cents, balanceCents: Cents, studentId: string): Notice {
  return {
    topic: 'balance',
    title: `+${formatCents(deltaCents)} for ${firstName}`,
    body: `${formatCents(deltaCents)} was added to ${firstName}'s TMA activity funds. New balance: ${formatCents(balanceCents)}.`,
    url: '#/funds',
    tag: `bal-${studentId}`,
  };
}

export function debitNotice(firstName: string, deltaCents: Cents, balanceCents: Cents, studentId: string): Notice {
  return {
    topic: 'balance',
    title: `${firstName}'s activity funds changed`,
    body: `${MINUS}${formatCents(Math.abs(deltaCents))} adjustment. New balance: ${formatCents(balanceCents)}.`,
    url: '#/funds',
    tag: `bal-${studentId}`,
  };
}

export function redemptionApprovedNotice(
  firstName: string,
  amountCents: Cents,
  activityName: string,
  remainingCents: Cents,
  requestId: string,
): Notice {
  return {
    topic: 'payments',
    title: `Funds applied to ${activityName}`,
    body: `${formatCents(amountCents)} of ${firstName}'s activity funds was applied to ${activityName}. Remaining: ${formatCents(remainingCents)}.`,
    url: '#/trips',
    tag: `red-${requestId}`,
  };
}

export function redemptionDeniedNotice(amountCents: Cents, activityName: string, adminNote: string | undefined, requestId: string): Notice {
  const note = adminNote ? ` Note: ${adminNote}` : '';
  return {
    topic: 'payments',
    title: 'Funds request not approved',
    body: `Your request to apply ${formatCents(amountCents)} to ${activityName} was not approved.${note}`,
    url: '#/trips',
    tag: `red-${requestId}`,
  };
}

export function paymentReceivedNotice(
  firstName: string,
  amountCents: Cents,
  activityName: string,
  remainingCents: Cents,
  paymentId: string,
): Notice {
  return {
    topic: 'payments',
    title: 'Payment received – thank you!',
    body: `${formatCents(amountCents)} toward ${activityName} for ${firstName}. Remaining: ${formatCents(remainingCents)}.`,
    url: '#/trips',
    tag: `pay-${paymentId}`,
  };
}

export function paymentReminderNotice(opts: {
  firstName: string;
  activityName: string;
  days: number;
  remainingCents: Cents;
  dueDate: string;
  allowFunds: boolean;
  allowOnline: boolean;
  tag: string;
}): Notice {
  const when = opts.days === 0 ? 'today' : `in ${plural(opts.days, 'day')}`;
  const how =
    opts.allowFunds && opts.allowOnline
      ? 'Use activity funds or pay online in the app.'
      : opts.allowFunds
        ? 'You can use activity funds in the app.'
        : opts.allowOnline
          ? 'You can pay online in the app.'
          : 'See the app for ways to pay.';
  return {
    topic: 'reminders',
    title: `${opts.activityName} payment due ${when}`,
    body: `${opts.firstName} has ${formatCents(opts.remainingCents)} left to pay by ${shortDate(opts.dueDate)}. ${how}`,
    url: '#/trips',
    tag: opts.tag,
  };
}

export function eventTomorrowNotice(event: {
  id: string;
  title: string;
  time?: string;
  location?: string;
  details?: string;
  audience: Audience;
}): Notice {
  let body: string;
  if (event.time && event.location) body = `${event.time} at ${event.location}.`;
  else if (event.time) body = `${event.time}.`;
  else if (event.location) body = `At ${event.location}.`;
  else body = truncate(event.details ?? '', 180);
  return {
    topic: 'announcements',
    title: `Tomorrow: ${event.title}`,
    body,
    url: '#/news',
    tag: `evt-${event.id}`,
    audience: event.audience,
  };
}

export function announcementNotice(a: { id: string; title: string; body: string; audience: Audience; link?: string }): Notice {
  const notice: Notice = {
    topic: 'announcements',
    title: a.title,
    body: a.body,
    pushBody: truncate(a.body.replace(/\s+/g, ' '), 180),
    url: '#/news',
    tag: `ann-${a.id}`,
    audience: a.audience,
  };
  if (a.link) notice.link = a.link;
  return notice;
}

export function householdVerifiedNotice(familyId: string): Notice {
  return {
    topic: 'admin',
    title: "You're all set!",
    body: 'TMA verified your household. You can now see activity funds and trips.',
    url: '#/',
    tag: `hh-${familyId}`,
  };
}

export function newSignupNotice(guardianNames: string, studentCount: number, familyId: string): Notice {
  return {
    topic: 'admin',
    title: 'New family signed up',
    body: `${guardianNames} (${plural(studentCount, 'student')}). Review in the app.`,
    url: '#/admin',
    tag: `signup-${familyId}`,
  };
}

export function newStudentsNotice(guardianNames: string, studentNames: string[], familyId: string): Notice {
  return {
    topic: 'admin',
    title: studentNames.length === 1 ? 'New student to review' : 'New students to review',
    body: `${guardianNames} added ${studentNames.join(', ')}. Review in the app.`,
    url: '#/admin',
    tag: `signup-${familyId}`,
  };
}

export function fundsRequestNotice(
  parentName: string,
  amountCents: Cents,
  firstName: string,
  activityName: string,
  requestId: string,
): Notice {
  return {
    topic: 'admin',
    title: `Funds request: ${formatCents(amountCents)}`,
    body: `${parentName} asked to apply ${formatCents(amountCents)} from ${firstName}'s funds to ${activityName}.`,
    url: '#/admin',
    tag: `req-${requestId}`,
  };
}

export function paymentReviewNotice(firstName: string, activityName: string, reference: string): Notice {
  return {
    topic: 'admin',
    title: 'Payment needs review',
    body: `A PayPal payment for ${firstName} (${activityName}) did not match the expected amount, so the app did not record it. Check PayPal capture ${reference} and add it to the Payments tab.`,
    url: '#/admin',
    tag: `payreview-${reference}`,
  };
}

export function paymentUnconfirmedNotice(firstName: string, activityName: string, grossCents: Cents, orderId: string): Notice {
  return {
    topic: 'admin',
    title: 'Payment needs review',
    body: `PayPal did not confirm whether a ${formatCents(grossCents)} payment for ${firstName} (${activityName}) went through, so the app has not recorded it yet. The app asks PayPal again, and if it then records the payment you'll get a "Payment recorded" message. Otherwise look up PayPal order ${orderId}: if it was captured and the Payments tab has no row with its transaction ID, add one so the family isn't asked to pay again.`,
    url: '#/admin',
    tag: `payreview-${orderId}`,
  };
}

/** The follow-up to paymentUnconfirmedNotice (same tag) once the app recorded that order after all. */
export function paymentRecordedAfterReviewNotice(
  firstName: string,
  activityName: string,
  grossCents: Cents,
  orderId: string,
  reference: string,
  pending: boolean,
): Notice {
  return {
    topic: 'admin',
    title: 'Payment recorded',
    body: `The ${formatCents(grossCents)} PayPal payment for ${firstName} (${activityName}) that needed review (order ${orderId}) went through after all: the app recorded it in the Payments tab as ${reference}${pending ? ' (Pending while PayPal finishes processing it)' : ''}. Don't add it by hand.`,
    url: '#/admin',
    tag: `payreview-${orderId}`,
  };
}

export function testNotice(): Notice {
  return {
    topic: 'test',
    title: 'Test notification ✅',
    body: 'Notifications are working on this device.',
    url: '#/',
    tag: 'test',
  };
}
