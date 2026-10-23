import * as nodeCrypto from 'node:crypto';
import { parseDate, parseTimeText } from '../server/util';
import { TABLES } from '../shared/schema';
import { createSheetStore, mapHeaders, toSheetValue, WALL_CLOCK_FORMAT } from './sheet-store';
import { FakeSheet, hostTimeZone, installGasFakes, instantIn, uninstallGasFakes, wallClockIn, type GasFakes } from './testing/fakes';

let gas: GasFakes;

beforeEach(() => {
  gas = installGasFakes(nodeCrypto);
});
afterEach(() => uninstallGasFakes());

function store() {
  return createSheetStore(gas.spreadsheet as unknown as GoogleAppsScript.Spreadsheet.Spreadsheet);
}

describe('mapHeaders', () => {
  it('normalizes spelling/case/punctuation and accepts aliases', () => {
    const columns = mapHeaders('Ledger', ['date', 'Student ID', 'TYPE', 'description', 'Amount ($)', 'Trip', 'Notes']);
    expect(Object.fromEntries(columns)).toEqual({
      Date: 1,
      StudentID: 2,
      Type: 3,
      Description: 4,
      Amount: 5,
      ActivityID: 6,
    });
  });

  it('prefers an exact canonical header over an alias of it', () => {
    // "Name" is an alias of "Parent Name"; the real "Parent Name" column must win.
    const columns = mapHeaders('Families', ['Name', 'Email', 'Parent Name']);
    expect(columns.get('Parent Name')).toBe(3);
    expect(columns.get('Email')).toBe(2);
  });

  it('maps each sheet column to at most one header and ignores blanks', () => {
    const columns = mapHeaders('Families', ['', 'Email', 'email', null, 'Family ID']);
    expect(columns.get('Email')).toBe(2);
    expect(columns.get('FamilyID')).toBe(5);
    expect(columns.size).toBe(2);
  });
});

describe('toSheetValue', () => {
  it('passes through numbers, booleans and dates; blanks for null/undefined/NaN', () => {
    const d = new Date('2026-10-21T00:00:00Z');
    expect(toSheetValue(12.5)).toBe(12.5);
    expect(toSheetValue(false)).toBe(false);
    expect(toSheetValue(d)).toBe(d);
    expect(toSheetValue(null)).toBe('');
    expect(toSheetValue(undefined)).toBe('');
    expect(toSheetValue(Number.NaN)).toBe('');
    expect(toSheetValue(new Date('nope'))).toBe('');
  });

  it('forces text for values Sheets would parse as formulas', () => {
    expect(toSheetValue('=IMPORTXML("https://evil.example","//a")')).toBe('\'=IMPORTXML("https://evil.example","//a")');
    expect(toSheetValue('+1 (603) 555-0100')).toBe("'+1 (603) 555-0100");
    expect(toSheetValue('@here')).toBe("'@here");
    expect(toSheetValue("'quoted")).toBe("''quoted");
    expect(toSheetValue('-20.00')).toBe('-20.00'); // plain numbers are fine
    expect(toSheetValue('Avery')).toBe('Avery');
  });

  it('truncates text to the Sheets cell limit', () => {
    expect((toSheetValue('x'.repeat(60000)) as string).length).toBe(50000);
    expect((toSheetValue(`=${'x'.repeat(60000)}`) as string).length).toBe(50000);
  });
});

