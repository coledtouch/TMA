/**
 * Per-user settings: notification prefs and push devices.
 */
import { TABLES } from '../shared/schema';
import type { DeliveryCounts, NotificationPrefs } from '../shared/types';
import type { Ctx } from './context';
import { rateLimit } from './context';
import type { DeviceRec } from './data';
import { badRequest } from './errors';
import { testNotice } from './messages';
import { deliver } from './notify';
import { prefsFor, sanitizePrefs } from './prefs';
import { cleanText, isRecord } from './util';
import * as v from './validate';

const MAX_DEVICES_PER_EMAIL = 10;
const TOKEN_RE = /^[A-Za-z0-9_:.\-]{20,4096}$/;
const DEVICE_COLUMNS = TABLES.Devices.headers;

/** prefs.save: sanitize and upsert the caller's Preferences row. Omitted fields keep their current value. */
export function savePrefs(ctx: Ctx, email: string, params: v.Params): { prefs: NotificationPrefs } {
  if (!isRecord(params.prefs)) badRequest('Preferences are missing.');
  const input = params.prefs as Record<string, unknown>;
  for (const [key, label] of [
    ['schools', 'Schools'],
    ['ensembles', 'Groups'],
  ] as const) {
    if (input[key] !== undefined && !Array.isArray(input[key])) badRequest(`${label} must be a list.`);
  }
  const prefs = sanitizePrefs(input, ctx.m.settings(), prefsFor(ctx, email));

  const family = ctx.m.familyForEmail(email);
  const row = {
    Email: email,
    FamilyID: family ? family.id : '',
    Prefs: JSON.stringify(prefs),
    Updated: ctx.now,
  };
  const existing = ctx.m.preferences().get(email);
  if (existing) ctx.db.update('Preferences', existing.row, row);
  else ctx.db.append('Preferences', [row]);
  return { prefs: prefsFor(ctx, email) };
}

function parseToken(value: unknown): string {
  if (typeof value !== 'string') return badRequest('Device token is missing.');
  const token = value.trim();
  if (!TOKEN_RE.test(token)) badRequest('Device token is invalid.');
  return token;
}

function lastSeenMs(d: DeviceRec): number {
  const t = Date.parse(d.lastSeen ?? d.createdAt ?? '');
  return Number.isNaN(t) ? 0 : t;
}

/** push.register: upsert by token; keep at most 10 devices per email (drop the least recently seen). */
export function registerDevice(ctx: Ctx, email: string, params: v.Params): { devices: number } {
  const token = parseToken(params.token);
  const userAgent = typeof params.userAgent === 'string' ? cleanText(params.userAgent).slice(0, v.LIMITS.userAgent) : '';
  rateLimit(ctx, `push-rl:${email}`, 30, 3600, 'Too many device registrations. Please try again later.');

  const family = ctx.m.familyForEmail(email);
  const familyId = family && family.status !== 'Inactive' ? family.id : '';
  const matches = ctx.m.devices().filter((d) => d.token === token);
  if (matches.length > 0) {
    const [first, ...duplicates] = matches;
    ctx.db.update('Devices', first.row, { Email: email, FamilyID: familyId, 'User Agent': userAgent, 'Last Seen': ctx.now });
    for (const d of duplicates) ctx.db.clear('Devices', d.row, DEVICE_COLUMNS);
  } else {
    ctx.db.append('Devices', [
      { Email: email, FamilyID: familyId, Token: token, 'User Agent': userAgent, Created: ctx.now, 'Last Seen': ctx.now },
    ]);
  }

  const mine = ctx.m.devicesFor(email);
  if (mine.length > MAX_DEVICES_PER_EMAIL) {
    const oldest = mine
      .filter((d) => d.token !== token)
      .sort((a, b) => lastSeenMs(a) - lastSeenMs(b) || a.row - b.row)
      .slice(0, mine.length - MAX_DEVICES_PER_EMAIL);
    for (const d of oldest) ctx.db.clear('Devices', d.row, DEVICE_COLUMNS);
  }
  return { devices: ctx.m.devicesFor(email).length };
}

/** push.unregister: remove the caller's own device row(s) with that token. */
export function unregisterDevice(ctx: Ctx, email: string, params: v.Params): { devices: number } {
  if (typeof params.token !== 'string' || params.token.trim() === '' || params.token.length > v.LIMITS.token) {
    badRequest('Device token is missing.');
  }
  const token = (params.token as string).trim();
  for (const d of ctx.m.devicesFor(email)) {
    if (d.token === token) ctx.db.clear('Devices', d.row, DEVICE_COLUMNS);
  }
  return { devices: ctx.m.devicesFor(email).length };
}

/** push.test: a test push to the caller's own devices, regardless of prefs. */
export function testPush(ctx: Ctx, email: string): DeliveryCounts {
  rateLimit(ctx, `push-test-rl:${email}`, 10, 3600, 'Too many test notifications. Please try again later.');
  return deliver(ctx, [email], testNotice(), { channels: { push: true, email: false, sms: false }, ignorePrefs: true });
}

