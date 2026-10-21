/**
 * Hand-written fakes of the Apps Script services used by src/gas, for Vitest.
 * Only the methods the adapters call are implemented, with Apps Script's
 * quirks where they matter (signed Java bytes, padded web-safe base64,
 * getDataRange on an empty sheet, out-of-grid ranges throwing, a leading
 * apostrophe marking text).
 *
 * This file stays free of Node types so it typechecks with the Apps Script
 * config; tests pass in node:crypto (`installGasFakes(nodeCrypto)`).
 */

type Bytes = number[];

interface Digest {
  update(data: Uint8Array): Digest;
  digest(): Uint8Array;
}

/** The subset of node:crypto the fakes need. */
export interface HostCrypto {
  createHmac(algorithm: 'sha256', key: Uint8Array): Digest;
  createHash(algorithm: 'sha256'): Digest;
  createSign(algorithm: 'RSA-SHA256'): { update(data: Uint8Array): unknown; sign(privateKeyPem: string): Uint8Array };
  randomUUID(): string;
}

// ---------------------------------------------------------------------------
// Bytes / base64 helpers (exported for tests)
// ---------------------------------------------------------------------------

export function utf8(text: string): number[] {
  const out: number[] = [];
  const encoded = encodeURIComponent(text);
  for (let i = 0; i < encoded.length; i += 1) {
    if (encoded[i] === '%') {
      out.push(parseInt(encoded.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      out.push(encoded.charCodeAt(i));
    }
  }
  return out;
}

/** Java-style signed bytes, as Apps Script returns them. */
export function toSigned(bytes: Iterable<number>): Bytes {
  return Array.from(bytes, (b) => (b > 127 ? b - 256 : b));
}

function toUnsigned(bytes: readonly number[]): Uint8Array {
  return Uint8Array.from(bytes, (b) => b & 0xff);
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function base64(bytes: readonly number[]): string {
  const u = toUnsigned(bytes);
  let out = '';
  for (let i = 0; i < u.length; i += 3) {
    const n = (u[i] << 16) | ((u[i + 1] ?? 0) << 8) | (u[i + 2] ?? 0);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
    out += i + 1 < u.length ? B64[(n >> 6) & 63] : '=';
    out += i + 2 < u.length ? B64[n & 63] : '=';
  }
  return out;
}

const asBytes = (data: string | readonly number[]): number[] => (typeof data === 'string' ? utf8(data) : [...data]);

// ---------------------------------------------------------------------------
// SpreadsheetApp
// ---------------------------------------------------------------------------

type Cell = string | number | boolean | Date;

export class FakeRange {
  constructor(
    private readonly sheet: FakeSheet,
    readonly row: number,
    readonly column: number,
    readonly numRows: number,
    readonly numColumns: number,
  ) {}

  getValues(): Cell[][] {
    const out: Cell[][] = [];
    for (let r = 0; r < this.numRows; r += 1) {
      const line: Cell[] = [];
      for (let c = 0; c < this.numColumns; c += 1) line.push(this.sheet.value(this.row + r, this.column + c));
      out.push(line);
    }
    return out;
  }

  setValues(values: Cell[][]): FakeRange {
    if (values.length !== this.numRows || values.some((line) => line.length !== this.numColumns)) {
      throw new Error(
        `The number of rows or columns in the data does not match the range (${values.length}x${values[0]?.length} vs ${this.numRows}x${this.numColumns})`,
      );
    }
    this.sheet.ops.push(`setValues ${this.a1()}`);
    values.forEach((line, r) => line.forEach((v, c) => this.sheet.write(this.row + r, this.column + c, v)));
    return this;
  }

  setValue(value: Cell): FakeRange {
    return this.setValues([[value]]);
  }

  clearContent(): FakeRange {
    this.sheet.ops.push(`clearContent ${this.a1()}`);
    for (let r = 0; r < this.numRows; r += 1) {
      for (let c = 0; c < this.numColumns; c += 1) this.sheet.write(this.row + r, this.column + c, '');
    }
    return this;
  }

  setNote(note: string): FakeRange {
    this.sheet.notes.set(`${this.row},${this.column}`, note);
    return this;
  }

  setFontWeight(weight: string): FakeRange {
    for (let c = 0; c < this.numColumns; c += 1) {
      for (let r = 0; r < this.numRows; r += 1) this.sheet.fontWeights.set(`${this.row + r},${this.column + c}`, weight);
    }
    return this;
  }

  private a1(): string {
    return `R${this.row}C${this.column}:${this.numRows}x${this.numColumns}`;
  }
}

export class FakeSheet {
  /** Raw stored cells, 0-based [row][col]. A leading ' is kept here, as Sheets keeps the quote prefix. */
  readonly cells: Cell[][] = [];
  readonly notes = new Map<string, string>();
  readonly fontWeights = new Map<string, string>();
  /** Log of write operations, e.g. "setValues R5C1:1x8". */
  readonly ops: string[] = [];
  frozenRows = 0;
  hidden = false;
  maxRows = 1000;
  maxColumns = 26;

  constructor(private name: string) {}

  /** Test helper: put a full 2D block at A1 (header + rows). */
  static withRows(name: string, rows: Cell[][]): FakeSheet {
    const sheet = new FakeSheet(name);
    rows.forEach((line, r) => line.forEach((v, c) => sheet.write(r + 1, c + 1, v)));
    sheet.ops.length = 0;
    return sheet;
  }

  getName(): string {
    return this.name;
  }

  /** Raw cell as stored (1-based). */
  raw(row: number, column: number): Cell {
    return this.cells[row - 1]?.[column - 1] ?? '';
  }

  /** Cell as getValues() returns it (quote prefix removed). */
  value(row: number, column: number): Cell {
    const v = this.raw(row, column);
    return typeof v === 'string' && v.startsWith("'") ? v.slice(1) : v;
  }

  write(row: number, column: number, value: Cell): void {
    while (this.cells.length < row) this.cells.push([]);
    const line = this.cells[row - 1];
    while (line.length < column) line.push('');
    line[column - 1] = value;
  }

  getLastRow(): number {
    for (let r = this.cells.length; r >= 1; r -= 1) {
      if (this.cells[r - 1].some((v) => v !== '')) return r;
    }
    return 0;
  }

  getLastColumn(): number {
    let last = 0;
    for (const line of this.cells) {
      for (let c = line.length; c > last; c -= 1) {
        if (line[c - 1] !== '') {
          last = c;
          break;
        }
      }
    }
    return last;
  }

  getMaxRows(): number {
    return this.maxRows;
  }

  getMaxColumns(): number {
    return this.maxColumns;
  }

  insertRowsAfter(_after: number, howMany: number): FakeSheet {
    this.maxRows += howMany;
    return this;
  }

  insertColumnsAfter(_after: number, howMany: number): FakeSheet {
    this.maxColumns += howMany;
    return this;
  }

  getRange(row: number, column: number, numRows = 1, numColumns = 1): FakeRange {
    if (row < 1 || column < 1 || numRows < 1 || numColumns < 1) throw new Error('Invalid range');
    if (row + numRows - 1 > this.maxRows || column + numColumns - 1 > this.maxColumns) {
      throw new Error('The coordinates of the range are outside the dimensions of the sheet.');
    }
    return new FakeRange(this, row, column, numRows, numColumns);
  }

  /** Like Sheets: an empty sheet still returns A1. */
  getDataRange(): FakeRange {
    this.ops.push('getDataRange');
    return new FakeRange(this, 1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn()));
  }

  setFrozenRows(rows: number): void {
    this.frozenRows = rows;
  }

  getFrozenRows(): number {
    return this.frozenRows;
  }

  hideSheet(): FakeSheet {
    this.hidden = true;
    return this;
  }

  isSheetHidden(): boolean {
    return this.hidden;
  }

  /** Rows as getValues() would return them, trimmed to the data extent (tests). */
  dump(): Cell[][] {
    const rows = this.getLastRow();
    const cols = this.getLastColumn();
    if (rows === 0) return [];
    return new FakeRange(this, 1, 1, rows, cols).getValues();
  }
}

export class FakeSpreadsheet {
  readonly sheets: FakeSheet[] = [];
  readonly toasts: string[] = [];

  addSheet(sheet: FakeSheet): FakeSheet {
    this.sheets.push(sheet);
    return sheet;
  }

  getSheetByName(name: string): FakeSheet | null {
    return this.sheets.find((s) => s.getName() === name) ?? null;
  }

  getSheets(): FakeSheet[] {
    return [...this.sheets];
  }

  getNumSheets(): number {
    return this.sheets.length;
  }

  insertSheet(name: string, index?: number): FakeSheet {
    if (this.sheets.some((s) => s.getName().toLowerCase() === name.toLowerCase())) {
      throw new Error(`A sheet with the name "${name}" already exists.`);
    }
    const sheet = new FakeSheet(name);
    this.sheets.splice(index ?? this.sheets.length, 0, sheet);
    return sheet;
  }

  toast(message: string): void {
    this.toasts.push(message);
  }
}

export class FakeUi {
  readonly alerts: Array<{ title: string; message: string }> = [];
  readonly menus: Array<{ name: string; items: Array<[string, string]> }> = [];
  readonly ButtonSet = { OK: 'OK', OK_CANCEL: 'OK_CANCEL', YES_NO: 'YES_NO', YES_NO_CANCEL: 'YES_NO_CANCEL' };

  alert(title: string, message?: string): string {
    this.alerts.push({ title, message: message ?? '' });
    return 'OK';
  }

  createMenu(name: string) {
    const menu = { name, items: [] as Array<[string, string]> };
    const builder = {
      addItem: (caption: string, fn: string) => {
        menu.items.push([caption, fn]);
        return builder;
      },
      addSeparator: () => builder,
      addToUi: () => {
        this.menus.push(menu);
      },
    };
    return builder;
  }
}

// ---------------------------------------------------------------------------
// UrlFetchApp
// ---------------------------------------------------------------------------

export interface FakeRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  contentType?: string;
  payload?: unknown;
  muteHttpExceptions?: boolean;
}

export interface FakeReply {
  code: number;
  body?: unknown;
}

export class FakeUrlFetch {
  readonly requests: FakeRequest[] = [];
  /** fetchAll batch sizes, in call order. */
  readonly batches: number[] = [];
  handler: (request: FakeRequest) => FakeReply = () => ({ code: 404, body: { error: 'no handler' } });

  fetch(url: string, params: Partial<FakeRequest> = {}) {
    return this.respond({ ...params, url, method: (params.method ?? 'get').toLowerCase(), headers: { ...(params.headers ?? {}) } });
  }

  fetchAll(requests: Array<Partial<FakeRequest> & { url: string }>) {
    this.batches.push(requests.length);
    return requests.map((r) => this.respond({ ...r, method: (r.method ?? 'get').toLowerCase(), headers: { ...(r.headers ?? {}) } }));
  }

  private respond(request: FakeRequest) {
    this.requests.push(request);
    const reply = this.handler(request);
    const text = typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body ?? {});
    if (reply.code >= 400 && !request.muteHttpExceptions) throw new Error(`Request failed with code ${reply.code}`);
    return { getResponseCode: () => reply.code, getContentText: () => text, getHeaders: () => ({}) };
  }
}