describe('SheetStore.read', () => {
  it('maps rows to canonical headers, ignores extra columns and blank rows, keeps row numbers', () => {
    const when = new Date(2026, 9, 1);
    gas.spreadsheet.addSheet(
      FakeSheet.withRows('Ledger', [
        ['Student ID', 'Treasurer notes', 'Amount', 'Date', 'Type'],
        ['S0001', 'keep me', 50, when, 'Fundraiser'],
        ['', 'only a note', '', '', ''],
        ['', '', '', '', ''],
        ['S0002', '', -20, '2026-10-02', 'Redemption'],
      ]),
    );
    const rows = store().read('Ledger');
    expect(rows).toEqual([
      { rowNumber: 2, data: { StudentID: 'S0001', Amount: 50, Date: when, Type: 'Fundraiser' } },
      { rowNumber: 5, data: { StudentID: 'S0002', Amount: -20, Date: '2026-10-02', Type: 'Redemption' } },
    ]);
  });

  it('returns [] for a missing tab and finds tabs case-insensitively', () => {
    expect(store().read('Events')).toEqual([]);
    gas.spreadsheet.addSheet(FakeSheet.withRows('events', [['ID', 'Title'], ['E1', 'Concert']]));
    expect(store().read('Events')).toEqual([{ rowNumber: 2, data: { ID: 'E1', Title: 'Concert' } }]);
  });

  it('reads each tab once per execution and returns copies', () => {
    const sheet = gas.spreadsheet.addSheet(FakeSheet.withRows('Students', [['StudentID', 'First Name'], ['S1', 'Avery']]));
    const s = store();
    const first = s.read('Students');
    first[0].data['First Name'] = 'Mutated';
    expect(s.read('Students')[0].data['First Name']).toBe('Avery');
    expect(sheet.ops.filter((op) => op === 'getDataRange')).toHaveLength(1);
  });

  it('re-reads a tab after a write to it, and after invalidate()', () => {
    const sheet = gas.spreadsheet.addSheet(FakeSheet.withRows('Students', [['StudentID', 'Grade'], ['S1', 7]]));
    const s = store();
    s.read('Students');
    s.update('Students', 2, { Grade: 8 });
    expect(s.read('Students')[0].data.Grade).toBe(8);
    s.invalidate();
    s.read('Students');
    expect(sheet.ops.filter((op) => op === 'getDataRange')).toHaveLength(3);
  });
});

describe('SheetStore.columns', () => {
  it('lists the canonical columns a tab has (aliases included), and null for a missing tab', () => {
    gas.spreadsheet.addSheet(FakeSheet.withRows('Ledger', [['Student ID', 'Amount (USD)', 'Amount ($)', 'Notes'], ['S1', 5, 5, '']]));
    const s = store();
    expect(s.columns('Ledger')).toEqual(['StudentID', 'Amount']); // "Amount ($)" is an alias; "Amount (USD)" isn't
    expect(s.columns('Events')).toBeNull();
  });

  it('sees a header renamed in the Sheets UI after invalidate(table)', () => {
    const sheet = gas.spreadsheet.addSheet(FakeSheet.withRows('Announcements', [['Title', 'Sent'], ['Hello', '']]));
    const s = store();
    expect(s.columns('Announcements')).toEqual(['Title', 'Sent']);
    sheet.write(1, 2, 'Sent At');
    s.invalidate('Announcements');
    expect(s.columns('Announcements')).toEqual(['Title']);
  });
});

