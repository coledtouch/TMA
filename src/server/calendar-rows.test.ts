import { describe, expect, it } from 'vitest';
import {
  audienceFromText,
  audienceNames,
  buildCalendarRow,
  calendarEventKey,
  calendarHash,
  calendarKeyHash,
  calendarProblemText,
  calendarRowId,
  htmlToText,
  mergeAudience,
  parseCalendarAddress,
} from './calendar-rows';
import type { CalendarEvent } from './services';
import { base64UrlEncode } from './util';

const KNOWN = {
  schools: ['High School', 'Middle School', 'Elementary'],
  ensembles: ['Band', 'Marching Band', 'Jazz Band', 'Orchestra', 'Chorus', 'Guitar'],
};
const SOURCE = { name: 'Music Dept', hash: 'a1b2c3d4e5', schools: [], ensembles: ['Band'] };

function event(over: Partial<CalendarEvent> = {}): CalendarEvent {
  return { uid: 'evt1', start: { dateTime: '2026-11-15T00:00:00.000Z' }, title: 'Winter Concert', location: 'TRHS Auditorium', description: '', ...over };
}

describe('Calendar column', () => {
  it('takes a Google Calendar ID or an account’s own address', () => {
    expect(parseCalendarAddress(' abc123@group.calendar.google.com ')).toEqual({ ref: { kind: 'google', id: 'abc123@group.calendar.google.com' } });
    expect(parseCalendarAddress('tma.board@example.com')).toEqual({ ref: { kind: 'google', id: 'tma.board@example.com' } });
    expect(parseCalendarAddress('example#holiday@group.v.calendar.google.com')).toEqual({
      ref: { kind: 'google', id: 'example#holiday@group.v.calendar.google.com' },
    });
  });

  it('finds the Calendar ID in Google Calendar links (public embed link, shared ?cid= link)', () => {
    expect(
      parseCalendarAddress('https://calendar.google.com/calendar/embed?src=abc123%40group.calendar.google.com&ctz=America%2FNew_York'),
    ).toEqual({ ref: { kind: 'google', id: 'abc123@group.calendar.google.com' } });
    const cid = base64UrlEncode('abc123@group.calendar.google.com');
    expect(parseCalendarAddress(`https://calendar.google.com/calendar/u/0?cid=${cid}`)).toEqual({
      ref: { kind: 'google', id: 'abc123@group.calendar.google.com' },
    });
  });

  it('takes https iCal links (webcal:// becomes https://), never http://', () => {
    expect(parseCalendarAddress('https://calendar.example.com/tma.ics')).toEqual({ ref: { kind: 'ical', url: 'https://calendar.example.com/tma.ics' } });
    expect(parseCalendarAddress('webcal://calendar.example.com/tma.ics')).toEqual({ ref: { kind: 'ical', url: 'https://calendar.example.com/tma.ics' } });
    expect(parseCalendarAddress('https://calendar.google.com/calendar/ical/abc123%40group.calendar.google.com/public/basic.ics')).toMatchObject({
      ref: { kind: 'ical' },
    });
    expect(parseCalendarAddress('http://calendar.example.com/tma.ics')).toEqual({ problem: 'http' });
    expect(parseCalendarAddress('')).toEqual({ problem: 'blank' });
    expect(parseCalendarAddress('Music department calendar')).toEqual({ problem: 'bad' });
    expect(parseCalendarAddress('javascript:alert(1)')).toEqual({ problem: 'bad' });
  });

  it('gives each calendar a short stable hash (Google IDs ignore capitals)', () => {
    const a = calendarHash({ kind: 'google', id: 'ABC123@group.calendar.google.com' });
    expect(a).toMatch(/^[0-9a-f]{10}$/);
    expect(calendarHash({ kind: 'google', id: 'abc123@group.calendar.google.com' })).toBe(a);
    expect(calendarHash({ kind: 'ical', url: 'https://calendar.example.com/a.ics' })).not.toBe(a);
  });

  it('describes problems in plain words', () => {
    expect(calendarProblemText('no_service')).toMatch(/Paste the new appsscript.json.*Set up \/ repair tabs/);
    expect(calendarProblemText('not_found', 'HTTP 404')).toMatch(/^not found, or not shared with this Google account \(HTTP 404\)/);
    expect(calendarProblemText('not_shared', 'HTTP 403')).toMatch(/^not shared with this Google account/);
    expect(calendarProblemText('link_failed')).toMatch(/^the iCal link failed \(no answer\)/);
    expect(calendarProblemText('no_permission')).toMatch(/approve the new permission/);
  });
});

