/**
 * Linked calendars, the pure part (ARCHITECTURE.md §7 "Linked calendars"):
 * what a Calendars-tab address means, the stable key and ID of a copied
 * event, and the Events-tab row an event becomes (plain-text details, "through"
 * for multi-day events, audience lines in the description). No sheet, no
 * network: src/server/calendars.ts does the syncing, and the sample data uses
 * these too so the demo's calendar rows match what a sync would write.
 */
import type { IsoDate } from '../shared/types';
import type { CalendarEvent, CalendarProblem, CalendarRef, RowData } from './services';
import { sha256Hex } from './sha256';
import {
  addDays,
  base64UrlDecode,
  canonical,
  cleanText,
  isKnown,
  joinList,
  nyParts,
  isoDate,
  shortDate,
  splitList,
  timeText,
  truncate,
  uniqueBy,
} from './util';

export const MAX_TITLE = 120;
export const MAX_LOCATION = 200;
export const MAX_DETAILS = 1000;
export const MAX_CALENDAR_NAME = 40;
/** Length of the calendar part of a Calendar Event key (hex). */
const CALENDAR_HASH_CHARS = 10;
const MAX_ADDRESS = 2000;

/** The Events columns a calendar row fills (a removed row is blanked in these when it can't be deleted). */
export const CALENDAR_ROW_COLUMNS: readonly string[] = [
  'ID',
  'Date',
  'Time',
  'Title',
  'Location',
  'Details',
  'Schools',
  'Ensembles',
  'Source',
  'Calendar Event',
];

// ---------------------------------------------------------------------------
// Addresses
// ---------------------------------------------------------------------------

export type ParsedAddress = { ref: CalendarRef } | { problem: 'blank' | 'http' | 'bad' };

