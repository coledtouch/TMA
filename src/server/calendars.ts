/**
 * Linked calendars (ARCHITECTURE.md §7 "Linked calendars"): every sync copies
 * the events of the calendars listed in the Calendars tab (Google Calendars and
 * iCal links) into the Events tab, so News and the "event tomorrow" reminders
 * work for them exactly as for rows typed by hand.
 *
 * Two phases, so slow network calls never hold the script's write lock:
 * 1. fetchCalendars(ctx), before taking the lock: read the Calendars tab and
 *    each calendar (CalendarSource port).
 * 2. syncCalendars(ctx, report, fetched), under the lock (inside syncTick):
 *    read the Events tab fresh and add, change or remove only the rows this
 *    feature wrote (a Source and a Calendar Event key). Rows typed by hand
 *    (no Source) are never touched; past rows stay as history; a calendar that
 *    couldn't be read keeps its rows as they were.
 */
import type { CalendarTickReport, IsoDate, TickReport } from '../shared/types';
import {
  audienceNames,
  buildCalendarRow,
  calendarEventIdentity,
  calendarHash,
  calendarKeyHash,
  calendarProblemText,
  CALENDAR_ROW_COLUMNS,
  MAX_CALENDAR_NAME,
  mergeAudience,
  parseCalendarAddress,
  type AudienceLists,
  type CalendarRow,
} from './calendar-rows';
import { createCtx, type Ctx } from './context';
import type { CalendarFeed, CalendarRef, RowData, Services, StoredRow } from './services';
import { CalendarReadError } from './services';
import { calendarSettings } from './settings';
import { sha256Hex } from './sha256';
import {
  addDays,
  cleanText,
  errorMessage,
  joinList,
  nyDate,
  nyLocalToDate,
  parseBool,
  parseDate,
  parseList,
  parseTimeText,
  plural,
  shortDate,
  str,
  truncate,
} from './util';

/** At most this many calendars are read (the rest are reported). */
export const MAX_CALENDARS = 10;
/** At most this many events are copied per calendar per run. */
export const MAX_EVENTS_PER_CALENDAR = 500;
/** Row changes per run; more wait for the next sync (each changed row is one write to the sheet). */
export const MAX_ROW_CHANGES = 300;
/**
 * Stop changing and removing rows after this long (they wait for the next sync): the sync holds the
 * script's write lock meanwhile, and other writes (a family's payment) wait for it only 20 s.
 */
export const APPLY_BUDGET_MS = 10000;
/** Stop starting new calendar reads after this long, so a sync always finishes. */
const FETCH_BUDGET_MS = 120000;
const FINGERPRINT_KEY = 'calendar-sync:fingerprint';
const CACHE_TTL_SECONDS = 21600;

// ---------------------------------------------------------------------------
// The Calendars tab
// ---------------------------------------------------------------------------

export interface CalendarDef {
  row: number;
  /** The Name column (the Events Source). */
  name: string;
  on: boolean;
  ref: CalendarRef | null;
  /** Why the address can't be used (ref null). */
  problem?: string;
  /** calendarHash(ref) ('' without a ref). */
  hash: string;
  /** Its Schools and Groups (see audienceNames: "Everyone" or blank = everyone). */
  schools: string[];
  ensembles: string[];
  /** Schools/Groups in the tab that aren't in Settings. */
  unknown: string[];
  /** Another row above has the same calendar: this one is ignored. */
  duplicate?: boolean;
  /** Past MAX_CALENDARS: not read. */
  overLimit?: boolean;
}

export type CalendarResult =
  | { ok: true; feed: CalendarFeed }
  | { ok: false; text: string };

export interface CalendarFetch {
  /** Window, New York dates (inclusive): yesterday … today + CALENDAR_DAYS. */
  from: IsoDate;
  to: IsoDate;
  days: number;
  defs: CalendarDef[];
  /** By hash, for the calendars that were (tried to be) read. */
  results: Map<string, CalendarResult>;
  /** A problem with the Calendars tab itself (the step is skipped). */
  error?: string;
}

