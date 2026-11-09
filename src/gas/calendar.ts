/**
 * CalendarSource for Apps Script (ARCHITECTURE.md §7 "Linked calendars", §9).
 *
 * - Google Calendars: the Calendar advanced service (Calendar API v3,
 *   appsscript.json `enabledAdvancedServices`), read-only scope
 *   calendar.readonly. It reads calendars shared with the TMA Google account
 *   and public calendars, and expands repeating events (singleEvents). Only
 *   the fields the app copies are requested: never attendees or organizers.
 *   A calendar TMA's account may only see as free/busy is refused (`free_busy`):
 *   Google would list its busy times without names, every one an "Untitled event".
 *   With an old manifest the service is missing: that is reported, never a crash.
 * - iCal links: UrlFetchApp (https only, at most 2 MB), parsed by the core's
 *   reader (src/server/ics.ts) with time zones resolved by Utilities. Events
 *   the link shows only as "Busy" (free/busy, no details) count as private.
 *
 * Errors carry a reason and an HTTP code only: never the calendar's address
 * (a private iCal link is a password).
 */
import { basicZones, looksLikeIcs, parseIcs, type ZoneResolver } from '../server/ics';
import type { CalendarEvent, CalendarFeed, CalendarSource, CalendarTime, CalendarWindow, Logger } from '../server/services';
import { CalendarReadError } from '../server/services';
import { WALL_CLOCK_FORMAT } from './sheet-store';
import { isRecord } from './util';

/** iCal files larger than this are refused (a school year of events is a few hundred KB). */
export const MAX_ICS_CHARS = 2000000;
const PAGE_SIZE = 250;
const MAX_PAGES = 10;
const EVENT_FIELDS = 'accessRole,nextPageToken,items(id,status,summary,description,location,start,end,visibility,eventType)';

/** IANA zone names Utilities understands (anything else would silently become GMT). */
const IANA_ZONE =
  /^(?:(?:Africa|America|Antarctica|Arctic|Asia|Atlantic|Australia|Europe|Indian|Pacific|Etc)\/[A-Za-z0-9_+-]+(?:\/[A-Za-z0-9_+-]+)?|(?:US|Canada|Mexico|Brazil|Chile)\/[A-Za-z_-]+|EST5EDT|CST6CDT|MST7MDT|PST8PDT)$/;

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0');
}

/** UTC and New York in plain code; other IANA zones through Utilities.parseDate. */
export const gasZones: ZoneResolver = (zone, w) => {
  const basic = basicZones(zone, w);
  if (basic !== null) return basic;
  if (!IANA_ZONE.test(zone)) return null;
  try {
    const text = `${pad(w.year, 4)}-${pad(w.month)}-${pad(w.day)}T${pad(w.hour)}:${pad(w.minute)}:${pad(w.second)}.000`;
    const d = Utilities.parseDate(text, zone, WALL_CLOCK_FORMAT);
    return d instanceof Date && !Number.isNaN(d.getTime()) ? d.getTime() : null;
  } catch {
    return null;
  }
};

/** The Calendar advanced service, or null when appsscript.json doesn't enable it. */
function calendarService(): GoogleAppsScript.Calendar | null {
  try {
    return typeof Calendar !== 'undefined' && Calendar && Calendar.Events ? Calendar : null;
  } catch {
    return null;
  }
}

function errorText(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (isRecord(err) && typeof err.message === 'string') return err.message;
  return String(err);
}

/** A Calendar API error -> a reason the volunteers can act on (the message itself is not kept). */
export function googleCalendarError(err: unknown): CalendarReadError {
  const message = errorText(err);
  if (/rate ?limit|quota|usageLimits|too many requests|\b429\b/i.test(message)) return new CalendarReadError('busy', 'HTTP 429');
  if (
    /insufficient (?:authentication )?scopes?|insufficient permission|required permissions|authorization is required|you do not have permission to call|invalid credentials|login required|\b401\b/i.test(
      message,
    )
  ) {
    return new CalendarReadError('no_permission');
  }
  if (/accessNotConfigured|has not been used in project|API has not been|is disabled/i.test(message)) return new CalendarReadError('no_service');
  if (/not ?found|\b404\b/i.test(message)) return new CalendarReadError('not_found', 'HTTP 404');
  if (/forbidden|\b403\b|access denied|not allowed|does not have permission/i.test(message)) return new CalendarReadError('not_shared', 'HTTP 403');
  if (/backend error|internal error|service unavailable|unavailable|\b50\d\b|timed? ?out|timeout/i.test(message)) return new CalendarReadError('busy');
  if (/bad request|invalid|\b400\b/i.test(message)) return new CalendarReadError('not_found', 'HTTP 400');
  return new CalendarReadError('failed');
}

function googleTime(value: unknown): CalendarTime | null {
  if (!isRecord(value)) return null;
  if (typeof value.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.date)) return { date: value.date };
  if (typeof value.dateTime === 'string') {
    const t = Date.parse(value.dateTime);
    if (!Number.isNaN(t)) return { dateTime: new Date(t).toISOString() };
  }
  return null;
}

/** One Calendar API event -> CalendarEvent; null when it can't be read (no id or start). */
export function mapGoogleEvent(item: unknown): CalendarEvent | null {
  if (!isRecord(item) || typeof item.id !== 'string' || !item.id) return null;
  const start = googleTime(item.start);
  if (!start) return null;
  const text = (v: unknown) => (typeof v === 'string' ? v : '');
  const event: CalendarEvent = {
    uid: item.id,
    start,
    title: text(item.summary),
    location: text(item.location),
    description: text(item.description),
  };
  const end = googleTime(item.end);
  if (end) event.end = end;
  if (item.status === 'cancelled') event.cancelled = true;
  // Private and confidential events, and personal kinds (out of office, focus time, working
  // location, birthdays, events from Gmail), are never copied.
  const type = typeof item.eventType === 'string' ? item.eventType : 'default';
  if (item.visibility === 'private' || item.visibility === 'confidential' || type !== 'default') event.private = true;
  return event;
}

