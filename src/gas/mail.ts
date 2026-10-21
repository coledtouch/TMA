/**
 * The app's Mailer in Apps Script: sign-in codes, notifications,
 * announcements and admin alerts all go through here.
 *
 * With Settings EMAIL_VIA = cloudflare (the default), every email goes out as
 * "Timberlane Music Association <noreply@mytma.org>" through the TMA push
 * Worker (POST /email, Cloudflare Email Sending), with Reply-To set to
 * Settings SUPPORT_EMAIL. When the Worker can't send a message, for any
 * reason, that message goes out with MailApp (Gmail, from the Google account
 * that runs the script) instead, so sign-in codes always arrive.
 * EMAIL_VIA = gmail always uses MailApp.
 *
 * So that a broken setup doesn't add a failing request to every email:
 *  - "the domain isn't verified" (and the other set-up problems in
 *    PAUSE_REASONS) pauses the Worker route for 10 minutes (CacheService);
 *  - "rate limited", or 3 failures in a row, switch this execution to Gmail.
 *
 * Logs carry the Worker's reason codes and HTTP codes only: never addresses,
 * subjects or bodies.
 */
import { SIGN_IN_EMAIL_RESERVE } from '../server/notify';
import type { Cache, Logger, MailMessage, Mailer } from '../server/services';
import { SETTING_DEFAULTS } from '../shared/schema';
import type { PushRelaySender } from './push-relay';
import { clip, isRecord, parseJson, pick } from './util';

/** The Worker's sender (workers/push/wrangler.toml EMAIL_FROM), for the status dialog. The Worker decides; Apps Script never sends it. */
export const WORKER_EMAIL_FROM = 'noreply@mytma.org';
/** What remainingQuota() reports while the Worker sends (Cloudflare has no per-script daily quota like Gmail's). */
export const WORKER_DAILY_ALLOWANCE = 1000;
/** How long a set-up problem keeps email on Gmail before the Worker is tried again. */
export const WORKER_PAUSE_SECONDS = 600;
export const WORKER_PAUSE_CACHE_KEY = 'email-worker:paused';
/** After this many Worker failures in a row, the rest of the execution uses Gmail. */
export const MAX_WORKER_FAILURES_IN_A_ROW = 3;
/** The Worker's subject limit. */
export const MAX_SUBJECT_CHARS = 300;

/** Worker answers that mean "not set up (yet)": no use asking again for every email. */
const PAUSE_REASONS = new Set([
  'sender_not_verified', // mytma.org isn't onboarded/verified in Cloudflare Email Sending yet
  'email_not_configured', // the Worker has no EMAIL binding
  'no_email_endpoint', // the Worker is older than POST /email (404)
  'unauthorized', // the Worker is linked to another sheet, and linking again failed
]);

/** Worker answers about the message itself (it checks addresses, subject and size): they say nothing about the Worker. */
const MESSAGE_REASONS = new Set(['bad_message', 'bad_to', 'bad_reply_to', 'bad_subject', 'bad_content', 'no_content', 'content_too_large']);

export type EmailVia = 'cloudflare' | 'gmail';

/** Settings EMAIL_VIA: "gmail" (any capitals) forces MailApp; anything else is the default, cloudflare. */
export function emailVia(value: string): EmailVia {
  return String(value ?? '').trim().toLowerCase() === 'gmail' ? 'gmail' : 'cloudflare';
}

/** Why email is going out with Gmail right now. */
export type GmailReason =
  | 'setting' // EMAIL_VIA = gmail
  | 'no_worker' // PUSH_RELAY_URL isn't an https:// address
  | 'not_linked' // no usable PUSH_RELAY_SECRET (run Set up)
  | 'paused' // the Worker reported a set-up problem in the last 10 minutes (detail = its reason)
  | 'this_run'; // the Worker failed earlier in this execution (detail = its reason)

export type MailRoute =
  | { via: 'cloudflare'; from: string; workerUrl: string }
  | { via: 'gmail'; reason: GmailReason; detail?: string };

/** How the last send() went out. */
export interface MailDelivery {
  via: EmailVia;
  /** Why the Worker didn't send it (a reason code), unless EMAIL_VIA = gmail. */
  workerReason?: string;
  /** Cloudflare's error code, when the Worker passed one on. */
  workerCode?: string;
}

export interface GasMailer extends Mailer {
  /** Which way the next email goes (reads the Settings and the pause flag; no network). */
  route(): MailRoute;
  /** How the last send() in this execution went out, or null before the first. */
  lastDelivery(): MailDelivery | null;
  /** MailApp's emails left today (the Gmail fallback). */
  gmailQuota(): number;
}

