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
 * send() sends one email (sign-in codes, the test email). sendMany() is what
 * notifications use: up to 10 emails per request to the Worker and a few
 * requests in parallel, so an announcement to every family takes seconds,
 * not minutes, inside the script's write lock.
 *
 * What the Worker says decides what happens next:
 *  - about one message or recipient (a suppressed or refused address, content
 *    Cloudflare won't take): just that message goes with Gmail;
 *  - a set-up problem (PAUSE_REASONS: the domain isn't verified, the Worker
 *    has no email binding or key…): Gmail for 10 minutes (CacheService), so a
 *    broken setup doesn't add a failing request to every email;
 *  - rate limited: Gmail for the rest of this execution;
 *  - the Worker or Cloudflare failing (unreachable, HTTP 5xx, an unknown
 *    error): after 3 in a row, Gmail for the rest of this execution and for
 *    2 minutes after it.
 *
 * The Gmail fallback for notifications keeps the day's last
 * SIGN_IN_EMAIL_RESERVE Gmail emails for sign-in codes, as the core does.
 *
 * Logs carry the Worker's reason codes and HTTP codes only: never addresses,
 * subjects or bodies.
 */
import { SIGN_IN_EMAIL_RESERVE } from '../server/notify';
import type { Cache, Logger, MailMessage, MailResult, Mailer } from '../server/services';
import { SETTING_DEFAULTS } from '../shared/schema';
import { utf8Length, type PushRelaySender, type RelayAnswer } from './push-relay';
import { clip, isRecord, parseJson, pick } from './util';

/** The Worker's sender (workers/push/wrangler.toml EMAIL_FROM), for the status dialog. The Worker decides; Apps Script never sends it. */
export const WORKER_EMAIL_FROM = 'noreply@mytma.org';
/** What remainingQuota() reports while the Worker sends (Cloudflare has no per-script daily quota like Gmail's). */
export const WORKER_DAILY_ALLOWANCE = 1000;
/** How long a set-up problem keeps email on Gmail before the Worker is tried again. */
export const WORKER_PAUSE_SECONDS = 600;
/** How long Gmail sends after the Worker failed MAX_WORKER_FAILURES_IN_A_ROW times in a row. */
export const WORKER_DOWN_PAUSE_SECONDS = 120;
export const WORKER_PAUSE_CACHE_KEY = 'email-worker:paused';
/** After this many Worker failures in a row, the rest of the execution (and WORKER_DOWN_PAUSE_SECONDS) uses Gmail. */
export const MAX_WORKER_FAILURES_IN_A_ROW = 3;
/** The Worker's subject limit. */
export const MAX_SUBJECT_CHARS = 300;
/** Messages per POST /email (the Worker's limit). */
export const MESSAGES_PER_EMAIL_REQUEST = 10;
/** Request body budget in UTF-8 bytes (the Worker refuses bodies over 256 KB). A bigger single message goes alone. */
export const MAX_EMAIL_REQUEST_BYTES = 200 * 1024;
/** POST /email requests per UrlFetchApp.fetchAll. */
export const EMAIL_REQUESTS_PER_FETCH_ALL = 5;
/** sendMany starts nothing new after this long, so a big batch ends cleanly inside Apps Script's 6-minute limit. */
export const SEND_MANY_TIME_BUDGET_MS = 4 * 60_000;

/** Worker answers that mean "not set up (yet)": no use asking again for every email. */
const PAUSE_REASONS = new Set([
  'sender_not_verified', // mytma.org isn't onboarded/verified in Cloudflare Email Sending yet
  'account_suspended', // Cloudflare paused Email Sending for the account
  'email_not_configured', // the Worker has no EMAIL binding
  'email_key_missing', // the Worker has no EMAIL_KEY secret
  'email_key_mismatch', // EMAIL_KEY holds another sheet's (or an old) key
  'no_email_endpoint', // the Worker is older than POST /email (404)
  'unauthorized', // the Worker is linked to another sheet, and linking again failed
]);

/** Answers that end the Worker route for this execution. */
const STOP_REASONS = new Set(['rate_limited']);

/**
 * Answers about one message or recipient: they say nothing about the Worker,
 * so that message goes with Gmail and the next one still tries the Worker.
 * (recipient_not_allowed only happens before mytma.org is onboarded, when
 * Cloudflare sends to verified addresses only, so the others still go out.)
 */
const MESSAGE_REASONS = new Set([
  // The Worker's own checks:
  'bad_message',
  'bad_to',
  'bad_reply_to',
  'bad_subject',
  'bad_content',
  'no_content',
  'content_too_large',
  // Cloudflare's answer about the recipient or the content:
  'recipient_not_allowed',
  'recipient_suppressed',
  'delivery_failed',
  'invalid_message',
  // HTTP 400/413 for a request: its content, not the Worker.
  'bad_request',
  'too_large',
]);

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
  | 'paused' // the Worker reported a problem in the last few minutes (detail = its reason)
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
  sendMany(msgs: MailMessage[]): MailResult[];
  relayStatus(): { from: string; backupRemaining: number } | null;
  /** Which way the next email goes (reads the Settings and the pause flag; no network). */
  route(): MailRoute;
  /** How the last send() in this execution went out, or null before the first. */
  lastDelivery(): MailDelivery | null;
  /** MailApp's emails left today (the Gmail fallback). */
  gmailQuota(): number;
}

