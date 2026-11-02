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
import { parseSubscription, subscriptionEndpoint, subscriptionToken } from './push-subscription';
import { cleanText, isRecord } from './util';
import * as v from './validate';

const MAX_DEVICES_PER_EMAIL = 10;
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

/** Demo-mode device tokens (the browser demo has no real push service). */
const DEMO_TOKEN_RE = /^demo-[A-Za-z0-9_.:-]{8,200}$/;

/** A device as push.register/unregister identify it: by subscription endpoint, or by the demo token itself. */
interface DeviceKey {
  /** What Devices.Token holds for this device. */
  token: string;
  /** Canonical subscription endpoint; null for demo tokens. */
  endpoint: string | null;
}

function tokenText(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') return badRequest('Device token is missing.');
  if (value.length > v.LIMITS.token) badRequest('Device token is invalid.');
  return value.trim();
}

function demoKey(ctx: Ctx, text: string): DeviceKey | null {
  return ctx.s.mode === 'demo' && DEMO_TOKEN_RE.test(text) ? { token: text, endpoint: null } : null;
}

/** push.register input: a browser PushSubscription as JSON (or, in the demo only, a "demo-…" token). */
function registrationKey(ctx: Ctx, value: unknown): DeviceKey {
  const text = tokenText(value);
  const demo = demoKey(ctx, text);
  if (demo) return demo;
  const parsed = parseSubscription(text);
  if (!parsed.ok) {
    if (parsed.problem === 'push_service') {
      badRequest("This browser's push service isn't supported. Try Chrome, Safari, Firefox or Edge.");
    }
    badRequest('Device token is invalid.');
  }
  const { subscription } = parsed;
  return { token: subscriptionToken(subscription), endpoint: subscription.endpoint };
}

/** push.unregister input: the stored token or the browser's subscription JSON (only its endpoint matters). */
function unregistrationKey(ctx: Ctx, value: unknown): DeviceKey {
  const text = tokenText(value);
  const demo = demoKey(ctx, text);
  if (demo) return demo;
  const endpoint = subscriptionEndpoint(text);
  if (!endpoint) badRequest('Device token is invalid.');
  return { token: text, endpoint };
}

/** Whether a Devices row is the device `key` names (same endpoint, whatever its keys; or the same demo token). */
function sameDevice(key: DeviceKey): (d: DeviceRec) => boolean {
  if (key.endpoint === null) return (d) => d.token === key.token;
  const endpoint = key.endpoint;
  return (d) => subscriptionEndpoint(d.token) === endpoint;
}

function lastSeenMs(d: DeviceRec): number {
  const t = Date.parse(d.lastSeen ?? d.createdAt ?? '');
  return Number.isNaN(t) ? 0 : t;
}

/**
 * push.register: upsert by subscription endpoint (a browser that re-subscribes
 * with new keys updates its row); keep at most 10 devices per email (drop the
 * least recently seen). A device moves to the caller when someone else signs
 * in on it.
 */
export function registerDevice(ctx: Ctx, email: string, params: v.Params): { devices: number } {
  const key = registrationKey(ctx, params.token);
  const userAgent = typeof params.userAgent === 'string' ? cleanText(params.userAgent).slice(0, v.LIMITS.userAgent) : '';
  rateLimit(ctx, `push-rl:${email}`, 30, 3600, 'Too many device registrations. Please try again later.');

  const family = ctx.m.familyForEmail(email);
  const familyId = family && family.status !== 'Inactive' ? family.id : '';
  const isThisDevice = sameDevice(key);
  const matches = ctx.m.devices().filter(isThisDevice);
  if (matches.length > 0) {
    const [first, ...duplicates] = matches;
    ctx.db.update('Devices', first.row, {
      Email: email,
      FamilyID: familyId,
      Token: key.token,
      'User Agent': userAgent,
      'Last Seen': ctx.now,
    });
    for (const d of duplicates) ctx.db.clear('Devices', d.row, DEVICE_COLUMNS);
  } else {
    ctx.db.append('Devices', [
      { Email: email, FamilyID: familyId, Token: key.token, 'User Agent': userAgent, Created: ctx.now, 'Last Seen': ctx.now },
    ]);
  }

  const mine = ctx.m.devicesFor(email);
  if (mine.length > MAX_DEVICES_PER_EMAIL) {
    const oldest = mine
      .filter((d) => !isThisDevice(d))
      .sort((a, b) => lastSeenMs(a) - lastSeenMs(b) || a.row - b.row)
      .slice(0, mine.length - MAX_DEVICES_PER_EMAIL);
    for (const d of oldest) ctx.db.clear('Devices', d.row, DEVICE_COLUMNS);
  }
  return { devices: ctx.m.devicesFor(email).length };
}

/** push.unregister: remove the caller's own row(s) for that device (matched by endpoint). */
export function unregisterDevice(ctx: Ctx, email: string, params: v.Params): { devices: number } {
  const isThisDevice = sameDevice(unregistrationKey(ctx, params.token));
  for (const d of ctx.m.devicesFor(email)) {
    if (isThisDevice(d)) ctx.db.clear('Devices', d.row, DEVICE_COLUMNS);
  }
  return { devices: ctx.m.devicesFor(email).length };
}

/** push.test: a test push to the caller's own devices, regardless of prefs. */
export function testPush(ctx: Ctx, email: string): DeliveryCounts {
  rateLimit(ctx, `push-test-rl:${email}`, 10, 3600, 'Too many test notifications. Please try again later.');
  return deliver(ctx, [email], testNotice(), { channels: { push: true, email: false, sms: false }, ignorePrefs: true });
}