/** Calendar.Events.list, every page (repeating events expanded), up to range.maxEvents. */
export function readGoogleCalendar(id: string, range: CalendarWindow): CalendarFeed {
  const service = calendarService();
  if (!service) throw new CalendarReadError('no_service');
  const events: CalendarEvent[] = [];
  let unsupported = 0;
  let capped = false;
  let pageToken: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const args: Record<string, unknown> = {
      timeMin: range.start.toISOString(),
      timeMax: range.end.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
      showDeleted: false,
      maxResults: PAGE_SIZE,
      fields: EVENT_FIELDS,
    };
    if (pageToken) args.pageToken = pageToken;
    let response: unknown;
    try {
      response = service.Events.list(id, args);
    } catch (err) {
      throw googleCalendarError(err);
    }
    // Free/busy only: the events come without names or details. Copying them would add a nameless
    // row, with a reminder to every family, for each busy time (personal ones included).
    if (page === 0 && isRecord(response) && response.accessRole === 'freeBusyReader') throw new CalendarReadError('free_busy');
    const items = isRecord(response) && Array.isArray(response.items) ? response.items : [];
    for (const item of items) {
      if (events.length >= range.maxEvents) {
        capped = true;
        break;
      }
      const event = mapGoogleEvent(item);
      if (event) events.push(event);
      else unsupported++;
    }
    pageToken = isRecord(response) && typeof response.nextPageToken === 'string' && response.nextPageToken ? response.nextPageToken : undefined;
    if (capped || !pageToken) break;
    if (events.length >= range.maxEvents || page === MAX_PAGES - 1) {
      capped = true;
      break;
    }
  }
  return { events, unsupported, capped };
}

/**
 * Whether an iCal event is only a busy time with its details hidden. Google's public iCal address
 * gives every event of a calendar that is public as "See only free/busy", and each private event of
 * any public calendar, as SUMMARY:Busy with no CLASS, LOCATION or DESCRIPTION. So: a title that is
 * exactly "Busy", and no location and no description. A real event named Busy that has either is kept.
 */
function isBusyOnly(event: CalendarEvent): boolean {
  return event.title.trim().toLowerCase() === 'busy' && event.location.trim() === '' && event.description.trim() === '';
}

/** An https iCal link: fetched, checked, and read by the core's parser. */
export function readIcalLink(url: string, range: CalendarWindow): CalendarFeed {
  if (!/^https:\/\/[^\s<>"'`]+$/i.test(url)) throw new CalendarReadError('bad_address');
  let res: GoogleAppsScript.URL_Fetch.HTTPResponse;
  try {
    res = UrlFetchApp.fetch(url, {
      method: 'get',
      muteHttpExceptions: true,
      followRedirects: true,
      validateHttpsCertificates: true,
      headers: { Accept: 'text/calendar, text/plain;q=0.9, */*;q=0.5' },
    });
  } catch (err) {
    // DNS failures and timeouts throw even with muteHttpExceptions; their text holds the link.
    throw new CalendarReadError('link_failed', /time ?out|timed out/i.test(errorText(err)) ? 'no answer in time' : 'no answer');
  }
  const code = res.getResponseCode();
  if (code < 200 || code >= 300) throw new CalendarReadError('link_failed', `HTTP ${code}`);
  const headers = res.getHeaders() as Record<string, unknown>;
  const length = Number(headers['Content-Length'] ?? headers['content-length']);
  if (Number.isFinite(length) && length > MAX_ICS_CHARS) throw new CalendarReadError('too_big', 'over 2 MB');
  const text = res.getContentText();
  if (text.length > MAX_ICS_CHARS) throw new CalendarReadError('too_big', 'over 2 MB');
  if (!looksLikeIcs(text)) throw new CalendarReadError('not_ical');
  const parsed = parseIcs(text, { range, maxEvents: range.maxEvents, zones: gasZones });
  if (parsed.calendars === 0) throw new CalendarReadError('not_ical');
  // Busy times without details are marked private, so the core skips them (Status counts them as
  // private) instead of copying a row titled "Busy", with a reminder to every family, for each. The
  // link itself still counts as read: were it refused, "Busy" rows copied before would stay in
  // Events (a failed calendar's rows are left alone) instead of being removed at the next sync.
  for (const event of parsed.events) {
    if (!event.cancelled && !event.private && isBusyOnly(event)) event.private = true;
  }
  return { events: parsed.events, unsupported: parsed.unsupported, capped: parsed.capped };
}

export function createGasCalendarSource(deps: { logger: Logger }): CalendarSource {
  return {
    read(ref, range) {
      try {
        return ref.kind === 'google' ? readGoogleCalendar(ref.id, range) : readIcalLink(ref.url, range);
      } catch (err) {
        if (err instanceof CalendarReadError) {
          deps.logger.info(`Calendar not read (${ref.kind}): ${err.problem}${err.detail ? `, ${err.detail}` : ''}`);
          throw err;
        }
        deps.logger.error(`Calendar not read (${ref.kind})`, err instanceof Error ? err.name : 'error');
        throw new CalendarReadError('failed');
      }
    },
  };
}
