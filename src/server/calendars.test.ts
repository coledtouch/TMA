import { describe, expect, it } from 'vitest';
import type { TableName } from '../shared/schema';
import { calendarHash, calendarRowId } from './calendar-rows';
import { calendarStatusLines, MAX_EVENTS_PER_CALENDAR } from './calendars';
import { createMemoryCalendarSource, type MemoryCalendarFeed } from './memory';
import { sampleData } from './sample-data';
import type { CalendarEvent, CalendarFeed, RowData, Store } from './services';
import { harness, PARENT, TEST_NOW, TREASURER } from './test-helpers';

const BOARD = 'tma-board@example.com';
const MUSIC = 'https://calendar.example.com/music.ics';
const BOARD_HASH = calendarHash({ kind: 'google', id: BOARD });
const LATER = new Date(TEST_NOW.getTime() + 15 * 60 * 1000);

/** A timed event `days` after TEST_NOW's date at `hour` New York time (EDT until Nov 1, then EST). */
function at(day: string, hour: number, minute = 0): string {
  const offset = day < '2026-11-01' ? 4 : 5;
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, hour + offset, minute)).toISOString();
}

function timed(uid: string, day: string, hour: number, title: string, extra: Partial<CalendarEvent> = {}): CalendarEvent {
  return { uid, start: { dateTime: at(day, hour) }, end: { dateTime: at(day, hour + 2) }, title, location: 'TRHS', description: '', ...extra };
}

function feed(events: CalendarEvent[]): CalendarFeed {
  return { events, unsupported: 0, capped: false };
}

/** The sheet's own (typed) Events rows, without the demo calendar's. */
const typedEvents = (): RowData[] => sampleData(TEST_NOW).Events ?? [];

interface Setup {
  board?: CalendarFeed | MemoryCalendarFeed;
  music?: MemoryCalendarFeed;
  calendars?: RowData[];
  events?: RowData[];
  settings?: Record<string, string>;
}

function setup(s: Setup = {}) {
  const feeds: Record<string, () => MemoryCalendarFeed> = {};
  const state = { board: s.board ?? feed([]), music: s.music };
  feeds[BOARD] = () => state.board;
  if (s.music) feeds[MUSIC] = () => state.music as MemoryCalendarFeed;
  const source = createMemoryCalendarSource(feeds);
  const h = harness({
    calendars: source,
    settings: s.settings,
    tables: {
      Calendars: s.calendars ?? [{ Name: 'TMA Board', Calendar: BOARD, Schools: '', Groups: 'Band, Kazoo Choir', On: '' }],
      Events: s.events ?? typedEvents(),
    },
  });
  const events = () => h.rows('Events');
  const calendarRows = () => events().filter((r) => r.Source);
  return { h, state, source, events, calendarRows };
}

/** Count Store writes per tab. */
function countWrites(store: Store): Record<string, number> {
  const counts: Record<string, number> = {};
  const bump = (table: TableName) => {
    counts[table] = (counts[table] ?? 0) + 1;
  };
  const { append, update, overwrite } = store;
  const deleteRows = store.deleteRows;
  store.append = (t, rows) => (bump(t), append.call(store, t, rows));
  store.update = (t, n, patch) => (bump(t), update.call(store, t, n, patch));
  store.overwrite = (t, rows) => (bump(t), overwrite.call(store, t, rows));
  store.deleteRows = (t, rows) => (bump(t), deleteRows?.call(store, t, rows));
  return counts;
}

