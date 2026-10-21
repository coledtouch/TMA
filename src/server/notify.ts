/**
 * Notification delivery (ARCHITECTURE.md §6): per-recipient prefs decide
 * topics, audience and channels; push goes to every device of the email
 * (invalid tokens are removed), email respects EMAIL_ENABLED and the daily
 * quota (minus a reserve for sign-in codes), SMS needs SMS_ENABLED + a configured sender + a phone. Each batch is
 * logged. Delivery problems are logged, never thrown.
 */
import { TABLES } from '../shared/schema';
import type { DeliveryCounts, NotificationChannel, NotificationTopic, PushMessage } from '../shared/types';
import type { Ctx } from './context';
import type { FamilyRec } from './data';
import { renderEmail } from './email';
import type { Notice } from './messages';
import { audienceMatches, prefsFor, TOPICS } from './prefs';
import type { MailMessage, MailResult, PushResult } from './services';
import { errorMessage, isEmail, normEmail, truncate, unique } from './util';

export interface DeliverOptions {
  /** Channels the sender allows (admin announcement checkboxes). Default: all. */
  channels?: Partial<Record<NotificationChannel, boolean>>;
  /** Ignore the recipient's prefs entirely (push tests). */
  ignorePrefs?: boolean;
}

export function zeroCounts(): DeliveryCounts {
  return { push: 0, email: 0, sms: 0 };
}

export function addCounts(target: DeliveryCounts, more: DeliveryCounts): DeliveryCounts {
  target.push += more.push;
  target.email += more.email;
  target.sms += more.sms;
  return target;
}

function isTopic(topic: string): topic is NotificationTopic {
  return (TOPICS as readonly string[]).includes(topic);
}

/** Collapse whitespace (sheet text may contain newlines) and cap the length. */
function oneLine(text: string, max: number): string {
  return truncate(text.replace(/\s+/g, ' ').trim(), max);
}

function safely<T>(ctx: Ctx, what: string, fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch (err) {
    ctx.s.logger.error(`${what} failed`, errorMessage(err));
    return fallback;
  }
}

const DEVICE_COLUMNS = TABLES.Devices.headers;

/**
 * Daily email recipients kept back for sign-in codes. Codes and notification
 * emails share one MailApp quota (about 100 a day on a free Gmail account), so
 * without this one email announcement to every family would lock everyone out
 * of signing in until the next day.
 */
export const SIGN_IN_EMAIL_RESERVE = 20;

/** Deliver one notice to a list of recipient emails. */
export function deliver(ctx: Ctx, recipients: readonly string[], notice: Notice, opts: DeliverOptions = {}): DeliveryCounts {
  const counts = zeroCounts();
  const emails = unique(recipients.map(normEmail).filter(isEmail));
  if (emails.length === 0) return counts;

  const settings = ctx.m.settings();
  const allowed = { push: true, email: true, sms: true, ...opts.channels };
  const pushOn = allowed.push && safely(ctx, 'push.enabled', () => ctx.s.push.enabled(), false);
  const emailOn = allowed.email && settings.emailEnabled;
  const smsOn = allowed.sms && settings.smsSetting && safely(ctx, 'sms.enabled', () => ctx.s.sms.enabled(), false);

  const tokens: string[] = [];
  const mailTo: string[] = [];
  const smsTo: string[] = [];
  for (const email of emails) {
    const prefs = prefsFor(ctx, email);
    if (!opts.ignorePrefs) {
      if (isTopic(notice.topic) && !prefs.topics[notice.topic]) continue;
      if (notice.audience && !audienceMatches(notice.audience, prefs)) continue;
    }
    if (pushOn && (opts.ignorePrefs || prefs.channels.push)) {
      for (const d of ctx.m.devicesFor(email)) tokens.push(d.token);
    }
    if (emailOn && (opts.ignorePrefs || prefs.channels.email)) mailTo.push(email);
    if (smsOn && prefs.smsPhone && (opts.ignorePrefs || prefs.channels.sms)) smsTo.push(prefs.smsPhone);
  }

  if (tokens.length > 0) counts.push = sendPush(ctx, unique(tokens), notice);

  let quotaSkipped = 0;
  if (mailTo.length > 0) {
    // One quota read per batch (each read is a service call in Apps Script).
    let quota = safely(ctx, 'mailer.remainingQuota', () => ctx.s.mailer.remainingQuota(), 0) - SIGN_IN_EMAIL_RESERVE;
    const { html, text } = renderEmail({
      orgName: settings.pub.orgName,
      title: notice.title,
      body: notice.body,
      appUrl: settings.pub.appUrl,
      path: notice.url,
      link: notice.link,
    });
    const subject = oneLine(notice.title, 150);
    // Up to `quota` recipients at a time; a failed email doesn't use up quota, so the next round may take more.
    let next = 0;
    while (next < mailTo.length && quota > 0) {
      const batch = mailTo.slice(next, next + quota);
      next += batch.length;
      const sent = sendEmails(ctx, batch, { subject, html, text });
      counts.email += sent;
      quota -= sent;
    }
    quotaSkipped = mailTo.length - next;
  }

  if (smsTo.length > 0) {
    const message = oneLine(`TMA: ${notice.title} – ${notice.pushBody ?? notice.body}`, 320);
    for (const phone of unique(smsTo)) {
      const sent = safely(
        ctx,
        'sms.send',
        () => {
          ctx.s.sms.send(phone, message);
          return true;
        },
        false,
      );
      if (sent) counts.sms++;
    }
  }

  const skipped =
    quotaSkipped > 0
      ? ` (${quotaSkipped} email skipped: daily quota used up; the last ${SIGN_IN_EMAIL_RESERVE} are kept for sign-in codes)`
      : '';
  ctx.log('notify', `${notice.topic}: ${notice.title} → push ${counts.push}, email ${counts.email}, sms ${counts.sms}${skipped}`);
  return counts;
}

