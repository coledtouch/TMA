/**
 * iCalendar (RFC 5545) reader for linked calendars given as iCal (.ics) links
 * (ARCHITECTURE.md §7 "Linked calendars"). Pure and synchronous, so the same
 * code runs in Apps Script (src/gas/calendar.ts fetches the file), the demo and
 * the tests.
 *
 * What it understands: line unfolding; text escapes; VEVENTs (nested
 * components such as VALARM are ignored); DTSTART/DTEND/DURATION as all-day
 * dates (VALUE=DATE), UTC times ("Z"), times with a TZID, and floating times
 * (the calendar's X-WR-TIMEZONE, else New York), and a TZID no resolver
 * knows read from the file's own VTIMEZONE when it describes a US zone (Outlook
 * writes names like "(UTC-05:00) Eastern Time (US & Canada)"); SUMMARY, LOCATION,
 * DESCRIPTION, UID, STATUS:CANCELLED, CLASS:PRIVATE/CONFIDENTIAL (also for the
 * changed occurrences of a private series); repeating
 * events (RRULE FREQ=DAILY/WEEKLY/MONTHLY/YEARLY with INTERVAL, COUNT, UNTIL,
 * BYDAY, WKST, and for MONTHLY/YEARLY also BYMONTHDAY, BYMONTH, BYSETPOS),
 * RDATE and EXDATE; and RECURRENCE-ID overrides (a moved, renamed or cancelled
 * occurrence). Anything else that changes when an event happens (other RRULE
 * parts, an unknown time zone, PERIOD dates…) is skipped and counted in
 * `unsupported`, never guessed.
 */
import type { CalendarEvent, CalendarFeed, CalendarTime } from './services';
import { isoDate, nyLocalToDate } from './util';

