/**
 * Passwordless sign-in (ARCHITECTURE.md §4): 6-digit email codes and signed
 * session tokens `base64url(JSON{e,v,x}).hmacHex`.
 */
import { SETTING_DEFAULTS } from '../shared/schema';
import type { IsoDateTime } from '../shared/types';
import type { Ctx } from './context';
import { inWriteLock, rateLimit } from './context';
import { renderEmail } from './email';
import { ApiError, badRequest, fail } from './errors';
import { MailReserveError } from './services';
import * as v from './validate';
import { base64UrlDecode, base64UrlEncode, errorMessage, isEmail, isRecord, safeEqual } from './util';

const CODE_TTL_SECONDS = 600;
const MAX_CODE_ATTEMPTS = 5;
const CODES_PER_HOUR = 5;
const MAX_TOKEN_LENGTH = 2048;
/**
 * Default codes per hour, script-wide, for emails TMA hasn't verified (new sign-ups, households still
 * Pending, people who only saved settings); Settings NEW_SIGNUPS_PER_HOUR overrides it. Apps Script
 * can't see the caller's address, so this is what stops one person from spending the whole shared
 * daily email quota on made-up addresses.
 */
export const NEW_EMAIL_CODES_PER_HOUR = Number(SETTING_DEFAULTS.NEW_SIGNUPS_PER_HOUR);
/**
 * The last daily email recipients are kept for sign-in codes to emails TMA has verified (guardians
 * of Active households, admins), so those families can still sign in after a flood of codes to
 * other addresses.
 */
export const KNOWN_EMAIL_CODE_RESERVE = 40;

interface OtpEntry {
  /** hmac(TOKEN_SECRET, "otp|email|code") */
  h: string;
  /** failed attempts so far */
  a: number;
  /** expiry, epoch ms */
  x: number;
}

export function requireSecret(ctx: Ctx): string {
  const secret = ctx.s.secrets.get('TOKEN_SECRET');
  if (!secret || secret.length < 32) {
    return fail('NOT_CONFIGURED', "The TMA app isn't set up yet. Please ask TMA to run Setup.");
  }
  return secret;
}

function otpHash(ctx: Ctx, secret: string, email: string, code: string): string {
  return ctx.s.crypto.hmacSha256Hex(secret, `otp|${email}|${code}`);
}

function readOtp(raw: string | null): OtpEntry | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return null;
    const { h, a, x } = parsed;
    return typeof h === 'string' && typeof a === 'number' && typeof x === 'number' ? { h, a, x } : null;
  } catch {
    return null;
  }
}

/**
 * TMA has verified this email: an admin, or a guardian of an Active household. Not a Pending
 * household's guardians, nor someone who only saved settings or a device: anyone can sign in and
 * make those, or type any address as a Pending household's second guardian, so they would let one
 * person send codes past the new-email limits.
 */
function isKnownEmail(ctx: Ctx, email: string): boolean {
  return ctx.m.settings().adminEmails.includes(email) || ctx.m.familiesWithEmail(email).some((f) => f.status === 'Active');
}

/** A sign-in limit for new emails was hit: log it (and once an hour in the Log tab, so admins see a flood). */
function newEmailLimitHit(ctx: Ctx, detail: string): void {
  ctx.s.logger.error(detail);
  const flag = 'otp-new-email-limit-logged';
  if (ctx.s.cache.get(flag)) return;
  ctx.s.cache.put(flag, '1', 3600);
  try {
    inWriteLock(ctx, () => ctx.log('auth', detail));
  } catch (err) {
    ctx.s.logger.error('Could not write the Log row', errorMessage(err));
  }
}

const NEW_EMAILS_PAUSED = 'Lots of people are signing up right now, so new sign-ups are paused for a while. Please try again later or contact TMA.';