export interface GasMailerDeps {
  /** The push Worker client: same address and secret as push. */
  relay: Pick<PushRelaySender, 'baseUrl' | 'enabled' | 'authorizedPost'>;
  cache: Cache;
  logger: Logger;
  /** Settings EMAIL_VIA. */
  via(): string;
  /** Settings ORG_NAME (the Gmail sender name). */
  senderName(): string;
  /** Settings SUPPORT_EMAIL (Reply-To). */
  replyTo(): string;
}

/** What the Worker said about one message. */
export type WorkerOutcome =
  | { ok: true; messageId: string }
  | { ok: false; reason: string; httpCode?: number; code?: string };

const PLAIN_ADDRESS = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

function oneLine(text: string): string {
  return String(text ?? '').replace(/[\r\n\u0085\u2028\u2029]+/g, ' ').replace(/[\u0000-\u001f\u007f]/g, '').trim();
}

/** A reason or error code from the Worker as a short identifier (it goes into logs and dialogs). */
function cleanCode(value: unknown): string {
  return typeof value === 'string' ? clip(value.replace(/[^A-Za-z0-9_]/g, ''), 64) : '';
}

/** Settings SUPPORT_EMAIL when it is one plain address, else the default. */
export function replyToAddress(value: string): string {
  const email = String(value ?? '').trim().toLowerCase();
  return email.length <= 254 && PLAIN_ADDRESS.test(email) ? email : SETTING_DEFAULTS.SUPPORT_EMAIL;
}

/** Maps the Worker's answer to POST /email (one message). */
export function readEmailAnswer(code: number, text: string): WorkerOutcome {
  const body = parseJson(text);
  if (code === 401) return { ok: false, reason: 'unauthorized', httpCode: code };
  if (code === 404) return { ok: false, reason: 'no_email_endpoint', httpCode: code };
  if (code === 503 && pick(body, 'error') === 'email_not_configured') return { ok: false, reason: 'email_not_configured', httpCode: code };
  if (code !== 200) return { ok: false, reason: 'http_error', httpCode: code };
  const results = pick(body, 'results');
  if (!Array.isArray(results) || results.length !== 1 || !isRecord(results[0])) return { ok: false, reason: 'bad_answer', httpCode: code };
  const result = results[0];
  if (result.status === 'ok') return { ok: true, messageId: typeof result.messageId === 'string' ? clip(result.messageId, 200) : '' };
  const reason = cleanCode(result.reason) || 'send_failed';
  const cfCode = cleanCode(result.code);
  return cfCode ? { ok: false, reason, code: cfCode } : { ok: false, reason };
}

/** A plain-language explanation of a Worker reason code (or a GmailReason), for the sheet's dialogs. */
export function describeWorkerReason(reason: string): string {
  switch (reason) {
    case 'sender_not_verified':
      return "mytma.org isn't verified for Cloudflare Email Sending yet (finish onboarding it; see docs/SETUP.md, Email from noreply@mytma.org)";
    case 'recipient_not_allowed':
      return 'Cloudflare only sends to verified addresses until mytma.org is onboarded on the Workers Paid plan';
    case 'rate_limited':
      return "Cloudflare's sending limit was reached";
    case 'email_not_configured':
      return 'the push Worker has no Email Sending binding (deploy it again from workers/push)';
    case 'no_email_endpoint':
      return 'the push Worker is an older version without email (deploy it again from workers/push)';
    case 'unauthorized':
      return "the push Worker didn't accept this sheet's secret (another spreadsheet may be linked to it; see docs/SETUP.md step 5E)";
    case 'network':
      return "the push Worker couldn't be reached";
    case 'no_worker':
      return "Settings PUSH_RELAY_URL isn't an https:// address";
    case 'not_linked':
      return "this sheet isn't linked to the push Worker yet (TMA App → Set up / repair tabs)";
    default:
      return `the push Worker couldn't send it (${cleanCode(reason) || 'unknown'})`;
  }
}