describe('SheetStore.ensureTable', () => {
  it('creates a missing tab with a bold, frozen header row and the header note', () => {
    const result = store().ensureTable('Families');
    expect(result).toEqual({ created: true, addedColumns: [] });
    const sheet = gas.spreadsheet.getSheetByName('Families')!;
    expect(sheet.dump()[0]).toEqual([...TABLES.Families.headers]);
    expect(sheet.frozenRows).toBe(1);
    expect(sheet.notes.get('1,1')).toBe(TABLES.Families.note);
    expect(sheet.fontWeights.get('1,1')).toBe('bold');
    expect(sheet.hidden).toBe(false);
  });

  it('hides system tabs when creating them', () => {
    store().ensureTable('Devices');
    expect(gas.spreadsheet.getSheetByName('Devices')!.hidden).toBe(true);
  });

  it('still creates a system tab when Sheets refuses to hide it (last visible tab)', () => {
    vi.spyOn(FakeSheet.prototype, 'hideSheet').mockImplementation(() => {
      throw new Error("Sorry, it is not possible to hide all the sheets in a document.");
    });
    expect(store().ensureTable('Log')).toEqual({ created: true, addedColumns: [] });
    expect(gas.spreadsheet.getSheetByName('Log')!.dump()).toEqual([['At', 'Kind', 'Detail']]);
  });

  it('appends only missing headers after the last used column and is idempotent', () => {
    const sheet = gas.spreadsheet.addSheet(
      FakeSheet.withRows('Payments', [
        ['date', 'Student ID', 'Activity', 'Amount', 'My column'],
        ['2026-10-01', 'S1', 'FL27', 100, 'x'],
      ]),
    );
    const first = store().ensureTable('Payments');
    // "Activity" is not an alias for Payments.ActivityID, so it is added too.
    expect(first).toEqual({
      created: false,
      addedColumns: ['ActivityID', 'Fee Covered', 'Gross', 'Method', 'Reference', 'Payer Email', 'Status'],
    });
    expect(sheet.dump()[0]).toEqual([
      'date',
      'Student ID',
      'Activity',
      'Amount',
      'My column',
      'ActivityID',
      'Fee Covered',
      'Gross',
      'Method',
      'Reference',
      'Payer Email',
      'Status',
    ]);
    expect(sheet.dump()[1].slice(0, 5)).toEqual(['2026-10-01', 'S1', 'FL27', 100, 'x']);
    expect(store().ensureTable('Payments')).toEqual({ created: false, addedColumns: [] });
    expect(gas.spreadsheet.sheets).toHaveLength(1);
  });

  it('fills the header row of an existing empty tab', () => {
    gas.spreadsheet.addSheet(new FakeSheet('Log'));
    expect(store().ensureTable('Log')).toEqual({ created: false, addedColumns: ['At', 'Kind', 'Detail'] });
    expect(gas.spreadsheet.getSheetByName('Log')!.dump()).toEqual([['At', 'Kind', 'Detail']]);
  });

  it('grows the grid when headers would not fit', () => {
    const sheet = gas.spreadsheet.addSheet(FakeSheet.withRows('Activities', [['ActivityID']]));
    sheet.maxColumns = 3;
    store().ensureTable('Activities');
    expect(sheet.maxColumns).toBe(TABLES.Activities.headers.length);
    expect(sheet.dump()[0]).toEqual([...TABLES.Activities.headers]);
  });
});