const GOOGLE_ID = /^[^\s@<>"',;]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/i;
const SAFE_LINK = /^https:\/\/[^\s<>"'`]+$/i;

function decodeComponent(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '));
  } catch {
    return value;
  }
}

/** A query parameter of a link (no `new URL`: Apps Script has none). */
function queryParam(link: string, name: string): string | null {
  const m = new RegExp(`[?&]${name}=([^&#]*)`, 'i').exec(link);
  return m ? decodeComponent(m[1]) : null;
}

/**
 * What the Calendar column holds: a Google Calendar ID (e.g. abc123@group.calendar.google.com, or
 * an account's own address), a Google Calendar link that carries one (the "Public URL" embed link,
 * or a shared "?cid=" link), or an https iCal (.ics) link (webcal:// becomes https://).
 */
export function parseCalendarAddress(value: unknown): ParsedAddress {
  const text = String(value ?? '')
    .trim()
    .replace(/^<|>$/g, '')
    .replace(/^"|"$/g, '')
    .trim();
  if (!text) return { problem: 'blank' };
  if (text.length > MAX_ADDRESS) return { problem: 'bad' };
  if (/^http:\/\//i.test(text)) return { problem: 'http' };
  const link = /^webcal:\/\//i.test(text) ? `https://${text.slice('webcal://'.length)}` : text;
  if (/^https:\/\//i.test(link)) {
    if (!SAFE_LINK.test(link)) return { problem: 'bad' };
    if (/^https:\/\/calendar\.google\.com\/calendar\//i.test(link)) {
      const src = queryParam(link, 'src');
      if (src && GOOGLE_ID.test(src.trim())) return { ref: { kind: 'google', id: src.trim() } };
      const cid = queryParam(link, 'cid');
      if (cid) {
        const decoded = base64UrlDecode(cid.trim().replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_'));
        const id = decoded ? decoded.trim() : '';
        if (GOOGLE_ID.test(id)) return { ref: { kind: 'google', id } };
        if (GOOGLE_ID.test(cid.trim())) return { ref: { kind: 'google', id: cid.trim() } };
      }
    }
    return { ref: { kind: 'ical', url: link } };
  }
  if (GOOGLE_ID.test(text)) return { ref: { kind: 'google', id: text } };
  return { problem: 'bad' };
}

/** Short, stable hex for one calendar: the first part of every Calendar Event key it writes. */
export function calendarHash(ref: CalendarRef): string {
  const identity = ref.kind === 'google' ? `google:${ref.id.toLowerCase()}` : `ical:${ref.url}`;
  return sha256Hex(identity).slice(0, CALENDAR_HASH_CHARS);
}

/** Whether a Calendar Event cell holds a key this app wrote (calendar hash first). */
export function calendarKeyHash(key: string): string | null {
  const m = /^([0-9a-f]{10}):/.exec(key);
  return m ? m[1] : null;
}

// ---------------------------------------------------------------------------
// Problems
// ---------------------------------------------------------------------------

/** Plain words for why a calendar couldn't be read (Status, the sync report, the Log). */
export function calendarProblemText(problem: CalendarProblem | 'blank' | 'http' | 'bad', detail = ''): string {
  const extra = detail ? ` (${detail})` : '';
  switch (problem) {
    case 'blank':
      return 'the Calendar column is empty. Put a Google Calendar ID or an https:// iCal link there';
    case 'http':
      return 'iCal links must start with https:// (not http://)';
    case 'bad':
    case 'bad_address':
      return 'the Calendar column is not a Google Calendar ID (like abc123@group.calendar.google.com) or an https:// iCal link';
    case 'no_service':
      return 'the Google Calendar service is missing in Apps Script. Paste the new appsscript.json, then run TMA App → Set up / repair tabs (docs/SETUP.md, "Link Google Calendars")';
    case 'no_permission':
      return "the app isn't allowed to read calendars yet. Run TMA App → Set up / repair tabs and approve the new permission";
    case 'not_found':
      return `not found, or not shared with this Google account${extra}. Check the Calendar ID, and share the calendar with TMA's Google account (or make it public)`;
    case 'not_shared':
      return `not shared with this Google account${extra}. Share it with TMA's Google account ("See all event details"), or make it public`;
    case 'busy':
      return `Google was busy${extra}. The app tries again at the next sync`;
    case 'link_failed':
      return `the iCal link failed${extra || ' (no answer)'}. Check the link; it must be the calendar's iCal (.ics) address`;
    case 'not_ical':
      return "the link didn't return a calendar (.ics) file. Use the calendar's iCal address";
    case 'too_big':
      return `the iCal file is too big${extra}`;
    default:
      return `could not be read${extra}`;
  }
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  bull: '•',
  middot: '·',
  copy: '©',
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8});/gi, (whole, code: string) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      if (!Number.isFinite(n) || n < 32 || n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff)) return n === 9 || n === 10 ? String.fromCharCode(n) : '';
      return String.fromCodePoint(n);
    }
    return NAMED_ENTITIES[code.toLowerCase()] ?? whole;
  });
}

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, '');
}

/**
 * A calendar description as plain text. Google Calendar descriptions are often HTML: <br> and the
 * end of <p>, <div>, <li> become line breaks, list items get "• ", a link keeps its address in
 * brackets, every other tag is dropped and entities (&amp;, &#39;, …) are decoded. Plain text
 * passes through unchanged (apart from entities).
 */
