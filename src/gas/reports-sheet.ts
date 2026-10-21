/**
 * TMA App → Reports in the sheet (ARCHITECTURE.md §5.4): build a report with its
 * default filters and write it to its own tab, "Report: <title>", made on the
 * first run and cleared and rewritten on every run after. No other tab is
 * touched, and nothing reads these tabs back: the app finds its tables by their
 * exact names (TABLES), so the sync and Set up never see them.
 *
 * Layout: row 1 says when it was made and not to edit it, row 2 is the bold
 * header (rows 1–2 frozen), then the rows, a bold totals row, and under them the
 * report's description, filters and notes. Money goes in as dollars formatted
 * $#,##0.00, dates as real dates (sheet serial numbers, which no time zone can
 * shift). Text that Sheets would read as a formula (= + - @) gets a leading
 * apostrophe, so it shows as typed and never runs.
 */
import { createCtx } from '../server/context';
import { buildReport, REPORT_TITLES } from '../server/reports';
import type { Services } from '../server/services';
import { daysBetween, hasOwn, nyParts } from '../server/util';
import { centsToDollars } from '../shared/money';
import type { IsoDate, IsoDateTime, Report, ReportCell, ReportColumn, ReportColumnType, ReportKind } from '../shared/types';

type Spreadsheet = GoogleAppsScript.Spreadsheet.Spreadsheet;
type Sheet = GoogleAppsScript.Spreadsheet.Sheet;
export type SheetCell = string | number;

export const REPORT_TAB_PREFIX = 'Report: ';

/** One menu item per report, each calling its own top-level function in src/gas/entry.ts. */
export const SHEET_REPORTS: ReadonlyArray<{ kind: ReportKind; fn: string }> = [
  { kind: 'trip-balances', fn: 'reportTripBalances' },
  { kind: 'student-funds', fn: 'reportStudentFunds' },
  { kind: 'fundraiser-totals', fn: 'reportFundraiserTotals' },
  { kind: 'fund-activity', fn: 'reportFundActivity' },
  { kind: 'payments', fn: 'reportPayments' },
  { kind: 'roster', fn: 'reportRoster' },
  { kind: 'open-items', fn: 'reportOpenItems' },
  { kind: 'app-usage', fn: 'reportAppUsage' },
];

const FORMATS: Readonly<Partial<Record<ReportColumnType, string>>> = {
  money: '$#,##0.00',
  date: 'm/d/yyyy',
  number: '#,##0',
};

/** Google Sheets rejects cells longer than this. */
const MAX_CELL_CHARS = 50000;
/** A leading = + - @ makes Sheets read text as a formula; a leading ' would be eaten as a text marker. */
const FORMULA_START = /^[=+\-@']/;
/** Sheets serial day 0. */
const SHEETS_EPOCH: IsoDate = '1899-12-30';
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function reportTabName(kind: ReportKind): string {
  return `${REPORT_TAB_PREFIX}${REPORT_TITLES[kind]}`;
}

/** Text as Sheets should keep it: anything starting with = + - @ or ' gets an apostrophe, so it stays text. */
export function sheetText(value: string): string {
  const text = value.length > MAX_CELL_CHARS - 1 ? value.slice(0, MAX_CELL_CHARS - 1) : value;
  return FORMULA_START.test(text) ? `'${text}` : text;
}

/** A report cell as written: money in dollars, dates as serial days, text made safe. */
export function sheetCell(type: ReportColumnType, value: ReportCell | undefined): SheetCell {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return '';
    return type === 'money' ? centsToDollars(value) : value;
  }
  if (type === 'date' && ISO_DATE.test(value)) return daysBetween(SHEETS_EPOCH, value);
  return sheetText(value);
}

/** "Oct 21, 2026 10:00 AM" in New York time (the app's time zone). */
export function nyTimestamp(at: IsoDateTime): string {
  const p = nyParts(new Date(at));
  const hour = p.hour % 12 === 0 ? 12 : p.hour % 12;
  return `${MONTHS[p.month - 1]} ${p.day}, ${p.year} ${hour}:${String(p.minute).padStart(2, '0')} ${p.hour < 12 ? 'AM' : 'PM'}`;
}

function usDate(date: IsoDate): string {
  const [y, m, d] = date.split('-').map((n) => parseInt(n, 10));
  return `${m}/${d}/${y}`;
}

/** "Showing …" line for the filters the report applied ('' when there are none). */
export function filtersLine(report: Report): string {
  const f = report.filters;
  const parts: string[] = [];
  if (f.from && f.to) parts.push(`dates ${usDate(f.from)} to ${usDate(f.to)}`);
  if (f.activityId) parts.push(`activity ${f.activityId}`);
  else if (report.kind === 'trip-balances') parts.push('open activities');
  if (f.school) parts.push(`school ${f.school}`);
  if (f.ensemble) parts.push(`group ${f.ensemble}`);
  if (f.includePaid !== undefined) {
    parts.push(f.includePaid ? 'including students who have paid in full' : 'students with something left to pay');
  }
  return parts.length > 0 ? `Showing ${parts.join('; ')}.` : '';
}

