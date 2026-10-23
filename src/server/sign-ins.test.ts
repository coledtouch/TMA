import { describe, expect, it } from 'vitest';
import { TABLES } from '../shared/schema';
import { mapSignIn, mergeSignIns, signInCount } from './data';
import type { LockOptions, RowData } from './services';
import {
  OPENED_EVERY_SECONDS,
  OPENED_LOCK_WAIT_MS,
  OPENED_RETRY_SECONDS,
  openedKey,
  PENDING_SIGN_IN_SECONDS,
  pendingSignInKey,
  SIGN_IN_LOCK_WAIT_MS,
} from './sign-ins';
import { harness, NGUYEN, ORTIZ, PARENT, PARENT2, TEST_NOW, TREASURER, type Harness } from './test-helpers';

const NOW = TEST_NOW.toISOString(); // 2026-10-21T14:00:00.000Z, 10:00 AM in New York
const later = (minutes: number) => new Date(TEST_NOW.getTime() + minutes * 60_000);

/** The Sign-ins rows for one email (blank rows left out, as the sheet reads them). */
function rowsFor(h: Harness, email: string): RowData[] {
  return h.rows('Sign-ins').filter((r) => String(r.Email ?? '').trim().toLowerCase() === email);
}

/** Count the store writes to the Sign-ins tab from now on. */
function countWrites(h: Harness): { n: number } {
  const writes = { n: 0 };
  const store = h.services.store;
  const append = store.append.bind(store);
  const update = store.update.bind(store);
  store.append = (table, rows) => {
    if (table === 'Sign-ins') writes.n += 1;
    append(table, rows);
  };
  store.update = (table, row, patch) => {
    if (table === 'Sign-ins') writes.n += 1;
    update(table, row, patch);
  };
  return writes;
}

describe('Sign-ins tab', () => {
  it('is set up with the other tabs, hidden like the app’s own, and holds only email, household, times and a count', () => {
    expect(TABLES['Sign-ins']).toMatchObject({
      headers: ['Email', 'FamilyID', 'First Signed In', 'Last Signed In', 'Last Opened App', 'Sign-ins'],
      system: true,
    });
    const h = harness({ sample: false });
    expect(h.app.setup().createdTables).toContain('Sign-ins');
  });
});

describe('signing in', () => {
  it('adds a row the first time: first and last sign-in, opened, count 1 and the household', () => {
    const h = harness({ tables: { 'Sign-ins': [] } });
    h.signIn(NGUYEN);
    expect(h.rows('Sign-ins')).toEqual([
      {
        Email: NGUYEN,
        FamilyID: 'F0002',
        'First Signed In': NOW,
        'Last Signed In': NOW,
        'Last Opened App': NOW,
        'Sign-ins': 1,
      },
    ]);
  });

  it('updates the same row later: first sign-in kept, last sign-in and opened moved, count up', () => {
    const h = harness();
    const before = rowsFor(h, PARENT)[0];
    h.services.setNow(later(90));
    h.signIn('Parent@Example.COM');
    expect(rowsFor(h, PARENT)).toEqual([
      {
        Email: PARENT,
        FamilyID: 'F0001',
        'First Signed In': before['First Signed In'],
        'Last Signed In': '2026-10-21T15:30:00.000Z',
        'Last Opened App': '2026-10-21T15:30:00.000Z',
        'Sign-ins': 3,
      },
    ]);
    expect(h.rows('Sign-ins')).toHaveLength(3); // the sample's three people, no new row
  });

  it('records someone with no household yet with a blank FamilyID, and fills it in once they sign up', () => {
    const h = harness();
    const token = h.signIn('new.family@example.com');
    expect(rowsFor(h, 'new.family@example.com')[0]).toMatchObject({ FamilyID: '', 'Sign-ins': 1 });
    h.ok(
      'household.save',
      {
        guardians: [{ name: 'Sam Rivera', email: 'new.family@example.com' }],
        students: [{ firstName: 'Lu', lastName: 'Rivera', grade: '4', school: 'Elementary', ensembles: [] }],
      },
      token,
    );
    h.services.setNow(later(7 * 60)); // past the 6-hour wait, so the next opening is noted
    h.ok('me.bootstrap', {}, token);
    expect(rowsFor(h, 'new.family@example.com')[0]).toMatchObject({
      FamilyID: 'F0004',
      'Last Opened App': '2026-10-21T21:00:00.000Z',
      'Sign-ins': 1,
    });
  });

  it('stores no code, device, browser or address: only the six columns', () => {
    const h = harness({ tables: { 'Sign-ins': [] } });
    h.ok('auth.requestCode', { email: ORTIZ });
    const code = /(\d{6})/.exec(h.services.outbox.mail.at(-1)?.subject ?? '')?.[1] ?? '';
    h.ok('auth.verifyCode', { email: ORTIZ, code });
    const [row] = h.rows('Sign-ins');
    expect(Object.keys(row).sort()).toEqual([...TABLES['Sign-ins'].headers].sort());
    expect(JSON.stringify(row)).not.toContain(code);
  });

  it('does not note anything for a wrong code', () => {
    const h = harness({ tables: { 'Sign-ins': [] } });
    h.ok('auth.requestCode', { email: NGUYEN });
    expect(h.err('auth.verifyCode', { email: NGUYEN, code: '000000' }).code).toBe('UNAUTHORIZED');
    expect(h.rows('Sign-ins')).toEqual([]);
  });

  it('works before Set up has made the tab: the first sign-in creates it', () => {
    const h = harness();
    delete h.services.db.tables['Sign-ins'];
    h.signIn(PARENT2);
    expect(h.rows('Sign-ins')).toEqual([expect.objectContaining({ Email: PARENT2, FamilyID: 'F0001', 'Sign-ins': 1 })]);
  });
});

