/**
 * Passwordless sign-in (ARCHITECTURE.md §4): 6-digit email codes and signed
 * session tokens `base64url(JSON{e,v,x}).hmacHex`.
 */
import type { IsoDateTime } from '../shared/types';
import type { Ctx } from './context';
import { rateLimit } from './context';
import { renderEmail } from './email';
import { ApiError, badRequest, fail } from './errors';
import * as v from './validate';
import { base64UrlDecode, base64UrlEncode, errorMessage, isEmail, isRecord, safeEqual } from './util';

const CODE_TTL_SECONDS = 600;
const MAX_CODE_ATTEMPTS = 5;
const CODES_PER_HOUR = 5;
const MAX_TOKEN_LENGTH = 2048;

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

/** auth.requestCode: always answers {sent:true}; anyone may sign up with any email. */
export function requestCode(ctx: Ctx, params: v.Params): { sent: true; devCode?: string } {
  const email = v.email(params.email);
  const secret = requireSecret(ctx);
  rateLimit(ctx, `otp-rl:${email}`, CODES_PER_HOUR, 3600, 'Too many codes requested for this email. Please wait an hour and try again.');

  const code = ctx.s.crypto.randomDigits(6);
  if (!/^\d{6}$/.test(code)) throw new Error('randomDigits returned an invalid code');
  const entry: OtpEntry = { h: otpHash(ctx, secret, email, code), a: 0, x: ctx.now.getTime() + CODE_TTL_SECONDS * 1000 };
  ctx.s.cache.put(`otp:${email}`, JSON.stringify(entry), CODE_TTL_SECONDS);

  if (ctx.s.mode === 'demo') return { sent: true, devCode: code };

  const settings = ctx.m.settings();
  let quota = 0;
  try {
    quota = ctx.s.mailer.remainingQuota();
  } catch (err) {
    ctx.s.logger.error('remainingQuota failed', errorMessage(err));
  }
  if (quota <= 0) {
    fail('RATE_LIMITED', "TMA has reached today's email limit. Please try again tomorrow or contact TMA.");
  }
  const { html, text } = renderEmail({
    orgName: settings.pub.orgName,
    title: 'Your sign-in code',
    body: 'Enter this code in the TMA app to sign in. It expires in 10 minutes.',
    code,
    appUrl: '',
    footer: "Someone asked to sign in to the TMA app with this email address. If it wasn't you, you can ignore this email.",
  });
  try {
    ctx.s.mailer.send({ to: email, subject: `Your TMA sign-in code: ${code}`, html, text });
  } catch (err) {
    ctx.s.logger.error('Could not send sign-in code', errorMessage(err));
    fail('INTERNAL', "We couldn't send the email right now. Please try again in a few minutes.");
  }
  return { sent: true };
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