export interface ReportLayout {
  /** Every cell, row by row, written with one setValues. */
  values: SheetCell[][];
  width: number;
  /** 1-based; rows up to it are frozen. */
  headerRow: number;
  firstDataRow: number;
  /** Rows from firstDataRow that take the columns' number formats: report rows and totals. */
  formattedRows: number;
  boldRows: number[];
  formats: Array<{ column: number; format: string }>;
}

/** Where every cell of the tab goes (pure, so it can be checked without a sheet). */
export function reportLayout(report: Report): ReportLayout {
  const columns: readonly ReportColumn[] = report.columns;
  const width = Math.max(1, columns.length);
  const line = (first: string): SheetCell[] => {
    const row: SheetCell[] = [];
    for (let i = 0; i < width; i += 1) row.push('');
    row[0] = sheetText(first);
    return row;
  };
  const menuPath = `TMA App → Reports → ${report.title}`;
  const values: SheetCell[][] = [
    line(`Generated ${nyTimestamp(report.generatedAt)} — rebuilt each time you run it; edit the other tabs, not this one. (${menuPath})`),
    columns.length > 0 ? columns.map((c) => sheetText(c.label)) : line(''),
  ];
  const headerRow = values.length;
  const boldRows = [headerRow];

  if (report.rows.length === 0) values.push(line('Nothing to show.'));
  for (const row of report.rows) values.push(columns.map((c) => sheetCell(c.type, row[c.key])));

  const totals = report.totals ?? {};
  if (report.rows.length > 0 && columns.some((c) => hasOwn(totals, c.key))) {
    values.push(columns.map((c, i) => (hasOwn(totals, c.key) ? sheetCell(c.type, totals[c.key]) : i === 0 ? 'Total' : '')));
    boldRows.push(values.length);
  }
  // Totals that aren't columns (fund-activity: credits, debits, net) go under the first money column.
  const extra = Object.keys(totals).filter((key) => !columns.some((c) => c.key === key));
  const money = columns.findIndex((c) => c.type === 'money');
  const at = money > 0 ? money : Math.min(1, width - 1);
  for (const key of report.rows.length > 0 ? extra : []) {
    const row = line(key.charAt(0).toUpperCase() + key.slice(1));
    row[at] = sheetCell(money >= 0 ? 'money' : 'number', totals[key]);
    values.push(row);
    boldRows.push(values.length);
  }
  const formattedRows = values.length - headerRow;

  values.push(line(''), line(report.description));
  const filters = filtersLine(report);
  if (filters) values.push(line(filters));
  for (const note of report.notes ?? []) values.push(line(`Note: ${note}`));

  const formats: ReportLayout['formats'] = [];
  columns.forEach((c, i) => {
    const format = FORMATS[c.type];
    if (format) formats.push({ column: i + 1, format });
  });
  return { values, width, headerRow, firstDataRow: headerRow + 1, formattedRows, boldRows, formats };
}

/** The report's tab: found by name (capitals ignored, as Sheets does), else added at the end. Cleared either way. */
function reportTab(spreadsheet: Spreadsheet, name: string): Sheet {
  const wanted = name.toLowerCase();
  const existing = spreadsheet.getSheets().find((s) => s.getName().trim().toLowerCase() === wanted);
  if (!existing) return spreadsheet.insertSheet(name, spreadsheet.getNumSheets());
  existing.clear();
  return existing;
}

/** Write `report` to its "Report: <title>" tab, replacing what was there. Touches no other tab. */
export function writeReportTab(spreadsheet: Spreadsheet, report: Report): Sheet {
  const layout = reportLayout(report);
  const sheet = reportTab(spreadsheet, `${REPORT_TAB_PREFIX}${report.title}`);
  const rows = layout.values.length;
  if (rows > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), rows - sheet.getMaxRows());
  if (layout.width > sheet.getMaxColumns()) sheet.insertColumnsAfter(sheet.getMaxColumns(), layout.width - sheet.getMaxColumns());
  sheet.getRange(1, 1, rows, layout.width).setValues(layout.values);
  for (const f of layout.formats) sheet.getRange(layout.firstDataRow, f.column, layout.formattedRows, 1).setNumberFormat(f.format);
  for (const row of layout.boldRows) sheet.getRange(row, 1, 1, layout.width).setFontWeight('bold');
  sheet.setFrozenRows(layout.headerRow);
  return sheet;
}

/** Build `kind` from this sheet with its default filters (this school year, open activities…) and write its tab. */
export function runSheetReport(services: Services, spreadsheet: Spreadsheet, kind: ReportKind): { report: Report; sheet: Sheet } {
  const report = buildReport(createCtx(services), kind);
  return { report, sheet: writeReportTab(spreadsheet, report) };
}
