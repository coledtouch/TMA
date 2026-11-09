import * as nodeCrypto from 'node:crypto';
import { createApp } from '../server/app';
import { calendarStatusLines } from '../server/calendars';
import { CalendarReadError, type CalendarWindow } from '../server/services';
import { TEST_NOW } from '../server/test-helpers';
import { createGasCalendarSource, gasZones, googleCalendarError, mapGoogleEvent, MAX_ICS_CHARS, readGoogleCalendar, readIcalLink } from './calendar';
import { createGasServices } from './services';
import { installGasFakes, uninstallGasFakes, type GasFakes } from './testing/fakes';

let gas: GasFakes;

beforeEach(() => {
  gas = installGasFakes(nodeCrypto);
});
afterEach(() => uninstallGasFakes());

const RANGE: CalendarWindow = { start: new Date('2026-10-20T04:00:00Z'), end: new Date('2027-04-20T04:00:00Z'), maxEvents: 500 };
const BOARD = 'abc123@group.calendar.google.com';
const ICS_URL = 'https://calendar.example.com/private-0123456789abcdef/basic.ics';

function problem(fn: () => unknown): { problem: string; detail: string } {
  try {
    fn();
  } catch (err) {
    if (err instanceof CalendarReadError) return { problem: err.problem, detail: err.detail };
    throw err;
  }
  throw new Error('expected a CalendarReadError');
}

describe('Google Calendar (Calendar advanced service)', () => {
  it('maps timed and all-day events; private, confidential and personal kinds are flagged; cancelled too', () => {
    expect(
      mapGoogleEvent({
        id: 'abc_20261115T000000Z',
        status: 'confirmed',
        summary: 'Winter Concert',
        location: 'TRHS',
        description: '<b>Concert black</b>',
        start: { dateTime: '2026-11-14T19:00:00-05:00', timeZone: 'America/New_York' },
        end: { dateTime: '2026-11-14T21:00:00-05:00' },
        attendees: [{ email: 'someone@example.com' }],
      }),
    ).toEqual({
      uid: 'abc_20261115T000000Z',
      start: { dateTime: '2026-11-15T00:00:00.000Z' },
      end: { dateTime: '2026-11-15T02:00:00.000Z' },
      title: 'Winter Concert',
      location: 'TRHS',
      description: '<b>Concert black</b>',
    });
    expect(mapGoogleEvent({ id: 'b', start: { date: '2026-12-23' }, end: { date: '2027-01-02' } })).toEqual({
      uid: 'b',
      start: { date: '2026-12-23' },
      end: { date: '2027-01-02' },
      title: '',
      location: '',
      description: '',
    });
    expect(mapGoogleEvent({ id: 'p', start: { date: '2026-12-23' }, visibility: 'private' })?.private).toBe(true);
    expect(mapGoogleEvent({ id: 'q', start: { date: '2026-12-23' }, visibility: 'confidential' })?.private).toBe(true);
    expect(mapGoogleEvent({ id: 'o', start: { date: '2026-12-23' }, eventType: 'outOfOffice' })?.private).toBe(true);
    expect(mapGoogleEvent({ id: 'd', start: { date: '2026-12-23' }, eventType: 'default', visibility: 'public' })?.private).toBeUndefined();
    expect(mapGoogleEvent({ id: 'c', start: { date: '2026-12-23' }, status: 'cancelled' })?.cancelled).toBe(true);
    expect(mapGoogleEvent({ start: { date: '2026-12-23' } })).toBeNull();
    expect(mapGoogleEvent({ id: 'x', start: { dateTime: 'soon' } })).toBeNull();
  });

  it('asks for single events in the range, oldest first, without deleted ones, and reads every page', () => {
    gas.calendar.handler = ({ args }) =>
      args.pageToken === 'p2'
        ? { items: [{ id: 'c', start: { date: '2026-12-01' } }] }
        : { items: [{ id: 'a', start: { date: '2026-11-01' } }, { id: 'broken' }], nextPageToken: 'p2' };
    const feed = readGoogleCalendar(BOARD, RANGE);
    expect(feed.events.map((e) => e.uid)).toEqual(['a', 'c']);
    expect(feed).toMatchObject({ unsupported: 1, capped: false });
    expect(gas.calendar.calls.map((c) => c.calendarId)).toEqual([BOARD, BOARD]);
    expect(gas.calendar.calls[0].args).toEqual({
      timeMin: '2026-10-20T04:00:00.000Z',
      timeMax: '2027-04-20T04:00:00.000Z',
      singleEvents: true,
      orderBy: 'startTime',
      showDeleted: false,
      maxResults: 250,
      fields: 'accessRole,nextPageToken,items(id,status,summary,description,location,start,end,visibility,eventType)',
    });
    expect(gas.calendar.calls[1].args.pageToken).toBe('p2');
  });

  it('stops at the limit and says so', () => {
    let page = 0;
    gas.calendar.handler = () => {
      page += 1;
      return { items: Array.from({ length: 250 }, (_, i) => ({ id: `e${page}-${i}`, start: { date: '2026-11-01' } })), nextPageToken: `p${page + 1}` };
    };
    const feed = readGoogleCalendar(BOARD, { ...RANGE, maxEvents: 300 });
    expect(feed.events).toHaveLength(300);
    expect(feed.capped).toBe(true);
    expect(gas.calendar.calls).toHaveLength(2);
  });

  it('refuses a calendar shared as free/busy only (its events have no names); a reader’s is read', () => {
    const busy = { id: 'busy-1', start: { dateTime: '2026-11-12T19:00:00-05:00' }, end: { dateTime: '2026-11-12T20:00:00-05:00' } };
    gas.calendar.handler = () => ({ accessRole: 'freeBusyReader', items: [busy], nextPageToken: 'p2' });
    expect(problem(() => readGoogleCalendar(BOARD, RANGE))).toEqual({ problem: 'free_busy', detail: '' });
    expect(gas.calendar.calls).toHaveLength(1);
    gas.calendar.handler = () => ({ accessRole: 'reader', items: [{ ...busy, summary: 'Pops concert' }] });
    expect(readGoogleCalendar(BOARD, RANGE).events.map((e) => e.title)).toEqual(['Pops concert']);
  });

  it('reports a missing advanced service (old appsscript.json) instead of crashing', () => {
    delete (globalThis as { Calendar?: unknown }).Calendar;
    expect(problem(() => readGoogleCalendar(BOARD, RANGE))).toEqual({ problem: 'no_service', detail: '' });
  });

  it('turns the API’s errors into reasons', () => {
    const cases: Array<[string, string, string]> = [
      ['API call to calendar.events.list failed with error: Not Found', 'not_found', 'HTTP 404'],
      ['GoogleJsonResponseException: API call to calendar.events.list failed with error: Forbidden', 'not_shared', 'HTTP 403'],
      ['API call to calendar.events.list failed with error: Request had insufficient authentication scopes.', 'no_permission', ''],
      ['You do not have permission to call Calendar.Events.list. Required permissions: https://www.googleapis.com/auth/calendar.readonly', 'no_permission', ''],
      ['API call to calendar.events.list failed with error: Rate Limit Exceeded', 'busy', 'HTTP 429'],
      ['API call to calendar.events.list failed with error: Backend Error', 'busy', ''],
      ['Google Calendar API has not been used in project 123 before or it is disabled.', 'no_service', ''],
      ['Something odd', 'failed', ''],
    ];
    for (const [message, reason, detail] of cases) {
      gas.calendar.handler = () => {
        throw new Error(message);
      };
      expect(problem(() => readGoogleCalendar(BOARD, RANGE)), message).toEqual({ problem: reason, detail });
      expect(googleCalendarError(new Error(message)).problem).toBe(reason);
    }
  });
});