export interface GasMailerDeps {
  /** The push Worker client: same address and secret as push. */
  relay: Pick<PushRelaySender, 'baseUrl' | 'enabled' | 'authorizedPost' | 'authorizedPostAll'>;
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
export type WorkerOutcome = { ok: true; messageId: string } | WorkerFailure;
export type WorkerFailure = { ok: false; reason: string; httpCode?: number; code?: string };

/** What the Worker said about one POST /email: a result per message, or one failure for the whole request. */
export type EmailBatchAnswer = { kind: 'results'; outcomes: WorkerOutcome[] } | { kind: 'failed'; outcome: WorkerFailure };

/** One email as POST /email takes it. */
interface WorkerEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo: string;
}

const PLAIN_ADDRESS = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

function oneLine(text: string): string {
  return String(text ?? '').replace(/[\r\n\u0085\u2028\u2029]+/g, ' ').replace(/[\u0000-\u001f\u007f]/g, '').trim();
}

/** A reason or error code from the Worker as a short identifier (it goes into logs and dialogs). */
function cleanCode(value: unknown): string {
  return typeof value === 'string' ? clip(value.replace(/[^A-Za-z0-9_]/g, ''), 64) : '';
}

function errorText(error: unknown): string {
  return clip(error instanceof Error ? error.message : String(error), 300);
}

/** Settings SUPPORT_EMAIL when it is one plain address, else the default. */
export function replyToAddress(value: string): string {
  const email = String(value ?? '').trim().toLowerCase();
  return email.length <= 254 && PLAIN_ADDRESS.test(email) ? email : SETTING_DEFAULTS.SUPPORT_EMAIL;
}

/** Maps the Worker's answer to a POST /email of `count` messages. */
export function readEmailBatchAnswer(code: number, text: string, count: number): EmailBatchAnswer {
  const body = parseJson(text);
  const error = pick(body, 'error');
  const failed = (reason: string): EmailBatchAnswer => ({ kind: 'failed', outcome: { ok: false, reason, httpCode: code } });
  if (code === 401) return failed('unauthorized');
  if (code === 404) return failed('no_email_endpoint');
  if (code === 503 && (error === 'email_not_configured' || error === 'email_key_missing')) return failed(error);
  if (code === 403 && error === 'email_key_mismatch') return failed(error);
  if (code === 400) return failed('bad_request');
  if (code === 413) return failed('too_large');
  if (code !== 200) return failed('http_error');
  const results = pick(body, 'results');
  if (!Array.isArray(results) || results.length !== count || !results.every(isRecord)) return failed('bad_answer');
  return {
    kind: 'results',
    outcomes: results.map((result): WorkerOutcome => {
      if (result.status === 'ok') return { ok: true, messageId: typeof result.messageId === 'string' ? clip(result.messageId, 200) : '' };
      const reason = cleanCode(result.reason) || 'send_failed';
      const cfCode = cleanCode(result.code);
      return cfCode ? { ok: false, reason, code: cfCode } : { ok: false, reason };
    }),
  };
}

/** Maps the Worker's answer to POST /email (one message). */
export function readEmailAnswer(code: number, text: string): WorkerOutcome {
  const answer = readEmailBatchAnswer(code, text, 1);
  return answer.kind === 'failed' ? answer.outcome : answer.outcomes[0];
}

/** How long a paused Worker route stays paused, in seconds: set-up problems 10 minutes, the Worker failing 2. */
export function pauseSeconds(reason: string): number {
  return PAUSE_REASONS.has(reason) ? WORKER_PAUSE_SECONDS : WORKER_DOWN_PAUSE_SECONDS;
}

