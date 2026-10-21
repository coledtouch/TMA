/**
 * Per-request view of the Store: each tab is read at most once (Apps Script
 * reads are slow), writes go straight through, and every write bumps a
 * per-table version so parsed views (see data.ts) know when to rebuild.
 */
import type { TableName } from '../shared/schema';
import type { RowData, Store, StoredRow } from './services';
import { isBlank } from './util';

export function isBlankRow(data: RowData): boolean {
  for (const key of Object.keys(data)) if (!isBlank(data[key])) return false;
  return true;
}

export class Db {
  private readonly cache = new Map<TableName, StoredRow[]>();
  private readonly versions = new Map<TableName, number>();
  private epoch = 0;

  constructor(private readonly store: Store) {}

  rows(table: TableName): readonly StoredRow[] {
    let rows = this.cache.get(table);
    if (!rows) {
      rows = this.store.read(table).slice();
      this.cache.set(table, rows);
    }
    return rows;
  }

  /** Changes whenever the table (or the whole view) may have changed. */
  version(table: TableName): string {
    return `${this.epoch}.${this.versions.get(table) ?? 0}`;
  }

  append(table: TableName, rows: RowData[]): void {
    if (rows.length === 0) return;
    this.store.append(table, rows);
    this.cache.delete(table); // row numbers come from the store
    this.bump(table);
  }

  update(table: TableName, rowNumber: number, patch: RowData): void {
    this.store.update(table, rowNumber, patch);
    const rows = this.cache.get(table);
    if (rows) {
      // Patch the cached copy instead of re-reading the whole tab.
      const index = rows.findIndex((r) => r.rowNumber === rowNumber);
      if (index < 0) {
        this.cache.delete(table);
      } else {
        const data = { ...rows[index].data, ...patch };
        if (isBlankRow(data)) rows.splice(index, 1);
        else rows[index] = { rowNumber, data };
      }
    }
    this.bump(table);
  }

  /** Blank out a row (the sheet equivalent of deleting it without shifting row numbers). */
  clear(table: TableName, rowNumber: number, columns: readonly string[]): void {
    const patch: RowData = {};
    for (const c of columns) patch[c] = '';
    this.update(table, rowNumber, patch);
  }

  overwrite(table: TableName, rows: RowData[]): void {
    this.store.overwrite(table, rows);
    this.cache.delete(table);
    this.bump(table);
  }

  /**
   * Read the tab again from the sheet, dropping what this request (and the store) memoized: the
   * treasurer can insert, delete or sort rows at any time, and the script lock doesn't stop that.
   */
  refresh(table: TableName): void {
    this.store.invalidate?.(table);
    this.cache.delete(table);
    this.bump(table);
  }

  /** Canonical headers the tab has; null = the tab is missing; undefined = the store can't tell. */
  columns(table: TableName): readonly string[] | null | undefined {
    return this.store.columns ? this.store.columns(table) : undefined;
  }

  ensureTable(table: TableName): { created: boolean; addedColumns: string[] } {
    const result = this.store.ensureTable(table);
    this.cache.delete(table);
    this.bump(table);
    return result;
  }

  /** Forget everything read so far (call after taking the write lock). */
  reset(): void {
    this.cache.clear();
    this.epoch++;
  }

  private bump(table: TableName): void {
    this.versions.set(table, (this.versions.get(table) ?? 0) + 1);
  }
}
