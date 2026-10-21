/**
 * In-memory Services for unit tests and the browser demo. NOT bundled into
 * Apps Script (excluded in tsconfig.gas.json and not re-exported by index.ts).
 *
 * The store behaves like a sheet: row numbers start at 2 and never shift,
 * blank rows are skipped on read, unknown columns are ignored, and every value
 * is JSON-safe (Date objects are stored as ISO strings) so the demo can keep
 * the whole database in localStorage.
 */
import { normalizeHeader, TABLES, type SecretName, type TableName } from '../shared/schema';
import type { PushMessage } from '../shared/types';
import type {
  Cache,
  CaptureResult,
  CellValue,
  Clock,
  CreateOrderInput,
  Crypto,
  Logger,
  MailMessage,
  PaymentGateway,
  PushResult,
  PushSender,
  RowData,
  Services,
  Store,
  StoredRow,
} from './services';
import { hmacSha256Hex, sha256Hex, toHex } from './sha256';

export interface MemoryDb {
  tables: Partial<Record<TableName, RowData[]>>;
}

export interface Outbox {
  mail: MailMessage[];
  sms: Array<{ to: string; body: string }>;
  push: Array<{ tokens: string[]; message: PushMessage }>;
}

export interface MemoryServicesOptions {
  now?: Date | (() => Date);
  mode?: 'demo' | 'test';
  db?: MemoryDb;
  secrets?: Partial<Record<SecretName, string>>;
  /** Emails the fake mailer may still send today (default 100). */
  mailQuota?: number;
  /** Replaces the default push sender (pushes are still recorded in the outbox). */
  push?: PushSender;
  /** VAPID public key the push sender reports (default: the custom sender's, else ''). */
  pushPublicKey?: string;
  payments?: PaymentGateway;
  /** Called after every store mutation (the demo persists `db` here). */
  onChange?: (db: MemoryDb) => void;
}

export interface MemoryLogEntry {
  level: 'info' | 'error';
  message: string;
  data?: unknown;
}