export function createGasMailer(deps: GasMailerDeps): GasMailer {
  const { relay, cache, logger } = deps;
  // Per execution (createGasServices runs once per request/trigger/menu click).
  let pausedMemo: string | null | undefined; // undefined = not read from CacheService yet
  let stoppedReason: string | null = null;
  let failuresInARow = 0;
  let last: MailDelivery | null = null;
  /** remainingQuota() reported the Worker's allowance in this execution, so the core may send more than Gmail can. */
  let promisedWorkerAllowance = false;
  let gmailSendsSincePromise = 0;

  function pausedReason(): string | null {
    if (pausedMemo === undefined) {
      try {
        pausedMemo = cache.get(WORKER_PAUSE_CACHE_KEY);
      } catch {
        pausedMemo = null;
      }
    }
    return pausedMemo;
  }

  function route(): MailRoute {
    if (emailVia(deps.via()) === 'gmail') return { via: 'gmail', reason: 'setting' };
    const base = relay.baseUrl();
    if (!base) return { via: 'gmail', reason: 'no_worker' };
    if (!relay.enabled()) return { via: 'gmail', reason: 'not_linked' };
    if (stoppedReason !== null) return { via: 'gmail', reason: 'this_run', detail: stoppedReason };
    const paused = pausedReason();
    if (paused) return { via: 'gmail', reason: 'paused', detail: paused };
    return { via: 'cloudflare', from: WORKER_EMAIL_FROM, workerUrl: base };
  }

  function sendThroughWorker(email: { to: string; subject: string; html: string; text: string; replyTo: string }): WorkerOutcome {
    try {
      const answer = relay.authorizedPost('/email', { messages: [email] });
      return readEmailAnswer(answer.code, answer.text);
    } catch {
      // Unreachable Worker (DNS, timeout) or push not configured: authorizedPost's text is not logged, it may name the URL.
      return { ok: false, reason: 'network' };
    }
  }

  function workerFailed(outcome: Exclude<WorkerOutcome, { ok: true }>): void {
    if (!MESSAGE_REASONS.has(outcome.reason)) failuresInARow += 1;
    const details: Record<string, unknown> = { reason: outcome.reason };
    if (outcome.httpCode !== undefined) details.httpCode = outcome.httpCode;
    if (outcome.code) details.code = outcome.code;
    logger.error('Worker email failed; sending this one with Gmail instead', details);
    if (PAUSE_REASONS.has(outcome.reason)) {
      pausedMemo = outcome.reason;
      try {
        cache.put(WORKER_PAUSE_CACHE_KEY, outcome.reason, WORKER_PAUSE_SECONDS);
      } catch (error) {
        logger.error('Could not pause Worker email', error);
      }
    } else if (outcome.reason === 'rate_limited' || failuresInARow >= MAX_WORKER_FAILURES_IN_A_ROW) {
      stoppedReason = outcome.reason;
    }
  }

  function sendWithGmail(email: { to: string; subject: string; html: string; text: string; replyTo: string }): void {
    if (promisedWorkerAllowance) {
      // The core counted on the Worker's allowance, not on Gmail's quota. The first fallback always goes
      // (it may be a sign-in code); later ones keep the day's last emails for sign-in codes, as the core does.
      if (gmailSendsSincePromise > 0 && MailApp.getRemainingDailyQuota() <= SIGN_IN_EMAIL_RESERVE) {
        throw new Error(`Gmail fallback skipped: the last ${SIGN_IN_EMAIL_RESERVE} emails of today's Gmail quota are kept for sign-in codes`);
      }
      gmailSendsSincePromise += 1;
    }
    MailApp.sendEmail({
      to: email.to,
      subject: email.subject,
      htmlBody: email.html,
      body: email.text,
      name: oneLine(deps.senderName()),
      replyTo: email.replyTo,
    });
  }

  function send(msg: MailMessage): void {
    last = null;
    const to = String(msg.to ?? '').trim();
    if (!to || !to.includes('@')) throw new Error('Invalid email recipient');
    const email = {
      to,
      subject: clip(oneLine(msg.subject), MAX_SUBJECT_CHARS),
      html: String(msg.html ?? ''),
      text: String(msg.text ?? ''),
      replyTo: replyToAddress(deps.replyTo()),
    };
    const current = route();
    if (current.via === 'gmail') {
      sendWithGmail(email);
      last = current.reason === 'setting' ? { via: 'gmail' } : { via: 'gmail', workerReason: current.detail ?? current.reason };
      return;
    }
    const outcome = sendThroughWorker(email);
    if (outcome.ok) {
      failuresInARow = 0;
      last = { via: 'cloudflare' };
      return;
    }
    workerFailed(outcome);
    sendWithGmail(email);
    last = outcome.code ? { via: 'gmail', workerReason: outcome.reason, workerCode: outcome.code } : { via: 'gmail', workerReason: outcome.reason };
  }

  return {
    remainingQuota() {
      if (route().via === 'cloudflare') {
        promisedWorkerAllowance = true;
        return WORKER_DAILY_ALLOWANCE;
      }
      return MailApp.getRemainingDailyQuota();
    },
    send,
    route,
    lastDelivery: () => last,
    gmailQuota: () => MailApp.getRemainingDailyQuota(),
  };
}