describe('SheetStore.append', () => {
  it('writes all rows with one setValues below the last row, in the mapped columns', () => {
    const sheet = gas.spreadsheet.addSheet(
      FakeSheet.withRows('Ledger', [
        ['Notes', 'StudentID', 'Date', 'Amount', 'Type'],
        ['n', 'S1', '2026-10-01', 5, 'Credit'],
      ]),
    );
    store().append('Ledger', [
      { StudentID: 'S2', Amount: 25, Date: '2026-10-21', Unknown: 'ignored' },
      { StudentID: 'S3', Amount: -10, Type: 'Redemption' },
    ]);
    expect(sheet.ops.filter((op) => op.startsWith('setValues'))).toEqual(['setValues R3C2:2x4']);
    expect(sheet.dump().slice(2)).toEqual([
      ['', 'S2', '2026-10-21', 25, ''],
      ['', 'S3', '', -10, 'Redemption'],
    ]);
  });

  it('creates the tab when missing, takes the script lock, and is readable afterwards', () => {
    const locked: string[] = [];
    const s = createSheetStore(gas.spreadsheet as unknown as GoogleAppsScript.Spreadsheet.Spreadsheet, {
      withLock: (fn) => {
        locked.push('lock');
        return fn();
      },
    });
    s.append('Log', [{ At: '2026-10-21T12:00:00.000Z', Kind: 'notify', Detail: 'x' }]);
    expect(locked).toEqual(['lock']);
    expect(gas.spreadsheet.getSheetByName('Log')!.hidden).toBe(true);
    expect(s.read('Log')).toEqual([
      { rowNumber: 2, data: { At: '2026-10-21T12:00:00.000Z', Kind: 'notify', Detail: 'x' } },
    ]);
  });

  it('restores a canonical column the treasurer deleted instead of dropping the value', () => {
    const sheet = gas.spreadsheet.addSheet(
      FakeSheet.withRows('Redemptions', [['RequestID', 'Status'], ['R-1', 'Approved']]),
    );
    store().append('Redemptions', [{ RequestID: 'R-2', Status: 'Pending', Notified: 'now' }]);
    expect(sheet.dump()).toEqual([
      ['RequestID', 'Status', 'Notified'],
      ['R-1', 'Approved', ''],
      ['R-2', 'Pending', 'now'],
    ]);
  });

  it('adds grid rows when the sheet is full and writes formula-like text as plain text', () => {
    const sheet = gas.spreadsheet.addSheet(FakeSheet.withRows('Families', [['FamilyID', 'Parent Name']]));
    sheet.maxRows = 1;
    const s = store();
    s.append('Families', [{ FamilyID: 'F0009', 'Parent Name': '=HYPERLINK("http://x")' }]);
    expect(sheet.maxRows).toBe(2);
    expect(sheet.raw(2, 2)).toBe('\'=HYPERLINK("http://x")');
    expect(s.read('Families')[0].data['Parent Name']).toBe('=HYPERLINK("http://x")');
  });

  it('does nothing for an empty list', () => {
    store().append('Ledger', []);
    expect(gas.spreadsheet.sheets).toHaveLength(0);
  });
});

describe('SheetStore.update', () => {
  it('writes only the patched cells, grouping adjacent columns', () => {
    const sheet = gas.spreadsheet.addSheet(
      FakeSheet.withRows('Redemptions', [
        [...TABLES.Redemptions.headers],
        ['R-1', 'x', 'p@example.com', 'F1', 'S1', 'FL27', 200, '', 'Pending', '', '', '', ''],
      ]),
    );
    store().update('Redemptions', 2, {
      Status: 'Approved',
      Decided: '2026-10-21',
      'Decided By': 'treasurer@example.com',
      Notified: '2026-10-21',
      Nope: 'ignored',
      'Admin Note': undefined,
    });
    expect(sheet.ops).toEqual(['setValues R2C9:1x3', 'setValues R2C13:1x1']);
    expect(sheet.dump()[1]).toEqual([
      'R-1',
      'x',
      'p@example.com',
      'F1',
      'S1',
      'FL27',
      200,
      '',
      'Approved',
      '2026-10-21',
      'treasurer@example.com',
      '',
      '2026-10-21',
    ]);
  });

  it('rejects row numbers outside the data', () => {
    gas.spreadsheet.addSheet(FakeSheet.withRows('Students', [['StudentID'], ['S1']]));
    const s = store();
    expect(() => s.update('Students', 1, { StudentID: 'x' })).toThrow(/Invalid row/);
    expect(() => s.update('Students', 2.5, { StudentID: 'x' })).toThrow(/Invalid row/);
    expect(() => s.update('Students', 3, { StudentID: 'x' })).toThrow(/does not exist/);
    expect(() => s.update('Events', 2, { ID: 'x' })).toThrow(/missing/);
  });

  it('does not re-read the whole tab to find columns for consecutive updates', () => {
    const sheet = gas.spreadsheet.addSheet(
      FakeSheet.withRows('Students', [['StudentID', 'Status'], ['S1', 'Pending'], ['S2', 'Pending']]),
    );
    const s = store();
    s.read('Students');
    s.update('Students', 2, { Status: 'Active' });
    s.update('Students', 3, { Status: 'Active' });
    expect(sheet.ops.filter((op) => op === 'getDataRange')).toHaveLength(1);
    expect(s.read('Students').map((r) => r.data.Status)).toEqual(['Active', 'Active']);
  });
});