describe('opening the app (me.bootstrap)', () => {
  it('is noted at most once every 6 hours per email, and not right after signing in', () => {
    const h = harness();
    const token = h.signIn(NGUYEN);
    const writes = countWrites(h);
    h.ok('me.bootstrap', {}, token); // the sign-in already noted this opening
    h.services.setNow(later(5 * 60));
    h.ok('me.bootstrap', {}, token);
    expect(writes.n).toBe(0);

    h.services.setNow(later(6 * 60 + 1));
    h.ok('me.bootstrap', {}, token);
    expect(writes.n).toBe(1);
    expect(rowsFor(h, NGUYEN)[0]).toMatchObject({ 'Last Signed In': NOW, 'Last Opened App': '2026-10-21T20:01:00.000Z', 'Sign-ins': 1 });
    h.ok('me.bootstrap', {}, token);
    expect(writes.n).toBe(1);
    expect(h.services.cache.get(openedKey(NGUYEN))).toBe('1');
    expect(OPENED_EVERY_SECONDS).toBe(6 * 3600);
  });

  it('adds a row without sign-in dates for someone who signed in before the app kept the tab', () => {
    const h = harness({ tables: { 'Sign-ins': [] } });
    const token = h.signIn(PARENT);
    h.services.db.tables['Sign-ins'] = []; // as if that sign-in happened before the update
    h.services.cache.remove(openedKey(PARENT));
    h.ok('me.bootstrap', {}, token);
    expect(h.rows('Sign-ins')).toEqual([
      { Email: PARENT, FamilyID: 'F0001', 'First Signed In': '', 'Last Signed In': '', 'Last Opened App': NOW, 'Sign-ins': 0 },
    ]);
    // Their next real sign-in fills in the first sign-in.
    h.services.setNow(later(60));
    h.signIn(PARENT);
    expect(rowsFor(h, PARENT)[0]).toMatchObject({ 'First Signed In': '2026-10-21T15:00:00.000Z', 'Sign-ins': 1 });
  });

  it('skips the write when the cache forgot but the sheet already has a recent opening', () => {
    const h = harness();
    const token = h.signIn(PARENT);
    h.services.cache.remove(openedKey(PARENT)); // CacheService may drop entries early
    const writes = countWrites(h);
    h.services.setNow(later(30));
    h.ok('me.bootstrap', {}, token);
    expect(writes.n).toBe(0);
    expect(h.services.cache.get(openedKey(PARENT))).toBe('1');
  });
});