export interface WallClock {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/**
 * UTC milliseconds of a wall-clock time in a time zone (an IANA name such as America/New_York, or
 * "UTC"), or null when the zone isn't known. Apps Script resolves any IANA zone with Utilities;
 * basicZones knows UTC and New York only.
 */
export type ZoneResolver = (zone: string, wall: WallClock) => number | null;

export interface IcsOptions {
  range: { start: Date; end: Date };
  /** Return at most this many events (the soonest); `capped` says when there were more. */
  maxEvents: number;
  zones: ZoneResolver;
  /** Zone for floating times when the calendar names none (X-WR-TIMEZONE). Default America/New_York. */
  defaultZone?: string;
}

export interface IcsResult extends CalendarFeed {
  /** BEGIN:VCALENDAR blocks found: 0 means the text isn't a calendar at all. */
  calendars: number;
}

const NEW_YORK = 'America/New_York';
const DAY_MS = 86400000;
/** Hard limits, so a huge or hostile file can't run away with the script's time. */
const MAX_LINES = 200000;
const MAX_VEVENTS = 20000;
const MAX_VTIMEZONES = 100;
/** Repeat periods for one series. */
const MAX_PERIODS = 50000;
/** Repeat periods and candidate days for the whole file: past it, the remaining series are left out. */
const MAX_WORK = 500000;
const MAX_COLLECTED = 20000;
const MAX_TEXT = 20000;

const NY_ALIASES = new Set(['america/new_york', 'us/eastern', 'est5edt', 'america/detroit', 'america/toronto', 'america/montreal']);
const UTC_NAMES = /^(utc|gmt|z|zulu|universal|etc\/(utc|gmt|zulu|universal|gmt[+-]0))$/i;
/** Windows zone names some calendar programs write as TZID. */
const WINDOWS_ZONES: Readonly<Record<string, string>> = {
  'eastern standard time': NEW_YORK,
  'us eastern standard time': 'America/Indiana/Indianapolis',
  'central standard time': 'America/Chicago',
  'mountain standard time': 'America/Denver',
  'us mountain standard time': 'America/Phoenix',
  'pacific standard time': 'America/Los_Angeles',
  'atlantic standard time': 'America/Halifax',
  'alaskan standard time': 'America/Anchorage',
  'hawaiian standard time': 'Pacific/Honolulu',
  'gmt standard time': 'Europe/London',
};

/** Windows display names ("(UTC-05:00) Eastern Time (US & Canada)") Outlook writes as TZID. */
const DISPLAY_ZONES: ReadonlyArray<readonly [RegExp, string]> = [
  [/\beastern time \(us (?:&|and) canada\)/i, NEW_YORK],
  [/\bcentral time \(us (?:&|and) canada\)/i, 'America/Chicago'],
  [/\bmountain time \(us (?:&|and) canada\)/i, 'America/Denver'],
  [/\bpacific time \(us (?:&|and) canada\)/i, 'America/Los_Angeles'],
  [/\batlantic time \(canada\)/i, 'America/Halifax'],
  [/\bindiana \(east\)/i, 'America/Indiana/Indianapolis'],
  [/^\((?:utc|gmt)-07:00\) arizona$/i, 'America/Phoenix'],
  [/^\((?:utc|gmt)-09:00\) alaska$/i, 'America/Anchorage'],
  [/^\((?:utc|gmt)-10:00\) hawaii$/i, 'Pacific/Honolulu'],
];

/** UTC and New York only (the demo and tests can pass a fuller resolver). */
export const basicZones: ZoneResolver = (zone, w) => {
  if (zone === 'UTC') return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  if (NY_ALIASES.has(zone.toLowerCase())) return nyLocalToDate(w.year, w.month, w.day, w.hour, w.minute, w.second).getTime();
  return null;
};

/**
 * A TZID as written -> the zone name to resolve: "UTC" for the UTC spellings, the IANA name for
 * Windows names and display names, and for prefixed ids like "/mozilla.org/20070129_1/America/New_York".
 */
export function normalizeTzid(raw: string): string {
  const s = raw.replace(/^"|"$/g, '').trim();
  if (UTC_NAMES.test(s)) return 'UTC';
  const windows = WINDOWS_ZONES[s.toLowerCase()];
  if (windows) return windows;
  const display = DISPLAY_ZONES.find(([re]) => re.test(s));
  if (display) return display[1];
  const m = /([A-Za-z]+\/[A-Za-z0-9_+-]+(?:\/[A-Za-z0-9_+-]+)?)$/.exec(s);
  return m ? m[1] : s;
}

/** Whether text looks like an iCalendar file (cheap check before parsing). */
export function looksLikeIcs(text: string): boolean {
  return /^\s*(﻿)?BEGIN:VCALENDAR/i.test(text.slice(0, 2000)) || /\nBEGIN:VCALENDAR/i.test(text.slice(0, 2000));
}

// ---------------------------------------------------------------------------
// The file's own time zones (VTIMEZONE)
// ---------------------------------------------------------------------------

export interface VTimezonePart {
  kind: 'STANDARD' | 'DAYLIGHT';
  /** DTSTART as written (YYYYMMDDTHHMMSS), to find the rule in force now. */
  start: string;
  /** TZOFFSETTO in minutes east of UTC. */
  offset: number | null;
  /** RRULE as written, upper-case ('' = none). */
  rule: string;
}

export interface VTimezone {
  tzid: string;
  parts: VTimezonePart[];
}

/** When a zone is checked for being known at all. */
const PROBE: WallClock = { year: 2026, month: 1, day: 1, hour: 12, minute: 0, second: 0 };
/** US and Canadian zones on today's daylight-saving rules, by standard-time offset (minutes). */
const US_DST_ZONES: Readonly<Record<string, string>> = {
  '-240': 'America/Halifax',
  '-300': NEW_YORK,
  '-360': 'America/Chicago',
  '-420': 'America/Denver',
  '-480': 'America/Los_Angeles',
  '-540': 'America/Anchorage',
};
/** Zones without daylight saving, by offset. */
const NO_DST_ZONES: Readonly<Record<string, string>> = { '0': 'UTC', '-420': 'America/Phoenix', '-600': 'Pacific/Honolulu' };

/** "-0500" or "-050000" -> minutes east of UTC. */
function parseOffset(value: string): number | null {
  const m = /^([+-])(\d{2})(\d{2})(\d{2})?$/.exec(value.trim());
  if (!m) return null;
  const minutes = +m[2] * 60 + +m[3];
  return m[1] === '-' ? -minutes : minutes;
}

/** A yearly rule on one day of one month, with no end (e.g. FREQ=YEARLY;BYMONTH=11;BYDAY=1SU). */
function isYearlyRule(rule: string, month: number, byDay: string): boolean {
  const parts = new Map<string, string>();
  for (const piece of rule.split(';')) {
    const eq = piece.indexOf('=');
    if (eq > 0) parts.set(piece.slice(0, eq).trim(), piece.slice(eq + 1).trim());
  }
  for (const key of parts.keys()) if (!['FREQ', 'INTERVAL', 'BYMONTH', 'BYDAY', 'WKST'].includes(key)) return false;
  return (
    parts.get('FREQ') === 'YEARLY' &&
    (parts.get('INTERVAL') ?? '1') === '1' &&
    parts.get('BYMONTH') === String(month) &&
    (parts.get('BYDAY') ?? '').replace(/^\+/, '') === byDay
  );
}

/**
 * The IANA zone a VTIMEZONE describes, for a TZID no resolver knows (Outlook writes names like
 * "Custom Time Zone"): a US or Canadian zone on today's rules (daylight saving from the 2nd Sunday
 * of March to the 1st Sunday of November, one hour ahead), or UTC, Arizona or Hawaii (none).
 * Anything else: null, and its events stay unreadable, never guessed.
 */
export function zoneFromVtimezone(tz: VTimezone): string | null {
  const latest = (kind: VTimezonePart['kind']) =>
    tz.parts.filter((p) => p.kind === kind).reduce<VTimezonePart | null>((a, b) => (a === null || b.start > a.start ? b : a), null);
  const standard = latest('STANDARD');
  const daylight = latest('DAYLIGHT');
  if (!standard || standard.offset === null) return null;
  if (!daylight || (daylight.offset === standard.offset && !daylight.rule && !standard.rule)) {
    return NO_DST_ZONES[String(standard.offset)] ?? null;
  }
  if (daylight.offset !== standard.offset + 60) return null;
  if (!isYearlyRule(standard.rule, 11, '1SU') || !isYearlyRule(daylight.rule, 3, '2SU')) return null;
  return US_DST_ZONES[String(standard.offset)] ?? null;
}

/** `zones`, also resolving the TZIDs it doesn't know that one of the file's VTIMEZONEs explains. */
function withFileZones(zones: ZoneResolver, timezones: readonly VTimezone[]): ZoneResolver {
  const aliases = new Map<string, string>();
  for (const tz of timezones) {
    const name = normalizeTzid(tz.tzid);
    if (!name || aliases.has(name) || zones(name, PROBE) !== null) continue;
    const zone = zoneFromVtimezone(tz);
    if (zone && zones(zone, PROBE) !== null) aliases.set(name, zone);
  }
  return aliases.size === 0 ? zones : (zone, wall) => zones(aliases.get(zone) ?? zone, wall);
}

// ---------------------------------------------------------------------------
// Lines
// ---------------------------------------------------------------------------

interface Prop {
  name: string;
  params: Record<string, string>;
  value: string;
}

/** RFC 5545 §3.1: a line starting with a space or tab continues the previous one. */
export function unfoldLines(text: string): string[] {
  const raw = text.replace(/^﻿/, '').split(/\r\n|\r|\n/);
  const out: string[] = [];
  for (const line of raw) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && out.length > 0) out[out.length - 1] += line.slice(1);
    else out.push(line);
    if (out.length > MAX_LINES) break;
  }
  return out;
}