/** A plain-language explanation of a Worker reason code (or a GmailReason), for the sheet's dialogs. */
export function describeWorkerReason(reason: string): string {
  switch (reason) {
    case 'sender_not_verified':
      return "mytma.org isn't verified for Cloudflare Email Sending yet (finish onboarding it; see docs/SETUP.md, Email from noreply@mytma.org)";
    case 'account_suspended':
      return "Cloudflare paused Email Sending for the account (check Compute → Email Service → Email Sending in Cloudflare)";
    case 'recipient_not_allowed':
      return 'Cloudflare only sends to verified addresses until mytma.org is onboarded on the Workers Paid plan (finish steps A and B)';
    case 'recipient_suppressed':
      return "Cloudflare won't email this address any more (it bounced or complained before)";
    case 'delivery_failed':
      return "the recipient's mail server refused it";
    case 'invalid_message':
    case 'bad_request':
    case 'too_large':
      return "Cloudflare didn't accept this email's content";
    case 'rate_limited':
      return "Cloudflare's sending limit was reached";
    case 'email_not_configured':
      return 'the push Worker has no Email Sending binding (deploy it again from workers/push)';
    case 'email_key_missing':
      return "the push Worker doesn't have its EMAIL_KEY secret yet (copy the email key from TMA App → Status into Cloudflare; see docs/SETUP.md)";
    case 'email_key_mismatch':
      return "the push Worker's EMAIL_KEY secret isn't this sheet's email key (copy it again from TMA App → Status; see docs/SETUP.md)";
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

  function pause(reason: string): void {
    pausedMemo = reason;
    try {
      cache.put(WORKER_PAUSE_CACHE_KEY, reason, pauseSeconds(reason));
    } catch (error) {
      logger.error('Could not pause Worker email', error);
    }
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

  /** The email as POST /email takes it, or null when there is no recipient to send to. */
  function prepare(msg: MailMessage): WorkerEmail | null {
    const to = String(msg.to ?? '').trim();
    if (!to || !to.includes('@')) return null;
    return {
      to,
      subject: clip(oneLine(msg.subject), MAX_SUBJECT_CHARS),
      html: String(msg.html ?? ''),
      text: String(msg.text ?? ''),
      replyTo: replyToAddress(deps.replyTo()),
    };
  }

  function sendThroughWorker(email: WorkerEmail): WorkerOutcome {
    try {
      const answer = relay.authorizedPost('/email', { messages: [email] });
      return readEmailAnswer(answer.code, answer.text);
    } catch {
      // Unreachable Worker (DNS, timeout) or push not configured: authorizedPost's text is not logged, it may name the URL.
      return { ok: false, reason: 'network' };
    }
  }

  /** Records a Worker failure (for one message, or a whole request) and decides whether to keep asking the Worker. */
  function workerFailed(outcome: WorkerFailure, messages = 1): void {
    const details: Record<string, unknown> = { reason: outcome.reason };
    if (outcome.httpCode !== undefined) details.httpCode = outcome.httpCode;
    if (outcome.code) details.code = outcome.code;
    if (messages !== 1) details.messages = messages;
    logger.error(`Worker email failed; sending ${messages === 1 ? 'this one' : 'these'} with Gmail instead`, details);
    if (PAUSE_REASONS.has(outcome.reason)) {
      pause(outcome.reason);
    } else if (STOP_REASONS.has(outcome.reason)) {
      stoppedReason = outcome.reason;
    } else if (!MESSAGE_REASONS.has(outcome.reason)) {
      // The Worker or Cloudflare failing (unreachable, 5xx, unknown errors).
      failuresInARow += 1;
      if (failuresInARow >= MAX_WORKER_FAILURES_IN_A_ROW) {
        stoppedReason = outcome.reason;
        // Later executions skip the Worker for a moment too, and report Gmail's quota so the core keeps its reserve.
        pause(outcome.reason);
      }
    }
  }

  function mailApp(email: WorkerEmail): void {
    MailApp.sendEmail({
      to: email.to,
      subject: email.subject,
      htmlBody: email.html,
      body: email.text,
      name: oneLine(deps.senderName()),
      replyTo: email.replyTo,
    });
  }

  /** The Gmail fallback for send() (sign-in codes, the test email). */
  function sendWithGmail(email: WorkerEmail): void {
    if (promisedWorkerAllowance) {
      // The core counted on the Worker's allowance, not on Gmail's quota. The first fallback always goes
      // (send() is how sign-in codes go out, and the reserve is theirs); later ones keep the day's last
      // emails for sign-in codes, as the core does.
      if (gmailSendsSincePromise > 0 && MailApp.getRemainingDailyQuota() <= SIGN_IN_EMAIL_RESERVE) {
        throw new Error(`Gmail fallback skipped: the last ${SIGN_IN_EMAIL_RESERVE} emails of today's Gmail quota are kept for sign-in codes`);
      }
      gmailSendsSincePromise += 1;
    }
    mailApp(email);
  }

  function send(msg: MailMessage): void {
    last = null;
    const email = prepare(msg);
    if (!email) throw new Error('Invalid email recipient');
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

  /** Splits emails into POST /email bodies: at most MESSAGES_PER_EMAIL_REQUEST each, and within MAX_EMAIL_REQUEST_BYTES. */
  function chunk<T extends { email: WorkerEmail }>(items: T[]): T[][] {
    const EMPTY_BODY_BYTES = 15; // {"messages":[]}
    const chunks: T[][] = [];
    let current: T[] = [];
    let bytes = EMPTY_BODY_BYTES;
    for (const item of items) {
      const size = utf8Length(JSON.stringify(item.email)) + 1; // and a comma
      if (current.length > 0 && (current.length >= MESSAGES_PER_EMAIL_REQUEST || bytes + size > MAX_EMAIL_REQUEST_BYTES)) {
        chunks.push(current);
        current = [];
        bytes = EMPTY_BODY_BYTES;
      }
      current.push(item);
      bytes += size;
    }
    if (current.length > 0) chunks.push(current);
    return chunks;
  }

  function sendMany(msgs: MailMessage[]): MailResult[] {
    const started = Date.now();
    const results: MailResult[] = msgs.map(() => ({ ok: false, error: 'not sent' }));
    const pending: Array<{ index: number; email: WorkerEmail }> = [];
    msgs.forEach((msg, index) => {
      const email = prepare(msg);
      if (email) pending.push({ index, email });
      else results[index] = { ok: false, error: 'Invalid email recipient' };
    });

    // Notifications only, so every Gmail fallback keeps the day's last emails for sign-in codes.
    let gmailLeft: number | null = null;
    const viaGmail = (item: { index: number; email: WorkerEmail }): void => {
      try {
        if (gmailLeft === null) gmailLeft = MailApp.getRemainingDailyQuota();
        if (gmailLeft <= SIGN_IN_EMAIL_RESERVE) {
          throw new Error(`Gmail fallback skipped: the last ${SIGN_IN_EMAIL_RESERVE} emails of today's Gmail quota are kept for sign-in codes`);
        }
        mailApp(item.email);
        gmailLeft -= 1;
        results[item.index] = { ok: true };
      } catch (error) {
        results[item.index] = { ok: false, error: errorText(error) };
      }
    };
    const outOfTime = () => Date.now() - started > SEND_MANY_TIME_BUDGET_MS;

    let next = 0;
    while (next < pending.length) {
      if (outOfTime()) {
        const left = pending.length - next;
        logger.error('Stopped sending emails before the Apps Script time limit', { notSent: left });
        for (; next < pending.length; next += 1) {
          results[pending[next].index] = { ok: false, error: 'Not sent: this run was close to the Apps Script time limit' };
        }
        break;
      }
      if (route().via === 'gmail') {
        viaGmail(pending[next]);
        next += 1;
        continue;
      }
      // Enough for EMAIL_REQUESTS_PER_FETCH_ALL requests, sent in parallel.
      const group = chunk(pending.slice(next, next + MESSAGES_PER_EMAIL_REQUEST * EMAIL_REQUESTS_PER_FETCH_ALL)).slice(0, EMAIL_REQUESTS_PER_FETCH_ALL);
      next += group.reduce((n, c) => n + c.length, 0);
      let answers: RelayAnswer[] | null;
      try {
        answers = relay.authorizedPostAll(
          '/email',
          group.map((c) => ({ messages: c.map((item) => item.email) })),
        );
      } catch {
        // Unreachable: nothing is known about any of them (the error text may name the URL, so it isn't logged).
        // fetchAll throws if any one request fails, so a few may in fact have been sent: a rare duplicate
        // email beats a family missing one.
        answers = null;
      }
      group.forEach((items, i) => {
        const answer = answers?.[i];
        const parsed: EmailBatchAnswer = answer
          ? readEmailBatchAnswer(answer.code, answer.text, items.length)
          : { kind: 'failed', outcome: { ok: false, reason: 'network' } };
        if (parsed.kind === 'failed') {
          workerFailed(parsed.outcome, items.length);
          items.forEach(viaGmail);
          return;
        }
        parsed.outcomes.forEach((outcome, k) => {
          if (outcome.ok) {
            failuresInARow = 0;
            results[items[k].index] = { ok: true };
          } else {
            workerFailed(outcome);
            viaGmail(items[k]);
          }
        });
      });
    }
    return results;
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
    sendMany,
    relayStatus: () => (route().via === 'cloudflare' ? { from: WORKER_EMAIL_FROM, backupRemaining: MailApp.getRemainingDailyQuota() } : null),
    route,
    lastDelivery: () => last,
    gmailQuota: () => MailApp.getRemainingDailyQuota(),
  };
}