describe('never in the way', () => {
  /** A lock that is always busy for the short best-effort wait (another execution holds it). */
  function busyLock(h: Harness): Array<number | undefined> {
    const waits: Array<number | undefined> = [];
    h.services.withLock = <T>(fn: () => T, options?: LockOptions): T => {
      waits.push(options?.waitMs);
      if (options?.waitMs !== undefined) throw new Error('Lock timeout: another process was holding the lock for too long.');
      return fn();
    };
    return waits;
  }

  it('skips the row when the lock is busy, waiting only briefly; sign-in and bootstrap still work', () => {
    const h = harness();
    const before = JSON.stringify(h.rows('Sign-ins'));
    const waits = busyLock(h);
    const token = h.signIn(NGUYEN);
    expect(h.ok('me.bootstrap', {}, token).me.familyId).toBe('F0002');
    expect(JSON.stringify(h.rows('Sign-ins'))).toBe(before);
    expect(waits).toEqual([SIGN_IN_LOCK_WAIT_MS]); // the bootstrap right after waits for the retry time
    expect(SIGN_IN_LOCK_WAIT_MS).toBeLessThanOrEqual(5000);
    expect(OPENED_LOCK_WAIT_MS).toBeLessThanOrEqual(2000);
    expect(h.services.logs.filter((l) => l.level === 'error').map((l) => l.message)).toEqual([
      'Could not note the sign-in (Sign-ins tab); skipped',
    ]);
  });

  it('tries an opening again after 10 minutes, not on every page load', () => {
    const h = harness();
    const token = h.signIn(NGUYEN);
    h.services.setNow(later(6 * 60 + 1));
    const waits = busyLock(h);
    h.ok('me.bootstrap', {}, token);
    h.services.setNow(later(6 * 60 + 5));
    h.ok('me.bootstrap', {}, token);
    expect(waits).toHaveLength(1);

    h.services.withLock = <T>(fn: () => T): T => fn(); // free again
    h.services.setNow(later(6 * 60 + 1 + OPENED_RETRY_SECONDS / 60));
    h.ok('me.bootstrap', {}, token);
    expect(rowsFor(h, NGUYEN)[0]['Last Opened App']).toBe('2026-10-21T20:11:00.000Z');
  });

  it('keeps a sign-in skipped on a busy lock and adds it with the next write, so it is not lost', () => {
    const h = harness({ tables: { 'Sign-ins': [] } });
    const waits = busyLock(h);
    const token = h.signIn(NGUYEN); // the row is skipped
    h.ok('me.bootstrap', {}, token);
    expect(h.rows('Sign-ins')).toEqual([]);
    expect(h.services.cache.get(pendingSignInKey(NGUYEN))).toBeTruthy();
    expect(PENDING_SIGN_IN_SECONDS).toBe(6 * 3600);

    h.services.withLock = <T>(fn: () => T): T => fn(); // free again
    h.services.setNow(later(11)); // past the 10-minute retry
    h.ok('me.bootstrap', {}, token);
    expect(waits).toEqual([SIGN_IN_LOCK_WAIT_MS]);
    expect(rowsFor(h, NGUYEN)).toEqual([
      { Email: NGUYEN, FamilyID: 'F0002', 'First Signed In': NOW, 'Last Signed In': NOW, 'Last Opened App': '2026-10-21T14:11:00.000Z', 'Sign-ins': 1 },
    ]);
    expect(h.services.cache.get(pendingSignInKey(NGUYEN))).toBeNull();
    const r = h.ok('admin.report', { kind: 'app-activity' }, h.signIn(TREASURER)).report;
    expect(r.rows.find((row) => row.familyId === 'F0002')).toMatchObject({ lastSignedIn: '2026-10-21', signIns: 1 });
  });

  it('adds several skipped sign-ins with the next sign-in, keeping the first one’s time', () => {
    const h = harness({ tables: { 'Sign-ins': [] } });
    busyLock(h);
    h.signIn(NGUYEN);
    h.services.setNow(later(30));
    h.signIn(NGUYEN); // on another phone, still busy
    h.services.withLock = <T>(fn: () => T): T => fn();
    h.services.setNow(later(60));
    h.signIn(NGUYEN);
    expect(rowsFor(h, NGUYEN)).toEqual([
      { Email: NGUYEN, FamilyID: 'F0002', 'First Signed In': NOW, 'Last Signed In': '2026-10-21T15:00:00.000Z', 'Last Opened App': '2026-10-21T15:00:00.000Z', 'Sign-ins': 3 },
    ]);
    // Added once only.
    h.services.setNow(later(7 * 60));
    h.signIn(NGUYEN);
    expect(rowsFor(h, NGUYEN)[0]['Sign-ins']).toBe(4);
  });

  it('never moves Last Signed In back when a skipped sign-in is added after a later one', () => {
    const h = harness({ tables: { 'Sign-ins': [] } });
    busyLock(h);
    const token = h.signIn(PARENT);
    h.services.withLock = <T>(fn: () => T): T => fn();
    // A later sign-in reached the sheet some other way (the treasurer pasted the row back, say).
    h.services.db.tables['Sign-ins'] = [
      { Email: PARENT, FamilyID: 'F0001', 'First Signed In': '2026-09-01T12:00:00.000Z', 'Last Signed In': '2026-10-21T14:30:00.000Z', 'Last Opened App': '', 'Sign-ins': 4 },
    ];
    h.services.setNow(later(40));
    h.ok('me.bootstrap', {}, token);
    expect(rowsFor(h, PARENT)[0]).toMatchObject({
      'First Signed In': '2026-09-01T12:00:00.000Z',
      'Last Signed In': '2026-10-21T14:30:00.000Z',
      'Last Opened App': '2026-10-21T14:40:00.000Z',
      'Sign-ins': 5,
    });
  });

  it('never breaks signing in or opening the app when the write fails', () => {
    const h = harness();
    const store = h.services.store;
    const update = store.update.bind(store);
    const append = store.append.bind(store);
    store.update = (table, row, patch) => {
      if (table === 'Sign-ins') throw new Error('Service Spreadsheets failed');
      update(table, row, patch);
    };
    store.append = (table, rows) => {
      if (table === 'Sign-ins') throw new Error('Service Spreadsheets failed');
      append(table, rows);
    };
    const token = h.signIn(PARENT);
    expect(token).toMatch(/\./);
    h.services.setNow(later(6 * 60 + 1));
    expect(h.ok('me.bootstrap', {}, token).me.email).toBe(PARENT);
    h.signIn('someone.new@example.com');
    expect(h.services.logs.filter((l) => l.level === 'error')).toHaveLength(3);
  });

  it('never breaks them when the cache fails either', () => {
    const h = harness();
    h.ok('auth.requestCode', { email: NGUYEN });
    const code = /(\d{6})/.exec(h.services.outbox.mail.at(-1)?.subject ?? '')?.[1] ?? '';
    h.services.cache.put = () => {
      throw new Error('CacheService unavailable');
    };
    const { token } = h.ok('auth.verifyCode', { email: NGUYEN, code });
    expect(rowsFor(h, NGUYEN)).toHaveLength(1);
    h.services.cache.get = () => {
      throw new Error('CacheService unavailable');
    };
    expect(h.ok('me.bootstrap', {}, token).me.familyId).toBe('F0002');
  });
});

