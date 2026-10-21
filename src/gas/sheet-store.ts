/**
 * Store port over the bound Google Sheet (SpreadsheetApp).
 *
 * - Each tab is read with one getDataRange().getValues() and memoized for the
 *   rest of the execution. Any write to a tab drops its memoized rows, so the
 *   next read sees what Sheets actually stored (Sheets converts typed text such
 *   as "TRUE" or "50" into booleans/numbers on write). Header layouts are kept.
 * - Headers are matched with normalizeHeader + TABLES[...].aliases, so column
 *   order, spelling and extra treasurer columns never matter.
 * - Text that Sheets would evaluate as a formula is written as plain text.
 */
import { normalizeHeader, TABLES, type TableName } from '../shared/schema';
import type { CellValue, RowData, Store, StoredRow } from '../server/services';

type Sheet = GoogleAppsScript.Spreadsheet.Sheet;
type Spreadsheet = GoogleAppsScript.Spreadsheet.Spreadsheet;
type SheetValue = string | number | boolean | Date;

/** Google Sheets rejects cells longer than this. */
const MAX_CELL_CHARS = 50000;
/** A leading = + - @ makes Sheets parse text as a formula; a leading ' is eaten as a text marker. */
const FORMULA_START = /^[=+\-@']/;
const NUMERIC_TEXT = /^[+-]?(\d+(\.\d*)?|\.\d+)$/;

export interface SheetStore extends Store {
  /** Forget memoized reads (all tabs, or one). Called after taking the script lock. */
  invalidate(table?: TableName): void;
}

export interface SheetStoreOptions {
  /**
   * Runs appends/overwrites under the script lock so two executions never
   * write the same "next empty row". Must be re-entrant.
   */
  withLock?: <T>(fn: () => T) => T;
}

/** Where a tab's canonical columns are. Survives row writes; we update it when we add headers. */
interface Layout {
  table: TableName;
  sheet: Sheet;
  /** canonical header -> 1-based column number */
  columns: Map<string, number>;
}

export function createSheetStore(spreadsheet: Spreadsheet, options: SheetStoreOptions = {}): SheetStore {
  return new SpreadsheetStore(spreadsheet, options.withLock ?? ((fn) => fn()));
}

/**
 * Map a header row to canonical column numbers (1-based). Exact canonical
 * names win over aliases; each sheet column maps to at most one header.
 */
export function mapHeaders(table: TableName, headerRow: readonly unknown[]): Map<string, number> {
  const def = TABLES[table];
  const normalized = headerRow.map((h) => (h === null || h === undefined ? '' : normalizeHeader(String(h))));
  const taken = new Set<number>();
  const columns = new Map<string, number>();
  const claim = (canonical: string, key: string): boolean => {
    if (!key) return false;
    const index = normalized.findIndex((n, i) => n === key && !taken.has(i));
    if (index < 0) return false;
    taken.add(index);
    columns.set(canonical, index + 1);
    return true;
  };
  for (const canonical of def.headers) claim(canonical, normalizeHeader(canonical));
  for (const canonical of def.headers) {
    if (columns.has(canonical)) continue;
    for (const alias of def.aliases?.[canonical] ?? []) {
      if (claim(canonical, normalizeHeader(alias))) break;
    }
  }
  return columns;
}

/** Convert a core value to what we hand to Range.setValues. */
export function toSheetValue(value: CellValue | undefined): SheetValue {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : '';
  if (typeof value === 'boolean') return value;
  const text = String(value);
  if (FORMULA_START.test(text) && !NUMERIC_TEXT.test(text)) {
    return `'${text.slice(0, MAX_CELL_CHARS - 1)}`;
  }
  return text.length > MAX_CELL_CHARS ? text.slice(0, MAX_CELL_CHARS) : text;
}

function isBlank(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
}

class SpreadsheetStore implements SheetStore {
  /** null = the tab does not exist. */
  private readonly layouts = new Map<TableName, Layout | null>();
  /** Data rows; dropped on every write to the tab. */
  private readonly rowCache = new Map<TableName, StoredRow[]>();

  constructor(
    private readonly spreadsheet: Spreadsheet,
    private readonly withLock: <T>(fn: () => T) => T,
  ) {}

  invalidate(table?: TableName): void {
    if (table) {
      this.layouts.delete(table);
      this.rowCache.delete(table);
    } else {
      this.layouts.clear();
      this.rowCache.clear();
    }
  }

  ensureTable(table: TableName): { created: boolean; addedColumns: string[] } {
    const def = TABLES[table];
    const existing = this.findSheet(table);
    if (!existing) {
      const sheet = this.spreadsheet.insertSheet(table, this.spreadsheet.getNumSheets());
      this.writeHeaderRow(sheet, def.headers, def.note);
      if (def.system) {
        try {
          sheet.hideSheet();
        } catch {
          // Sheets refuses to hide the last visible tab; leaving it visible is harmless.
        }
      }
      this.invalidate(table);
      return { created: true, addedColumns: [] };
    }
    if (existing.getLastRow() === 0 && existing.getLastColumn() === 0) {
      // The tab exists but is empty: give it the full header row.
      this.writeHeaderRow(existing, def.headers, def.note);
      this.invalidate(table);
      return { created: false, addedColumns: [...def.headers] };
    }
    const layout = this.layout(table);
    const missing = layout ? def.headers.filter((h) => !layout.columns.has(h)) : [];
    if (layout && missing.length > 0) this.addColumns(layout, missing);
    return { created: false, addedColumns: missing };
  }

  read(table: TableName): StoredRow[] {
    let rows = this.rowCache.get(table);
    if (!rows) {
      rows = this.loadRows(table);
      this.rowCache.set(table, rows);
    }
    // Copies, so callers can't corrupt the memo.
    return rows.map((row) => ({ rowNumber: row.rowNumber, data: { ...row.data } }));
  }

  append(table: TableName, rows: RowData[]): void {
    if (rows.length === 0) return;
    this.withLock(() => {
      const layout = this.writableLayout(table, rows);
      this.writeRows(layout, layout.sheet.getLastRow() + 1, rows);
      this.rowCache.delete(table);
    });
  }

  update(table: TableName, rowNumber: number, patch: RowData): void {
    if (!Number.isInteger(rowNumber) || rowNumber < 2) {
      throw new Error(`Invalid row number ${rowNumber} for ${table}`);
    }
    const layout = this.layout(table);
    if (!layout) throw new Error(`The ${table} tab is missing`);
    if (rowNumber > layout.sheet.getLastRow()) throw new Error(`Row ${rowNumber} of ${table} does not exist`);
    this.addMissingColumns(layout, Object.keys(patch));

    const cells: Array<{ column: number; value: SheetValue }> = [];
    for (const [key, value] of Object.entries(patch)) {
      const column = layout.columns.get(key);
      if (column !== undefined && value !== undefined) cells.push({ column, value: toSheetValue(value) });
    }
    cells.sort((a, b) => a.column - b.column);
    // One setValues per run of adjacent columns; untouched cells are never rewritten.
    let i = 0;
    while (i < cells.length) {
      let j = i + 1;
      while (j < cells.length && cells[j].column === cells[j - 1].column + 1) j += 1;
      const run = cells.slice(i, j);
      layout.sheet.getRange(rowNumber, run[0].column, 1, run.length).setValues([run.map((c) => c.value)]);
      i = j;
    }
    this.rowCache.delete(table);
  }

  overwrite(table: TableName, rows: RowData[]): void {
    this.withLock(() => {
      const layout = this.writableLayout(table, rows);
      const { sheet } = layout;
      const lastRow = sheet.getLastRow();
      const lastColumn = sheet.getLastColumn();
      if (lastRow >= 2 && lastColumn >= 1) sheet.getRange(2, 1, lastRow - 1, lastColumn).clearContent();
      if (rows.length > 0) this.writeRows(layout, 2, rows);
      this.rowCache.delete(table);
    });
  }

  // -------------------------------------------------------------------------

  private findSheet(table: TableName): Sheet | null {
    const exact = this.spreadsheet.getSheetByName(table);
    if (exact) return exact;
    const wanted = table.toLowerCase();
    return this.spreadsheet.getSheets().find((s) => s.getName().trim().toLowerCase() === wanted) ?? null;
  }

  /** Header layout, from the memo or by reading just the header row. */
  private layout(table: TableName): Layout | null {
    const memo = this.layouts.get(table);
    if (memo !== undefined) return memo;
    const sheet = this.findSheet(table);
    let layout: Layout | null = null;
    if (sheet) {
      const lastColumn = sheet.getLastColumn();
      const header = lastColumn > 0 ? sheet.getRange(1, 1, 1, lastColumn).getValues()[0] : [];
      layout = { table, sheet, columns: mapHeaders(table, header) };
    }
    this.layouts.set(table, layout);
    return layout;
  }

  /** One getDataRange().getValues() for the whole tab; refreshes the layout too. */
  private loadRows(table: TableName): StoredRow[] {
    const sheet = this.layouts.get(table)?.sheet ?? this.findSheet(table);
    if (!sheet) {
      this.layouts.set(table, null);
      return [];
    }
    const values = sheet.getDataRange().getValues();
    const columns = mapHeaders(table, values[0] ?? []);
    this.layouts.set(table, { table, sheet, columns });
    const rows: StoredRow[] = [];
    for (let r = 1; r < values.length; r += 1) {
      const line = values[r];
      const data: RowData = {};
      let blank = true;
      for (const [header, column] of columns) {
        const value = line[column - 1] as CellValue;
        data[header] = value;
        if (!isBlank(value)) blank = false;
      }
      if (!blank) rows.push({ rowNumber: r + 1, data });
    }
    return rows;
  }

  /** Layout for a write: creates the tab if needed and adds any canonical columns the rows use. */
  private writableLayout(table: TableName, rows: RowData[]): Layout {
    let layout = this.layout(table);
    if (!layout || layout.columns.size === 0) {
      this.ensureTable(table);
      layout = this.layout(table);
    }
    if (!layout) throw new Error(`Could not create the ${table} tab`);
    const keys = new Set<string>();
    for (const row of rows) for (const key of Object.keys(row)) keys.add(key);
    this.addMissingColumns(layout, [...keys]);
    return layout;
  }

  /** Writing a known column the treasurer deleted would silently lose data, so put the header back. */
  private addMissingColumns(layout: Layout, keys: string[]): void {
    const missing = TABLES[layout.table].headers.filter((h) => keys.includes(h) && !layout.columns.has(h));
    if (missing.length > 0) this.addColumns(layout, missing);
  }

  private addColumns(layout: Layout, headers: readonly string[]): void {
    const { sheet } = layout;
    const start = sheet.getLastColumn() + 1;
    const needed = start + headers.length - 1 - sheet.getMaxColumns();
    if (needed > 0) sheet.insertColumnsAfter(sheet.getMaxColumns(), needed);
    sheet.getRange(1, start, 1, headers.length).setValues([[...headers]]).setFontWeight('bold');
    headers.forEach((h, i) => layout.columns.set(h, start + i));
    this.rowCache.delete(layout.table);
  }

  private writeHeaderRow(sheet: Sheet, headers: readonly string[], note: string): void {
    const needed = headers.length - sheet.getMaxColumns();
    if (needed > 0) sheet.insertColumnsAfter(sheet.getMaxColumns(), needed);
    sheet.getRange(1, 1, 1, headers.length).setValues([[...headers]]).setFontWeight('bold');
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1).setNote(note);
  }

  /** Write rows as one block spanning only the columns the rows actually use. */
  private writeRows(layout: Layout, startRow: number, rows: RowData[]): void {
    const used: number[] = [];
    for (const [header, column] of layout.columns) {
      if (rows.some((row) => row[header] !== undefined)) used.push(column);
    }
    if (used.length === 0) return;
    const first = Math.min(...used);
    const last = Math.max(...used);
    const byColumn = new Map<number, string>();
    for (const [header, column] of layout.columns) byColumn.set(column, header);

    const matrix = rows.map((row) => {
      const line: SheetValue[] = [];
      for (let c = first; c <= last; c += 1) {
        const header = byColumn.get(c);
        line.push(header === undefined ? '' : toSheetValue(row[header]));
      }
      return line;
    });

    const { sheet } = layout;
    const lastNeeded = startRow + rows.length - 1;
    if (lastNeeded > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), lastNeeded - sheet.getMaxRows());
    sheet.getRange(startRow, first, rows.length, last - first + 1).setValues(matrix);
  }
}