export function htmlToText(input: string): string {
  let s = String(input ?? '');
  if (!/<[a-z!/][^>]*>/i.test(s)) return decodeEntities(s);
  s = s.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
  s = s.replace(/<!--[\s\S]*?-->/g, '');
  s = s.replace(
    /<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a\s*>/gi,
    (_m, dq: string | undefined, sq: string | undefined, bare: string | undefined, inner: string) => {
      const href = decodeEntities((dq ?? sq ?? bare ?? '').trim());
      const label = decodeEntities(stripTags(inner)).trim();
      const isLink = /^https?:\/\/[^\s<>"']+$/i.test(href);
      if (!isLink) return label;
      if (!label || label === href || label.replace(/^https?:\/\//i, '') === href.replace(/^https?:\/\//i, '')) return href;
      return `${label} (${href})`;
    },
  );
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<li\b[^>]*>/gi, '\n• ');
  s = s.replace(/<\/(p|div|li|h[1-6]|tr|ul|ol|blockquote|table)\s*>/gi, '\n');
  s = s.replace(/<(p|div|h[1-6]|tr|ul|ol|blockquote|table)\b[^>]*>/gi, '\n');
  s = stripTags(s);
  return decodeEntities(s);
}

// ---------------------------------------------------------------------------
// Audience
// ---------------------------------------------------------------------------

export interface AudienceLists {
  schools: string[];
  ensembles: string[];
}

/** Known names in their Settings spelling, and the names that aren't in Settings. */
export function knownNames(value: unknown, known: readonly string[]): { names: string[]; unknown: string[] } {
  const names: string[] = [];
  const unknown: string[] = [];
  for (const item of splitList(value)) {
    if (isKnown(item, known)) names.push(canonical(item, known));
    else unknown.push(item);
  }
  return { names: uniqueBy(names, (s) => s.toLowerCase()), unknown: uniqueBy(unknown, (s) => s.toLowerCase()) };
}

const AUDIENCE_LINE = /^\s*(schools?|groups?|ensembles?)\s*:\s*(.*?)\s*$/i;
const EVERYONE = /^(everyone|everybody|all|all families)\.?$/i;

/**
 * A Schools or Groups list as written in the Calendars tab or a description line: the names in
 * their Settings spelling, and the names that aren't in Settings. "Everyone" (or "All") means
 * everyone: an empty list. When no name at all is in Settings, the names are kept as typed, as in a
 * row typed into Events: they match no family's choices, so a misspelling never turns into
 * "everyone". Otherwise unknown names are left out.
 */
export function audienceNames(value: unknown, known: readonly string[]): { names: string[]; unknown: string[] } {
  if (EVERYONE.test(String(value ?? '').trim())) return { names: [], unknown: [] };
  const found = knownNames(value, known);
  return { names: found.names.length > 0 ? found.names : found.unknown, unknown: found.unknown };
}

/**
 * "Schools: Middle School" / "Groups: Jazz Band, Chorus" (or "Ensembles:") lines in an event's
 * description choose who it is for, instead of the calendar's default; the lines are removed from
 * the text. "Everyone" means everyone. Unknown names are reported, and kept only when no name on
 * the line is known (see audienceNames); a blank line keeps the calendar's default for that list.
 */
export function audienceFromText(
  text: string,
  defaults: AudienceLists,
  known: AudienceLists,
): { text: string; audience: AudienceLists; unknown: string[] } {
  const audience: AudienceLists = { schools: defaults.schools.slice(), ensembles: defaults.ensembles.slice() };
  const unknown: string[] = [];
  const kept: string[] = [];
  for (const line of text.split('\n')) {
    const m = AUDIENCE_LINE.exec(line);
    if (!m) {
      kept.push(line);
      continue;
    }
    const list: keyof AudienceLists = /^school/i.test(m[1]) ? 'schools' : 'ensembles';
    const found = audienceNames(m[2], known[list]);
    unknown.push(...found.unknown);
    if (found.names.length > 0 || EVERYONE.test(m[2].trim())) audience[list] = found.names;
  }
  return { text: kept.join('\n'), audience, unknown };
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

export interface CalendarRowSource {
  /** The Calendars tab Name (the Events Source). */
  name: string;
  /** calendarHash of its address. */
  hash: string;
  /** Its default audience (Calendars Schools / Groups, see audienceNames). */
  schools: string[];
  ensembles: string[];
}

export interface CalendarRow {
  key: string;
  /** Start date (New York), for the window. */
  date: IsoDate;
  row: RowData;
  /** Who it is for (the row's Schools and Ensembles, as lists). */
  audience: AudienceLists;
  /** Audience names in the description that aren't in Settings. */
  unknown: string[];
}

/** Start in New York: the date, and the time of day ('' for all-day events). */
function localStart(event: CalendarEvent): { date: IsoDate; time: string } | null {
  if ('date' in event.start) return /^\d{4}-\d{2}-\d{2}$/.test(event.start.date) ? { date: event.start.date, time: '' } : null;
  const at = new Date(event.start.dateTime);
  if (Number.isNaN(at.getTime())) return null;
  const p = nyParts(at);
  return { date: isoDate(p.year, p.month, p.day), time: timeText(p.hour, p.minute) };
}

/** The last day of a multi-day event (New York), or null for a one-day event. */
function lastDay(event: CalendarEvent, start: IsoDate): IsoDate | null {
  if (!event.end) return null;
  let last: IsoDate | null = null;
  if ('date' in event.end) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(event.end.date)) last = addDays(event.end.date, -1); // all-day ends are exclusive
  } else {
    const end = new Date(event.end.dateTime);
    if (!Number.isNaN(end.getTime())) {
      const p = nyParts(end);
      const endDate = isoDate(p.year, p.month, p.day);
      // Ending at midnight means it ended the day before.
      last = p.hour === 0 && p.minute === 0 ? addDays(endDate, -1) : endDate;
    }
  }
  return last && last > start ? last : null;
}

/** "a1b2c3d4e5:<event id>:<start>": the calendar, the event and this occurrence's start. */
export function calendarEventKey(hash: string, event: CalendarEvent): string {
  const uid = event.uid.trim();
  const uidPart = /^[A-Za-z0-9._@+-]{1,80}$/.test(uid) ? uid : `h${sha256Hex(uid).slice(0, 16)}`;
  const start = 'date' in event.start ? event.start.date.replace(/-/g, '') : event.start.dateTime.replace(/[-:]|\.\d{3}/g, '');
  return `${hash}:${uidPart}:${start}`;
}

/** A Calendar Event key without its calendar part: the same event on two linked calendars has the same one. */
export function calendarEventIdentity(key: string): string {
  return key.slice(key.indexOf(':') + 1);
}

/**
 * Who an event on two calendars is for: everyone either calendar's row reaches. Each list is the
 * union of both, or blank (no limit) when either row leaves it blank. Never narrower than either.
 */
export function mergeAudience(a: AudienceLists, b: AudienceLists): AudienceLists {
  const merge = (x: string[], y: string[]) => (x.length === 0 || y.length === 0 ? [] : uniqueBy([...x, ...y], (s) => s.toLowerCase()));
  return { schools: merge(a.schools, b.schools), ensembles: merge(a.ensembles, b.ensembles) };
}

/** Events ID for a calendar row: "CAL-" and a short hash of its key, so it stays the same every sync. */
export function calendarRowId(key: string): string {
  return `CAL-${sha256Hex(key).slice(0, 10)}`;
}

/**
 * The Events row for one calendar event (null when its start can't be read). Private and cancelled
 * events are the caller's to skip. Text is cleaned and trimmed to the app's limits; the Store keeps
 * text that starts with = + - @ as text (no formulas).
 */
export function buildCalendarRow(source: CalendarRowSource, event: CalendarEvent, known: AudienceLists): CalendarRow | null {
  const start = localStart(event);
  if (!start) return null;
  const key = calendarEventKey(source.hash, event);
  const plain = cleanText(htmlToText(event.description), true);
  const { text, audience, unknown } = audienceFromText(plain, { schools: source.schools, ensembles: source.ensembles }, known);
  const last = lastDay(event, start.date);
  const details = [last ? `Through ${shortDate(last)}.` : '', cleanText(text, true)].filter((s) => s !== '').join('\n');
  const row: RowData = {
    ID: calendarRowId(key),
    Date: start.date,
    Time: start.time,
    Title: truncate(cleanText(event.title) || 'Untitled event', MAX_TITLE),
    Location: truncate(cleanText(event.location), MAX_LOCATION),
    Details: truncate(details, MAX_DETAILS),
    Schools: joinList(audience.schools),
    Ensembles: joinList(audience.ensembles),
    Source: source.name,
    'Calendar Event': key,
  };
  return { key, date: start.date, row, audience, unknown };
}