// ---------------------------------------------------------------------------
// CacheService, PropertiesService, LockService, MailApp
// ---------------------------------------------------------------------------

export class FakeCache {
  readonly entries = new Map<string, { value: string; expiresAt: number; ttl: number }>();
  nowMs = Date.parse('2026-10-21T12:00:00Z');

  get(key: string): string | null {
    this.checkKey(key);
    const entry = this.entries.get(key);
    if (!entry || entry.expiresAt <= this.nowMs) return null;
    return entry.value;
  }

  put(key: string, value: string, ttl: number): void {
    this.checkKey(key);
    if (!Number.isInteger(ttl) || ttl < 1 || ttl > 21600) throw new Error(`Invalid cache expiration ${ttl}`);
    this.entries.set(key, { value, ttl, expiresAt: this.nowMs + ttl * 1000 });
  }

  remove(key: string): void {
    this.entries.delete(key);
  }

  private checkKey(key: string): void {
    if (key.length > 250) throw new Error('Argument too large: key');
  }
}

export class FakeProperties {
  readonly values = new Map<string, string>();

  getProperty(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setProperty(key: string, value: string): FakeProperties {
    this.values.set(key, value);
    return this;
  }
}

export class FakeLock {
  readonly calls: string[] = [];
  held = false;
  /** Make waitLock time out (another execution holds the lock). */
  busy = false;