describe('SheetStore.overwrite', () => {
  it('clears old data rows and writes the new ones from row 2', () => {
    const sheet = gas.spreadsheet.addSheet(
      FakeSheet.withRows('_Snapshot', [
        ['StudentID', 'Balance', 'Updated'],
        ['S1', 10, 'a'],
        ['S2', 20, 'a'],
        ['S3', 30, 'a'],
      ]),
    );
    const s = store();
    s.overwrite('_Snapshot', [
      { StudentID: 'S1', Balance: 15, Updated: 'b' },
      { StudentID: 'S4', Balance: 5, Updated: 'b' },
    ]);
    expect(sheet.dump()).toEqual([
      ['StudentID', 'Balance', 'Updated'],
      ['S1', 15, 'b'],
      ['S4', 5, 'b'],
    ]);
    expect(s.read('_Snapshot')).toHaveLength(2);
  });

  it('with no rows leaves only the header', () => {
    const sheet = gas.spreadsheet.addSheet(FakeSheet.withRows('_Sent', [['Key', 'At'], ['k', 'a']]));
    store().overwrite('_Sent', []);
    expect(sheet.dump()).toEqual([['Key', 'At']]);
  });
});

describe('SheetStore time zones', () => {
  // The script zone is the host's (`new Date(y, m, d)` uses it, as in Apps Script).
  // A spreadsheet zone ~14 hours away makes a missed conversion change the calendar day.
  const FAR_ZONE = hostTimeZone() === 'Pacific/Kiritimati' ? 'Pacific/Pago_Pago' : 'Pacific/Kiritimati';
  /** What Sheets' getValues() returns for a wall-clock value typed into a sheet in `zone`. */
  const typedIn = (zone: string, year: number, month: number, day: number, hour = 0, minute = 0) =>
    instantIn({ year, month, day, hour, minute, second: 0, ms: 0 }, zone);

  it('reads typed dates and times with the sheet’s wall clock when the spreadsheet zone differs', () => {
    gas.spreadsheet.timeZone = FAR_ZONE;
    const typedDate = typedIn(FAR_ZONE, 2026, 10, 21);
    // Without the fix the core would see another day.
    expect(parseDate(typedDate)).not.toBe('2026-10-21');
    gas.spreadsheet.addSheet(FakeSheet.withRows('Ledger', [['Date', 'StudentID', 'Amount'], [typedDate, 'S1', 50]]));
    gas.spreadsheet.addSheet(
      FakeSheet.withRows('Events', [
        ['ID', 'Date', 'Time', 'Title'],
        ['E1', typedIn(FAR_ZONE, 2026, 12, 10), typedIn(FAR_ZONE, 1899, 12, 30, 19, 30), 'Winter Concert'],
      ]),
    );
    const s = store();

    const date = s.read('Ledger')[0].data.Date as Date;
    expect([date.getFullYear(), date.getMonth() + 1, date.getDate(), date.getHours(), date.getMinutes()]).toEqual([2026, 10, 21, 0, 0]);
    expect(parseDate(date)).toBe('2026-10-21');
    const event = s.read('Events')[0].data;
    expect(parseDate(event.Date)).toBe('2026-12-10');
    expect(parseTimeText(event.Time)).toBe('7:30 PM');
    expect(gas.formatDateCalls.every(([, zone, pattern]) => zone === FAR_ZONE && pattern === WALL_CLOCK_FORMAT)).toBe(true);
  });

  it('round-trips Dates the app writes (append and update); the sheet shows the script zone’s wall clock', () => {
    gas.spreadsheet.timeZone = FAR_ZONE;
    const sheet = gas.spreadsheet.addSheet(FakeSheet.withRows('Log', [['At', 'Kind', 'Detail']]));
    const at = new Date('2026-10-21T14:05:06.789Z');
    const s = store();
    s.append('Log', [{ At: at, Kind: 'notify', Detail: 'x' }]);

    const stored = sheet.raw(2, 1) as Date;
    expect(wallClockIn(stored, FAR_ZONE)).toEqual(wallClockIn(at, hostTimeZone()));
    expect((s.read('Log')[0].data.At as Date).getTime()).toBe(at.getTime());

    const later = new Date('2026-12-31T23:59:59.000Z');
    s.update('Log', 2, { At: later });
    expect((s.read('Log')[0].data.At as Date).getTime()).toBe(later.getTime());
    // Text and invalid dates are written as before.
    s.update('Log', 2, { At: new Date('nope'), Detail: '2026-10-21' });
    expect(sheet.raw(2, 1)).toBe('');
    expect(sheet.raw(2, 3)).toBe('2026-10-21');
  });

  it('looks the zones up once, converts each distinct instant once, and leaves Dates alone when the zones match', () => {
    const same = new Date(2026, 9, 21);
    gas.spreadsheet.addSheet(FakeSheet.withRows('Ledger', [['Date', 'StudentID'], [same, 'S1']]));
    const plain = store();
    expect(plain.read('Ledger')[0].data.Date).toBe(same);
    plain.append('Ledger', [{ Date: same, StudentID: 'S2' }]);
    expect(gas.spreadsheet.getSheetByName('Ledger')!.raw(3, 1)).toBe(same);
    expect(gas.formatDateCalls).toHaveLength(0);

    gas.spreadsheet.timeZone = FAR_ZONE;
    gas.spreadsheet.timeZoneLookups = 0;
    const day = typedIn(FAR_ZONE, 2026, 10, 1);
    gas.spreadsheet.addSheet(
      FakeSheet.withRows('Payments', [
        ['Date', 'StudentID', 'Amount'],
        [day, 'S1', 5],
        [day, 'S2', 6],
        [day, 'S3', 7],
        [typedIn(FAR_ZONE, 2026, 10, 2), 'S4', 8],
      ]),
    );
    const s = store();
    const dates = s.read('Payments').map((r) => parseDate(r.data.Date));
    expect(dates).toEqual(['2026-10-01', '2026-10-01', '2026-10-01', '2026-10-02']);
    s.read('Ledger'); // two rows, one instant
    s.invalidate();
    s.read('Payments');
    // Two distinct Payments instants + one Ledger instant, even after re-reading.
    expect(gas.formatDateCalls).toHaveLength(3);
    expect(gas.spreadsheet.timeZoneLookups).toBe(1);
  });

  it('keeps Sheets’ values when the spreadsheet zone cannot be read; converts when only the script zone is unknown', () => {
    const typed = typedIn(FAR_ZONE, 2026, 10, 21);
    gas.spreadsheet.addSheet(FakeSheet.withRows('Ledger', [['Date', 'StudentID'], [typed, 'S1']]));
    vi.spyOn(gas.spreadsheet, 'getSpreadsheetTimeZone').mockImplementation(() => {
      throw new Error('Service error: Spreadsheets');
    });
    expect(store().read('Ledger')[0].data.Date).toBe(typed);
    vi.restoreAllMocks();

    gas.spreadsheet.timeZone = FAR_ZONE;
    vi.spyOn(Session, 'getScriptTimeZone').mockImplementation(() => {
      throw new Error('nope');
    });
    expect(parseDate(store().read('Ledger')[0].data.Date)).toBe('2026-10-21');
  });

  it('toSheetValue applies the date conversion to valid Dates only', () => {
    const shift = (d: Date) => new Date(d.getTime() + 1000);
    const d = new Date('2026-10-21T00:00:00Z');
    expect((toSheetValue(d, shift) as Date).getTime()).toBe(d.getTime() + 1000);
    expect(toSheetValue(new Date('nope'), shift)).toBe('');
    expect(toSheetValue('2026-10-21', shift)).toBe('2026-10-21');
  });
});