/**
 * Email one notice to each address: in one batch when the mailer can
 * (Apps Script: several per request to the push Worker, requests in
 * parallel), else one by one. Failures are logged per recipient. Returns how
 * many were sent.
 */
function sendEmails(ctx: Ctx, recipients: string[], content: Omit<MailMessage, 'to'>): number {
  const mailer = ctx.s.mailer;
  if (!mailer.sendMany) {
    let sent = 0;
    for (const to of recipients) {
      const ok = safely(
        ctx,
        `email to ${to}`,
        () => {
          mailer.send({ to, ...content });
          return true;
        },
        false,
      );
      if (ok) sent++;
    }
    return sent;
  }
  const messages = recipients.map((to) => ({ to, ...content }));
  const results = safely<MailResult[] | null>(ctx, 'mailer.sendMany', () => mailer.sendMany!(messages), null);
  if (!results) return 0;
  let sent = 0;
  recipients.forEach((to, i) => {
    const result = results[i];
    if (result?.ok) sent++;
    else ctx.s.logger.error(`email to ${to} failed`, result ? result.error : 'no result');
  });
  return sent;
}

/** Send one push batch; remove tokens the push service reports as invalid. Returns delivered count. */
function sendPush(ctx: Ctx, tokens: string[], notice: Notice): number {
  const message: PushMessage = {
    title: oneLine(notice.title, 120),
    body: oneLine(notice.pushBody ?? notice.body, 240),
    url: notice.url,
    topic: notice.topic,
  };
  if (notice.tag) message.tag = notice.tag;
  const results = safely<PushResult[]>(ctx, 'push.send', () => ctx.s.push.send(tokens, message), []);
  let ok = 0;
  const invalid = new Set<string>();
  results.forEach((result, i) => {
    if (result === 'ok') ok++;
    else if (result === 'invalid' && i < tokens.length) invalid.add(tokens[i]);
  });
  if (invalid.size > 0) {
    for (const device of ctx.m.devices()) {
      if (!invalid.has(device.token)) continue;
      safely(ctx, 'remove invalid device', () => ctx.db.clear('Devices', device.row, DEVICE_COLUMNS), undefined);
    }
    ctx.log('push', `Removed ${invalid.size} expired device token(s)`);
  }
  return ok;
}

// ---------------------------------------------------------------------------
// Recipient lists
// ---------------------------------------------------------------------------

export function familyRecipients(family: FamilyRec | null): string[] {
  return family ? unique(family.guardians.map((g) => g.email).filter(isEmail)) : [];
}

export function adminRecipients(ctx: Ctx): string[] {
  return ctx.m.settings().adminEmails.slice();
}

/** Guardians of non-Inactive families plus anyone with prefs or a device (signed in, no household yet). */
export function allRecipients(ctx: Ctx): string[] {
  const out: string[] = [];
  for (const f of ctx.m.families()) if (f.status !== 'Inactive') out.push(...familyRecipients(f));
  ctx.m.preferences().forEach((_, email) => out.push(email));
  for (const d of ctx.m.devices()) if (d.email) out.push(d.email);
  return unique(out.filter(isEmail));
}

export function notifyFamily(ctx: Ctx, family: FamilyRec | null, notice: Notice): DeliveryCounts {
  if (!family || family.status === 'Inactive') return zeroCounts();
  return deliver(ctx, familyRecipients(family), notice);
}

export function notifyAdmins(ctx: Ctx, notice: Notice): DeliveryCounts {
  const admins = adminRecipients(ctx);
  if (admins.length === 0) {
    ctx.log('notify', `admin: ${notice.title} → no ADMIN_EMAILS set`);
    return zeroCounts();
  }
  return deliver(ctx, admins, notice);
}