describe('syncTick: linked calendars', () => {
  it('copies a calendar’s events into Events and leaves typed rows alone', () => {
    const { h, calendarRows, events } = setup({
      board: feed([
        timed('meeting', '2026-11-10', 19, 'TMA monthly meeting (board)', { description: '<p>All welcome.</p><p>Schools: Middle School</p>' }),
        // 11:30 PM on Nov 13 in New York is Nov 14 in UTC.
        { uid: 'late', start: { dateTime: '2026-11-14T04:30:00.000Z' }, title: 'Late bus', location: '', description: '' },
        { uid: 'break', start: { date: '2026-12-23' }, end: { date: '2027-01-02' }, title: 'Winter break', location: '', description: 'No rehearsals.' },
      ]),
    });
    const typedBefore = events().filter((r) => !r.Source);
    const report = h.app.syncTick();
    expect(report.errors).toEqual([]);
    expect(report.calendars).toEqual({ read: 1, failed: 0, added: 3, updated: 0, removed: 0 });
    expect(calendarRows().map((r) => [r.Date, r.Time, r.Title, r.Schools, r.Ensembles, r.Source, r.Details])).toEqual([
      ['2026-11-10', '7:00 PM', 'TMA monthly meeting (board)', 'Middle School', 'Band', 'TMA Board', 'All welcome.'],
      ['2026-11-13', '11:30 PM', 'Late bus', '', 'Band', 'TMA Board', ''],
      ['2026-12-23', '', 'Winter break', '', 'Band', 'TMA Board', 'Through Jan 1.\nNo rehearsals.'],
    ]);
    for (const row of calendarRows()) {
      expect(String(row['Calendar Event'])).toMatch(new RegExp(`^${BOARD_HASH}:`));
      expect(row.ID).toBe(calendarRowId(String(row['Calendar Event'])));
    }
    expect(events().filter((r) => !r.Source)).toEqual(typedBefore);
    // "Kazoo Choir" isn't in Settings ENSEMBLES: left out, with a note and one Log row.
    expect(report.notes?.join(' ')).toMatch(/"Kazoo Choir" is not in Settings SCHOOLS or ENSEMBLES/);
    const log = h.rows('Log').filter((r) => r.Kind === 'calendar');
    expect(log.map((r) => r.Detail)).toEqual([
      expect.stringMatching(/^"TMA Board" note: "Kazoo Choir" is not in Settings/),
      'Calendar events copied into Events: 3 added, 0 changed, 0 removed (TMA Board)',
    ]);
    // Families see them under News like any other event.
    const news = h.ok('me.bootstrap', {}, h.signIn(PARENT)).events;
    expect(news.find((e) => e.title === 'Winter break')).toMatchObject({ source: 'TMA Board', audience: { schools: [], ensembles: ['Band'] } });
  });

  it('writes nothing on the next sync when nothing changed (also once the fingerprint is forgotten)', () => {
    const { h } = setup({ board: feed([timed('a', '2026-11-10', 19, 'A'), timed('b', '2026-11-12', 18, 'B')]) });
    h.app.syncTick();
    const writes = countWrites(h.services.store);
    h.services.setNow(LATER);
    expect(h.app.syncTick().calendars).toEqual({ read: 1, failed: 0, added: 0, updated: 0, removed: 0 });
    h.services.cache.remove('calendar-sync:fingerprint');
    expect(h.app.syncTick().calendars).toEqual({ read: 1, failed: 0, added: 0, updated: 0, removed: 0 });
    expect(writes.Events).toBeUndefined();
    // The note about "Kazoo Choir" was logged once today, not every sync.
    expect(h.rows('Log').filter((r) => String(r.Detail).includes('Kazoo Choir'))).toHaveLength(1);
  });

  it('updates what changed and removes cancelled, deleted, private and moved-away events in the range, keeping past rows', () => {
    const s = setup({
      board: feed([
        timed('a', '2026-11-10', 19, 'Concert'),
        timed('b', '2026-11-12', 18, 'Rehearsal'),
        timed('c', '2026-11-13', 18, 'Car wash'),
        timed('d', '2026-11-14', 18, 'Bake sale'),
        timed('e', '2026-11-15', 18, 'Pizza night'),
      ]),
    });
    s.h.app.syncTick();
    const before = s.calendarRows();
    // A row for an event long past: history, kept even though the calendar no longer has it.
    const pastKey = `${BOARD_HASH}:old:20260901T230000Z`;
    s.h.services.db.tables.Events!.push({ ID: calendarRowId(pastKey), Date: '2026-09-01', Time: '7:00 PM', Title: 'Old concert', Source: 'TMA Board', 'Calendar Event': pastKey });
    s.state.board = feed([
      timed('a', '2026-11-10', 19, 'Concert (new title)', { location: 'Gym' }),
      timed('b', '2026-11-12', 18, 'Rehearsal', { cancelled: true }),
      timed('d', '2026-11-14', 18, 'Bake sale', { private: true }),
      timed('e', '2028-01-15', 18, 'Pizza night'), // moved past the range
    ]);
    const writes = countWrites(s.h.services.store);
    s.h.services.setNow(LATER);
    const report = s.h.app.syncTick();
    expect(report.calendars).toEqual({ read: 1, failed: 0, added: 0, updated: 1, removed: 4 });
    expect(s.calendarRows().map((r) => [r.Date, r.Title, r.Location])).toEqual([
      ['2026-11-10', 'Concert (new title)', 'Gym'],
      ['2026-09-01', 'Old concert', undefined],
    ]);
    // Same row, same ID: only the changed cells were written.
    expect(s.calendarRows()[0].ID).toBe(before[0].ID);
    expect(writes.Events).toBe(2); // one update, one delete (of four rows)
  });

  it('replaces the row when an event moves to another day or time (a new ID, so its reminder goes out for the new day)', () => {
    const s = setup({ board: feed([timed('a', '2026-11-10', 19, 'Concert')]) });
    s.h.app.syncTick();
    const oldId = s.calendarRows()[0].ID;
    s.state.board = feed([timed('a', '2026-11-11', 19, 'Concert')]);
    s.h.services.setNow(LATER);
    expect(s.h.app.syncTick().calendars).toMatchObject({ added: 1, removed: 1 });
    expect(s.calendarRows().map((r) => r.Date)).toEqual(['2026-11-11']);
    expect(s.calendarRows()[0].ID).not.toBe(oldId);
  });

  it('keeps a calendar’s rows when it can’t be read; reports it every sync, logs it once a day', () => {
    const s = setup({
      board: feed([timed('a', '2026-11-10', 19, 'Concert')]),
      music: { ics: ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:m1', 'DTSTART;TZID=America/New_York:20261120T190000', 'SUMMARY:Pops concert', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n') },
      calendars: [
        { Name: 'TMA Board', Calendar: BOARD, On: 'TRUE' },
        { Name: 'Music Dept', Calendar: MUSIC, Groups: 'Orchestra' },
      ],
    });
    expect(s.h.app.syncTick().calendars).toEqual({ read: 2, failed: 0, added: 2, updated: 0, removed: 0 });
    expect(s.calendarRows().map((r) => [r.Title, r.Source, r.Ensembles])).toEqual([
      ['Concert', 'TMA Board', ''],
      ['Pops concert', 'Music Dept', 'Orchestra'],
    ]);
    s.state.board = { problem: 'not_shared', detail: 'HTTP 403' };
    for (const when of [LATER, new Date(LATER.getTime() + 15 * 60000)]) {
      s.h.services.setNow(when);
      const report = s.h.app.syncTick();
      expect(report.errors).toEqual([
        'Calendar "TMA Board": not shared with this Google account (HTTP 403). Share it with TMA\'s Google account ("See all event details"), or make it public.',
      ]);
      expect(report.calendars).toEqual({ read: 1, failed: 1, added: 0, updated: 0, removed: 0 });
      // The other calendar and the rest of the sync still ran.
      expect(report.balanceChanges).toBe(0);
    }
    expect(s.calendarRows().map((r) => r.Title)).toEqual(['Concert', 'Pops concert']);
    const logged = s.h.rows('Log').filter((r) => String(r.Detail).startsWith('"TMA Board" could not be read'));
    expect(logged).toHaveLength(1);
    expect(logged[0].Detail).toMatch(/Its rows in Events were left as they were\.$/);
  });

  it('removes the upcoming rows of a calendar turned off (or deleted from the tab), keeping its past ones', () => {
    const s = setup({ board: feed([timed('a', '2026-11-10', 19, 'Concert'), timed('b', '2026-10-20', 19, 'Yesterday')]) });
    s.h.app.syncTick();
    const pastKey = `${BOARD_HASH}:old:20260901T230000Z`;
    s.h.services.db.tables.Events!.push({ Date: '2026-09-01', Title: 'Old', Source: 'TMA Board', 'Calendar Event': pastKey });
    s.h.services.db.tables.Calendars![0].On = 'FALSE';
    s.h.services.setNow(LATER);
    const report = s.h.app.syncTick();
    expect(report.calendars).toEqual({ read: 0, failed: 0, added: 0, updated: 0, removed: 2 });
    expect(s.calendarRows().map((r) => r.Title)).toEqual(['Old']);
    expect(s.source.reads).toHaveLength(1); // an Off calendar is not read
  });

  it('never touches rows typed by hand, even with a Source, the same title or a Calendar Event typed in', () => {
    const typed: RowData[] = [
      ...typedEvents(),
      { ID: 'EV-1', Date: '2026-11-10', Time: '7:00 PM', Title: 'Concert', Location: 'TRHS', Source: 'TMA Board' },
      { ID: 'EV-2', Date: '2026-11-11', Title: 'Typed key', 'Calendar Event': `${BOARD_HASH}:x:20261111` },
    ];
    const s = setup({ board: feed([timed('a', '2026-11-10', 19, 'Concert')]), events: typed });
    s.h.app.syncTick();
    s.state.board = feed([]);
    s.h.services.setNow(LATER);
    s.h.app.syncTick();
    expect(s.events()).toEqual(typed);
  });

  it('does not copy an event again when a volunteer cleared the Source of its row (no second row with the same ID)', () => {
    const s = setup({ board: feed([timed('a', '2026-11-10', 19, 'Concert')]) });
    s.h.app.syncTick();
    const copied = s.events().filter((e) => e.Source);
    expect(copied).toHaveLength(1);
    // The volunteer clears Source: the row is now theirs and must stay as they left it.
    for (const row of s.h.services.db.tables.Events!) if (row.Source) row.Source = '';
    const before = s.events();
    s.h.services.cache.remove('calendar-sync:fingerprint');
    s.h.services.setNow(LATER);
    s.h.app.syncTick();
    expect(s.events()).toEqual(before);
    expect(s.events().filter((e) => e.ID === copied[0]!.ID)).toHaveLength(1);
  });

  it('never sends a calendar to everyone because of a misspelled school or group (it reaches whom a typed row with the typo reaches)', () => {
    const s = setup({
      board: feed([timed('t', '2026-10-22', 19, 'Jazz sectional')]),
      music: {
        events: [
          timed('c', '2026-10-22', 20, 'Jazz combo', { description: 'Groups: Jaz Band\nBring a stand.' }),
          timed('p', '2026-10-22', 18, 'Pops concert'),
        ],
        unsupported: 0,
        capped: false,
      },
      calendars: [
        { Name: 'Jazz', Calendar: BOARD, Groups: 'Jaz Band' },
        { Name: 'Music Dept', Calendar: MUSIC, Groups: 'Everyone' },
      ],
      events: [{ ID: 'EV-T', Date: '2026-10-22', Time: '5:00 PM', Title: 'Typed sectional', Ensembles: 'Jaz Band' }],
    });
    const report = s.h.app.syncTick();
    expect(s.calendarRows().map((r) => [r.Title, r.Schools, r.Ensembles, r.Details])).toEqual([
      ['Jazz sectional', '', 'Jaz Band', ''],
      ['Jazz combo', '', 'Jaz Band', 'Bring a stand.'],
      ['Pops concert', '', '', ''],
    ]);
    // Reported (check the spelling); "Everyone" in the tab means everyone, with no note.
    expect(report.notes).toEqual([
      'Calendar "Jazz": "Jaz Band" is not in Settings SCHOOLS or ENSEMBLES, so it matches no family\'s choices; check the spelling.',
      'Calendar "Music Dept": "Jaz Band" is not in Settings SCHOOLS or ENSEMBLES, so it matches no family\'s choices; check the spelling.',
    ]);
    s.h.app.dailyTick();
    const to = (title: string) => s.h.services.outbox.mail.filter((m) => m.subject.includes(title)).map((m) => m.to).sort();
    expect(to('Pops concert')).toContain(PARENT);
    expect(to('Jazz sectional')).not.toContain(PARENT);
    expect(to('Jazz sectional')).toEqual(to('Typed sectional'));
    expect(to('Jazz combo')).toEqual(to('Typed sectional'));
  });

  it('finds each row again by its key before writing, so a sort or a row added meanwhile never changes or deletes a typed row', () => {
    const typed: RowData[] = [
      { ID: 'EV-A', Date: '2026-12-01', Title: 'Typed A' },
      { ID: 'EV-B', Date: '2026-12-02', Title: 'Typed B' },
      { ID: 'EV-C', Date: '2026-12-03', Title: 'Typed C' },
    ];
    const s = setup({
      board: feed([timed('a', '2026-11-10', 19, 'Concert'), timed('b', '2026-11-12', 19, 'Gone soon'), timed('z', '2026-11-13', 19, 'Zulu rehearsal')]),
      calendars: [{ Name: 'TMA Board', Calendar: BOARD }],
      events: typed,
    });
    s.h.app.syncTick();
    // Next: the calendar is renamed (every row's Source changes), "a" retitled and "b" deleted. After
    // the sync's first write to Events, the treasurer sorts the tab, then adds a row at the top.
    s.h.services.db.tables.Calendars![0].Name = 'Music Dept';
    s.state.board = feed([timed('a', '2026-11-10', 19, 'Concert (moved room)'), timed('z', '2026-11-13', 19, 'Zulu rehearsal')]);
    const store = s.h.services.store;
    const update = store.update.bind(store);
    let writes = 0;
    store.update = (t, n, patch) => {
      update(t, n, patch);
      if (t !== 'Events') return;
      const rows = s.h.services.db.tables.Events!;
      if (++writes === 1) rows.sort((x, y) => String(y.Title).localeCompare(String(x.Title)));
      if (writes === 2) rows.unshift({ ID: 'EV-NEW', Date: '2026-12-05', Title: 'Typed just now' });
    };
    s.h.services.setNow(LATER);
    const report = s.h.app.syncTick();
    expect(report.calendars).toEqual({ read: 1, failed: 0, added: 0, updated: 2, removed: 1 });
    const rows = s.events().map((r) => [r.Title, r.Source ?? '']);
    expect(rows.filter((r) => !r[1]).map((r) => r[0]).sort()).toEqual(['Typed A', 'Typed B', 'Typed C', 'Typed just now']);
    expect(rows.filter((r) => r[1]).sort()).toEqual([
      ['Concert (moved room)', 'Music Dept'],
      ['Zulu rehearsal', 'Music Dept'],
    ]);
  });

  it('keeps copied rows and says so (every sync; the Log once a day) while the Calendars tab is missing', () => {
    const s = setup({ board: feed([timed('a', '2026-10-30', 19, 'Concert')]) });
    s.h.app.syncTick();
    const pastKey = `${BOARD_HASH}:old:20260901T230000Z`;
    s.h.services.db.tables.Events!.push({ Date: '2026-09-01', Title: 'Old', Source: 'TMA Board', 'Calendar Event': pastKey });
    // The tab is renamed or deleted in the sheet (a missing tab, as in Apps Script); the concert is then cancelled.
    delete s.h.services.db.tables.Calendars;
    s.state.board = feed([]);
    for (const minutes of [15, 30]) {
      s.h.services.setNow(new Date(TEST_NOW.getTime() + minutes * 60000));
      expect(s.h.app.syncTick().errors).toEqual([
        'Calendars: The Calendars tab is missing (renamed or deleted?), so 1 upcoming event copied from linked calendars is no longer kept up to date in Events, and still gets its reminder. Rename the tab back to Calendars. To stop linking calendars, run TMA App → Set up / repair tabs instead: it adds an empty Calendars tab, and the next sync removes those rows.',
      ]);
    }
    expect(s.calendarRows().map((r) => r.Title)).toEqual(['Concert', 'Old']);
    expect(s.h.rows('Log').filter((r) => String(r.Detail).startsWith('The Calendars tab is missing'))).toHaveLength(1);
    // Set up adds an empty Calendars tab: the upcoming row goes, the past one stays, no more error.
    s.h.app.setup({});
    s.h.services.setNow(new Date(TEST_NOW.getTime() + 45 * 60000));
    expect(s.h.app.syncTick().errors).toEqual([]);
    expect(s.calendarRows().map((r) => r.Title)).toEqual(['Old']);
  });

  it('copies an event once: same key twice in a feed, on two rows, or on two calendars (the first listed, for both calendars’ families)', () => {
    const shared = timed('shared-uid', '2026-11-10', 19, 'Winter Concert');
    const s = setup({
      board: feed([shared, { ...shared }, timed('own', '2026-11-11', 19, 'Board meeting')]),
      music: { events: [shared], unsupported: 0, capped: false },
      calendars: [
        { Name: 'TMA Board', Calendar: BOARD, Groups: 'Band' },
        { Name: 'Music Dept', Calendar: MUSIC, Groups: 'Orchestra' },
        { Name: 'Board again', Calendar: BOARD.toUpperCase() },
      ],
    });
    const report = s.h.app.syncTick();
    expect(s.calendarRows().map((r) => [r.Title, r.Source, r.Ensembles])).toEqual([
      ['Winter Concert', 'TMA Board', 'Band, Orchestra'],
      ['Board meeting', 'TMA Board', 'Band'],
    ]);
    expect(report.notes).toContain('Calendar "Board again" (Calendars row 4) is the same calendar as a row above it, so it was skipped.');
    // A copy of a calendar row (e.g. pasted by mistake) goes away; the first one stays.
    const first = s.calendarRows()[0];
    s.h.services.db.tables.Events!.push({ ...first });
    s.h.services.cache.remove('calendar-sync:fingerprint');
    s.h.services.setNow(LATER);
    expect(s.h.app.syncTick().calendars).toMatchObject({ removed: 1 });
    expect(s.calendarRows()).toHaveLength(2);
  });

  it('sends one reminder per family for an event on two linked calendars', () => {
    const shared = timed('concert123', '2026-10-22', 19, 'Winter Concert');
    const s = setup({
      board: feed([shared]),
      music: { events: [shared], unsupported: 0, capped: false },
      calendars: [
        { Name: 'TMA Board', Calendar: BOARD },
        { Name: 'Music Dept', Calendar: MUSIC },
      ],
      events: [],
    });
    s.h.app.syncTick();
    expect(s.calendarRows().map((r) => r.Source)).toEqual(['TMA Board']);
    s.h.app.dailyTick();
    const mails = s.h.services.outbox.mail.filter((m) => m.subject.includes('Winter Concert')).map((m) => m.to);
    expect(mails).toContain(PARENT);
    expect(new Set(mails).size).toBe(mails.length);
    expect(s.h.services.outbox.push.filter((p) => p.message.title === 'Tomorrow: Winter Concert')).toHaveLength(1);
  });

  it('copies at most 500 events per calendar, with a note', () => {
    const many = Array.from({ length: 520 }, (_, i) => ({
      uid: `e${i}`,
      start: { dateTime: new Date(Date.UTC(2026, 10, 1) + i * 3600000 * 6).toISOString() },
      title: `Event ${i}`,
      location: '',
      description: '',
    }));
    const s = setup({ board: feed(many) });
    const report = s.h.app.syncTick();
    expect(s.calendarRows()).toHaveLength(MAX_EVENTS_PER_CALENDAR);
    expect(report.notes?.join(' ')).toMatch(/more than 500 events in the next 180 days; only the first 500 were copied/);
  });

  it('follows Settings CALENDAR_DAYS (7 to 400; anything else means 180)', () => {
    const far = feed([timed('a', '2027-06-01', 19, 'Graduation concert')]);
    expect(setup({ board: far }).h.app.syncTick().calendars?.added).toBe(0);
    const s = setup({ board: far, settings: { CALENDAR_DAYS: '365' } });
    expect(s.h.app.syncTick().calendars?.added).toBe(1);
    expect(setup({ board: far, settings: { CALENDAR_DAYS: '5000' } }).h.app.syncTick().calendars?.added).toBe(0);
  });

  it('sends the usual "Tomorrow" reminder for a calendar event, once, even after it is edited in the calendar', () => {
    const s = setup({ board: feed([timed('t', '2026-10-22', 19, 'Pops rehearsal')]), calendars: [{ Name: 'TMA Board', Calendar: BOARD }] });
    s.h.app.syncTick();
    const daily = s.h.app.dailyTick();
    const sent = s.h.services.outbox.push.map((p) => p.message.title);
    expect(sent).toContain('Tomorrow: Pops rehearsal');
    expect(daily.errors).toEqual([]);
    expect(sent).toContain('Tomorrow: Jazz Night'); // the typed row, as before
    const id = s.calendarRows()[0].ID;
    expect(s.h.rows('_Sent').map((r) => r.Key)).toContain(`evt:${id}:2026-10-22`);
    s.state.board = feed([timed('t', '2026-10-22', 19, 'Pops rehearsal (bring music)')]);
    s.h.services.setNow(LATER);
    s.h.app.syncTick();
    s.h.clearOutbox();
    s.h.app.dailyTick();
    expect(s.h.services.outbox.push.map((p) => p.message.title)).not.toContain('Tomorrow: Pops rehearsal (bring music)');
  });

  it('reads calendars before taking the write lock and writes Events only while holding it (also from Run sync now)', () => {
    const s = setup({ board: feed([timed('a', '2026-11-10', 19, 'Concert')]) });
    let held = false;
    const readsWhileHeld: boolean[] = [];
    const writesWhileHeld: boolean[] = [];
    s.h.services.withLock = <T>(fn: () => T): T => {
      held = true;
      try {
        return fn();
      } finally {
        held = false;
      }
    };
    const read = s.source.read.bind(s.source);
    s.h.services.calendars = { read: (ref, range) => (readsWhileHeld.push(held), read(ref, range)) };
    const append = s.h.services.store.append.bind(s.h.services.store);
    s.h.services.store.append = (t, rows) => {
      if (t === 'Events') writesWhileHeld.push(held);
      append(t, rows);
    };
    s.h.app.syncTick();
    const token = s.h.signIn(TREASURER);
    s.h.services.db.tables.Events = typedEvents();
    s.h.services.cache.remove('calendar-sync:fingerprint');
    expect(s.h.ok('admin.runSync', {}, token).calendars).toMatchObject({ added: 1 });
    expect(readsWhileHeld).toEqual([false, false]);
    expect(writesWhileHeld).toEqual([true, true]);
  });

  it('asks for Set up when the Events tab has no Source / Calendar Event columns yet', () => {
    const s = setup({ board: feed([timed('a', '2026-11-10', 19, 'Concert')]) });
    s.h.services.db.headers = { Events: ['ID', 'Date', 'Time', 'Title', 'Location', 'Details', 'Schools', 'Ensembles'] };
    const report = s.h.app.syncTick();
    expect(report.errors).toEqual([expect.stringMatching(/^calendars: The Events tab has no "Source", "Calendar Event" column.*Set up \/ repair tabs/)]);
    expect(s.calendarRows()).toEqual([]);
  });

  it('reports a bad address and a missing Calendar column in plain words', () => {
    const bad = setup({ calendars: [{ Name: 'Oops', Calendar: 'http://calendar.example.com/x.ics' }] });
    expect(bad.h.app.syncTick().errors).toEqual(['Calendar "Oops": iCal links must start with https:// (not http://).']);
    const noColumn = setup();
    noColumn.h.services.db.headers = { Calendars: ['Name', 'On'] };
    expect(noColumn.h.app.syncTick().errors).toEqual([expect.stringMatching(/^calendars: The Calendars tab has no "Calendar" column/)]);
  });

  it('starts the demo in step with its calendar: a sync changes nothing', () => {
    const h = harness();
    const before = h.rows('Events');
    expect(before.filter((r) => r.Source === 'Music Dept').map((r) => r.Title)).toEqual(['Spring musical auditions', 'Winter break: no rehearsals']);
    const report = h.app.syncTick();
    expect(report.errors).toEqual([]);
    expect(report.calendars).toEqual({ read: 1, failed: 0, added: 0, updated: 0, removed: 0 });
    expect(h.rows('Events')).toEqual(before);
  });
});