describe('event text', () => {
  it('turns a Google HTML description into plain text', () => {
    const html =
      '<p>Doors open at 6:30&nbsp;PM.</p><p>Bring <b>music</b> &amp; a stand<br>and a pencil</p><ul><li>Black pants</li><li>White shirt</li></ul>' +
      '<a href="https://tickets.example.com/winter">Tickets</a> <a href="https://tma.example.org">https://tma.example.org</a> <a href="javascript:alert(1)">click</a>' +
      '<script>alert(1)</script>Fish &#38; chips &#x2014; &#39;fun&#39;';
    expect(htmlToText(html).replace(/\n+/g, '\n').trim()).toBe(
      [
        'Doors open at 6:30 PM.',
        'Bring music & a stand',
        'and a pencil',
        '• Black pants',
        '• White shirt',
        "Tickets (https://tickets.example.com/winter) https://tma.example.org clickFish & chips — 'fun'",
      ].join('\n'),
    );
    expect(htmlToText('Plain text with 5 < 6 & a newline\nkept')).toBe('Plain text with 5 < 6 & a newline\nkept');
  });

  it('reads "Schools:" / "Groups:" / "Ensembles:" lines as the audience and removes them', () => {
    const r = audienceFromText('Bring music.\nSchools: middle school\nGroups: Jazz Band; chorus\nSee you there.', { schools: [], ensembles: ['Band'] }, KNOWN);
    expect(r).toEqual({
      text: 'Bring music.\nSee you there.',
      audience: { schools: ['Middle School'], ensembles: ['Jazz Band', 'Chorus'] },
      unknown: [],
    });
  });

  it('leaves out unknown names (reported); a line with none known keeps them as typed, never everyone; Everyone means everyone', () => {
    expect(audienceFromText('Ensembles: Jazz Band, Kazoo Choir', { schools: [], ensembles: ['Band'] }, KNOWN)).toEqual({
      text: '',
      audience: { schools: [], ensembles: ['Jazz Band'] },
      unknown: ['Kazoo Choir'],
    });
    // A misspelling matches no family's choices, as in a typed Events row: not the calendar's default,
    // and on an everyone calendar not everyone.
    expect(audienceFromText('Groups: Jazz Bnad', { schools: [], ensembles: ['Band'] }, KNOWN)).toMatchObject({
      audience: { schools: [], ensembles: ['Jazz Bnad'] },
      unknown: ['Jazz Bnad'],
    });
    expect(audienceFromText('Groups: Jaz Band', { schools: [], ensembles: [] }, KNOWN).audience).toEqual({ schools: [], ensembles: ['Jaz Band'] });
    expect(audienceFromText('Groups:', { schools: [], ensembles: ['Band'] }, KNOWN).audience).toEqual({ schools: [], ensembles: ['Band'] });
    expect(audienceFromText('Groups: Everyone', { schools: ['High School'], ensembles: ['Band'] }, KNOWN).audience).toEqual({
      schools: ['High School'],
      ensembles: [],
    });
  });

  it('reads a Calendars-tab list: Everyone is everyone; a list with no known name is never everyone', () => {
    expect(audienceNames('band; kazoo choir', KNOWN.ensembles)).toEqual({ names: ['Band'], unknown: ['kazoo choir'] });
    expect(audienceNames('Jaz Band', KNOWN.ensembles)).toEqual({ names: ['Jaz Band'], unknown: ['Jaz Band'] });
    expect(audienceNames('Everyone', KNOWN.ensembles)).toEqual({ names: [], unknown: [] });
    expect(audienceNames(' all ', KNOWN.schools)).toEqual({ names: [], unknown: [] });
    expect(audienceNames('', KNOWN.schools)).toEqual({ names: [], unknown: [] });
  });

  it('merges who an event on two calendars is for, never narrower than either', () => {
    expect(mergeAudience({ schools: [], ensembles: ['Band'] }, { schools: [], ensembles: ['Orchestra', 'band'] })).toEqual({ schools: [], ensembles: ['Band', 'Orchestra'] });
    expect(mergeAudience({ schools: ['High School'], ensembles: [] }, { schools: [], ensembles: ['Band'] })).toEqual({ schools: [], ensembles: [] });
    expect(mergeAudience({ schools: [], ensembles: [] }, { schools: ['Middle School'], ensembles: ['Chorus'] })).toEqual({ schools: [], ensembles: [] });
  });
});