describe('iCal links (UrlFetchApp)', () => {
  const ICS = [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'UID:london-1',
    'DTSTART;TZID=Europe/London:20261201T190000',
    'RRULE:FREQ=WEEKLY;COUNT=2',
    'SUMMARY:Exchange concert',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');

  it('fetches over https and reads the file, with other time zones through Utilities', () => {
    gas.fetch.handler = () => ({ code: 200, body: ICS });
    const feed = readIcalLink(ICS_URL, RANGE);
    expect(feed.events.map((e) => e.start)).toEqual([{ dateTime: '2026-12-01T19:00:00.000Z' }, { dateTime: '2026-12-08T19:00:00.000Z' }]);
    expect(gas.fetch.requests[0]).toMatchObject({ url: ICS_URL, method: 'get', muteHttpExceptions: true });
  });

  it('refuses http:// before fetching anything', () => {
    expect(problem(() => readIcalLink('http://calendar.example.com/a.ics', RANGE))).toEqual({ problem: 'bad_address', detail: '' });
    expect(gas.fetch.requests).toHaveLength(0);
  });

  it('reports HTTP errors, no answer, files that are too big and pages that are not calendars', () => {
    gas.fetch.handler = () => ({ code: 404, body: 'Not found' });
    expect(problem(() => readIcalLink(ICS_URL, RANGE))).toEqual({ problem: 'link_failed', detail: 'HTTP 404' });
    gas.fetch.handler = () => {
      throw new Error(`Address unavailable: ${ICS_URL}`);
    };
    const failed = problem(() => readIcalLink(ICS_URL, RANGE));
    expect(failed).toEqual({ problem: 'link_failed', detail: 'no answer' });
    expect(JSON.stringify(failed)).not.toContain('private-0123456789abcdef'); // a private link is a password
    gas.fetch.handler = () => ({ code: 200, body: ICS, headers: { 'Content-Length': String(MAX_ICS_CHARS + 1) } });
    expect(problem(() => readIcalLink(ICS_URL, RANGE)).problem).toBe('too_big');
    gas.fetch.handler = () => ({ code: 200, body: `BEGIN:VCALENDAR\r\n${'X-PAD:x\r\n'.repeat(MAX_ICS_CHARS / 9 + 1)}` });
    expect(problem(() => readIcalLink(ICS_URL, RANGE)).problem).toBe('too_big');
    gas.fetch.handler = () => ({ code: 200, body: '<!doctype html><html><body>Sign in to see this calendar</body></html>' });
    expect(problem(() => readIcalLink(ICS_URL, RANGE)).problem).toBe('not_ical');
  });

  it('resolves IANA zones with Utilities, and nothing else', () => {
    const wall = { year: 2026, month: 7, day: 1, hour: 19, minute: 0, second: 0 };
    expect(new Date(gasZones('Europe/London', wall)!).toISOString()).toBe('2026-07-01T18:00:00.000Z');
    expect(new Date(gasZones('America/New_York', wall)!).toISOString()).toBe('2026-07-01T23:00:00.000Z');
    expect(gasZones('UTC', wall)).toBe(Date.UTC(2026, 6, 1, 19));
    expect(gasZones('Mars/Olympus Mons', wall)).toBeNull();
    expect(gasZones('Not a zone', wall)).toBeNull();
  });

  it('never logs the link', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    try {
      gas.fetch.handler = () => ({ code: 403, body: '' });
      const source = createGasCalendarSource({ logger: { info: (m) => console.info(m), error: (m) => console.error(m) } });
      expect(() => source.read({ kind: 'ical', url: ICS_URL }, RANGE)).toThrow(CalendarReadError);
      expect(info.mock.calls.flat().join(' ')).not.toContain('calendar.example.com');
      expect(info.mock.calls.flat().join(' ')).toContain('link_failed, HTTP 403');
    } finally {
      info.mockRestore();
    }
  });
});

