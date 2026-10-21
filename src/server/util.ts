/**
 * Small pure helpers for the backend core: cell parsing, America/New_York
 * calendar dates, text cleaning, base64url and constant-time comparison.
 *
 * Must stay ES2020-lib only (runs in Apps Script V8, the browser and Node).
 */
import { normalizeHeader } from '../shared/schema';
import type { IsoDate, IsoDateTime } from '../shared/types';
import { utf8Decode, utf8Encode } from './sha256';

/** Largest amount the app accepts anywhere: $100,000. */
export const MAX_AMOUNT_CENTS = 10000000;

const DAY_MS = 86400000;
/** Google Sheets serial day 0 = 1899-12-30. */
const SHEETS_EPOCH_MS = Date.UTC(1899, 11, 30);

// ---------------------------------------------------------------------------
// Cells
// ---------------------------------------------------------------------------

export function isBlank(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
}

/** A cell as trimmed text ('' for blanks). Dates become ISO timestamps. */
export function str(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : value.toISOString();
  return String(value).trim();
}

const TRUE_WORDS = new Set(['true', 'yes', 'y', 'x', '1', 'on', '✓', '✔']);
const FALSE_WORDS = new Set(['false', 'no', 'n', '0', 'off']);

/** TRUE/FALSE, Y/N, Yes/No, x, 1/0 and real booleans. Blank or unknown -> `fallback`. */
export function parseBool(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value !== 0 : fallback;
  const s = str(value).toLowerCase();
  if (TRUE_WORDS.has(s)) return true;
  if (FALSE_WORDS.has(s)) return false;
  return fallback;
}

/** Split a list cell on , ; / or newlines. */
export function splitList(value: unknown, separators: RegExp = /[,;/\n\r]+/): string[] {
  return str(value)
    .split(separators)
    .map((s) => s.trim())
    .filter((s) => s !== '');
}

/** Canonical spelling of `value` from `known` (case/punctuation-insensitive), else `value` as typed. */
export function canonical(value: string, known: readonly string[]): string {
  const key = normalizeHeader(value);
  if (!key) return value;
  for (const k of known) if (normalizeHeader(k) === key) return k;
  return value;
}

/** Whether `value` is one of `known` (case/punctuation-insensitive). */
export function isKnown(value: string, known: readonly string[]): boolean {
  const key = normalizeHeader(value);
  return key !== '' && known.some((k) => normalizeHeader(k) === key);
}

/** Parse a list cell, canonicalize known names, drop duplicates. */
export function parseList(value: unknown, known: readonly string[]): string[] {
  return uniqueBy(
    splitList(value).map((s) => canonical(s, known)),
    (s) => normalizeHeader(s) || s,
  );
}

export function joinList(list: readonly string[]): string {
  return list.join(', ');
}

export function uniqueBy<T>(items: readonly T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const k = key(item);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}

export function unique(items: readonly string[]): string[] {
  return uniqueBy(items, (s) => s);
}

/** Lists share at least one entry (case/punctuation-insensitive). */
export function intersects(a: readonly string[], b: readonly string[]): boolean {
  const keys = new Set(a.map((s) => normalizeHeader(s)));
  return b.some((s) => keys.has(normalizeHeader(s)));
}

/** Case-insensitive identity key for IDs typed by hand (" s0001 " == "S0001"). */
export function idKey(value: unknown): string {
  return str(value).toUpperCase();
}