/** auth.requestCode: always answers {sent:true}; anyone may sign up with any email. */
export function requestCode(ctx: Ctx, params: v.Params): { sent: true; devCode?: string } {
  const email = v.email(params.email);
  const secret = requireSecret(ctx);
  // The demo signs in with one tap over and over; the real limit only matters when email is sent.
  const perHour = ctx.s.mode === 'demo' ? 100 : CODES_PER_HOUR;
  rateLimit(ctx, `otp-rl:${email}`, perHour, 3600, 'Too many codes requested for this email. Please wait an hour and try again.');

  if (ctx.s.mode === 'demo') {
    const devCode = newCode(ctx);
    storeCode(ctx, secret, email, devCode);
    return { sent: true, devCode };
  }

  // A new code replaces one the person may already have in their inbox only once it is sent.
  let quota = 0;
  try {
    quota = ctx.s.mailer.remainingQuota();
  } catch (err) {
    ctx.s.logger.error('remainingQuota failed', errorMessage(err));
  }
  if (quota <= 0) {
    fail('RATE_LIMITED', "TMA has reached today's email limit. Please try again tomorrow or contact TMA.");
  }
  const known = isKnownEmail(ctx, email);
  if (!known) {
    if (quota <= KNOWN_EMAIL_CODE_RESERVE) {
      newEmailLimitHit(ctx, `Sign-in codes to new emails paused: only ${quota} emails left today (the last ${KNOWN_EMAIL_CODE_RESERVE} are kept for families TMA has verified)`);
      fail('RATE_LIMITED', NEW_EMAILS_PAUSED);
    }
    const perHourNew = ctx.m.settings().newSignupsPerHour;
    try {
      rateLimit(ctx, 'otp-rl:new-emails', perHourNew, 3600, NEW_EMAILS_PAUSED);
    } catch (err) {
      newEmailLimitHit(ctx, `Sign-in codes to new emails paused: more than ${perHourNew} in an hour (Settings NEW_SIGNUPS_PER_HOUR)`);
      throw err;
    }
  }

  const code = newCode(ctx);
  const settings = ctx.m.settings();
  const { html, text } = renderEmail({
    orgName: settings.pub.orgName,
    title: 'Your sign-in code',
    body: 'Enter this code in the TMA app to sign in. It expires in 10 minutes.',
    code,
    appUrl: '',
    footer: "Someone asked to sign in to the TMA app with this email address. If it wasn't you, you can ignore this email.",
  });
  try {
    // remainingQuota() may be a relay's allowance, not its backup sender's (Apps Script: the Worker's,
    // then Gmail when the Worker can't send), so the mailer keeps the reserve on the backup too.
    ctx.s.mailer.send({ to: email, subject: `Your TMA sign-in code: ${code}`, html, text }, known ? undefined : { reserve: KNOWN_EMAIL_CODE_RESERVE });
  } catch (err) {
    if (err instanceof MailReserveError) {
      newEmailLimitHit(ctx, `Sign-in codes to new emails paused: only ${err.remaining} backup emails left today (the last ${KNOWN_EMAIL_CODE_RESERVE} are kept for families TMA has verified)`);
      fail('RATE_LIMITED', NEW_EMAILS_PAUSED);
    }
    ctx.s.logger.error('Could not send sign-in code', errorMessage(err));
    fail('INTERNAL', "We couldn't send the email right now. Please try again in a few minutes.");
  }
  storeCode(ctx, secret, email, code);
  return { sent: true };
}

/** A new random 6-digit code. */
function newCode(ctx: Ctx): string {
  const code = ctx.s.crypto.randomDigits(6);
  if (!/^\d{6}$/.test(code)) throw new Error('randomDigits returned an invalid code');
  return code;
}

/** Remember only the HMAC of `code` for `email`, replacing any earlier code. */
function storeCode(ctx: Ctx, secret: string, email: string, code: string): void {
  const entry: OtpEntry = { h: otpHash(ctx, secret, email, code), a: 0, x: ctx.now.getTime() + CODE_TTL_SECONDS * 1000 };
  ctx.s.cache.put(`otp:${email}`, JSON.stringify(entry), CODE_TTL_SECONDS);
}