describe('the sync through the real sheet adapter', () => {
  function sheetWithCalendar() {
    const services = createGasServices();
    services.clock = { now: () => new Date(TEST_NOW.getTime()) };
    const app = createApp(services);
    app.setup({});
    services.store.append('Events', [{ ID: 'EV-1', Date: '2026-11-10', Time: '7:00 PM', Title: 'Typed by hand', Location: 'TRHS' }]);
    services.store.append('Calendars', [{ Name: 'Music Dept', Calendar: BOARD, Groups: 'Band', On: true }]);
    return { services, app, events: () => gas.spreadsheet.getSheetByName('Events')! };
  }

  const items = [
    { id: 'a', summary: '=HYPERLINK("https://evil.example","Tickets")', location: '+1 room', description: '-bring music', start: { dateTime: '2026-11-12T19:00:00-05:00' } },
    { id: 'b', summary: 'Pops concert', start: { dateTime: '2026-11-13T19:00:00-05:00' } },
    { id: 'c', summary: 'Winter break', start: { date: '2026-12-23' }, end: { date: '2027-01-02' } },
  ];

  it('writes calendar text as text, finds its rows again, writes nothing when nothing changed, and deletes whole rows', () => {
    const { app, events } = sheetWithCalendar();
    gas.calendar.handler = () => ({ items });
    expect(app.syncTick().calendars).toEqual({ read: 1, failed: 0, added: 3, updated: 0, removed: 0 });
    const sheet = events();
    const header = sheet.dump()[0] as string[];
    expect(header).toEqual(['ID', 'Date', 'Time', 'Title', 'Location', 'Details', 'Schools', 'Ensembles', 'Source', 'Calendar Event']);
    const col = (name: string) => header.indexOf(name) + 1;
    // Formula-looking text is stored with Sheets' text marker, and shows as typed.
    expect(sheet.raw(3, col('Title'))).toBe('\'=HYPERLINK("https://evil.example","Tickets")');
    expect(sheet.value(3, col('Title'))).toBe('=HYPERLINK("https://evil.example","Tickets")');
    expect(sheet.raw(3, col('Location'))).toBe("'+1 room");
    expect(sheet.raw(3, col('Details'))).toBe("'-bring music");
    expect(sheet.value(2, col('Title'))).toBe('Typed by hand');

    const opsBefore = sheet.ops.filter((op) => op !== 'getDataRange').length;
    gas.cache.entries.clear(); // forget the fingerprint: the rows themselves must match
    expect(app.syncTick().calendars).toEqual({ read: 1, failed: 0, added: 0, updated: 0, removed: 0 });
    expect(sheet.ops.filter((op) => op !== 'getDataRange')).toHaveLength(opsBefore);

    gas.calendar.handler = () => ({ items: [items[0], items[2]] });
    expect(app.syncTick().calendars).toMatchObject({ removed: 1 });
    expect(sheet.ops).toContain('deleteRows 4x1');
    expect(sheet.dump().slice(1).map((r) => r[col('Title') - 1])).toEqual([
      'Typed by hand',
      '=HYPERLINK("https://evil.example","Tickets")',
      'Winter break',
    ]);
  });

  it('formats the copied Title, Location and Details cells as plain text before writing them; Date and Time keep theirs', () => {
    const { app, events } = sheetWithCalendar();
    gas.calendar.handler = () => ({
      items: [{ id: 'n', summary: '0042', location: '12/5', description: '50%', start: { dateTime: '2026-11-12T18:30:00-05:00' } }],
    });
    expect(app.syncTick().calendars).toMatchObject({ added: 1 });
    const sheet = events();
    const header = sheet.dump()[0] as string[];
    const col = (name: string) => header.indexOf(name) + 1;
    expect(sheet.dump()[2].slice(col('Time') - 1, col('Details'))).toEqual(['6:30 PM', '0042', '12/5', '50%']);
    // Plain text on exactly those three cells, then the values.
    expect(sheet.ops.filter((op) => op.includes(' R3C'))).toEqual([
      `setNumberFormat R3C${col('Title')}:1x1 @`,
      `setNumberFormat R3C${col('Location')}:1x1 @`,
      `setNumberFormat R3C${col('Details')}:1x1 @`,
      `setValues R3C1:1x${header.length}`,
    ]);
    expect([...sheet.numberFormats.keys()].filter((key) => key.startsWith('3,'))).toHaveLength(3);
  });

  it('a calendar shared as free/busy only fails with what to do, and copies no rows', () => {
    const { app, events } = sheetWithCalendar();
    const busy = { id: 'busy-1', start: { dateTime: '2026-11-12T19:00:00-05:00' }, end: { dateTime: '2026-11-12T20:00:00-05:00' } };
    gas.calendar.handler = () => ({ accessRole: 'freeBusyReader', items: [busy] });
    const report = app.syncTick();
    expect(report.calendars).toEqual({ read: 0, failed: 1, added: 0, updated: 0, removed: 0 });
    expect(report.errors).toEqual([
      'Calendar "Music Dept": shared with this Google account as free/busy only, so event names and details can\'t be read. Share it with TMA\'s Google account with "See all event details".',
    ]);
    expect(events().dump().slice(1).map((r) => r[3])).toEqual(['Typed by hand']);

    // Shared again with all event details: copied.
    gas.calendar.handler = () => ({ accessRole: 'reader', items: [{ ...busy, summary: 'Pops concert' }] });
    expect(app.syncTick().calendars).toEqual({ read: 1, failed: 0, added: 1, updated: 0, removed: 0 });
    expect(events().dump().slice(1).map((r) => r[3])).toEqual(['Typed by hand', 'Pops concert']);
  });

  it('with the Calendars tab deleted, keeps the copied rows and says what to do (not silently frozen)', () => {
    const { app, events } = sheetWithCalendar();
    gas.calendar.handler = () => ({ items: [items[1]] });
    expect(app.syncTick().calendars).toMatchObject({ added: 1 });
    gas.spreadsheet.sheets.splice(gas.spreadsheet.sheets.indexOf(gas.spreadsheet.getSheetByName('Calendars')!), 1);
    gas.calendar.handler = () => ({ items: [] });
    gas.cache.entries.clear();
    expect(app.syncTick().errors).toEqual([expect.stringMatching(/^Calendars: The Calendars tab is missing \(renamed or deleted\?\), so 1 upcoming event copied/)]);
    expect(events().dump().slice(1).map((r) => r[3])).toEqual(['Typed by hand', 'Pops concert']);
    const log = gas.spreadsheet.getSheetByName('Log')!.dump();
    expect(log.filter((r) => String(r[2]).startsWith('The Calendars tab is missing'))).toHaveLength(1);
  });

  it('with an old appsscript.json (no Calendar service) the sync still runs and says what to do, in the Log once a day', () => {
    const { app, services } = sheetWithCalendar();
    delete (globalThis as { Calendar?: unknown }).Calendar;
    const first = app.syncTick();
    expect(first.errors).toEqual([expect.stringMatching(/^Calendar "Music Dept": the Google Calendar service is missing in Apps Script\. Paste the new appsscript.json/)]);
    app.syncTick();
    const log = gas.spreadsheet.getSheetByName('Log')!.dump();
    expect(log.filter((r) => String(r[2]).includes('Google Calendar service is missing'))).toHaveLength(1);
    expect(calendarStatusLines(services)).toContainEqual(expect.stringMatching(/^Calendar "Music Dept": ✗ the Google Calendar service is missing/));
  });
});