export const GRADES: readonly string[] = ['K', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'];

/** "11", "11th", "Grade 11", 11 -> "11"; "k"/"Kindergarten" -> "K"; anything else as typed. */
export function normalizeGrade(value: unknown): string {
  const s = str(value);
  if (!s) return '';
  if (/^(k|kg|kindergarten)$/i.test(s)) return 'K';
  const m = /^(?:grade\s*)?0*(\d{1,2})(?:\.0+)?(?:st|nd|rd|th)?(?:\s*grade)?$/i.exec(s);
  return m ? String(parseInt(m[1], 10)) : s;
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

// Control characters, plus bidi overrides and zero-width characters that can disguise text.
const INVISIBLE_RANGES: ReadonlyArray<[number, number]> = [
  [0x00, 0x08],
  [0x0b, 0x0c],
  [0x0e, 0x1f],
  [0x7f, 0x7f],
  [0x200b, 0x200f], // zero-width and directional marks
  [0x202a, 0x202e], // bidi embedding/override
  [0x2028, 0x2029], // line/paragraph separators
  [0x2066, 0x2069], // bidi isolates
  [0xfeff, 0xfeff], // BOM
];
const hex4 = (n: number) => n.toString(16).padStart(4, '0');
const INVISIBLE = new RegExp(
  `[${INVISIBLE_RANGES.map(([a, b]) => `\\u${hex4(a)}-\\u${hex4(b)}`).join('')}]`,
  'g',
);

/** Clean user text: drop control/invisible characters, normalize whitespace, trim. */
export function cleanText(value: string, multiline = false): string {
  const s = value.replace(/\r\n?/g, '\n').replace(INVISIBLE, '');
  if (!multiline) return s.replace(/\s+/g, ' ').trim();
  return s
    .split('\n')
    .map((line) => line.replace(/[ \t\f\v]+/g, ' ').trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

export function lettersOnly(value: string): string {
  return value.toLowerCase().replace(/[^a-z]/g, '');
}

/** http(s) URL without whitespace/quotes, else undefined. Blocks javascript:, data:, etc. */
export function safeUrl(value: unknown, max = 500): string | undefined {
  const s = str(value);
  if (!s || s.length > max) return undefined;
  return /^https?:\/\/[^\s<>"'`]+$/i.test(s) ? s : undefined;
}

const EMAIL_RE =
  /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

export const MAX_EMAIL_LENGTH = 200;

/** Trim + lower-case. */
export function normEmail(value: unknown): string {
  return str(value).toLowerCase();
}

export function isEmail(value: string): boolean {
  return (
    value.length <= MAX_EMAIL_LENGTH &&
    EMAIL_RE.test(value) &&
    !value.includes('..') &&
    !value.startsWith('.') &&
    !value.includes('.@')
  );
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return typeof err === 'string' ? err : 'Unknown error';
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function hasOwn(obj: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

// ---------------------------------------------------------------------------
// Security helpers
// ---------------------------------------------------------------------------

/** Constant-time string comparison (for HMAC hex digests). */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** base64url (no padding) of the UTF-8 bytes of `text`. */
export function base64UrlEncode(text: string): string {
  const bytes = utf8Encode(text);
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const n = (bytes[i] << 16) | (b1 << 8) | b2;
    out += B64URL[(n >> 18) & 63] + B64URL[(n >> 12) & 63];
    if (i + 1 < bytes.length) out += B64URL[(n >> 6) & 63];
    if (i + 2 < bytes.length) out += B64URL[n & 63];
  }
  return out;
}

/** Inverse of base64UrlEncode; null for malformed input or invalid UTF-8. */
export function base64UrlDecode(encoded: string): string | null {
  if (!/^[A-Za-z0-9_-]*$/.test(encoded) || encoded.length % 4 === 1) return null;
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < encoded.length; i++) {
    buffer = ((buffer << 6) | B64URL.indexOf(encoded[i])) & 0xffffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  // Leftover bits must be zero padding, otherwise the encoding is not canonical.
  if (bits > 0 && (buffer & ((1 << bits) - 1)) !== 0) return null;
  return utf8Decode(bytes);
}

/** First 8 hex chars of a uuid (lower-case). */
export function hex8(uuid: string): string {
  return uuid.replace(/[^0-9a-f]/gi, '').slice(0, 8).toLowerCase();
}

/** Next sequential ID like F0007 / S0042: max numeric suffix of `prefix` IDs + 1, 4-digit padded. */
export function nextSequentialId(prefix: string, existing: readonly string[]): string {
  let max = 0;
  const re = new RegExp(`^${prefix}0*(\\d{1,9})$`, 'i');
  for (const id of existing) {
    const m = re.exec(id.trim());
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `${prefix}${String(max + 1).padStart(4, '0')}`;
}

// ---------------------------------------------------------------------------
// Dates (America/New_York semantics without Intl)
// ---------------------------------------------------------------------------

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Day of month of the n-th Sunday of a month (UTC calendar math). */
function nthSunday(year: number, month0: number, n: number): number {
  const firstDow = new Date(Date.UTC(year, month0, 1)).getUTCDay();
  return 1 + ((7 - firstDow) % 7) + 7 * (n - 1);
}

/**
 * UTC offset of America/New_York at an instant, in minutes (-240 EDT / -300 EST).
 * US rules since 2007: DST from the 2nd Sunday of March 2:00 EST (07:00 UTC) to
 * the 1st Sunday of November 2:00 EDT (06:00 UTC).
 */
export function nyOffsetMinutes(at: Date): number {
  const year = at.getUTCFullYear();
  const start = Date.UTC(year, 2, nthSunday(year, 2, 2), 7);
  const end = Date.UTC(year, 10, nthSunday(year, 10, 1), 6);
  const t = at.getTime();
  return t >= start && t < end ? -240 : -300;
}

export interface NyParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
}

/** Wall-clock parts of an instant in America/New_York. */
export function nyParts(at: Date): NyParts {
  const shifted = new Date(at.getTime() + nyOffsetMinutes(at) * 60000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
  };
}

export function isoDate(year: number, month: number, day: number): IsoDate {
  return `${String(year).padStart(4, '0')}-${pad2(month)}-${pad2(day)}`;
}

/** Calendar date of an instant in America/New_York ("today" for the app). */
export function nyDate(at: Date): IsoDate {
  const p = nyParts(at);
  return isoDate(p.year, p.month, p.day);
}

/** The instant of a wall-clock time in America/New_York. */
export function nyLocalToDate(year: number, month: number, day: number, hour = 0, minute = 0, second = 0): Date {
  const wall = Date.UTC(year, month - 1, day, hour, minute, second);
  let t = wall + 300 * 60000; // assume EST first
  t = wall - nyOffsetMinutes(new Date(t)) * 60000;
  t = wall - nyOffsetMinutes(new Date(t)) * 60000; // settle near transitions
  return new Date(t);
}

function dateParts(date: IsoDate): [number, number, number] {
  const [y, m, d] = date.split('-').map((n) => parseInt(n, 10));
  return [y, m, d];
}

function utcMidnight(date: IsoDate): number {
  const [y, m, d] = dateParts(date);
  return Date.UTC(y, m - 1, d);
}

export function addDays(date: IsoDate, days: number): IsoDate {
  const t = new Date(utcMidnight(date) + days * DAY_MS);
  return isoDate(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** Whole days from `from` to `to` (positive when `to` is later). */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((utcMidnight(to) - utcMidnight(from)) / DAY_MS);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2027-02-01" -> "Feb 1". */
export function shortDate(date: IsoDate): string {
  const [, m, d] = dateParts(date);
  return `${MONTHS[m - 1] ?? ''} ${d}`;
}

function validDate(year: number, month: number, day: number): IsoDate | null {
  if (!Number.isInteger(year) || year < 1900 || year > 2200) return null;
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (!Number.isInteger(day) || day < 1 || day > daysInMonth) return null;
  return isoDate(year, month, day);
}

function serialToDate(serial: number): IsoDate | null {
  if (!Number.isFinite(serial) || serial <= 0 || serial >= 2958466) return null;
  const t = new Date(SHEETS_EPOCH_MS + Math.floor(serial) * DAY_MS);
  return validDate(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

const ISO_DATE = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
const ISO_DATETIME = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i;
const US_DATE = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})(?:[ T,]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap]\.?m\.?)?)?$/i;

function zonedIsoToMs(isoText: string, zone: string): number {
  const fixed = /^[+-]\d{4}$/.test(zone) ? isoText.replace(/([+-]\d{2})(\d{2})$/, '$1:$2') : isoText;
  return Date.parse(fixed.replace(' ', 'T'));
}

/**
 * Calendar date from a sheet cell: Date objects (read with the script-timezone
 * getters, as Apps Script returns them), YYYY-MM-DD, M/D/YYYY, M/D/YY, sheet
 * serial numbers, or ISO timestamps (converted to the New York calendar date).
 */
export function parseDate(value: unknown): IsoDate | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime())
      ? null
      : validDate(value.getFullYear(), value.getMonth() + 1, value.getDate());
  }
  if (typeof value === 'number') return serialToDate(value);
  const s = str(value);
  if (!s) return null;
  let m = ISO_DATE.exec(s);
  if (m) return validDate(+m[1], +m[2], +m[3]);
  m = ISO_DATETIME.exec(s);
  if (m) {
    if (!m[7]) return validDate(+m[1], +m[2], +m[3]);
    const t = zonedIsoToMs(s, m[7]);
    return Number.isNaN(t) ? null : nyDate(new Date(t));
  }
  m = US_DATE.exec(s);
  if (m) {
    const year = m[3].length === 2 ? 2000 + parseInt(m[3], 10) : parseInt(m[3], 10);
    return validDate(year, +m[1], +m[2]);
  }
  if (/^\d+(\.\d+)?$/.test(s)) return serialToDate(parseFloat(s));
  const t = Date.parse(s); // e.g. "Oct 21, 2026"
  if (Number.isNaN(t)) return null;
  const d = new Date(t);
  return validDate(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

/**
 * Timestamp from a sheet cell: Date objects, ISO strings (with or without a
 * zone; zone-less and date-only text is New York wall-clock time), M/D/YYYY
 * h:mm AM/PM, or sheet serial numbers.
 */
export function parseTimestamp(value: unknown): IsoDateTime | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0 || value >= 2958466) return null;
    const date = serialToDate(value);
    if (!date) return null;
    const [y, mo, d] = dateParts(date);
    const seconds = Math.round((value - Math.floor(value)) * 86400);
    return nyLocalToDate(y, mo, d, 0, 0, seconds).toISOString();
  }
  const s = str(value);
  if (!s) return null;
  let m = ISO_DATE.exec(s);
  if (m) {
    const date = validDate(+m[1], +m[2], +m[3]);
    return date ? nyLocalToDate(+m[1], +m[2], +m[3]).toISOString() : null;
  }
  m = ISO_DATETIME.exec(s);
  if (m) {
    if (!validDate(+m[1], +m[2], +m[3])) return null;
    if (m[7]) {
      const t = zonedIsoToMs(s, m[7]);
      return Number.isNaN(t) ? null : new Date(t).toISOString();
    }
    return nyLocalToDate(+m[1], +m[2], +m[3], +m[4], +m[5], m[6] ? +m[6] : 0).toISOString();
  }
  m = US_DATE.exec(s);
  if (m) {
    const year = m[3].length === 2 ? 2000 + parseInt(m[3], 10) : parseInt(m[3], 10);
    if (!validDate(year, +m[1], +m[2])) return null;
    let hour = m[4] ? parseInt(m[4], 10) : 0;
    const minute = m[5] ? parseInt(m[5], 10) : 0;
    const meridiem = (m[7] ?? '').toLowerCase().replace(/\./g, '');
    if (meridiem === 'pm' && hour < 12) hour += 12;
    if (meridiem === 'am' && hour === 12) hour = 0;
    if (hour > 23 || minute > 59) return null;
    return nyLocalToDate(year, +m[1], +m[2], hour, minute, m[6] ? +m[6] : 0).toISOString();
  }
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/** Time-of-day text from a cell: "7:00 PM" as typed, or a Sheets time value (Date / day fraction). */
export function parseTimeText(value: unknown): string {
  let hours: number;
  let minutes: number;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return '';
    hours = value.getHours();
    minutes = value.getMinutes();
  } else if (typeof value === 'number' && value >= 0 && value < 1) {
    const total = Math.round(value * 1440);
    hours = Math.floor(total / 60) % 24;
    minutes = total % 60;
  } else {
    const s = str(value);
    // A Sheets time value that went through JSON (demo storage): "1899-12-30T23:00:00.000Z".
    if (!/^1899-12-(30|31)T/.test(s)) return s;
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return '';
    hours = d.getHours();
    minutes = d.getMinutes();
  }
  const suffix = hours >= 12 ? 'PM' : 'AM';
  const h12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${h12}:${pad2(minutes)} ${suffix}`;
}
