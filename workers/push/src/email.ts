// Transactional email through Cloudflare Email Service ("Email Sending").
//
// Apps Script posts the emails the app sends (sign-in codes, notifications,
// announcements, admin alerts) to POST /email, one recipient per message, and
// the Worker hands each one to the `send_email` binding EMAIL. The sender is
// fixed by wrangler.toml ([vars] EMAIL_FROM and EMAIL_FROM_NAME) and is never
// taken from the request, so the relay secret can't be used to send as anyone
// else.
//
// Every address, the subject and both bodies are checked before anything is
// sent: plain addresses only (no display names, lists or line breaks) and no
// control characters in the subject, so a value from the sheet can't add
// recipients or headers.
//
// Logs carry counts and Cloudflare's error codes only: never addresses,
// subjects or bodies.
import { utf8 } from './b64';
import type { EmailAddressLike, EmailBinding, Env, OutgoingEmail } from './env';

/** Messages per /email request. Apps Script sends one at a time. */
export const MAX_EMAIL_MESSAGES = 10;
/** RFC 5321 path limit. */
export const MAX_ADDRESS_CHARS = 254;
const MAX_LOCAL_PART_CHARS = 64;
export const MAX_SUBJECT_CHARS = 300;
export const MAX_HTML_BYTES = 200 * 1024;
export const MAX_TEXT_BYTES = 100 * 1024;
const MAX_FROM_NAME_CHARS = 100;
const MAX_MESSAGE_ID_CHARS = 256;
const MAX_CODE_CHARS = 64;

export const DEFAULT_EMAIL_FROM = 'noreply@mytma.org';
export const DEFAULT_EMAIL_FROM_NAME = 'Timberlane Music Association';

/** Why one message was not sent. */
export type EmailErrorReason =
  // The message itself (nothing was sent):
  | 'bad_message' // not an object
  | 'bad_to' // `to` is not one plain email address
  | 'bad_reply_to' // `replyTo` is present but not one plain email address
  | 'bad_subject' // not 1–300 characters, or has a line break / control character
  | 'bad_content' // `html` or `text` is not a string
  | 'no_content' // neither `html` nor `text`
  | 'content_too_large' // html over 200 KB or text over 100 KB (UTF-8)
  // Cloudflare refused it (the thrown error's code is passed along as `code`):
  | 'sender_not_verified' // E_SENDER_NOT_VERIFIED: the sending domain isn't onboarded/verified yet
  | 'rate_limited' // E_RATE_LIMIT_EXCEEDED or E_DAILY_LIMIT_EXCEEDED
  | 'recipient_not_allowed' // E_RECIPIENT_NOT_ALLOWED (e.g. only verified destinations allowed)
  | 'send_failed'; // anything else

export type EmailResult =
  | { status: 'ok'; messageId: string }
  | { status: 'error'; reason: EmailErrorReason; code?: string };

const LOCAL_PART = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/;
const DOMAIN_LABEL = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;
/** C0 controls (CR and LF included), DEL, NEL and the Unicode line/paragraph separators. */
const CONTROL = /[\u0000-\u001f\u007f\u0085\u2028\u2029]/;

/**
 * One plain address, `local@domain.tld`: no display name, no angle brackets,
 * no list, no spaces or line breaks, at most 254 characters.
 */
export function isPlainAddress(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > MAX_ADDRESS_CHARS) return false;
  const at = value.indexOf('@');
  if (at < 1 || at !== value.lastIndexOf('@')) return false;
  const local = value.slice(0, at);
  const labels = value.slice(at + 1).split('.');
  if (local.length > MAX_LOCAL_PART_CHARS || !LOCAL_PART.test(local)) return false;
  if (labels.length < 2 || !labels.every((label) => DOMAIN_LABEL.test(label))) return false;
  return !/^\d+$/.test(labels[labels.length - 1]!); // the top-level domain isn't numeric
}

/** A subject Cloudflare can put in one header line: 1–300 characters, not blank, no control characters. */
export function isSafeSubject(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_SUBJECT_CHARS && value.trim() !== '' && !CONTROL.test(value);
}

/** The fixed sender from wrangler.toml [vars], or the defaults when a var is missing or unusable. */
export function emailSender(env: Env): EmailAddressLike {
  const email = env.EMAIL_FROM?.trim() ?? '';
  const name = (env.EMAIL_FROM_NAME ?? '').replace(new RegExp(CONTROL.source, 'g'), ' ').trim().slice(0, MAX_FROM_NAME_CHARS);
  return {
    email: isPlainAddress(email) ? email : DEFAULT_EMAIL_FROM,
    name: name || DEFAULT_EMAIL_FROM_NAME,
  };
}

/** True when the EMAIL binding is configured on this Worker. */
export function hasEmailBinding(env: Env): env is Env & { EMAIL: EmailBinding } {
  return typeof env.EMAIL?.send === 'function';
}