describe('duplicate rows for one email', () => {
  const dupes = (): RowData[] => [
    { Email: PARENT, FamilyID: 'F0001', 'First Signed In': '2026-09-01T12:00:00.000Z', 'Last Signed In': '2026-09-10T12:00:00.000Z', 'Last Opened App': '2026-09-12T12:00:00.000Z', 'Sign-ins': 4 },
    { Email: NGUYEN, FamilyID: 'F0002', 'First Signed In': '2026-10-01T12:00:00.000Z', 'Last Signed In': '2026-10-01T12:00:00.000Z', 'Last Opened App': '2026-10-01T12:00:00.000Z', 'Sign-ins': 1 },
    // A copy pasted further down, with capitals and spaces, seen more recently.
    { Email: ' Parent@Example.COM ', FamilyID: 'F0001', 'First Signed In': '2026-09-05T12:00:00.000Z', 'Last Signed In': '2026-10-15T12:00:00.000Z', 'Last Opened App': '', 'Sign-ins': '3' },
  ];

  it('count as one person on read: earliest first sign-in, latest times, highest count', () => {
    const h = harness({ tables: { 'Sign-ins': dupes() } });
    const r = h.ok('admin.report', { kind: 'app-activity' }, h.signIn(TREASURER)).report;
    const jordan = r.rows.find((row) => row.familyId === 'F0001');
    expect(jordan).toMatchObject({ lastOpened: '2026-10-15', lastSignedIn: '2026-10-15', signIns: 4 });
  });

  it('are merged into one row by the next write, the others blanked', () => {
    const h = harness({ tables: { 'Sign-ins': dupes() } });
    h.signIn(PARENT);
    const all = h.services.db.tables['Sign-ins']!;
    // The kept row is the one seen last (row 4); row 2 is blanked, Priya's row is untouched.
    expect(all[2]).toEqual({
      Email: PARENT,
      FamilyID: 'F0001',
      'First Signed In': '2026-09-01T12:00:00.000Z',
      'Last Signed In': NOW,
      'Last Opened App': NOW,
      'Sign-ins': 5,
    });
    expect(Object.values(all[0]).every((v) => v === '')).toBe(true);
    expect(all[1]).toEqual(dupes()[1]);
    expect(rowsFor(h, PARENT)).toHaveLength(1);
  });

  it('are merged by an opening too', () => {
    const h = harness();
    const token = h.signIn(PARENT);
    // As if the copies were pasted after that sign-in.
    h.services.db.tables['Sign-ins'] = dupes();
    h.services.cache.remove(openedKey(PARENT));
    h.ok('me.bootstrap', {}, token);
    expect(rowsFor(h, PARENT)).toEqual([
      {
        Email: PARENT,
        FamilyID: 'F0001',
        'First Signed In': '2026-09-01T12:00:00.000Z',
        'Last Signed In': '2026-10-15T12:00:00.000Z',
        'Last Opened App': NOW,
        'Sign-ins': 4,
      },
    ]);
  });

  it('mergeSignIns keeps the row seen last (the higher one on a tie) and the highest count', () => {
    const a = mapSignIn({ rowNumber: 2, data: { Email: 'a@example.com', FamilyID: 'F1', 'Last Opened App': '2026-10-01T00:00:00Z', 'Sign-ins': 2 } })!;
    const b = mapSignIn({ rowNumber: 3, data: { Email: 'A@example.com', FamilyID: 'F2', 'Last Opened App': '2026-10-01T00:00:00Z', 'Sign-ins': 7 } })!;
    expect(mergeSignIns(a, b)).toMatchObject({ row: 2, rows: [2, 3], familyId: 'F1', count: 7 });
    expect(mergeSignIns(b, a)).toMatchObject({ row: 2, rows: [2, 3], familyId: 'F1', count: 7 });
    expect(mapSignIn({ rowNumber: 4, data: { Email: 'not an email', 'Sign-ins': 1 } })).toBeNull();
  });

  it('signInCount reads whole numbers and treats anything else as 0', () => {
    expect([3, '4', ' 5 ', '2.0', 2.7, '', null, 'many', -1, Number.NaN].map(signInCount)).toEqual([3, 4, 5, 2, 2, 0, 0, 0, 0, 0]);
  });
});