/** The Calendars tab as definitions; null when the tab doesn't exist (nothing is synced then). */
export function readCalendarDefs(ctx: Ctx): CalendarDef[] | null {
  const columns = ctx.db.columns('Calendars');
  if (columns === null) return null;
  if (columns !== undefined && !columns.includes('Calendar')) {
    throw new Error('The Calendars tab has no "Calendar" column, so no calendar was read. If the header was renamed, change it back.');
  }
  const settings = calendarSettings(ctx.db.rows('Settings'));
  const defs: CalendarDef[] = [];
  const seen = new Set<string>();
  let read = 0;
  for (const stored of ctx.db.rows('Calendars')) {
    const d = stored.data;
    if (!str(d.Name) && !str(d.Calendar)) continue;
    const schools = audienceNames(d.Schools, settings.schools);
    const groups = audienceNames(d.Groups, settings.ensembles);
    const parsed = parseCalendarAddress(d.Calendar);
    const def: CalendarDef = {
      row: stored.rowNumber,
      name: truncate(cleanText(str(d.Name)), MAX_CALENDAR_NAME) || 'Calendar',
      on: parseBool(d.On, true),
      ref: 'ref' in parsed ? parsed.ref : null,
      hash: 'ref' in parsed ? calendarHash(parsed.ref) : '',
      schools: schools.names,
      ensembles: groups.names,
      unknown: [...schools.unknown, ...groups.unknown],
    };
    if ('problem' in parsed) def.problem = calendarProblemText(parsed.problem);
    if (def.on && def.hash) {
      if (seen.has(def.hash)) def.duplicate = true;
      else if (read >= MAX_CALENDARS) def.overLimit = true;
      else {
        seen.add(def.hash);
        read++;
      }
    }
    defs.push(def);
  }
  return defs;
}

/** Calendars this run reads: on, with a usable address, not a repeat, within the limit. */
function active(def: CalendarDef): boolean {
  return def.on && def.ref !== null && !def.duplicate && !def.overLimit;
}

function windowOf(ctx: Ctx): { from: IsoDate; to: IsoDate; days: number; start: Date; end: Date } {
  const days = calendarSettings(ctx.db.rows('Settings')).calendarDays;
  const from = addDays(ctx.today, -1);
  const to = addDays(ctx.today, days);
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = addDays(to, 1).split('-').map(Number);
  return { from, to, days, start: nyLocalToDate(fy, fm, fd), end: nyLocalToDate(ty, tm, td) };
}

/**
 * Phase 1, before the write lock: read the Calendars tab and every calendar it lists. Never throws;
 * returns null when there is no Calendars tab. One calendar failing never stops the others.
 */
export function fetchCalendars(ctx: Ctx): CalendarFetch | null {
  const results = new Map<string, CalendarResult>();
  let w: ReturnType<typeof windowOf>;
  let defs: CalendarDef[] | null;
  try {
    w = windowOf(ctx);
    defs = readCalendarDefs(ctx);
  } catch (err) {
    return { from: ctx.today, to: ctx.today, days: 0, defs: [], results, error: errorMessage(err) };
  }
  if (defs === null) return null;
  const started = ctx.s.clock.now().getTime();
  for (const def of defs) {
    if (!active(def) || !def.ref) continue;
    if (ctx.s.clock.now().getTime() - started > FETCH_BUDGET_MS) {
      results.set(def.hash, { ok: false, text: 'not read this time (the other calendars took too long); the app tries again at the next sync' });
      continue;
    }
    try {
      const feed = ctx.s.calendars.read(def.ref, { start: w.start, end: w.end, maxEvents: MAX_EVENTS_PER_CALENDAR });
      results.set(def.hash, { ok: true, feed });
    } catch (err) {
      if (err instanceof CalendarReadError) {
        results.set(def.hash, { ok: false, text: calendarProblemText(err.problem, err.detail) });
      } else {
        ctx.s.logger.error(`Calendar "${def.name}" could not be read`, errorMessage(err));
        results.set(def.hash, { ok: false, text: calendarProblemText('failed') });
      }
    }
  }
  return { from: w.from, to: w.to, days: w.days, defs, results };
}

// ---------------------------------------------------------------------------
// Rows wanted
// ---------------------------------------------------------------------------

export interface CalendarRows {
  def: CalendarDef;
  rows: CalendarRow[];
  private: number;
  cancelled: number;
  /** Events with the same key as one before them (left out). */
  duplicates: number;
  unsupported: number;
  capped: boolean;
  /** Audience names (tab and descriptions) that aren't in Settings. */
  unknown: string[];
}