type Checked = { ok: true; email: OutgoingEmail } | { ok: false; result: EmailResult };

function invalid(reason: EmailErrorReason): Checked {
  return { ok: false, result: { status: 'error', reason } };
}

/** Optional body part: absent (undefined/null/''), a string within `maxBytes`, or a problem. */
function bodyPart(value: unknown, maxBytes: number): { value?: string } | 'bad_content' | 'content_too_large' {
  if (value === undefined || value === null || value === '') return {};
  if (typeof value !== 'string') return 'bad_content';
  // A UTF-8 character is at most 3 bytes per UTF-16 unit: only measure when it could be over.
  if (value.length * 3 > maxBytes && utf8(value).byteLength > maxBytes) return 'content_too_large';
  return { value };
}

/** Validates one message from the request and builds what the binding gets. */
export function checkMessage(message: unknown, from: EmailAddressLike): Checked {
  if (typeof message !== 'object' || message === null || Array.isArray(message)) return invalid('bad_message');
  const m = message as Record<string, unknown>;
  if (!isPlainAddress(m.to)) return invalid('bad_to');
  const replyTo = m.replyTo;
  if (replyTo !== undefined && replyTo !== null && !isPlainAddress(replyTo)) return invalid('bad_reply_to');
  if (!isSafeSubject(m.subject)) return invalid('bad_subject');
  const html = bodyPart(m.html, MAX_HTML_BYTES);
  const text = bodyPart(m.text, MAX_TEXT_BYTES);
  for (const part of [html, text]) if (typeof part === 'string') return invalid(part);
  const htmlValue = (html as { value?: string }).value;
  const textValue = (text as { value?: string }).value;
  if (htmlValue === undefined && textValue === undefined) return invalid('no_content');

  // Exactly one recipient; From is ours, whatever the request said.
  const email: OutgoingEmail = { from: { ...from }, to: m.to, subject: m.subject };
  if (htmlValue !== undefined) email.html = htmlValue;
  if (textValue !== undefined) email.text = textValue;
  if (typeof replyTo === 'string') email.replyTo = replyTo;
  return { ok: true, email };
}

/** Cloudflare's error code (a short identifier), or '' when the error has none. */
function errorCode(error: unknown): string {
  const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
  return typeof code === 'string' ? code.replace(/[^A-Za-z0-9_.-]/g, '').slice(0, MAX_CODE_CHARS) : '';
}

/** Maps a thrown Email Sending error to a reason. Only the code is kept, never the error message. */
export function mapEmailError(error: unknown): { status: 'error'; reason: EmailErrorReason; code?: string } {
  const code = errorCode(error);
  let reason: EmailErrorReason = 'send_failed';
  if (code === 'E_SENDER_NOT_VERIFIED') reason = 'sender_not_verified';
  else if (code === 'E_RATE_LIMIT_EXCEEDED' || code === 'E_DAILY_LIMIT_EXCEEDED') reason = 'rate_limited';
  else if (/RECIPIENT|DESTINATION/i.test(code) && /NOT_?ALLOWED|NOT_?VERIFIED|UNVERIFIED/i.test(code)) reason = 'recipient_not_allowed';
  return code ? { status: 'error', reason, code } : { status: 'error', reason };
}

async function sendOne(message: unknown, binding: EmailBinding, from: EmailAddressLike): Promise<EmailResult> {
  const checked = checkMessage(message, from);
  if (!checked.ok) return checked.result;
  try {
    const sent = await binding.send(checked.email);
    const id = typeof sent?.messageId === 'string' ? sent.messageId.slice(0, MAX_MESSAGE_ID_CHARS) : '';
    return { status: 'ok', messageId: id };
  } catch (error) {
    return mapEmailError(error);
  }
}

/**
 * Sends each message in order, one at a time (Apps Script sends one per
 * request; a batch is at most 10). Results are in the same order.
 */
export async function sendEmails(messages: unknown[], binding: EmailBinding, from: EmailAddressLike): Promise<EmailResult[]> {
  const results: EmailResult[] = [];
  for (const message of messages) results.push(await sendOne(message, binding, from));
  return results;
}

/** One log line: counts and reason/error codes only (e.g. "email ok 1 error 1 rate_limited:E_RATE_LIMIT_EXCEEDED"). */
export function summarizeEmailResults(results: readonly EmailResult[]): string {
  const ok = results.filter((r) => r.status === 'ok').length;
  const codes = new Set<string>();
  for (const r of results) if (r.status === 'error') codes.add(r.code ? `${r.reason}:${r.code}` : r.reason);
  return `email ok ${ok} error ${results.length - ok}${codes.size ? ` ${[...codes].join(',')}` : ''}`;
}
