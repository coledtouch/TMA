/**
 * CSV downloads for the Reports screen (ARCHITECTURE.md §5.4).
 *
 * RFC 4180: CRLF line ends, fields quoted when they hold a quote, comma or line
 * break, quotes doubled. A UTF-8 byte-order mark goes first so Excel reads
 * accents and "–" correctly. Money is written as plain dollars ("1234.50") and
 * dates as YYYY-MM-DD, so a spreadsheet treats them as numbers and dates.
 *
 * Text from the sheet is never trusted: a cell starting with = + - @, a tab or
 * a carriage return gets a leading apostrophe, so Excel and Sheets show it as
 * typed instead of running it as a formula (CSV injection). Numbers the app
 * formats itself ("-5.00") are not text and are written as they are.
 */
import type { Cents, Report, ReportCell, ReportColumn, ReportColumnType, ReportKind } from '../../shared/types';
import { toIsoDate } from './format';

export const CSV_BOM = '﻿';
const CRLF = '\r\n';

/** Characters that make a spreadsheet read a cell as a formula. */
const FORMULA_START = /^[=+\-@\t\r]/;

/** A CSV cell: text (guarded against formulas) or a number the app formatted itself. */
export type CsvCell = string | { number: string };

/** 123450 -> "1234.50"; -500 -> "-5.00". No "$", no thousands commas. */
export function centsToCsvDollars(cents: Cents): string {
  const rounded = Math.round(cents);
  const abs = Math.abs(rounded);
  const body = `${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
  return rounded < 0 ? `-${body}` : body;
}

/** Text a spreadsheet would run as a formula gets a leading apostrophe. */
export function neutralizeFormula(text: string): string {
  return FORMULA_START.test(text) ? `'${text}` : text;
}

/** "Oct 21, 2026, 2:15 PM": a report's generated time with the year, so a printout or file still reads right later. */
export function formatStamp(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/** One field, quoted only when it must be. */
export function csvField(text: string): string {
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** One line (no line end). */
export function csvLine(cells: ReadonlyArray<CsvCell>): string {
  return cells.map((c) => csvField(typeof c === 'string' ? neutralizeFormula(c) : c.number)).join(',');
}

/** A whole file: BOM first, CRLF after every line (the last one too). */
export function toCsv(lines: ReadonlyArray<ReadonlyArray<CsvCell>>): string {
  return CSV_BOM + lines.map((l) => csvLine(l) + CRLF).join('');
}

/** One report cell: money (integer cents) -> dollars, dates -> YYYY-MM-DD, numbers as they are, blanks empty. */
export function cellToCsv(value: ReportCell | undefined, type: ReportColumnType): CsvCell {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return '';
    return { number: type === 'money' ? centsToCsvDollars(value) : String(value) };
  }
  if (type === 'date') {
    const m = /^\d{4}-\d{2}-\d{2}/.exec(value);
    if (m) return m[0];
  }
  return value;
}

// ---------------------------------------------------------------------------
// Columns and totals (shared with the on-screen table)
// ---------------------------------------------------------------------------

/** The student column (else the first) leads: on screen it stays in view while the table scrolls sideways. */
export function displayColumns(columns: readonly ReportColumn[]): ReportColumn[] {
  const i = columns.findIndex((c) => c.key === 'student');
  return i > 0 ? [columns[i], ...columns.slice(0, i), ...columns.slice(i + 1)] : columns.slice();
}

/** Labels for totals that aren't columns (fund activity's credits, debits and net). */
const EXTRA_TOTAL_LABELS: Record<string, string> = { credits: 'Credits', debits: 'Debits', net: 'Net' };

export interface ExtraTotal {
  key: string;
  label: string;
  /** The column the amount lines up under: the first money column, else the first number column. */
  column: ReportColumn | null;
  value: number;
}

/** report.totals entries that match a column (the "Total" row). */
export function columnTotals(report: Report): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of report.columns) {
    const value = report.totals?.[c.key];
    if (typeof value === 'number') out[c.key] = value;
  }
  return out;
}

/** report.totals entries with no column of their own, one row each under the totals. */
export function extraTotals(report: Report): ExtraTotal[] {
  if (!report.totals) return [];
  const keys = new Set(report.columns.map((c) => c.key));
  const column = report.columns.find((c) => c.type === 'money') ?? report.columns.find((c) => c.type === 'number') ?? null;
  return Object.entries(report.totals)
    .filter(([key, value]) => !keys.has(key) && typeof value === 'number')
    .map(([key, value]) => ({ key, label: EXTRA_TOTAL_LABELS[key] ?? key, column, value }));
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

/**
 * The report as a CSV file, laid out like the sheet's "Report: …" tab: the header, one line per
 * row, the totals, then a blank line and the title, description, generated time, filters and
 * notes. The columns come in the order the screen shows them, so the file reads like the table
 * it was downloaded from. Every line has as many fields as the header (RFC 4180).
 */
export function reportToCsv(report: Report, options: { filters?: string } = {}): string {
  const cols = displayColumns(report.columns);
  const width = Math.max(cols.length, 1);
  const blankLine = (): CsvCell[] => Array<CsvCell>(width).fill('');

  const lines: CsvCell[][] = [cols.map((c) => c.label)];
  for (const row of report.rows) lines.push(cols.map((c) => cellToCsv(row[c.key], c.type)));

  const totals = columnTotals(report);
  if (Object.keys(totals).length > 0) {
    const cells = cols.map((c) => (c.key in totals ? cellToCsv(totals[c.key], c.type) : ''));
    if (cells[0] === '') cells[0] = 'Total';
    lines.push(cells);
  }
  for (const extra of extraTotals(report)) {
    const cells = blankLine();
    cells[0] = extra.label;
    // Under its column; the label takes the first field, so never there.
    cells[Math.max(1, extra.column ? cols.indexOf(extra.column) : 1)] = cellToCsv(extra.value, extra.column?.type ?? 'number');
    lines.push(cells);
  }

  const about = [
    report.title,
    report.description,
    `Generated ${formatStamp(report.generatedAt)}`,
    options.filters ? `Filters: ${options.filters}` : '',
    ...(report.notes ?? []),
  ].filter(Boolean);
  lines.push(blankLine());
  for (const text of about) {
    const cells = blankLine();
    cells[0] = text;
    lines.push(cells);
  }
  return toCsv(lines);
}

/** "tma-trip-balances-2026-10-21.csv": the local date the report was made. */
export function reportFileName(kind: ReportKind, generatedAt?: string): string {
  const at = generatedAt ? new Date(generatedAt) : new Date();
  return `tma-${kind}-${toIsoDate(Number.isNaN(at.getTime()) ? new Date() : at)}.csv`;
}

/** Save `csv` as a file through a temporary link (works in browsers and Home Screen apps). */
export function downloadCsv(fileName: string, csv: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.rel = 'noopener';
  link.hidden = true;
  document.body.appendChild(link);
  try {
    link.click();
  } finally {
    link.remove();
    // Some browsers read the file after click() returns; let them finish first.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}