/** The Events rows a calendar's feed should give, within the dates synced. */
export function rowsForCalendar(def: CalendarDef, feed: CalendarFeed, range: { from: IsoDate; to: IsoDate }, known: AudienceLists): CalendarRows {
  const out: CalendarRows = {
    def,
    rows: [],
    private: 0,
    cancelled: 0,
    duplicates: 0,
    unsupported: feed.unsupported,
    capped: feed.capped,
    unknown: def.unknown.slice(),
  };
  const keys = new Set<string>();
  for (const event of feed.events) {
    if (event.cancelled) {
      out.cancelled++;
      continue;
    }
    if (event.private) {
      out.private++;
      continue;
    }
    const built = buildCalendarRow({ name: def.name, hash: def.hash, schools: def.schools, ensembles: def.ensembles }, event, known);
    if (!built) {
      out.unsupported++;
      continue;
    }
    if (built.date < range.from || built.date > range.to) continue;
    if (keys.has(built.key)) {
      out.duplicates++;
      continue;
    }
    if (out.rows.length >= MAX_EVENTS_PER_CALENDAR) {
      out.capped = true;
      continue;
    }
    keys.add(built.key);
    out.rows.push(built);
    for (const name of built.unknown) if (!out.unknown.some((u) => u.toLowerCase() === name.toLowerCase())) out.unknown.push(name);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Phase 2: apply under the write lock
// ---------------------------------------------------------------------------

export interface CalendarPlan {
  /** `key`: the row's Calendar Event, to find it again just before writing (see applyUpdates). */
  updates: Array<{ row: number; key: string; patch: RowData }>;
  inserts: RowData[];
  /** Bottom-up. `source` and `key`: what the row held, checked again just before deleting it (see applyDeletes). */
  deletes: Array<{ row: number; source: string; key: string }>;
}

/** Values as compared: what the app would read back from the sheet. */
function sameValue(column: string, stored: unknown, wanted: unknown, known: AudienceLists): boolean {
  if (column === 'Date') return parseDate(stored) === wanted;
  if (column === 'Time') return parseTimeText(stored) === wanted;
  if (column === 'Schools') return joinList(parseList(stored, known.schools)) === wanted;
  if (column === 'Ensembles') return joinList(parseList(stored, known.ensembles)) === wanted;
  return str(stored) === str(wanted);
}

/**
 * What to change in the Events tab. `rows` is a fresh read. Only rows with a Source and a Calendar
 * Event key written by this app are considered:
 * - of a calendar read this run (`read`): changed fields are updated, new events added, and rows
 *   whose event is gone (cancelled, deleted, made private, moved out of the window) removed when
 *   their date is inside the window;
 * - of a calendar no longer listed (removed, turned off): removed when inside the window;
 * - of a calendar that couldn't be read (`failed`): left alone.
 * Past rows (before the window) are always kept. A key on several rows keeps the first one. An event
 * whose row is held, by a calendar that couldn't be read or by a volunteer who cleared its Source, is
 * not added again from another calendar (calendarEventIdentity): one event, one row, one reminder.
 */
export function planCalendarRows(
  rows: readonly StoredRow[],
  wanted: ReadonlyMap<string, CalendarRow>,
  read: ReadonlySet<string>,
  failed: ReadonlySet<string>,
  range: { from: IsoDate; to: IsoDate },
  known: AudienceLists,
): CalendarPlan {
  const plan: CalendarPlan = { updates: [], inserts: [], deletes: [] };
  const inWindow = (row: StoredRow) => {
    const date = parseDate(row.data.Date);
    return date !== null && date >= range.from && date <= range.to;
  };
  const remove = (row: StoredRow, key: string) => plan.deletes.push({ row: row.rowNumber, source: str(row.data.Source), key });
  const byKey = new Map<string, StoredRow[]>();
  // Events (calendarEventIdentity, so across calendars) whose row stays as it is and must not be
  // copied again beside it (two rows, two IDs, two reminders): rows a volunteer made theirs by clearing
  // the Source, and rows of a calendar that couldn't be read this run.
  const held = new Set<string>();
  for (const row of rows) {
    const key = str(row.data['Calendar Event']);
    const hash = key ? calendarKeyHash(key) : null;
    if (!str(row.data.Source)) {
      if (hash) held.add(calendarEventIdentity(key));
      continue; // typed by hand: never touched
    }
    if (!hash) continue;
    if (failed.has(hash)) {
      held.add(calendarEventIdentity(key));
      continue;
    }
    const list = byKey.get(key) ?? [];
    list.push(row);
    byKey.set(key, list);
  }
  byKey.forEach((list, key) => {
    const want = wanted.get(key);
    if (!want) {
      for (const row of list) if (inWindow(row)) remove(row, key);
      return;
    }
    const [first, ...repeats] = list;
    const patch: RowData = {};
    for (const column of CALENDAR_ROW_COLUMNS) {
      if (!sameValue(column, first.data[column], want.row[column], known)) patch[column] = want.row[column];
    }
    if (Object.keys(patch).length > 0) plan.updates.push({ row: first.rowNumber, key, patch });
    for (const row of repeats) remove(row, key);
  });
  wanted.forEach((want, key) => {
    if (!byKey.has(key) && !held.has(calendarEventIdentity(key)) && read.has(calendarKeyHash(key) ?? '')) plan.inserts.push({ ...want.row });
  });
  plan.deletes.sort((a, b) => b.row - a.row);
  return plan;
}

/**
 * A Log row at most once per calendar per New York day for the same kind of message: the cache
 * remembers for a few hours, and the Log tab itself is checked when the cache has forgotten.
 */
function logOncePerDay(ctx: Ctx, prefix: string, detail: string): void {
  const cacheKey = `calendar-log:${sha256Hex(prefix).slice(0, 16)}:${ctx.today}`;
  try {
    if (ctx.s.cache.get(cacheKey)) return;
    const already = ctx.m
      .logEntries()
      .some((e) => e.kind === 'calendar' && e.detail.startsWith(prefix) && e.at !== '' && nyDate(new Date(e.at)) === ctx.today);
    ctx.s.cache.put(cacheKey, '1', CACHE_TTL_SECONDS);
    if (already) return;
  } catch (err) {
    ctx.s.logger.error('Calendar log check failed', errorMessage(err));
  }
  ctx.log('calendar', detail);
}

function listNames(names: readonly string[]): string {
  const shown = names.slice(0, 5).map((n) => `"${truncate(n, 40)}"`);
  return names.length > 5 ? `${shown.join(', ')} and ${names.length - 5} more` : shown.join(', ');
}

/** Notes about one calendar's rows (not errors): too many events, unreadable parts, unknown names. */
function rowNotes(r: CalendarRows, days: number): string[] {
  const notes: string[] = [];
  if (r.capped) notes.push(`more than ${MAX_EVENTS_PER_CALENDAR} events in the next ${days} days; only the first ${MAX_EVENTS_PER_CALENDAR} were copied`);
  if (r.unsupported > 0) notes.push(`${plural(r.unsupported, 'event')} (or repeat rules) the app can't read were left out`);
  if (r.unknown.length > 0) {
    notes.push(`${listNames(r.unknown)} ${r.unknown.length === 1 ? 'is' : 'are'} not in Settings SCHOOLS or ENSEMBLES, so ${r.unknown.length === 1 ? 'it matches' : 'they match'} no family's choices; check the spelling`);
  }
  return notes;
}

/** A fingerprint of everything the apply step would write from: same as last time = nothing to do. */
function fingerprint(ctx: Ctx, fetched: CalendarFetch, read: string[], failed: string[], wanted: Map<string, CalendarRow>): string {
  const rows = Array.from(wanted.keys())
    .sort()
    .map((key) => CALENDAR_ROW_COLUMNS.map((c) => str(wanted.get(key)?.row[c])));
  // The crypto port: native in Apps Script, so thousands of rows hash quickly.
  return ctx.s.crypto.hmacSha256Hex('tma-calendars', JSON.stringify([fetched.from, fetched.to, read.slice().sort(), failed.slice().sort(), rows]));
}

/**
 * Where each calendar row is: its key → the first Events row with a Source that holds it (the one
 * planCalendarRows picks), from a read of the whole tab made now.
 */
function keyPositions(ctx: Ctx): Map<string, number> {
  ctx.db.refresh('Events');
  const positions = new Map<string, number>();
  for (const row of ctx.db.rows('Events')) {
    const key = str(row.data['Calendar Event']);
    if (key && str(row.data.Source) !== '' && !positions.has(key)) positions.set(key, row.rowNumber);
  }
  return positions;
}

/** Whether Events row `row` holds the calendar row with this key right now (just that row is read). */
function holdsKey(ctx: Ctx, row: number | undefined, key: string): row is number {
  if (row === undefined) return false;
  const [data] = ctx.db.readRows('Events', row, 1);
  return data !== null && data !== undefined && str(data.Source) !== '' && str(data['Calendar Event']) === key;
}

/**
 * Write the planned updates; returns how many were written. The treasurer can sort, insert or delete
 * rows while the sync writes, and the script lock doesn't stop that, so no row number read earlier is
 * trusted: Events is read once, and each row is read again just before it is written and must still
 * hold the key (a row typed by hand is never written to). If it doesn't, Events is read again once to
 * find the key; a key no row holds any more waits for the next sync. Stops when `stop()` says so.
 */
function applyUpdates(ctx: Ctx, updates: CalendarPlan['updates'], stop: () => boolean): number {
  if (updates.length === 0) return 0;
  let positions = keyPositions(ctx);
  let written = 0;
  for (const u of updates) {
    if (stop()) break;
    let row = positions.get(u.key);
    if (!holdsKey(ctx, row, u.key)) {
      positions = keyPositions(ctx); // sorted, or rows added or removed meanwhile
      row = positions.get(u.key);
      if (!holdsKey(ctx, row, u.key)) continue; // removed meanwhile: looked at again at the next sync
    }
    ctx.db.update('Events', row, u.patch);
    written++;
  }
  return written;
}

/**
 * Delete the planned rows (bottom-up, from a read made just now), one deleteRows per run of adjacent
 * rows; returns how many were deleted. Each deleteRows takes time in Sheets and the treasurer may
 * insert, delete or sort rows in between, so just before each run its rows are read again and must
 * still hold the planned Source and Calendar Event. When one doesn't, nothing more is deleted this
 * sync (the next one plans again): a row typed by hand is never deleted. Stops when `stop()` says so.
 */
function applyDeletes(ctx: Ctx, deletes: CalendarPlan['deletes'], stop: () => boolean): number {
  let deleted = 0;
  let i = 0;
  while (i < deletes.length) {
    let j = i + 1;
    while (j < deletes.length && deletes[j].row === deletes[j - 1].row - 1) j += 1;
    const run = deletes.slice(i, j).reverse(); // top to bottom
    if (stop()) break;
    const now = ctx.db.readRows('Events', run[0].row, run.length);
    const same = run.every((d, k) => {
      const data = now[k];
      return data !== null && data !== undefined && str(data.Source) === d.source && str(data['Calendar Event']) === d.key;
    });
    if (!same) break;
    ctx.db.deleteRows('Events', run.map((d) => d.row), CALENDAR_ROW_COLUMNS);
    deleted += run.length;
    i = j;
  }
  return deleted;
}

/**
 * No Calendars tab (renamed or deleted) while Events still has upcoming rows copied from calendars:
 * those rows are then neither updated nor removed, so a cancelled event would still get its
 * reminder. Say so in every report and once a day in the Log. Past rows are history and don't count.
 */
function reportMissingTab(ctx: Ctx, report: TickReport): void {
  const upcoming = ctx.db.rows('Events').filter((r) => {
    if (!str(r.data.Source) || !calendarKeyHash(str(r.data['Calendar Event']))) return false;
    const date = parseDate(r.data.Date);
    return date !== null && date >= ctx.today;
  }).length;
  if (upcoming === 0) return;
  const text =
    `The Calendars tab is missing (renamed or deleted?), so ${plural(upcoming, 'upcoming event')} copied from linked calendars ` +
    `${upcoming === 1 ? 'is' : 'are'} no longer kept up to date in Events, and still ${upcoming === 1 ? 'gets its' : 'get their'} reminder. ` +
    'Rename the tab back to Calendars. To stop linking calendars, run TMA App → Set up / repair tabs instead: it adds an empty Calendars tab, and the next sync removes those rows.';
  report.errors.push(`Calendars: ${text}`);
  logOncePerDay(ctx, 'The Calendars tab is missing', text);
}

/**
 * Phase 2, inside syncTick under the write lock: apply what fetchCalendars read (null: there is no
 * Calendars tab). Errors and notes go into the report; one Log row per calendar per day for each
 * problem.
 */
export function syncCalendars(ctx: Ctx, report: TickReport, fetched: CalendarFetch | null): void {
  if (fetched === null) {
    reportMissingTab(ctx, report);
    return;
  }
  if (fetched.error) throw new Error(fetched.error);
  const known: AudienceLists = calendarSettings(ctx.db.rows('Settings'));
  const range = { from: fetched.from, to: fetched.to };
  const summary: CalendarTickReport = { read: 0, failed: 0, added: 0, updated: 0, removed: 0 };
  const notes: string[] = [];
  const read: string[] = [];
  const failed: string[] = [];
  const wanted = new Map<string, CalendarRow>();
  /** The row kept for each event (calendarEventIdentity), so an event on two calendars is copied once. */
  const byEvent = new Map<string, CalendarRow>();

  for (const def of fetched.defs) {
    if (!def.on) continue;
    const label = `"${def.name}"`;
    if (!def.ref) {
      summary.failed++;
      report.errors.push(`Calendar ${label}: ${def.problem ?? calendarProblemText('bad')}.`);
      logOncePerDay(ctx, `${label} could not be read`, `${label} could not be read: ${def.problem ?? calendarProblemText('bad')}.`);
      continue;
    }
    if (def.duplicate) {
      notes.push(`Calendar ${label} (Calendars row ${def.row}) is the same calendar as a row above it, so it was skipped.`);
      continue;
    }
    if (def.overLimit) {
      notes.push(`Calendar ${label} was not read: the app reads at most ${MAX_CALENDARS} calendars.`);
      continue;
    }
    const result = fetched.results.get(def.hash);
    if (!result) continue;
    if (!result.ok) {
      summary.failed++;
      failed.push(def.hash);
      report.errors.push(`Calendar ${label}: ${result.text}.`);
      logOncePerDay(ctx, `${label} could not be read`, `${label} could not be read: ${result.text}. Its rows in Events were left as they were.`);
      continue;
    }
    summary.read++;
    read.push(def.hash);
    const r = rowsForCalendar(def, result.feed, range, known);
    for (const row of r.rows) {
      const identity = calendarEventIdentity(row.key);
      const first = byEvent.get(identity);
      if (first) {
        // The same event (same id and start) on a calendar listed above: one row, and one reminder,
        // for the families of both.
        first.audience = mergeAudience(first.audience, row.audience);
        first.row.Schools = joinList(first.audience.schools);
        first.row.Ensembles = joinList(first.audience.ensembles);
        continue;
      }
      byEvent.set(identity, row);
      wanted.set(row.key, row);
    }
    const calendarNotes = rowNotes(r, fetched.days);
    if (calendarNotes.length > 0) {
      for (const note of calendarNotes) notes.push(`Calendar ${label}: ${note}.`);
      logOncePerDay(ctx, `${label} note`, `${label} note: ${calendarNotes.join('; ')}.`);
    }
  }
  if (notes.length > 0) report.notes = [...(report.notes ?? []), ...notes];

  const fp = fingerprint(ctx, fetched, read, failed, wanted);
  const listed = fetched.defs.some((d) => d.on);
  if (ctx.s.cache.get(FINGERPRINT_KEY) === fp) {
    if (listed) report.calendars = summary;
    return; // the same events as when the Events tab was last brought up to date
  }

  // A renamed header must not make every calendar row look new (or typed by hand).
  const columns = ctx.db.columns('Events');
  const missing = columns ? ['Date', 'Title', 'Source', 'Calendar Event'].filter((c) => !columns.includes(c)) : [];
  if (missing.length > 0) {
    if (!listed) return;
    throw new Error(
      `The Events tab has no ${missing.map((c) => `"${c}"`).join(', ')} column, so calendar events were not copied. Run TMA App → Set up / repair tabs (it adds the Source and Calendar Event columns); if a header was renamed, change it back.`,
    );
  }

  const readSet = new Set(read);
  const failedSet = new Set(failed);
  const planNow = () => planCalendarRows(ctx.db.rows('Events'), wanted, readSet, failedSet, range, known);
  // ctx.now is fixed for the whole call: the time spent is measured with the clock port.
  const started = ctx.s.clock.now().getTime();
  const outOfTime = () => ctx.s.clock.now().getTime() - started > APPLY_BUDGET_MS;
  const plan = planNow();
  const total = plan.updates.length + plan.inserts.length + plan.deletes.length;
  const inserts = plan.inserts; // one write for all of them, always made

  summary.updated = applyUpdates(ctx, plan.updates.slice(0, MAX_ROW_CHANGES), outOfTime);
  let deletesLeft = 0;
  if (plan.deletes.length > 0) {
    let deletes = plan.deletes;
    if (!outOfTime()) {
      // Planned again on a read made just now: the updates took time, and rows may have moved.
      ctx.db.refresh('Events');
      deletes = planNow().deletes;
      summary.removed = applyDeletes(ctx, deletes.slice(0, Math.max(0, MAX_ROW_CHANGES - summary.updated)), outOfTime);
    }
    deletesLeft = deletes.length - summary.removed;
  }
  if (inserts.length > 0) ctx.db.append('Events', inserts);
  summary.added = inserts.length;
  const complete = summary.updated === plan.updates.length && deletesLeft === 0;
  if (!complete) {
    report.notes = [...(report.notes ?? []), `Calendars: ${plan.updates.length - summary.updated + deletesLeft} more Events rows change at the next sync.`];
  }
  if (summary.added + summary.updated + summary.removed > 0) {
    const names = fetched.defs.filter((d) => active(d) && read.includes(d.hash)).map((d) => d.name);
    ctx.log(
      'calendar',
      `Calendar events copied into Events: ${summary.added} added, ${summary.updated} changed, ${summary.removed} removed${names.length ? ` (${names.join(', ')})` : ''}`,
    );
  }
  // Remember only once the Events tab matches; a run cut short tries again next time.
  if (complete) ctx.s.cache.put(FINGERPRINT_KEY, fp, CACHE_TTL_SECONDS);
  if (listed || total > 0) report.calendars = summary;
}

// ---------------------------------------------------------------------------
// Status (TMA App → Status)
// ---------------------------------------------------------------------------

/**
 * One line per linked calendar for the Status dialog: OK with how many events would be copied, or
 * the plain reason it can't be read. Reads each calendar now (outside any lock); writes nothing.
 */
export function calendarStatusLines(services: Services): string[] {
  const ctx = createCtx(services);
  let fetched: CalendarFetch | null;
  try {
    fetched = fetchCalendars(ctx);
  } catch (err) {
    return [`Calendars: could not be checked (${errorMessage(err)})`];
  }
  if (fetched === null) return ['Calendars: no Calendars tab yet (TMA App → Set up / repair tabs adds it)'];
  if (fetched.error) return [`Calendars: ${fetched.error}`];
  const listed = fetched.defs;
  if (listed.length === 0) return ['Calendars: none linked (add one in the Calendars tab; see docs/SETUP.md, "Link Google Calendars")'];
  const known: AudienceLists = calendarSettings(ctx.db.rows('Settings'));
  const lines = [`Calendars (events from ${shortDate(fetched.from)} to ${shortDate(fetched.to)}, Settings CALENDAR_DAYS ${fetched.days}):`];
  for (const def of listed) {
    const label = `Calendar "${def.name}"`;
    if (!def.on) lines.push(`${label}: off (On is FALSE)`);
    else if (!def.ref) lines.push(`${label}: ✗ ${def.problem ?? calendarProblemText('bad')}`);
    else if (def.duplicate) lines.push(`${label}: skipped, the same calendar as a row above`);
    else if (def.overLimit) lines.push(`${label}: not read (at most ${MAX_CALENDARS} calendars)`);
    else {
      const result = fetched.results.get(def.hash);
      if (!result) continue;
      if (!result.ok) {
        lines.push(`${label}: ✗ ${result.text}`);
        continue;
      }
      const r = rowsForCalendar(def, result.feed, fetched, known);
      const extras = [
        r.private ? `${r.private} private skipped` : '',
        r.unsupported ? `${r.unsupported} unreadable skipped` : '',
        r.capped ? `only the first ${MAX_EVENTS_PER_CALENDAR} copied` : '',
        r.unknown.length ? `schools/groups not in Settings: ${listNames(r.unknown)}` : '',
      ].filter(Boolean);
      lines.push(`${label}: OK ✓, ${plural(r.rows.length, 'event')}${extras.length ? ` (${extras.join('; ')})` : ''}`);
    }
  }
  return lines;
}
