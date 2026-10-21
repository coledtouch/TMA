/**
 * Notification preferences: defaults, sanitizing, and audience matching (§6).
 */
import type {
  Audience,
  NotificationChannel,
  NotificationPrefs,
  NotificationTopic,
  Student,
} from '../shared/types';
import type { Ctx } from './context';
import type { AppSettings } from './settings';
import { canonical, intersects, isKnown, isRecord, uniqueBy } from './util';

export const CHANNELS: readonly NotificationChannel[] = ['push', 'email', 'sms'];
export const TOPICS: readonly NotificationTopic[] = ['balance', 'payments', 'reminders', 'announcements'];

const DEFAULT_CHANNELS: Readonly<Record<NotificationChannel, boolean>> = { push: true, email: true, sms: false };

/** Keep only names from `known`, in their canonical spelling, without duplicates. */
export function knownOnly(values: readonly string[], known: readonly string[]): string[] {
  return uniqueBy(
    values.filter((v) => isKnown(v, known)).map((v) => canonical(v, known)),
    (v) => v,
  );
}

/** Defaults: push+email on, all topics, interests = union of the household's students' schools/ensembles. */
export function defaultPrefs(students: readonly Student[], settings: AppSettings): NotificationPrefs {
  const schools: string[] = [];
  const ensembles: string[] = [];
  for (const s of students) {
    if (s.status === 'Inactive') continue;
    if (s.school) schools.push(s.school);
    ensembles.push(...s.ensembles);
  }
  return {
    channels: { ...DEFAULT_CHANNELS },
    topics: { balance: true, payments: true, reminders: true, announcements: true },
    schools: knownOnly(schools, settings.pub.schools),
    ensembles: knownOnly(ensembles, settings.pub.ensembles),
  };
}

function stringList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter((v): v is string => typeof v === 'string').slice(0, 50);
}

/**
 * A US/Canada (NANP) mobile number as digits: 10 digits, or 11 starting with 1, with a valid area
 * code and exchange. Texts cost TMA money, so international and premium-rate numbers are refused.
 */
const SMS_PHONE_RE = /^1?[2-9]\d{2}[2-9]\d{6}$/;

/**
 * Sanitize prefs from the browser or the Preferences tab. Unknown or missing
 * fields fall back to `fallback`; schools/ensembles must be in Settings;
 * smsPhone keeps digits only (a US number, see SMS_PHONE_RE) or is dropped; sms needs SMS_ENABLED and a phone.
 */
export function sanitizePrefs(input: unknown, settings: AppSettings, fallback: NotificationPrefs): NotificationPrefs {
  const src = isRecord(input) ? input : {};
  const channelsIn = isRecord(src.channels) ? src.channels : {};
  const topicsIn = isRecord(src.topics) ? src.topics : {};
  const bool = (value: unknown, dflt: boolean) => (typeof value === 'boolean' ? value : dflt);

  const channels = {} as Record<NotificationChannel, boolean>;
  for (const c of CHANNELS) channels[c] = bool(channelsIn[c], fallback.channels[c]);
  const topics = {} as Record<NotificationTopic, boolean>;
  for (const t of TOPICS) topics[t] = bool(topicsIn[t], fallback.topics[t]);

  const schoolsIn = stringList(src.schools);
  const ensemblesIn = stringList(src.ensembles);
  const prefs: NotificationPrefs = {
    channels,
    topics,
    schools: schoolsIn ? knownOnly(schoolsIn, settings.pub.schools) : fallback.schools.slice(),
    ensembles: ensemblesIn ? knownOnly(ensemblesIn, settings.pub.ensembles) : fallback.ensembles.slice(),
  };

  const phoneIn: unknown = src.smsPhone === undefined ? fallback.smsPhone : src.smsPhone;
  const digits = typeof phoneIn === 'string' || typeof phoneIn === 'number' ? String(phoneIn).replace(/\D/g, '') : '';
  if (SMS_PHONE_RE.test(digits)) prefs.smsPhone = digits;

  if (!settings.smsSetting || !prefs.smsPhone) prefs.channels.sms = false;
  return prefs;
}

/**
 * §6 audience rule. Audience both empty -> everyone. Prefs both empty -> everything.
 * Both audience lists set -> need a school match AND an ensemble match.
 * One audience list set -> a match on that list suffices.
 */
export function audienceMatches(audience: Audience, prefs: Pick<NotificationPrefs, 'schools' | 'ensembles'>): boolean {
  const { schools, ensembles } = audience;
  if (schools.length === 0 && ensembles.length === 0) return true;
  if (prefs.schools.length === 0 && prefs.ensembles.length === 0) return true;
  if (schools.length > 0 && ensembles.length > 0) {
    return intersects(schools, prefs.schools) && intersects(ensembles, prefs.ensembles);
  }
  return schools.length > 0 ? intersects(schools, prefs.schools) : intersects(ensembles, prefs.ensembles);
}

/** Defaults for an email: from its household's students (empty interests without a household). */
export function defaultPrefsFor(ctx: Ctx, email: string): NotificationPrefs {
  const family = ctx.m.familyForEmail(email);
  const students = family && family.status !== 'Inactive' ? ctx.m.studentsOfFamily(family.id) : [];
  return defaultPrefs(students, ctx.m.settings());
}

/** Stored prefs for an email (sanitized against current Settings), else the defaults. */
export function prefsFor(ctx: Ctx, email: string): NotificationPrefs {
  const fallback = defaultPrefsFor(ctx, email);
  const stored = ctx.m.preferences().get(email);
  if (!stored || !stored.json) return fallback;
  let parsed: unknown;
  try {
    parsed = JSON.parse(stored.json);
  } catch {
    return fallback;
  }
  return isRecord(parsed) ? sanitizePrefs(parsed, ctx.m.settings(), fallback) : fallback;
}