export interface MemoryServices extends Services {
  db: MemoryDb;
  outbox: Outbox;
  /** Everything passed to the logger. */
  logs: MemoryLogEntry[];
  setNow(d: Date): void;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

function isBlankCell(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
}

function isBlankRow(row: RowData): boolean {
  return Object.keys(row).every((k) => isBlankCell(row[k]));
}

/** canonical header for a key (exact, normalized, or alias), or null when unknown. */
function headerResolver(table: TableName): (key: string) => string | null {
  const def = TABLES[table];
  const map = new Map<string, string>();
  for (const h of def.headers) map.set(normalizeHeader(h), h);
  for (const h of def.headers) {
    for (const alias of def.aliases?.[h] ?? []) {
      const key = normalizeHeader(alias);
      if (!map.has(key)) map.set(key, h);
    }
  }
  return (key) => map.get(normalizeHeader(key)) ?? null;
}

function toCell(value: unknown): CellValue {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  return String(value);
}

export function createMemoryStore(db: MemoryDb, changed: () => void = () => undefined): Store {
  const resolvers = new Map<TableName, (key: string) => string | null>();
  const resolverFor = (table: TableName) => {
    let r = resolvers.get(table);
    if (!r) {
      r = headerResolver(table);
      resolvers.set(table, r);
    }
    return r;
  };
  /** Keep known columns only, under their canonical names, as JSON-safe values. */
  const clean = (table: TableName, row: RowData): RowData => {
    const resolve = resolverFor(table);
    const out: RowData = {};
    for (const key of Object.keys(row)) {
      const value = row[key];
      if (value === undefined) continue;
      const header = resolve(key);
      if (header) out[header] = toCell(value);
    }
    return out;
  };
  const tableRows = (table: TableName): RowData[] => {
    let rows = db.tables[table];
    if (!rows) {
      rows = [];
      db.tables[table] = rows;
    }
    return rows;
  };

  return {
    ensureTable(table) {
      if (db.tables[table]) return { created: false, addedColumns: [] };
      db.tables[table] = [];
      changed();
      return { created: true, addedColumns: [] };
    },
    read(table) {
      const rows = db.tables[table] ?? [];
      const out: StoredRow[] = [];
      rows.forEach((row, i) => {
        const data = clean(table, row);
        if (!isBlankRow(data)) out.push({ rowNumber: i + 2, data });
      });
      return out;
    },
    append(table, rows) {
      if (rows.length === 0) return;
      const target = tableRows(table);
      for (const row of rows) target.push(clean(table, row));
      changed();
    },
    update(table, rowNumber, patch) {
      const rows = db.tables[table];
      const index = rowNumber - 2;
      if (!rows || !Number.isInteger(rowNumber) || index < 0 || index >= rows.length) {
        throw new Error(`Row ${rowNumber} of ${table} does not exist`);
      }
      rows[index] = { ...clean(table, rows[index]), ...clean(table, patch) };
      changed();
    },
    overwrite(table, rows) {
      db.tables[table] = rows.map((row) => clean(table, row));
      changed();
    },
  };
}

// ---------------------------------------------------------------------------
// Cache, crypto
// ---------------------------------------------------------------------------

const MAX_CACHE_TTL = 21600;

export function createMemoryCache(clock: Clock): Cache & { size(): number } {
  const entries = new Map<string, { value: string; expires: number }>();
  return {
    get(key) {
      const entry = entries.get(key);
      if (!entry) return null;
      if (entry.expires <= clock.now().getTime()) {
        entries.delete(key);
        return null;
      }
      return entry.value;
    },
    put(key, value, ttlSeconds) {
      const ttl = Math.min(MAX_CACHE_TTL, Math.max(1, Math.floor(ttlSeconds)));
      entries.set(key, { value, expires: clock.now().getTime() + ttl * 1000 });
    },
    remove(key) {
      entries.delete(key);
    },
    size() {
      return entries.size;
    },
  };
}

function formatUuid(hex32: string): string {
  const h = hex32.slice(0, 32).split('');
  h[12] = '4';
  h[16] = '89ab'[parseInt(h[16], 16) & 3];
  const s = h.join('');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20, 32)}`;
}

/** Digits from random bytes by rejection sampling (bytes >= 250 are skipped to avoid bias). */
function digitsFrom(nextBytes: () => number[], length: number): string {
  let out = '';
  while (out.length < length) {
    for (const b of nextBytes()) {
      if (b < 250) out += String(b % 10);
      if (out.length === length) break;
    }
  }
  return out;
}

/** Deterministic "randomness" for tests (a SHA-256 counter); HMAC is the real thing. */
export function createDeterministicCrypto(seed = 'tma-test'): Crypto {
  let counter = 0;
  const nextBytes = (): number[] => {
    const hex = sha256Hex(`${seed}:${counter++}`);
    const bytes: number[] = [];
    for (let i = 0; i < hex.length; i += 2) bytes.push(parseInt(hex.slice(i, i + 2), 16));
    return bytes;
  };
  return {
    hmacSha256Hex,
    randomDigits: (length) => digitsFrom(nextBytes, length),
    uuid: () => formatUuid(toHex(nextBytes())),
  };
}

/** Browser/Node randomness via crypto.getRandomValues when available. */
export function createRandomCrypto(): Crypto {
  const source = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
  const nextBytes = (): number[] => {
    const bytes = new Uint8Array(32);
    if (source && typeof source.getRandomValues === 'function') {
      source.getRandomValues(bytes);
    } else {
      for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    }
    return Array.from(bytes);
  };
  return {
    hmacSha256Hex,
    randomDigits: (length) => digitsFrom(nextBytes, length),
    uuid: () => formatUuid(toHex(nextBytes())),
  };
}

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

/** A PayPal stand-in: orders capture for exactly their gross amount; captures are idempotent per request id. */
export function createFakePaymentGateway(
  opts: { failCapture?: boolean } = {},
): PaymentGateway & { orders: Map<string, CreateOrderInput> } {
  const orders = new Map<string, CreateOrderInput>();
  const captures = new Map<string, CaptureResult>();
  // Unique across page reloads, so a new demo session never reuses a recorded capture id.
  const run = `${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`.toUpperCase();
  let orderCount = 0;
  let captureCount = 0;
  return {
    orders,
    enabled: () => true,
    createOrder(input) {
      orderCount += 1;
      const orderId = `DEMO-${run}-${orderCount}`;
      orders.set(orderId, { ...input });
      return { orderId };
    },
    captureOrder(orderId, requestId) {
      const previous = captures.get(requestId);
      if (previous) return { ...previous };
      const order = orders.get(orderId);
      let result: CaptureResult;
      if (!order) {
        result = { status: 'FAILED', message: 'Unknown order' };
      } else if (opts.failCapture) {
        result = { status: 'DECLINED', message: 'The card was declined (simulated).' };
      } else {
        captureCount += 1;
        result = {
          status: 'COMPLETED',
          captureId: `DEMOCAP-${run}-${captureCount}`,
          grossCents: order.grossCents,
          payerEmail: 'payer@example.com',
        };
      }
      captures.set(requestId, result);
      return { ...result };
    },
  };
}

// ---------------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------------

export function createMemoryServices(opts: MemoryServicesOptions = {}): MemoryServices {
  const mode = opts.mode ?? 'test';
  const db: MemoryDb = opts.db ?? { tables: {} };
  const outbox: Outbox = { mail: [], sms: [], push: [] };
  const logs: MemoryLogEntry[] = [];

  let fixedNow: Date | null = opts.now instanceof Date ? new Date(opts.now.getTime()) : null;
  const nowFn = typeof opts.now === 'function' ? opts.now : null;
  const clock: Clock = {
    now: () => (fixedNow ? new Date(fixedNow.getTime()) : nowFn ? nowFn() : new Date()),
  };

  const secretValues: Partial<Record<SecretName, string>> = { ...opts.secrets };
  let mailQuota = opts.mailQuota ?? 100;

  const custom = opts.push;
  const push: PushSender = {
    enabled: () => (custom ? custom.enabled() : true),
    publicKey: () => opts.pushPublicKey ?? (custom ? custom.publicKey() : ''),
    send(tokens, message): PushResult[] {
      outbox.push.push({ tokens: tokens.slice(), message: { ...message } });
      if (custom) return custom.send(tokens, message);
      return tokens.map((t) => (t.startsWith('bad-') ? 'invalid' : 'ok'));
    },
  };

  const logger: Logger = {
    info: (message, data) => {
      logs.push({ level: 'info', message, data });
    },
    error: (message, data) => {
      logs.push({ level: 'error', message, data });
    },
  };

  return {
    mode,
    db,
    outbox,
    logs,
    setNow(d: Date) {
      fixedNow = new Date(d.getTime());
    },
    store: createMemoryStore(db, () => opts.onChange?.(db)),
    cache: createMemoryCache(clock),
    clock,
    crypto: mode === 'test' ? createDeterministicCrypto() : createRandomCrypto(),
    secrets: {
      get: (name) => secretValues[name] ?? null,
      set: (name, value) => {
        secretValues[name] = value;
      },
    },
    mailer: {
      remainingQuota: () => mailQuota,
      send(msg) {
        if (mailQuota <= 0) throw new Error('Service invoked too many times for one day: email.');
        mailQuota -= 1;
        outbox.mail.push({ ...msg });
      },
    },
    sms: {
      enabled: () => true,
      send(to, body) {
        outbox.sms.push({ to, body });
      },
    },
    push,
    payments: opts.payments ?? createFakePaymentGateway(),
    logger,
    withLock: <T>(fn: () => T): T => fn(),
  };
}