/** "NAME;PARAM=a;Q=\"x:y\":value" -> {name, params, value}; null when there is no ":". */
export function parseContentLine(line: string): Prop | null {
  let i = 0;
  while (i < line.length && line[i] !== ';' && line[i] !== ':') i++;
  if (i >= line.length) return null;
  const name = line.slice(0, i).trim().toUpperCase();
  if (!name) return null;
  const params: Record<string, string> = {};
  while (line[i] === ';') {
    i++;
    const eq = line.indexOf('=', i);
    if (eq < 0) return null;
    const key = line.slice(i, eq).trim().toUpperCase();
    i = eq + 1;
    let value = '';
    while (i < line.length && line[i] !== ';' && line[i] !== ':') {
      if (line[i] === '"') {
        const close = line.indexOf('"', i + 1);
        if (close < 0) return null;
        value += line.slice(i + 1, close);
        i = close + 1;
      } else {
        value += line[i];
        i++;
      }
    }
    if (key) params[key] = value;
  }
  if (line[i] !== ':') return null;
  return { name, params, value: line.slice(i + 1) };
}

/** TEXT value escapes: \\ \; \, \n \N. */
export function unescapeText(value: string): string {
  return value.replace(/\\([\\;,nN])/g, (_, c: string) => (c === 'n' || c === 'N' ? '\n' : c));
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

type DateValue =
  | { kind: 'date'; days: number }
  /** zone: 'UTC', a zone name, or '' for floating (the calendar's default zone). */
  | { kind: 'time'; days: number; h: number; mi: number; s: number; zone: string };

function toDays(year: number, month: number, day: number): number {
  return Math.floor(Date.UTC(year, month - 1, day) / DAY_MS);
}

function fromDays(days: number): { year: number; month: number; day: number } {
  const d = new Date(days * DAY_MS);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

function dayText(days: number): string {
  const p = fromDays(days);
  return isoDate(p.year, p.month, p.day);
}

/** 0 = Sunday … 6 = Saturday. */
function weekday(days: number): number {
  return ((days % 7) + 11) % 7;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

const DATE_RE = /^(\d{4})(\d{2})(\d{2})$/;
const DATETIME_RE = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/i;

function validYmd(y: number, m: number, d: number): boolean {
  return y >= 1900 && y <= 2200 && m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
}

/** One DATE or DATE-TIME value; `params` gives VALUE and TZID. null = unreadable. */
function parseDateValue(text: string, params: Record<string, string>): DateValue | null {
  const value = text.trim();
  const date = DATE_RE.exec(value);
  if (date) {
    if (!validYmd(+date[1], +date[2], +date[3])) return null;
    return { kind: 'date', days: toDays(+date[1], +date[2], +date[3]) };
  }
  if ((params.VALUE ?? '').toUpperCase() === 'DATE') return null;
  const m = DATETIME_RE.exec(value);
  if (!m) return null;
  const [y, mo, d, h, mi] = [+m[1], +m[2], +m[3], +m[4], +m[5]];
  const s = Math.min(59, +m[6]);
  if (!validYmd(y, mo, d) || h > 23 || mi > 59) return null;
  const zone = m[7] ? 'UTC' : params.TZID ? normalizeTzid(params.TZID) : '';
  return { kind: 'time', days: toDays(y, mo, d), h, mi, s, zone };
}

/** Comma-separated list of dates (EXDATE, RDATE). PERIOD values (with "/") count as unreadable. */
function parseDateList(text: string, params: Record<string, string>): { values: DateValue[]; bad: number } {
  const values: DateValue[] = [];
  let bad = 0;
  for (const part of text.split(',')) {
    if (!part.trim()) continue;
    const v = part.includes('/') ? null : parseDateValue(part, params);
    if (v) values.push(v);
    else bad++;
  }
  return { values, bad };
}

/** ISO 8601 duration as in RFC 5545 (P1W, P2D, PT1H30M, P1DT2H). null = unreadable. */
function parseDuration(text: string): { days: number; ms: number } | null {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i.exec(text.trim());
  if (!m || text.trim().toUpperCase() === 'P' || /T$/i.test(text.trim())) return null;
  const sign = m[1] === '-' ? -1 : 1;
  const days = (Number(m[2] ?? 0) * 7 + Number(m[3] ?? 0)) * sign;
  const ms = ((Number(m[4] ?? 0) * 60 + Number(m[5] ?? 0)) * 60 + Number(m[6] ?? 0)) * 1000 * sign;
  return { days, ms };
}

// ---------------------------------------------------------------------------
// Repeat rules
// ---------------------------------------------------------------------------

type Freq = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
const WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

interface Rule {
  freq: Freq;
  interval: number;
  count?: number;
  until?: DateValue;
  byDay?: Array<{ ord: number; wd: number }>;
  byMonthDay?: number[];
  byMonth?: number[];
  bySetPos?: number[];
  wkst: number;
}

function intList(value: string, min: number, max: number): number[] | null {
  const out: number[] = [];
  for (const part of value.split(',')) {
    if (!/^[+-]?\d{1,3}$/.test(part.trim())) return null;
    const n = parseInt(part, 10);
    if (n === 0 || Math.abs(n) < min || Math.abs(n) > max) return null;
    out.push(n);
  }
  return out.length ? out : null;
}

/** RRULE value -> Rule, or null when it uses anything this reader doesn't handle. */
export function parseRule(value: string): Rule | null {
  const parts = new Map<string, string>();
  for (const piece of value.split(';')) {
    if (!piece.trim()) continue;
    const eq = piece.indexOf('=');
    if (eq < 0) return null;
    const key = piece.slice(0, eq).trim().toUpperCase();
    if (parts.has(key)) return null;
    parts.set(key, piece.slice(eq + 1).trim().toUpperCase());
  }
  const freq = parts.get('FREQ') as Freq | undefined;
  if (!freq || !['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(freq)) return null;
  const known = new Set(['FREQ', 'INTERVAL', 'COUNT', 'UNTIL', 'BYDAY', 'BYMONTHDAY', 'BYMONTH', 'BYSETPOS', 'WKST']);
  for (const key of parts.keys()) if (!known.has(key)) return null;
  if (parts.has('COUNT') && parts.has('UNTIL')) return null;

  const rule: Rule = { freq, interval: 1, wkst: 1 };
  const interval = parts.get('INTERVAL');
  if (interval !== undefined) {
    if (!/^\d{1,4}$/.test(interval) || +interval < 1) return null;
    rule.interval = +interval;
  }
  const count = parts.get('COUNT');
  if (count !== undefined) {
    if (!/^\d{1,6}$/.test(count) || +count < 1) return null;
    rule.count = +count;
  }
  const until = parts.get('UNTIL');
  if (until !== undefined) {
    const parsed = parseDateValue(until, {});
    if (!parsed) return null;
    rule.until = parsed;
  }
  const wkst = parts.get('WKST');
  if (wkst !== undefined) {
    const wd = WEEKDAYS.indexOf(wkst);
    if (wd < 0) return null;
    rule.wkst = wd;
  }
  const byDay = parts.get('BYDAY');
  if (byDay !== undefined) {
    const list: Array<{ ord: number; wd: number }> = [];
    for (const part of byDay.split(',')) {
      const m = /^([+-]?\d{1,2})?(SU|MO|TU|WE|TH|FR|SA)$/.exec(part.trim());
      if (!m) return null;
      const ord = m[1] ? parseInt(m[1], 10) : 0;
      if (m[1] && (ord === 0 || Math.abs(ord) > 5)) return null;
      list.push({ ord, wd: WEEKDAYS.indexOf(m[2]) });
    }
    // "2nd Tuesday" only makes sense within a month.
    if (list.some((d) => d.ord !== 0) && freq !== 'MONTHLY' && !(freq === 'YEARLY' && parts.has('BYMONTH'))) return null;
    rule.byDay = list;
  }
  const byMonthDay = parts.get('BYMONTHDAY');
  if (byMonthDay !== undefined) {
    if (freq === 'DAILY' || freq === 'WEEKLY') return null;
    const list = intList(byMonthDay, 1, 31);
    if (!list) return null;
    if (rule.byDay?.some((d) => d.ord !== 0)) return null;
    rule.byMonthDay = list;
  }
  const byMonth = parts.get('BYMONTH');
  if (byMonth !== undefined) {
    if (freq !== 'YEARLY') return null;
    const list = intList(byMonth, 1, 12);
    if (!list || list.some((n) => n < 0)) return null;
    rule.byMonth = list.sort((a, b) => a - b);
  }
  if (freq === 'YEARLY' && !rule.byMonth && (rule.byDay || rule.byMonthDay)) return null;
  const bySetPos = parts.get('BYSETPOS');
  if (bySetPos !== undefined) {
    if (freq !== 'MONTHLY' && !(freq === 'YEARLY' && rule.byMonth?.length === 1)) return null;
    if (!rule.byDay && !rule.byMonthDay) return null;
    const list = intList(bySetPos, 1, 31);
    if (!list) return null;
    rule.bySetPos = list;
  }
  return rule;
}

/** The days (as day numbers) a MONTHLY/YEARLY rule picks in one month. */
function daysInRuleMonth(rule: Rule, year: number, month: number, startDay: number): number[] {
  const dim = daysInMonth(year, month);
  const first = toDays(year, month, 1);
  let picked: number[] = [];
  if (rule.byMonthDay) {
    for (const n of rule.byMonthDay) {
      const day = n > 0 ? n : dim + n + 1;
      if (day >= 1 && day <= dim) picked.push(first + day - 1);
    }
    if (rule.byDay) {
      const wds = new Set(rule.byDay.map((d) => d.wd));
      picked = picked.filter((n) => wds.has(weekday(n)));
    }
  } else if (rule.byDay) {
    for (const { ord, wd } of rule.byDay) {
      const matches: number[] = [];
      for (let n = first; n < first + dim; n++) if (weekday(n) === wd) matches.push(n);
      if (ord === 0) picked.push(...matches);
      else {
        const hit = ord > 0 ? matches[ord - 1] : matches[matches.length + ord];
        if (hit !== undefined) picked.push(hit);
      }
    }
  } else if (startDay <= dim) {
    picked.push(first + startDay - 1); // e.g. the 31st: months without one are skipped (RFC 5545)
  }
  picked = Array.from(new Set(picked)).sort((a, b) => a - b);
  if (rule.bySetPos) {
    const all = picked;
    picked = [];
    for (const pos of rule.bySetPos) {
      const hit = pos > 0 ? all[pos - 1] : all[all.length + pos];
      if (hit !== undefined) picked.push(hit);
    }
    picked = Array.from(new Set(picked)).sort((a, b) => a - b);
  }
  return picked;
}

/** Work left for the whole file (repeat periods and candidate days), shared by every series. */
interface Budget {
  left: number;
}

/**
 * Candidate days of a rule, in order, from the period holding DTSTART on. Without COUNT nothing
 * before `range.from` (day numbers) needs counting, so the expansion starts one period before it
 * instead. It ends when `emit(day)` says so (past UNTIL, past the window) or once a period starts
 * after `range.to` (also for a rule that never matches, like February 30). Returns false when it
 * gave up: too many periods, or the file's work budget is spent.
 */
function expandDays(rule: Rule, startDays: number, range: { from: number; to: number }, budget: Budget, emit: (day: number) => boolean): boolean {
  const start = fromDays(startDays);
  const weekStart0 = startDays - ((weekday(startDays) - rule.wkst + 7) % 7);
  const month0 = start.year * 12 + (start.month - 1);
  let k = 0;
  if (rule.count === undefined && range.from > startDays) {
    const from = fromDays(range.from);
    if (rule.freq === 'DAILY') k = Math.floor((range.from - startDays) / rule.interval);
    else if (rule.freq === 'WEEKLY') k = Math.floor((range.from - weekStart0) / (7 * rule.interval));
    else if (rule.freq === 'MONTHLY') k = Math.floor((from.year * 12 + (from.month - 1) - month0) / rule.interval);
    else k = Math.floor((from.year - start.year) / rule.interval);
    k = Math.max(0, k - 1);
  }
  for (let n = 0; n < MAX_PERIODS; n++, k++) {
    if (budget.left <= 0) return false;
    let candidates: number[];
    if (rule.freq === 'DAILY') {
      const day = startDays + k * rule.interval;
      if (day > range.to) return true;
      candidates = !rule.byDay || rule.byDay.some((d) => d.wd === weekday(day)) ? [day] : [];
    } else if (rule.freq === 'WEEKLY') {
      const weekStart = weekStart0 + 7 * rule.interval * k;
      if (weekStart > range.to) return true;
      const wds = rule.byDay ? rule.byDay.map((d) => d.wd) : [weekday(startDays)];
      candidates = Array.from(new Set(wds.map((wd) => weekStart + ((wd - rule.wkst + 7) % 7)))).sort((a, b) => a - b);
    } else if (rule.freq === 'MONTHLY') {
      const index = month0 + k * rule.interval;
      const year = Math.floor(index / 12);
      const month = (index % 12) + 1;
      if (toDays(year, month, 1) > range.to) return true;
      candidates = daysInRuleMonth(rule, year, month, start.day);
    } else {
      const year = start.year + k * rule.interval;
      if (toDays(year, 1, 1) > range.to) return true;
      candidates = [];
      for (const month of rule.byMonth ?? [start.month]) candidates.push(...daysInRuleMonth(rule, year, month, start.day));
    }
    budget.left -= 1 + candidates.length;
    for (const day of candidates) {
      if (day <= startDays) continue; // DTSTART itself is emitted first, by the caller
      if (!emit(day)) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

interface RawEvent {
  uid: string;
  start: DateValue | null;
  end: DateValue | null;
  duration: { days: number; ms: number } | null;
  title: string;
  location: string;
  description: string;
  cancelled: boolean;
  private: boolean;
  rrule: string[];
  rdates: DateValue[];
  exdates: DateValue[];
  badDates: number;
  recurrenceId: DateValue | null;
  rangeFuture: boolean;
}

function newRaw(): RawEvent {
  return {
    uid: '',
    start: null,
    end: null,
    duration: null,
    title: '',
    location: '',
    description: '',
    cancelled: false,
    private: false,
    rrule: [],
    rdates: [],
    exdates: [],
    badDates: 0,
    recurrenceId: null,
    rangeFuture: false,
  };
}

function clipText(value: string): string {
  return value.length > MAX_TEXT ? value.slice(0, MAX_TEXT) : value;
}

function readProp(ev: RawEvent, p: Prop): void {
  switch (p.name) {
    case 'UID':
      ev.uid = unescapeText(p.value).trim().slice(0, 500);
      break;
    case 'DTSTART':
      ev.start = parseDateValue(p.value, p.params);
      break;
    case 'DTEND':
      ev.end = parseDateValue(p.value, p.params);
      break;
    case 'DURATION':
      ev.duration = parseDuration(p.value);
      break;
    case 'SUMMARY':
      ev.title = clipText(unescapeText(p.value));
      break;
    case 'LOCATION':
      ev.location = clipText(unescapeText(p.value));
      break;
    case 'DESCRIPTION':
      ev.description = clipText(unescapeText(p.value));
      break;
    case 'STATUS':
      ev.cancelled = p.value.trim().toUpperCase() === 'CANCELLED';
      break;
    case 'CLASS': {
      const c = p.value.trim().toUpperCase();
      ev.private = c === 'PRIVATE' || c === 'CONFIDENTIAL';
      break;
    }
    case 'RRULE':
      ev.rrule.push(p.value);
      break;
    case 'RDATE':
    case 'EXDATE': {
      const { values, bad } = parseDateList(p.value, p.params);
      if (p.name === 'RDATE') ev.rdates.push(...values);
      else ev.exdates.push(...values);
      ev.badDates += bad;
      break;
    }
    case 'RECURRENCE-ID':
      ev.recurrenceId = parseDateValue(p.value, p.params);
      ev.rangeFuture = (p.params.RANGE ?? '').toUpperCase() === 'THISANDFUTURE';
      break;
    default:
      break;
  }
}

class Reader {
  unsupported = 0;
  private readonly zoneOk = new Map<string, boolean>();
  private readonly memo = new Map<string, number | null>();

  constructor(
    private readonly zones: ZoneResolver,
    readonly defaultZone: string,
  ) {}

  /** UTC ms of a value; all-day dates count from midnight in the default zone. null = unknown zone. */
  instant(v: DateValue): number | null {
    const zone = v.kind === 'date' ? this.defaultZone : v.zone || this.defaultZone;
    const key = v.kind === 'date' ? `${zone}|${v.days}` : `${zone}|${v.days}|${v.h}|${v.mi}|${v.s}`;
    const hit = this.memo.get(key);
    if (hit !== undefined) return hit;
    const p = fromDays(v.days);
    const wall = v.kind === 'date' ? { ...p, hour: 0, minute: 0, second: 0 } : { ...p, hour: v.h, minute: v.mi, second: v.s };
    const ms = this.zones(zone, wall);
    const value = typeof ms === 'number' && Number.isFinite(ms) ? ms : null;
    this.memo.set(key, value);
    return value;
  }

  zoneKnown(v: DateValue): boolean {
    if (v.kind === 'date') return true;
    const zone = v.zone || this.defaultZone;
    let ok = this.zoneOk.get(zone);
    if (ok === undefined) {
      ok = this.instant({ ...v, zone }) !== null;
      this.zoneOk.set(zone, ok);
    }
    return ok;
  }
}

/** The same time of day as `base`, on another day. */
function onDay(base: DateValue, days: number): DateValue {
  return { ...base, days };
}

/** A floating time inside a zoned series (EXDATE, RECURRENCE-ID, UNTIL) is read in the series' zone. */
function inZoneOf(v: DateValue, series: DateValue): DateValue {
  return v.kind === 'time' && !v.zone && series.kind === 'time' ? { ...v, zone: series.zone } : v;
}

/** A key matching an occurrence of `series`: the day for all-day series, else the instant. */
function occurrenceKey(reader: Reader, v: DateValue, series: DateValue): string | null {
  if (series.kind === 'date') return `d:${v.days}`;
  if (v.kind === 'date') return `day:${v.days}`;
  const t = reader.instant(inZoneOf(v, series));
  return t === null ? null : `t:${t}`;
}

function timeOf(reader: Reader, v: DateValue): CalendarTime | null {
  if (v.kind === 'date') return { date: dayText(v.days) };
  const t = reader.instant(v);
  return t === null ? null : { dateTime: new Date(t).toISOString() };
}

/** How long an event lasts: whole days for all-day events, else milliseconds (null = no end). */
function lengthOf(reader: Reader, ev: RawEvent): { days: number } | { ms: number } | null {
  const start = ev.start;
  if (!start) return null;
  if (start.kind === 'date') {
    let days = 1;
    if (ev.end?.kind === 'date') days = ev.end.days - start.days;
    else if (ev.duration) days = ev.duration.days + Math.floor(ev.duration.ms / DAY_MS);
    return { days: Math.max(1, days) };
  }
  let ms: number | null = null;
  if (ev.end?.kind === 'time') {
    const a = reader.instant(start);
    const b = reader.instant(inZoneOf(ev.end, start));
    if (a !== null && b !== null) ms = b - a;
  } else if (ev.duration) {
    ms = ev.duration.days * DAY_MS + ev.duration.ms;
  }
  return ms !== null && ms > 0 ? { ms } : null;
}

/**
 * Parse an iCalendar file and return the events (occurrences of repeating events) that overlap
 * the window, soonest first. Never throws on bad input: unreadable parts are skipped and counted.
 */
export function parseIcs(text: string, options: IcsOptions): IcsResult {
  const lines = unfoldLines(String(text ?? ''));
  let calendars = 0;
  let defaultZone = options.defaultZone ?? NEW_YORK;
  const raws: RawEvent[] = [];
  const timezones: VTimezone[] = [];
  const stack: string[] = [];
  let current: RawEvent | null = null;
  let tz: VTimezone | null = null;
  let tzPart: VTimezonePart | null = null;
  let capped = false;

  for (const line of lines) {
    if (!line.trim()) continue;
    const p = parseContentLine(line);
    if (!p) continue;
    if (p.name === 'BEGIN') {
      const what = p.value.trim().toUpperCase();
      stack.push(what);
      const parent = stack.length >= 2 ? stack[stack.length - 2] : '';
      if (what === 'VCALENDAR') calendars++;
      if (what === 'VEVENT' && parent === 'VCALENDAR') {
        if (raws.length >= MAX_VEVENTS) capped = true;
        else current = newRaw();
      }
      if (what === 'VTIMEZONE' && parent === 'VCALENDAR' && timezones.length < MAX_VTIMEZONES) tz = { tzid: '', parts: [] };
      if ((what === 'STANDARD' || what === 'DAYLIGHT') && parent === 'VTIMEZONE' && tz) tzPart = { kind: what, start: '', offset: null, rule: '' };
      continue;
    }
    if (p.name === 'END') {
      const what = p.value.trim().toUpperCase();
      // Tolerate a missing END (e.g. of a VALARM): pop back to the matching BEGIN.
      const at = stack.lastIndexOf(what);
      if (at < 0) continue;
      if (what === 'VEVENT' && current) {
        raws.push(current);
        current = null;
      }
      if ((what === 'STANDARD' || what === 'DAYLIGHT') && tz && tzPart) {
        if (tz.parts.length < 50) tz.parts.push(tzPart);
        tzPart = null;
      }
      if (what === 'VTIMEZONE' && tz) {
        timezones.push(tz);
        tz = null;
        tzPart = null;
      }
      stack.length = at;
      continue;
    }
    const top = stack[stack.length - 1];
    if (top === 'VEVENT' && current) readProp(current, p);
    else if (top === 'VTIMEZONE' && tz && p.name === 'TZID') tz.tzid = p.value.trim();
    else if ((top === 'STANDARD' || top === 'DAYLIGHT') && tzPart) {
      if (p.name === 'DTSTART') tzPart.start = p.value.trim();
      else if (p.name === 'TZOFFSETTO') tzPart.offset = parseOffset(p.value);
      else if (p.name === 'RRULE') tzPart.rule = p.value.trim().toUpperCase();
    } else if (top === 'VCALENDAR' && p.name === 'X-WR-TIMEZONE' && !options.defaultZone) {
      const zone = normalizeTzid(p.value);
      if (options.zones(zone, PROBE) !== null) defaultZone = zone;
    }
  }

  const reader = new Reader(withFileZones(options.zones, timezones), defaultZone);
  const budget: Budget = { left: MAX_WORK };
  const windowStart = options.range.start.getTime();
  const windowEnd = options.range.end.getTime();
  // Day numbers (UTC) with a day to spare either side: occurrences outside need no time-zone work.
  const firstDay = Math.floor(windowStart / DAY_MS) - 1;
  const lastDay = Math.floor(windowEnd / DAY_MS) + 1;
  const collected: Array<{ ms: number; event: CalendarEvent }> = [];

  const usable = (ev: RawEvent): boolean => {
    if (!ev.start || !reader.zoneKnown(ev.start)) {
      reader.unsupported++;
      return false;
    }
    return true;
  };

  /** Add one occurrence if it overlaps the range. */
  const add = (ev: RawEvent, uid: string, start: DateValue): void => {
    const startMs = reader.instant(start);
    const startTime = timeOf(reader, start);
    if (startMs === null || !startTime) return;
    const length = lengthOf(reader, ev);
    let end: CalendarTime | undefined;
    let endMs: number | null = null;
    if (length && 'days' in length && start.kind === 'date') {
      endMs = reader.instant({ kind: 'date', days: start.days + length.days });
      end = { date: dayText(start.days + length.days) };
    } else if (length && 'ms' in length) {
      endMs = startMs + length.ms;
      end = { dateTime: new Date(endMs).toISOString() };
    }
    const overlaps = startMs < windowEnd && (endMs !== null ? endMs > windowStart : startMs >= windowStart);
    if (!overlaps) return;
    if (collected.length >= MAX_COLLECTED) {
      capped = true;
      return;
    }
    const event: CalendarEvent = { uid, start: startTime, title: ev.title, location: ev.location, description: ev.description };
    if (end) event.end = end;
    if (ev.private) event.private = true;
    if (ev.cancelled) event.cancelled = true;
    collected.push({ ms: startMs, event });
  };

  // Overrides (RECURRENCE-ID) by UID; matched to their series below.
  const overridesByUid = new Map<string, RawEvent[]>();
  const masters: RawEvent[] = [];
  raws.forEach((ev, i) => {
    if (!ev.uid) ev.uid = `nouid-${i}`;
    if (ev.recurrenceId) {
      if (ev.rangeFuture) reader.unsupported++; // "this and future": only this occurrence is changed
      const list = overridesByUid.get(ev.uid) ?? [];
      list.push(ev);
      overridesByUid.set(ev.uid, list);
    } else {
      masters.push(ev);
    }
  });

  const usedOverrides = new Set<RawEvent>();
  for (const master of masters) {
    const overrides = overridesByUid.get(master.uid) ?? [];
    if (!usable(master)) {
      overrides.forEach((o) => usedOverrides.add(o));
      continue;
    }
    const start = master.start as DateValue;
    reader.unsupported += master.badDates;
    if (master.cancelled) {
      // A cancelled event or series: nothing to copy (the core counts it), nor its changed occurrences.
      overrides.forEach((o) => usedOverrides.add(o));
      add(master, master.uid, start);
      continue;
    }
    // A repeat rule this reader can't follow: the whole series is left out (and counted), never guessed.
    const rule = master.rrule.length === 1 ? parseRule(master.rrule[0]) : null;
    if (master.rrule.length > 0 && !rule) {
      reader.unsupported++;
      overrides.forEach((o) => usedOverrides.add(o));
      continue;
    }
    // The file used up its work budget: the remaining repeating series are left out and counted.
    if (rule && budget.left <= 0) {
      reader.unsupported++;
      capped = true;
      overrides.forEach((o) => usedOverrides.add(o));
      continue;
    }
    const replaced = new Map<string, RawEvent>();
    for (const o of overrides) {
      const key = occurrenceKey(reader, o.recurrenceId as DateValue, start);
      if (key !== null) replaced.set(key, o);
    }
    const length = lengthOf(reader, master);
    const spanDays = length ? ('days' in length ? length.days : Math.ceil(length.ms / DAY_MS)) : 0;

    const excluded = new Set<string>();
    for (const ex of master.exdates) {
      const key = occurrenceKey(reader, ex, start);
      if (key) excluded.add(key);
    }
    const seen = new Set<string>();
    const emit = (value: DateValue): void => {
      if (value.days + spanDays < firstDay || value.days > lastDay) return; // far outside the window
      const key = occurrenceKey(reader, value, start);
      if (key === null || seen.has(key)) return;
      seen.add(key);
      if (excluded.has(key) || excluded.has(`day:${value.days}`)) return;
      const override = replaced.get(key) ?? (value.kind === 'time' ? replaced.get(`day:${value.days}`) : undefined);
      if (override) {
        usedOverrides.add(override);
        if (override.cancelled || !usable(override)) return;
        if (master.private) override.private = true; // exporters often leave CLASS off a changed occurrence
        add(override, master.uid, override.start as DateValue);
        return;
      }
      add(master, master.uid, value);
    };

    emit(start); // DTSTART always counts as the first occurrence (RFC 5545 §3.3.10)
    if (rule) {
      let count = 1;
      const until = rule.until ? untilLimit(reader, rule.until, start) : null;
      const finished = expandDays(rule, start.days, { from: firstDay - spanDays, to: lastDay }, budget, (day) => {
        if (rule.count !== undefined && count >= rule.count) return false;
        const value = onDay(start, day);
        if (until && !beforeUntil(reader, value, until)) return false;
        if (day > lastDay) return false;
        count++;
        emit(value);
        return true;
      });
      if (!finished) {
        reader.unsupported++;
        if (budget.left <= 0) capped = true;
      }
    }
    for (const r of master.rdates) {
      if (r.kind !== start.kind || !reader.zoneKnown(inZoneOf(r, start))) {
        reader.unsupported++;
        continue;
      }
      emit(inZoneOf(r, start));
    }
    // Changed occurrences that match no occurrence of the series stand on their own.
    for (const o of overrides) {
      if (usedOverrides.has(o)) continue;
      usedOverrides.add(o);
      if (master.private) o.private = true;
      if (!o.cancelled && usable(o)) add(o, master.uid, o.start as DateValue);
    }
  }

  // Changed occurrences whose series isn't in this file.
  overridesByUid.forEach((list, uid) => {
    for (const o of list) {
      if (usedOverrides.has(o) || o.cancelled) continue;
      if (usable(o)) add(o, uid, o.start as DateValue);
    }
  });

  collected.sort((a, b) => a.ms - b.ms);
  if (collected.length > options.maxEvents) capped = true;
  return {
    calendars,
    events: collected.slice(0, Math.max(0, options.maxEvents)).map((c) => c.event),
    unsupported: reader.unsupported,
    capped,
  };
}

type UntilLimit = { kind: 'day'; days: number } | { kind: 'ms'; ms: number };

function untilLimit(reader: Reader, until: DateValue, start: DateValue): UntilLimit | null {
  if (until.kind === 'date' || start.kind === 'date') return { kind: 'day', days: until.days };
  const ms = reader.instant(inZoneOf(until, start));
  return ms === null ? null : { kind: 'ms', ms };
}

/** UNTIL is inclusive. Days well before or after it need no time-zone work. */
function beforeUntil(reader: Reader, value: DateValue, limit: UntilLimit): boolean {
  if (limit.kind === 'day') return value.days <= limit.days;
  const limitDay = Math.floor(limit.ms / DAY_MS);
  if (value.days < limitDay - 1) return true;
  if (value.days > limitDay + 1) return false;
  const ms = reader.instant(value);
  return ms !== null && ms <= limit.ms;
}