  waitLock(timeoutMs: number): void {
    this.calls.push(`waitLock ${timeoutMs}`);
    if (this.busy) throw new Error('Lock timeout: another process was holding the lock for too long.');
    if (this.held) throw new Error('FakeLock: waitLock while already held (not re-entrant in this fake)');
    this.held = true;
  }

  releaseLock(): void {
    this.calls.push('releaseLock');
    this.held = false;
  }

  hasLock(): boolean {
    return this.held;
  }
}

export class FakeMail {
  readonly sent: Array<Record<string, unknown>> = [];
  quota = 100;

  sendEmail(message: Record<string, unknown>): void {
    this.sent.push(message);
    this.quota -= 1;
  }

  getRemainingDailyQuota(): number {
    return this.quota;
  }
}

// ---------------------------------------------------------------------------
// ScriptApp, Session, ContentService, HtmlService
// ---------------------------------------------------------------------------

export class FakeTrigger {
  constructor(
    readonly handler: string,
    readonly schedule: string,
  ) {}

  getHandlerFunction(): string {
    return this.handler;
  }
}

export class FakeScriptApp {
  readonly triggers: FakeTrigger[] = [];
  serviceUrl = 'https://script.google.com/macros/s/FAKE/exec';

  getProjectTriggers(): FakeTrigger[] {
    return [...this.triggers];
  }

