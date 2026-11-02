import { describe, expect, it } from 'vitest';
import {
  addDays,
  base64UrlDecode,
  base64UrlEncode,
  canonical,
  cleanText,
  daysBetween,
  isEmail,
  nextSequentialId,
  normalizeGrade,
  nyDate,
  nyLocalToDate,
  nyOffsetMinutes,
  nyParts,
  parseBool,
  parseDate,
  parseList,
  parseTimeText,
  parseTimestamp,
  safeEqual,
  safeUrl,
  shortDate,
} from './util';

describe('America/New_York dates without Intl', () => {
  it('uses EST/EDT per US rules (2nd Sunday of March, 1st Sunday of November)', () => {
    // 2026: DST starts Sun Mar 8 at 2:00 EST (07:00Z), ends Sun Nov 1 at 2:00 EDT (06:00Z).
    expect(nyOffsetMinutes(new Date('2026-03-08T06:59:59Z'))).toBe(-300);
    expect(nyOffsetMinutes(new Date('2026-03-08T07:00:00Z'))).toBe(-240);
    expect(nyOffsetMinutes(new Date('2026-11-01T05:59:59Z'))).toBe(-240);
    expect(nyOffsetMinutes(new Date('2026-11-01T06:00:00Z'))).toBe(-300);
    // 2027: Mar 14 and Nov 7.
    expect(nyOffsetMinutes(new Date('2027-03-14T07:00:00Z'))).toBe(-240);
    expect(nyOffsetMinutes(new Date('2027-03-13T12:00:00Z'))).toBe(-300);
    expect(nyOffsetMinutes(new Date('2027-11-07T05:00:00Z'))).toBe(-240);
    expect(nyOffsetMinutes(new Date('2027-11-07T07:00:00Z'))).toBe(-300);
  });

  it('computes "today" as the New York calendar date', () => {
    expect(nyDate(new Date('2026-10-21T03:59:00Z'))).toBe('2026-10-20'); // 11:59 PM EDT
    expect(nyDate(new Date('2026-10-21T04:00:00Z'))).toBe('2026-10-21'); // midnight EDT
    expect(nyDate(new Date('2026-12-01T04:59:00Z'))).toBe('2026-11-30'); // 11:59 PM EST
    expect(nyDate(new Date('2026-12-01T05:00:00Z'))).toBe('2026-12-01');
    expect(nyDate(new Date('2027-01-01T03:00:00Z'))).toBe('2026-12-31'); // New Year's Eve in NY
    expect(nyParts(new Date('2026-07-04T23:30:00Z'))).toMatchObject({ year: 2026, month: 7, day: 4, hour: 19, minute: 30 });
  });

  it('converts New York wall-clock time to instants across DST', () => {
    expect(nyLocalToDate(2026, 10, 21, 19, 0).toISOString()).toBe('2026-10-21T23:00:00.000Z');
    expect(nyLocalToDate(2026, 12, 21, 19, 0).toISOString()).toBe('2026-12-22T00:00:00.000Z');
    expect(nyLocalToDate(2026, 3, 8, 12, 0).toISOString()).toBe('2026-03-08T16:00:00.000Z');
    expect(nyLocalToDate(2026, 11, 1, 12, 0).toISOString()).toBe('2026-11-01T17:00:00.000Z');
  });

  it('does day arithmetic on calendar dates across DST and month ends', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-11-01', 1)).toBe('2026-11-02');
    expect(addDays('2026-03-07', 2)).toBe('2026-03-09');
    expect(addDays('2027-02-28', 1)).toBe('2027-03-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(daysBetween('2026-10-25', '2026-11-08')).toBe(14);
    expect(daysBetween('2026-03-01', '2026-03-15')).toBe(14);
    expect(daysBetween('2026-10-21', '2026-10-20')).toBe(-1);
    expect(shortDate('2027-02-01')).toBe('Feb 1');
  });
});

describe('parseDate', () => {
  it.each([
    ['2026-10-21', '2026-10-21'],
    ['2026-1-5', '2026-01-05'],
    ['10/21/2026', '2026-10-21'],
    ['1/5/27', '2027-01-05'],
    ['10/21/2026 7:30 PM', '2026-10-21'],
    ['2026-10-21T03:30:00.000Z', '2026-10-20'], // 11:30 PM EDT on the 20th
    ['2026-10-21T15:00:00-04:00', '2026-10-21'],
    ['2026-10-21T00:00:00', '2026-10-21'], // no zone: literal calendar date
    [46316, '2026-10-21'], // Sheets serial
    ['46316', '2026-10-21'],
    ['', null],
    ['   ', null],
    [null, null],
    ['2026-02-30', null],
    ['13/1/2026', null],
    ['soon', null],
  ])('%s -> %s', (input, expected) => {
    expect(parseDate(input)).toBe(expected);
  });

  it('reads Date objects with local getters (the script timezone in Apps Script)', () => {
    expect(parseDate(new Date(2026, 9, 21))).toBe('2026-10-21');
    expect(parseDate(new Date(Number.NaN))).toBeNull();
  });
});