describe('Status: calendar lines', () => {
  it('says OK with how many events, or the plain reason', () => {
    const s = setup({
      board: feed([timed('a', '2026-11-10', 19, 'Concert'), timed('p', '2026-11-11', 19, 'Staff', { private: true })]),
      music: { problem: 'no_service' },
      calendars: [
        { Name: 'TMA Board', Calendar: BOARD, Groups: 'Kazoo Choir' },
        { Name: 'Music Dept', Calendar: MUSIC },
        { Name: 'Old', Calendar: 'old@example.com', On: 'FALSE' },
        { Name: 'Typo', Calendar: 'not a calendar' },
        { Name: 'Missing', Calendar: 'missing@example.com' },
      ],
    });
    expect(calendarStatusLines(s.h.services)).toEqual([
      'Calendars (events from Oct 20 to Apr 19, Settings CALENDAR_DAYS 180):',
      'Calendar "TMA Board": OK ✓, 1 event (1 private skipped; schools/groups not in Settings: "Kazoo Choir")',
      expect.stringMatching(/^Calendar "Music Dept": ✗ the Google Calendar service is missing in Apps Script\. Paste the new appsscript.json/),
      'Calendar "Old": off (On is FALSE)',
      expect.stringMatching(/^Calendar "Typo": ✗ the Calendar column is not a Google Calendar ID/),
      expect.stringMatching(/^Calendar "Missing": ✗ not found, or not shared with this Google account \(HTTP 404\)/),
    ]);
    // Read-only: nothing written.
    expect(s.calendarRows()).toEqual([]);
  });

  it('says when nothing is linked or the tab is missing', () => {
    expect(calendarStatusLines(setup({ calendars: [] }).h.services)).toEqual([
      'Calendars: none linked (add one in the Calendars tab; see docs/SETUP.md, "Link Google Calendars")',
    ]);
    const s = setup();
    s.h.services.db.headers = { Calendars: null };
    expect(calendarStatusLines(s.h.services)).toEqual(['Calendars: no Calendars tab yet (TMA App → Set up / repair tabs adds it)']);
  });
});