describe('time zones', () => {
  it('writes exact instants and reports New York calendar days', () => {
    // 10:30 PM on Oct 21 in New York is already Oct 22 in UTC.
    const lateNight = new Date('2026-10-22T02:30:00.000Z');
    const h = harness({ now: lateNight, tables: { 'Sign-ins': [] } });
    h.signIn(NGUYEN);
    expect(rowsFor(h, NGUYEN)[0]['Last Signed In']).toBe('2026-10-22T02:30:00.000Z');
    const r = h.ok('admin.report', { kind: 'app-activity' }, h.signIn(TREASURER)).report;
    expect(r.rows.find((row) => row.familyId === 'F0002')).toMatchObject({ lastOpened: '2026-10-21', lastSignedIn: '2026-10-21', daysSince: 0 });
  });

  it('reads times the treasurer typed as New York time', () => {
    const h = harness({
      tables: { 'Sign-ins': [{ Email: NGUYEN, 'First Signed In': '10/1/2026 9:30 PM', 'Last Signed In': '10/20/2026 11:45 PM', 'Sign-ins': 2 }] },
    });
    const r = h.ok('admin.report', { kind: 'app-activity' }, h.signIn(TREASURER)).report;
    expect(r.rows.find((row) => row.familyId === 'F0002')).toMatchObject({ lastOpened: '2026-10-20', lastSignedIn: '2026-10-20', daysSince: 1 });
  });
});