  deleteTrigger(trigger: FakeTrigger): void {
    const i = this.triggers.indexOf(trigger);
    if (i >= 0) this.triggers.splice(i, 1);
  }

  getService() {
    return { getUrl: () => this.serviceUrl };
  }

  newTrigger(handler: string) {
    let schedule = '';
    const clock = {
      everyMinutes: (n: number) => {
        schedule += `every ${n} min`;
        return clock;
      },
      everyDays: (n: number) => {
        schedule += `every ${n} day`;
        return clock;
      },
      atHour: (h: number) => {
        schedule += ` at ${h}`;
        return clock;
      },
      create: () => {
        const trigger = new FakeTrigger(handler, schedule);
        this.triggers.push(trigger);
        return trigger;
      },
    };
    return { timeBased: () => clock };
  }
}

export class FakeOutput {
  mimeType = 'TEXT';
  title = '';
  readonly metaTags: Array<[string, string]> = [];

  constructor(readonly content: string) {}

  getContent(): string {
    return this.content;
  }

  setMimeType(mimeType: string): FakeOutput {
    this.mimeType = mimeType;
    return this;
  }

  setTitle(title: string): FakeOutput {
    this.title = title;
    return this;
  }

  addMetaTag(name: string, content: string): FakeOutput {
    this.metaTags.push([name, content]);
    return this;
  }
}

// ---------------------------------------------------------------------------
// Install
// ---------------------------------------------------------------------------

export interface GasFakes {
  spreadsheet: FakeSpreadsheet;
  ui: FakeUi;
  fetch: FakeUrlFetch;
  cache: FakeCache;
  properties: FakeProperties;
  lock: FakeLock;
  mail: FakeMail;
  scriptApp: FakeScriptApp;
  session: { email: string };
  /** When false, SpreadsheetApp.getUi() throws as it does in triggers and web requests. */
  uiAvailable: boolean;
  flushes: number;
  uuids: string[];
}

const GLOBAL_NAMES = [
  'SpreadsheetApp',
  'UrlFetchApp',
  'CacheService',
  'PropertiesService',
  'LockService',
  'MailApp',
  'ScriptApp',
  'Session',
  'ContentService',
  'HtmlService',
  'Utilities',
] as const;

/** Put fresh fakes on globalThis and return handles to inspect/steer them. */
export function installGasFakes(host: HostCrypto): GasFakes {
  const fakes: GasFakes = {
    spreadsheet: new FakeSpreadsheet(),
    ui: new FakeUi(),
    fetch: new FakeUrlFetch(),
    cache: new FakeCache(),
    properties: new FakeProperties(),
    lock: new FakeLock(),
    mail: new FakeMail(),
    scriptApp: new FakeScriptApp(),
    session: { email: 'treasurer@example.com' },
    uiAvailable: true,
    flushes: 0,
    uuids: [],
  };
  const hash = (digest: Digest, data: string | readonly number[]) => toSigned(digest.update(toUnsigned(asBytes(data))).digest());

  const globals: Record<string, unknown> = {
    SpreadsheetApp: {
      getActive: () => fakes.spreadsheet,
      getActiveSpreadsheet: () => fakes.spreadsheet,
      getUi: () => {
        if (!fakes.uiAvailable) throw new Error('Cannot call SpreadsheetApp.getUi() from this context.');
        return fakes.ui;
      },
      flush: () => {
        fakes.flushes += 1;
      },
    },
    UrlFetchApp: fakes.fetch,
    CacheService: { getScriptCache: () => fakes.cache },
    PropertiesService: { getScriptProperties: () => fakes.properties },
    LockService: { getScriptLock: () => fakes.lock },
    MailApp: fakes.mail,
    ScriptApp: fakes.scriptApp,
    Session: { getActiveUser: () => ({ getEmail: () => fakes.session.email }) },
    ContentService: {
      MimeType: { JSON: 'JSON', TEXT: 'TEXT' },
      createTextOutput: (content: string) => new FakeOutput(content),
    },
    HtmlService: { createHtmlOutput: (html: string) => new FakeOutput(html) },
    Utilities: {
      Charset: { UTF_8: 'UTF_8', US_ASCII: 'US_ASCII' },
      DigestAlgorithm: { SHA_256: 'SHA_256' },
      getUuid: () => {
        const id = fakes.uuids.shift() ?? host.randomUUID();
        return id;
      },
      computeHmacSha256Signature: (value: string | Bytes, key: string | Bytes) =>
        hash(host.createHmac('sha256', toUnsigned(asBytes(key))), value),
      computeDigest: (algorithm: string, value: string | Bytes) => {
        if (algorithm !== 'SHA_256') throw new Error(`Unsupported digest ${algorithm}`);
        return hash(host.createHash('sha256'), value);
      },
      computeRsaSha256Signature: (value: string, key: string) => {
        const signer = host.createSign('RSA-SHA256');
        signer.update(toUnsigned(utf8(value)));
        return toSigned(signer.sign(key));
      },
      base64Encode: (data: string | Bytes) => base64(asBytes(data)),
      base64EncodeWebSafe: (data: string | Bytes) => base64(asBytes(data)).replace(/\+/g, '-').replace(/\//g, '_'),
      newBlob: (data: string | Bytes) => {
        const bytes = asBytes(data);
        return { getBytes: () => toSigned(bytes), getDataAsString: () => (typeof data === 'string' ? data : '') };
      },
    },
  };
  const target = globalThis as unknown as Record<string, unknown>;
  for (const name of GLOBAL_NAMES) target[name] = globals[name];
  return fakes;
}

export function uninstallGasFakes(): void {
  const target = globalThis as unknown as Record<string, unknown>;
  for (const name of GLOBAL_NAMES) delete target[name];
}