describe('the Events row for a calendar event', () => {
  it('fills every column, with a stable key and ID', () => {
    const built = buildCalendarRow(SOURCE, event({ description: 'Concert black.' }), KNOWN)!;
    expect(built.key).toBe('a1b2c3d4e5:evt1:20261115T000000Z');
    expect(calendarKeyHash(built.key)).toBe('a1b2c3d4e5');
    expect(built.row).toEqual({
      ID: calendarRowId(built.key),
      Date: '2026-11-14',
      Time: '7:00 PM',
      Title: 'Winter Concert',
      Location: 'TRHS Auditorium',
      Details: 'Concert black.',
      Schools: '',
      Ensembles: 'Band',
      Source: 'Music Dept',
      'Calendar Event': 'a1b2c3d4e5:evt1:20261115T000000Z',
    });
    expect(built.row.ID).toMatch(/^CAL-[0-9a-f]{10}$/);
    expect(buildCalendarRow(SOURCE, event(), KNOWN)!.row.ID).toBe(built.row.ID);
  });

  it('uses the New York date for late-evening events and keeps 7 PM across the clock change', () => {
    // 11:30 PM on Friday Nov 13 in New York is already Saturday in UTC.
    expect(buildCalendarRow(SOURCE, event({ start: { dateTime: '2026-11-14T04:30:00.000Z' } }), KNOWN)!.row).toMatchObject({
      Date: '2026-11-13',
      Time: '11:30 PM',
    });
    // Saturday Oct 31 (EDT) and Monday Nov 2 (EST), both 7 PM local.
    expect(buildCalendarRow(SOURCE, event({ start: { dateTime: '2026-10-31T23:00:00.000Z' } }), KNOWN)!.row).toMatchObject({ Date: '2026-10-31', Time: '7:00 PM' });
    expect(buildCalendarRow(SOURCE, event({ start: { dateTime: '2026-11-03T00:00:00.000Z' } }), KNOWN)!.row).toMatchObject({ Date: '2026-11-02', Time: '7:00 PM' });
  });

  it('leaves Time blank for all-day events and says "Through" for multi-day ones', () => {
    const allDay = buildCalendarRow(SOURCE, event({ start: { date: '2026-12-23' }, end: { date: '2027-01-02' }, description: 'No rehearsals.' }), KNOWN)!;
    expect(allDay.row).toMatchObject({ Date: '2026-12-23', Time: '', Details: 'Through Jan 1.\nNo rehearsals.' });
    expect(allDay.key).toBe('a1b2c3d4e5:evt1:20261223');
    expect(buildCalendarRow(SOURCE, event({ start: { date: '2026-12-23' }, end: { date: '2026-12-24' } }), KNOWN)!.row.Details).toBe('');
    // A timed event over two days; one that ends at midnight is one day.
    expect(
      buildCalendarRow(SOURCE, event({ start: { dateTime: '2026-11-14T14:00:00.000Z' }, end: { dateTime: '2026-11-15T22:00:00.000Z' } }), KNOWN)!.row.Details,
    ).toBe('Through Nov 15.');
    expect(
      buildCalendarRow(SOURCE, event({ start: { dateTime: '2026-11-14T23:00:00.000Z' }, end: { dateTime: '2026-11-15T05:00:00.000Z' } }), KNOWN)!.row.Details,
    ).toBe('');
  });

  it('trims long text, cleans invisible characters and hashes odd event ids', () => {
    const long = buildCalendarRow(
      SOURCE,
      event({ uid: 'x'.repeat(200), title: `T${'i'.repeat(300)}`, description: `${'word '.repeat(400)}`, location: '  Room​ 12  ' }),
      KNOWN,
    )!;
    expect(String(long.row.Title).length).toBe(120);
    expect(String(long.row.Details).length).toBeLessThanOrEqual(1000);
    expect(String(long.row.Details).endsWith('…')).toBe(true);
    expect(long.row.Location).toBe('Room 12');
    expect(long.key).toMatch(/^a1b2c3d4e5:h[0-9a-f]{16}:20261115T000000Z$/);
    expect(calendarEventKey('a1b2c3d4e5', event({ uid: 'abc_20261115T000000Z' }))).toBe('a1b2c3d4e5:abc_20261115T000000Z:20261115T000000Z');
    expect(buildCalendarRow(SOURCE, event({ title: '   ' }), KNOWN)!.row.Title).toBe('Untitled event');
    expect(buildCalendarRow(SOURCE, event({ start: { dateTime: 'not a date' } }), KNOWN)).toBeNull();
  });

  it('keeps formula-looking text as it is (the sheet writer stores it as text)', () => {
    const r = buildCalendarRow(SOURCE, event({ title: '=HYPERLINK("https://evil.example","x")', location: '+1 room', description: '@everyone -bring music' }), KNOWN)!;
    expect(r.row).toMatchObject({ Title: '=HYPERLINK("https://evil.example","x")', Location: '+1 room', Details: '@everyone -bring music' });
  });
});