/** auth.verifyCode: at most 5 attempts per issued code; success deletes the code and returns a session. */
export function verifyCode(ctx: Ctx, params: v.Params): { token: string; expiresAt: IsoDateTime } {
  const email = v.email(params.email);
  const rawCode = typeof params.code === 'number' ? String(params.code).padStart(6, '0') : params.code;
  const code = typeof rawCode === 'string' ? rawCode.replace(/[\s-]/g, '') : '';
  if (!/^\d{6}$/.test(code)) badRequest('Enter the 6-digit code from the email.');
  const secret = requireSecret(ctx);

  const key = `otp:${email}`;
  const entry = readOtp(ctx.s.cache.get(key));
  if (!entry || entry.x <= ctx.now.getTime()) {
    ctx.s.cache.remove(key);
    fail('UNAUTHORIZED', 'That code has expired. Please request a new one.');
  }
  const otp = entry as OtpEntry;
  if (otp.a >= MAX_CODE_ATTEMPTS) {
    ctx.s.cache.remove(key);
    fail('UNAUTHORIZED', 'Too many tries. Please request a new code.');
  }
  if (!safeEqual(otp.h, otpHash(ctx, secret, email, code))) {
    otp.a += 1;
    const ttl = Math.ceil((otp.x - ctx.now.getTime()) / 1000);
    if (otp.a >= MAX_CODE_ATTEMPTS || ttl <= 0) ctx.s.cache.remove(key);
    else ctx.s.cache.put(key, JSON.stringify(otp), ttl);
    fail(
      'UNAUTHORIZED',
      otp.a >= MAX_CODE_ATTEMPTS ? 'Too many tries. Please request a new code.' : "That code isn't right. Please check the email and try again.",
    );
  }
  ctx.s.cache.remove(key);
  return issueToken(ctx, email, secret);
}

export function issueToken(ctx: Ctx, email: string, secret = requireSecret(ctx)): { token: string; expiresAt: IsoDateTime } {
  const settings = ctx.m.settings();
  const expiry = Math.floor(ctx.now.getTime() / 1000) + settings.sessionDays * 86400;
  const payload = base64UrlEncode(JSON.stringify({ e: email, v: settings.tokenVersion, x: expiry }));
  return {
    token: `${payload}.${ctx.s.crypto.hmacSha256Hex(secret, payload)}`,
    expiresAt: new Date(expiry * 1000).toISOString(),
  };
}

/** Verify a session token (signature, expiry, TOKEN_VERSION) and return the signed-in email. */
export function authenticate(ctx: Ctx, token: unknown): string {
  if (typeof token !== 'string' || token === '') fail('UNAUTHORIZED', 'Please sign in.');
  const t = token as string;
  const secret = requireSecret(ctx);
  const invalid = (): never => {
    throw new ApiError('UNAUTHORIZED', 'Please sign in again.');
  };
  if (t.length > MAX_TOKEN_LENGTH) invalid();
  const dot = t.indexOf('.');
  if (dot <= 0 || dot !== t.lastIndexOf('.')) invalid();
  const payload = t.slice(0, dot);
  const signature = t.slice(dot + 1);
  if (!/^[0-9a-f]{64}$/.test(signature)) invalid();
  if (!safeEqual(signature, ctx.s.crypto.hmacSha256Hex(secret, payload))) invalid();

  const json = base64UrlDecode(payload);
  if (json === null) return invalid();
  let claims: unknown;
  try {
    claims = JSON.parse(json);
  } catch {
    return invalid();
  }
  if (!isRecord(claims)) return invalid();
  const { e, v: version, x } = claims;
  if (typeof e !== 'string' || !isEmail(e) || typeof x !== 'number' || !Number.isFinite(x)) return invalid();
  if (x * 1000 <= ctx.now.getTime()) fail('UNAUTHORIZED', 'Your session has expired. Please sign in again.');
  if (String(version) !== ctx.m.settings().tokenVersion) invalid();
  return e;
}
