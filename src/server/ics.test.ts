import { describe, expect, it } from 'vitest';
import { basicZones, looksLikeIcs, normalizeTzid, parseContentLine, parseIcs, parseRule, unescapeText, unfoldLines, type IcsOptions } from './ics';
import { intlZones } from './memory';
import type { CalendarEvent } from './services';

/** A calendar file around some VEVENT lines (CRLF, as servers send it). */
function ics(...events: string[][]): string {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Example//Test//EN'];
  for (const e of events) lines.push('BEGIN:VEVENT', ...e, 'END:VEVENT');
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

const RANGE = { start: new Date('2026-10-20T04:00:00Z'), end: new Date('2027-04-20T04:00:00Z') };

function parse(text: string, opts: Partial<IcsOptions> = {}) {
  return parseIcs(text, { range: RANGE, maxEvents: 500, zones: intlZones, ...opts });
}

const starts = (events: CalendarEvent[]) => events.map((e) => ('date' in e.start ? e.start.date : e.start.dateTime));

describe('iCal lines', () => {
  it('unfolds continuation lines (space or tab) and any line ending', () => {
    expect(unfoldLines('SUMMARY:Winter Con\r\n cert\nDESCRIPTION:a\r\n\tb\rLOCATION:x')).toEqual([
      'SUMMARY:Winter Concert',
      'DESCRIPTION:ab',
      'LOCATION:x',
    ]);
  });

  it('reads parameters, including quoted values with : and ;', () => {
    expect(parseContentLine('DTSTART;TZID="America/New_York";VALUE=DATE-TIME:20261114T190000')).toEqual({
      name: 'DTSTART',
      params: { TZID: 'America/New_York', VALUE: 'DATE-TIME' },
      value: '20261114T190000',
    });
    expect(parseContentLine('ATTENDEE;CN="Doe; Jane: Parent":mailto:x@example.com')?.value).toBe('mailto:x@example.com');
    expect(parseContentLine('no colon here')).toBeNull();
  });

  it('undoes TEXT escapes', () => {
    expect(unescapeText('Bring music\\, a stand\\; and a pencil\\nDoors 6:30\\N\\\\done')).toBe(
      'Bring music, a stand; and a pencil\nDoors 6:30\n\\done',
    );
  });

  it('normalizes TZIDs (UTC spellings, Windows names and display names, prefixed ids)', () => {
    expect(normalizeTzid('Etc/UTC')).toBe('UTC');
    expect(normalizeTzid('"GMT"')).toBe('UTC');
    expect(normalizeTzid('Eastern Standard Time')).toBe('America/New_York');
    expect(normalizeTzid('(UTC-05:00) Eastern Time (US & Canada)')).toBe('America/New_York');
    expect(normalizeTzid('(UTC-06:00) Central Time (US & Canada)')).toBe('America/Chicago');
    expect(normalizeTzid('(UTC-07:00) Arizona')).toBe('America/Phoenix');
    expect(normalizeTzid('/mozilla.org/20070129_1/America/New_York')).toBe('America/New_York');
    expect(normalizeTzid('Europe/London')).toBe('Europe/London');
  });

  it('tells a calendar file from a web page', () => {
    expect(looksLikeIcs('﻿ BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(looksLikeIcs('<!doctype html><html>Sign in</html>')).toBe(false);
  });
});

describe('iCal events', () => {
  it('reads one timed event with its text', () => {
    const r = parse(
      ics([
        'UID:concert-1@example.com',
        'DTSTART;TZID=America/New_York:20261114T190000',
        'DTEND;TZID=America/New_York:20261114T210000',
        'SUMMARY:Winter Con',
        ' cert',
        'LOCATION:TRHS Auditorium\\, Plaistow',
        'DESCRIPTION:Doors open 6:30.\\nBring a canned good.',
        'BEGIN:VALARM',
        'ACTION:DISPLAY',
        'DESCRIPTION:Reminder text that is not the event',
        'TRIGGER:-PT30M',
        'END:VALARM',
      ]),
    );
    expect(r).toMatchObject({ calendars: 1, unsupported: 0, capped: false });
    expect(r.events).toEqual([
      {
        uid: 'concert-1@example.com',
        start: { dateTime: '2026-11-15T00:00:00.000Z' }, // 7 PM EST (after the clocks went back on Nov 1)
        end: { dateTime: '2026-11-15T02:00:00.000Z' },
        title: 'Winter Concert',
        location: 'TRHS Auditorium, Plaistow',
        description: 'Doors open 6:30.\nBring a canned good.',
      },
    ]);
  });

  it('reads UTC times, floating times (New York, or the calendar’s X-WR-TIMEZONE) and other zones', () => {
    const r = parse(
      ics(
        ['UID:utc', 'DTSTART:20261114T230000Z', 'SUMMARY:UTC'],
        ['UID:floating', 'DTSTART:20261114T190000', 'SUMMARY:Floating'],
        ['UID:london', 'DTSTART;TZID=Europe/London:20261201T190000', 'SUMMARY:London'],
        ['UID:windows', 'DTSTART;TZID=Eastern Standard Time:20261202T190000', 'SUMMARY:Windows zone'],
      ),
    );
    const byUid = Object.fromEntries(r.events.map((e) => [e.uid, e.start]));
    expect(byUid).toEqual({
      utc: { dateTime: '2026-11-14T23:00:00.000Z' },
      floating: { dateTime: '2026-11-15T00:00:00.000Z' },
      london: { dateTime: '2026-12-01T19:00:00.000Z' },
      windows: { dateTime: '2026-12-03T00:00:00.000Z' },
    });
    const chicago = parse(ics(['UID:f', 'DTSTART:20261114T190000', 'SUMMARY:x']).replace('VERSION:2.0', 'VERSION:2.0\r\nX-WR-TIMEZONE:America/Chicago'));
    expect(chicago.events[0].start).toEqual({ dateTime: '2026-11-15T01:00:00.000Z' });
  });

  it('reads a TZID it doesn’t know from the file’s VTIMEZONE when that is a US zone (as Outlook writes them)', () => {
    const vtimezone = (tzid: string, standard: string, daylight: string, rules = true) => [
      'BEGIN:VTIMEZONE',
      `TZID:${tzid}`,
      'BEGIN:STANDARD',
      'DTSTART:16010101T020000',
      `TZOFFSETFROM:${daylight}`,
      `TZOFFSETTO:${standard}`,
      ...(rules ? ['RRULE:FREQ=YEARLY;INTERVAL=1;BYDAY=1SU;BYMONTH=11'] : []),
      'END:STANDARD',
      'BEGIN:DAYLIGHT',
      'DTSTART:16010101T020000',
      `TZOFFSETFROM:${standard}`,
      `TZOFFSETTO:${daylight}`,
      ...(rules ? ['RRULE:FREQ=YEARLY;INTERVAL=1;BYDAY=2SU;BYMONTH=3'] : []),
      'END:DAYLIGHT',
      'END:VTIMEZONE',
    ];
    const file = (zones: string[][], tzid: string) =>
      ics(['UID:x1', `DTSTART;TZID="${tzid}":20261112T190000`, `DTEND;TZID="${tzid}":20261112T210000`, 'SUMMARY:Winter concert']).replace(
        'BEGIN:VEVENT',
        [...zones.flat(), 'BEGIN:VEVENT'].join('\r\n'),
      );
    const outlook = '(UTC-05:00) Eastern Time (US & Canada)';
    for (const zones of [intlZones, basicZones]) {
      const r = parse(file([vtimezone(outlook, '-0500', '-0400')], outlook), { zones });
      expect(r).toMatchObject({ unsupported: 0 });
      expect(starts(r.events)).toEqual(['2026-11-13T00:00:00.000Z']); // 7 PM EST
    }
    // A made-up name: the VTIMEZONE says which zone (US Central here).
    const custom = parse(file([vtimezone('Custom Time Zone', '-0600', '-0500')], 'Custom Time Zone').replace(/20261112/g, '20270310'));
    expect(starts(custom.events)).toEqual(['2027-03-11T01:00:00.000Z']); // Mar 10 is before the switch: 7 PM CST
    // Anything else stays unreadable, never guessed.
    const india = parse(file([['BEGIN:VTIMEZONE', 'TZID:My Zone', 'BEGIN:STANDARD', 'DTSTART:16010101T000000', 'TZOFFSETTO:+0530', 'END:STANDARD', 'END:VTIMEZONE']], 'My Zone'));
    expect(india).toMatchObject({ events: [], unsupported: 1 });
    const noRules = parse(file([vtimezone('Odd Zone', '-0500', '-0400', false)], 'Odd Zone'));
    expect(noRules).toMatchObject({ events: [], unsupported: 1 });
  });

  it('skips and counts an event in a time zone it can’t look up (never guessed)', () => {
    const r = parse(ics(['UID:mars', 'DTSTART;TZID=Mars/Olympus_Mons:20261114T190000', 'SUMMARY:x'], ['UID:ok', 'DTSTART:20261114T230000Z', 'SUMMARY:y']));
    expect(r.events.map((e) => e.uid)).toEqual(['ok']);
    expect(r.unsupported).toBe(1);
    // Without Intl only UTC and New York are known.
    const basic = parseIcs(ics(['UID:london', 'DTSTART;TZID=Europe/London:20261201T190000', 'SUMMARY:x']), { range: RANGE, maxEvents: 10, zones: basicZones });
    expect(basic).toMatchObject({ events: [], unsupported: 1 });
  });

  it('reads all-day dates (VALUE=DATE, exclusive end) and DURATION', () => {
    const r = parse(
      ics(
        ['UID:break', 'DTSTART;VALUE=DATE:20261223', 'DTEND;VALUE=DATE:20270102', 'SUMMARY:Winter break'],
        ['UID:day', 'DTSTART;VALUE=DATE:20261114', 'SUMMARY:One day'],
        ['UID:dur', 'DTSTART:20261114T150000Z', 'DURATION:PT1H30M', 'SUMMARY:Ninety minutes'],
      ),
    );
    const byUid = Object.fromEntries(r.events.map((e) => [e.uid, [e.start, e.end]]));
    expect(byUid.break).toEqual([{ date: '2026-12-23' }, { date: '2027-01-02' }]);
    expect(byUid.day).toEqual([{ date: '2026-11-14' }, { date: '2026-11-15' }]);
    expect(byUid.dur).toEqual([{ dateTime: '2026-11-14T15:00:00.000Z' }, { dateTime: '2026-11-14T16:30:00.000Z' }]);
  });

  it('flags cancelled and private/confidential events for the sync to skip', () => {
    const r = parse(
      ics(
        ['UID:c', 'DTSTART:20261114T230000Z', 'SUMMARY:Called off', 'STATUS:CANCELLED'],
        ['UID:p', 'DTSTART:20261115T230000Z', 'SUMMARY:Staff only', 'CLASS:PRIVATE'],
        ['UID:q', 'DTSTART:20261116T230000Z', 'SUMMARY:Also staff', 'CLASS:CONFIDENTIAL'],
        ['UID:pub', 'DTSTART:20261117T230000Z', 'SUMMARY:Public', 'CLASS:PUBLIC'],
      ),
    );
    expect(r.events.map((e) => [e.uid, !!e.cancelled, !!e.private])).toEqual([
      ['c', true, false],
      ['p', false, true],
      ['q', false, true],
      ['pub', false, false],
    ]);
  });

  it('keeps only events overlapping the range, soonest first, and caps them', () => {
    const r = parse(
      ics(
        ['UID:late', 'DTSTART:20270101T150000Z', 'SUMMARY:Late'],
        ['UID:past', 'DTSTART:20250101T150000Z', 'SUMMARY:Long ago'],
        ['UID:soon', 'DTSTART:20261101T150000Z', 'SUMMARY:Soon'],
        ['UID:after', 'DTSTART:20280101T150000Z', 'SUMMARY:After the range'],
        // Started before the range and still going: overlaps.
        ['UID:running', 'DTSTART;VALUE=DATE:20261015', 'DTEND;VALUE=DATE:20261025', 'SUMMARY:Running'],
      ),
    );
    expect(r.events.map((e) => e.uid)).toEqual(['running', 'soon', 'late']);
    const capped = parse(ics(['UID:d', 'DTSTART:20261101T150000Z', 'RRULE:FREQ=DAILY', 'SUMMARY:Daily']), { maxEvents: 3 });
    expect(capped.events).toHaveLength(3);
    expect(capped.capped).toBe(true);
  });

  it('survives garbage: not a calendar, missing DTSTART, broken dates, missing END', () => {
    expect(parse('hello world')).toEqual({ calendars: 0, events: [], unsupported: 0, capped: false });
    expect(parse('')).toMatchObject({ calendars: 0, events: [] });
    const r = parse(
      [
        'BEGIN:VCALENDAR',
        'BEGIN:VEVENT',
        'SUMMARY:No start',
        'END:VEVENT',
        'BEGIN:VEVENT',
        'DTSTART:2026-11-14',
        'SUMMARY:Bad date',
        'END:VEVENT',
        'BEGIN:VEVENT',
        'UID:fine',
        'DTSTART:20261114T230000Z',
        'SUMMARY:Fine',
        'NOT A PROPERTY',
        'END:VEVENT',
        'BEGIN:VEVENT',
        'UID:unclosed',
        'DTSTART:20261115T230000Z',
        'SUMMARY:Never closed',
      ].join('\n'),
    );
    expect(r.calendars).toBe(1);
    expect(r.events.map((e) => e.uid)).toEqual(['fine']);
    expect(r.unsupported).toBe(2);
  });
});

describe('iCal repeating events', () => {
  it('WEEKLY with BYDAY and COUNT (DTSTART counts as the first)', () => {
    const r = parse(ics(['UID:rehearsal', 'DTSTART;TZID=America/New_York:20261103T190000', 'RRULE:FREQ=WEEKLY;BYDAY=TU,TH;COUNT=4', 'SUMMARY:Rehearsal']));
    expect(starts(r.events)).toEqual([
      '2026-11-04T00:00:00.000Z', // Tue Nov 3, 7 PM EST
      '2026-11-06T00:00:00.000Z', // Thu Nov 5
      '2026-11-11T00:00:00.000Z', // Tue Nov 10
      '2026-11-13T00:00:00.000Z', // Thu Nov 12
    ]);
    expect(r.events.every((e) => e.uid === 'rehearsal')).toBe(true);
  });

  it('keeps the local time across the end of daylight saving time', () => {
    const r = parse(ics(['UID:dst', 'DTSTART;TZID=America/New_York:20261027T190000', 'RRULE:FREQ=WEEKLY;COUNT=3', 'SUMMARY:Lessons']));
    expect(starts(r.events)).toEqual(['2026-10-27T23:00:00.000Z', '2026-11-04T00:00:00.000Z', '2026-11-11T00:00:00.000Z']);
  });

  it('INTERVAL, UNTIL (inclusive) and WKST', () => {
    const everyOther = parse(ics(['UID:a', 'DTSTART:20261102T150000Z', 'RRULE:FREQ=WEEKLY;INTERVAL=2;UNTIL=20261214T150000Z', 'SUMMARY:x']));
    expect(starts(everyOther.events)).toEqual([
      '2026-11-02T15:00:00.000Z',
      '2026-11-16T15:00:00.000Z',
      '2026-11-30T15:00:00.000Z',
      '2026-12-14T15:00:00.000Z',
    ]);
    const daily = parse(ics(['UID:b', 'DTSTART;VALUE=DATE:20261102', 'RRULE:FREQ=DAILY;UNTIL=20261105', 'SUMMARY:x']));
    expect(starts(daily.events)).toEqual(['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05']);
    // Weekdays only (how Outlook writes "every weekday").
    const weekdays = parse(ics(['UID:c', 'DTSTART;VALUE=DATE:20261106', 'RRULE:FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR;COUNT=3', 'SUMMARY:x']));
    expect(starts(weekdays.events)).toEqual(['2026-11-06', '2026-11-09', '2026-11-10']);
    // With INTERVAL=2 the week start decides which weeks count (RFC 5545's own example).
    const su = parse(ics(['UID:d', 'DTSTART;VALUE=DATE:20261103', 'RRULE:FREQ=WEEKLY;INTERVAL=2;COUNT=4;BYDAY=TU,SU;WKST=SU', 'SUMMARY:x']));
    expect(starts(su.events)).toEqual(['2026-11-03', '2026-11-15', '2026-11-17', '2026-11-29']);
    const mo = parse(ics(['UID:e', 'DTSTART;VALUE=DATE:20261103', 'RRULE:FREQ=WEEKLY;INTERVAL=2;COUNT=4;BYDAY=TU,SU;WKST=MO', 'SUMMARY:x']));
    expect(starts(mo.events)).toEqual(['2026-11-03', '2026-11-08', '2026-11-17', '2026-11-22']);
  });

  it('MONTHLY on the 2nd Tuesday, the last Tuesday (BYSETPOS) and a day of the month; YEARLY', () => {
    const second = parse(ics(['UID:m', 'DTSTART;TZID=America/New_York:20261110T190000', 'RRULE:FREQ=MONTHLY;BYDAY=2TU;COUNT=3', 'SUMMARY:TMA meeting']));
    expect(starts(second.events)).toEqual(['2026-11-11T00:00:00.000Z', '2026-12-09T00:00:00.000Z', '2027-01-13T00:00:00.000Z']);
    const last = parse(ics(['UID:l', 'DTSTART;VALUE=DATE:20261124', 'RRULE:FREQ=MONTHLY;BYDAY=TU;BYSETPOS=-1;COUNT=3', 'SUMMARY:x']));
    expect(starts(last.events)).toEqual(['2026-11-24', '2026-12-29', '2027-01-26']);
    const day31 = parse(ics(['UID:31', 'DTSTART;VALUE=DATE:20261031', 'RRULE:FREQ=MONTHLY;COUNT=4', 'SUMMARY:x']));
    expect(starts(day31.events)).toEqual(['2026-10-31', '2026-12-31', '2027-01-31', '2027-03-31']); // months without a 31st are skipped
    const leap = parseIcs(ics(['UID:y', 'DTSTART;VALUE=DATE:20240229', 'RRULE:FREQ=YEARLY', 'SUMMARY:Leap day']), {
      range: { start: new Date('2025-01-01T00:00:00Z'), end: new Date('2030-01-01T00:00:00Z') },
      maxEvents: 10,
      zones: intlZones,
    });
    expect(starts(leap.events)).toEqual(['2028-02-29']);
  });

  it('removes EXDATEs and applies RECURRENCE-ID changes (moved, renamed, cancelled)', () => {
    const r = parse(
      ics(
        [
          'UID:series',
          'DTSTART;TZID=America/New_York:20261103T190000',
          'RRULE:FREQ=WEEKLY;BYDAY=TU;COUNT=5',
          'EXDATE;TZID=America/New_York:20261110T190000',
          'SUMMARY:Jazz rehearsal',
        ],
        // Nov 17 moved to Wednesday Nov 18 at 6 PM, with a new title.
        ['UID:series', 'RECURRENCE-ID;TZID=America/New_York:20261117T190000', 'DTSTART;TZID=America/New_York:20261118T180000', 'SUMMARY:Jazz rehearsal (moved)'],
        // Nov 24 cancelled.
        ['UID:series', 'RECURRENCE-ID;TZID=America/New_York:20261124T190000', 'DTSTART;TZID=America/New_York:20261124T190000', 'STATUS:CANCELLED', 'SUMMARY:Jazz rehearsal'],
      ),
    );
    expect(r.events.map((e) => [('dateTime' in e.start ? e.start.dateTime : ''), e.title])).toEqual([
      ['2026-11-04T00:00:00.000Z', 'Jazz rehearsal'],
      ['2026-11-18T23:00:00.000Z', 'Jazz rehearsal (moved)'],
      ['2026-12-02T00:00:00.000Z', 'Jazz rehearsal'],
    ]);
  });

  it('keeps a changed occurrence of a private series private, even without its own CLASS line', () => {
    const r = parse(
      ics(
        ['UID:p', 'DTSTART;TZID=America/New_York:20261103T160000', 'RRULE:FREQ=WEEKLY;COUNT=4', 'CLASS:PRIVATE', 'SUMMARY:Family appointment'],
        // Nov 10 moved to Nov 11; and a change that matches no occurrence of the series.
        ['UID:p', 'RECURRENCE-ID;TZID=America/New_York:20261110T160000', 'DTSTART;TZID=America/New_York:20261111T160000', 'SUMMARY:Family appointment (moved)'],
        ['UID:p', 'RECURRENCE-ID;TZID=America/New_York:20261112T160000', 'DTSTART;TZID=America/New_York:20261113T160000', 'SUMMARY:Family appointment (extra)'],
      ),
    );
    expect(r.events).toHaveLength(5);
    expect(r.events.filter((e) => !e.private)).toEqual([]);
  });

  it('adds RDATEs and keeps a change whose series is not in the file', () => {
    const r = parse(
      ics(
        ['UID:r', 'DTSTART;VALUE=DATE:20261102', 'RDATE;VALUE=DATE:20261109,20261123', 'SUMMARY:x'],
        ['UID:orphan', 'RECURRENCE-ID:20261105T150000Z', 'DTSTART:20261106T150000Z', 'SUMMARY:Changed occurrence'],
      ),
    );
    expect(starts(r.events)).toEqual(['2026-11-02', '2026-11-06T15:00:00.000Z', '2026-11-09', '2026-11-23']);
  });

  it('skips and counts a series whose rule it can’t follow (the whole series, never guessed)', () => {
    const r = parse(
      ics(
        ['UID:hourly', 'DTSTART:20261102T150000Z', 'RRULE:FREQ=HOURLY;COUNT=3', 'SUMMARY:x'],
        ['UID:weekno', 'DTSTART:20261102T150000Z', 'RRULE:FREQ=YEARLY;BYWEEKNO=20', 'SUMMARY:x'],
        ['UID:two', 'DTSTART:20261102T150000Z', 'RRULE:FREQ=DAILY;COUNT=2', 'RRULE:FREQ=WEEKLY;COUNT=2', 'SUMMARY:x'],
        ['UID:ok', 'DTSTART:20261102T150000Z', 'SUMMARY:fine'],
      ),
    );
    expect(r.events.map((e) => e.uid)).toEqual(['ok']);
    expect(r.unsupported).toBe(3);
    expect(parseRule('FREQ=MONTHLY;BYDAY=2TU;INTERVAL=2')).toMatchObject({ freq: 'MONTHLY', interval: 2, byDay: [{ ord: 2, wd: 2 }] });
    expect(parseRule('FREQ=WEEKLY;BYDAY=2TU')).toBeNull(); // "2nd Tuesday" only means something within a month
    expect(parseRule('FREQ=DAILY;COUNT=2;UNTIL=20261101')).toBeNull();
    expect(parseRule('FREQ=DAILY;INTERVAL=0')).toBeNull();
  });

  it('stays quick on a hostile file: rules that never match, old daily series, a work budget for the whole file', () => {
    const many = (n: number, lines: (i: number) => string[]) => ics(...Array.from({ length: n }, (_, i) => lines(i)));
    // February 30 never happens: each series stops once it is past the range.
    let t = Date.now();
    const feb30 = parse(many(2000, (i) => [`UID:f${i}`, 'DTSTART;VALUE=DATE:19000101', 'RRULE:FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=30', 'SUMMARY:x']));
    expect(feb30).toMatchObject({ events: [], unsupported: 0, capped: false });
    // Without COUNT, a series from 1900 starts next to the range.
    const old = parse(many(100, (i) => [`UID:o${i}`, 'DTSTART;VALUE=DATE:19000101', 'RRULE:FREQ=DAILY', 'SUMMARY:x']));
    expect(old).toMatchObject({ unsupported: 0 });
    expect(old.events).toHaveLength(500);
    expect(Date.now() - t).toBeLessThan(3000);
    // With a COUNT, every day from 1900 must be counted: the file's budget runs out, the remaining
    // series are left out (counted), and the result says it is incomplete.
    t = Date.now();
    const counted = parse(many(2000, (i) => [`UID:d${i}`, 'DTSTART;VALUE=DATE:19000101', 'RRULE:FREQ=DAILY;COUNT=999999', 'SUMMARY:x']));
    expect(Date.now() - t).toBeLessThan(3000);
    expect(counted.capped).toBe(true);
    expect(counted.unsupported).toBeGreaterThan(1900);
  });

  it('expands a long-running series quickly, returning only the range', () => {
    const t = Date.now();
    const r = parse(ics(['UID:old', 'DTSTART;TZID=America/New_York:19950101T080000', 'RRULE:FREQ=DAILY', 'SUMMARY:Every day since 1995']));
    expect(Date.now() - t).toBeLessThan(2000);
    expect(r.events.length).toBe(182);
    expect(r.unsupported).toBe(0);
  });
});