describe('parseTimestamp', () => {
  it('accepts Dates, ISO strings and New York wall-clock text', () => {
    expect(parseTimestamp(new Date('2026-10-21T14:00:00Z'))).toBe('2026-10-21T14:00:00.000Z');
    expect(parseTimestamp('2026-10-21T14:00:00.000Z')).toBe('2026-10-21T14:00:00.000Z');
    expect(parseTimestamp('2026-10-21')).toBe('2026-10-21T04:00:00.000Z');
    expect(parseTimestamp('10/21/2026 7:30 PM')).toBe('2026-10-21T23:30:00.000Z');
    expect(parseTimestamp('12/21/2026 12:05 am')).toBe('2026-12-21T05:05:00.000Z');
    expect(parseTimestamp('TRUE')).toBeNull();
    expect(parseTimestamp('')).toBeNull();
  });
});

describe('cell helpers', () => {
  it('parses booleans the way treasurers type them', () => {
    for (const t of [true, 'TRUE', 'yes', 'Y', 'x', '1', 1]) expect(parseBool(t, false)).toBe(true);
    for (const f of [false, 'FALSE', 'no', 'N', '0', 0]) expect(parseBool(f, true)).toBe(false);
    expect(parseBool('', true)).toBe(true);
    expect(parseBool(null, false)).toBe(false);
    expect(parseBool('maybe', true)).toBe(true);
  });

  it('splits lists and canonicalizes known names', () => {
    const known = ['Band', 'Marching Band', 'Jazz Band'];
    expect(parseList('band; marching band /JAZZ BAND\nKazoo, Band', known)).toEqual([
      'Band',
      'Marching Band',
      'Jazz Band',
      'Kazoo',
    ]);
    expect(canonical('high school', ['High School'])).toBe('High School');
    expect(canonical('Pollard', ['High School'])).toBe('Pollard');
  });

  it('normalizes grades', () => {
    expect(normalizeGrade(11)).toBe('11');
    expect(normalizeGrade('11th')).toBe('11');
    expect(normalizeGrade('Grade 5')).toBe('5');
    expect(normalizeGrade('05')).toBe('5');
    expect(normalizeGrade('k')).toBe('K');
    expect(normalizeGrade('Kindergarten')).toBe('K');
    expect(normalizeGrade('Senior')).toBe('Senior');
  });

  it('formats Sheets time values', () => {
    expect(parseTimeText('7:00 PM')).toBe('7:00 PM');
    expect(parseTimeText(0.8125)).toBe('7:30 PM');
    expect(parseTimeText(new Date(1899, 11, 30, 18, 5))).toBe('6:05 PM');
    expect(parseTimeText(new Date(1899, 11, 30, 0, 0))).toBe('12:00 AM');
  });

  it('allocates sequential IDs after the max numeric suffix', () => {
    expect(nextSequentialId('F', ['F0001', 'f0009', 'F12', 'X0099', 'Family'])).toBe('F0013');
    expect(nextSequentialId('S', [])).toBe('S0001');
  });
});

describe('text and security helpers', () => {
  it('cleans control and invisible characters', () => {
    expect(cleanText('  Jordan\u0000  ​Thompson‮ ')).toBe('Jordan Thompson');
    expect(cleanText('line 1\r\n\r\n\r\n\r\nline\t 2  ', true)).toBe('line 1\n\nline 2');
    expect(cleanText('a\nb')).toBe('a b');
  });

  it('validates emails', () => {
    expect(isEmail('parent@example.com')).toBe(true);
    expect(isEmail("o'brien+tma@mail.example.org")).toBe(true);
    for (const bad of ['', 'parent', 'parent@', '@example.com', 'a..b@example.com', 'a@example', 'a b@example.com', `${'x'.repeat(195)}@ex.com`]) {
      expect(isEmail(bad)).toBe(false);
    }
  });

  it('only accepts http(s) URLs', () => {
    expect(safeUrl('https://example.com/a?b=1')).toBe('https://example.com/a?b=1');
    expect(safeUrl('javascript:alert(1)')).toBeUndefined();
    expect(safeUrl('https://example.com/"><script>')).toBeUndefined();
    expect(safeUrl('data:text/html,hi')).toBeUndefined();
  });

  it('round-trips base64url and rejects malformed input', () => {
    for (const text of ['', 'f', 'fo', 'foo', 'foob', '{"e":"a@b.co","v":"1","x":1}', 'café \u{1F3BA}']) {
      const encoded = base64UrlEncode(text);
      expect(encoded).toMatch(/^[A-Za-z0-9_-]*$/);
      expect(base64UrlDecode(encoded)).toBe(text);
    }
    expect(base64UrlEncode('foobar')).toBe('Zm9vYmFy');
    expect(base64UrlEncode('ÿþ')).toBe('w7_Dvg');
    expect(base64UrlDecode('Zm9vYmFy=')).toBeNull();
    expect(base64UrlDecode('Z')).toBeNull();
    expect(base64UrlDecode('Zh')).toBeNull(); // non-zero padding bits
    expect(base64UrlDecode('Zm+v')).toBeNull();
  });

  it('compares strings in constant time semantics', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});
