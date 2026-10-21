/**
 * Ports the backend core depends on. The core (src/server) is plain,
 * synchronous TypeScript with no Apps Script, DOM or Node globals, so the same
 * code runs:
 *   - in Google Apps Script (src/gas wires these to SpreadsheetApp, MailApp,
 *     UrlFetchApp, CacheService, PropertiesService, LockService, Utilities), and
 *   - in the browser demo (src/demo wires them to in-memory fakes), and
 *   - in unit tests (src/server/memory.ts fakes).
 *
 * Everything is synchronous because Apps Script web-app handlers must return
 * synchronously.
 */
import type { SecretName, TableName } from '../shared/schema';
import type {
  ApiRequest,
  ApiResponse,
  Cents,
  IsoDateTime,
  PushMessage,
  SetupReport,
  TickReport,
} from '../shared/types';

export type CellValue = string | number | boolean | Date | null;

/** Row keyed by canonical header names from TABLES (src/shared/schema.ts). Missing columns are absent/undefined. */
export type RowData = Partial<Record<string, CellValue>>;

export interface StoredRow {
  /** 1-based sheet row number (header is row 1, so data starts at 2). Stable until rows are deleted. */
  rowNumber: number;
  data: RowData;
}

export interface Store {
  /** Create the tab if missing and append any missing canonical headers. Returns what changed. */
  ensureTable(table: TableName): { created: boolean; addedColumns: string[] };
  /** All non-blank data rows, mapped to canonical headers. Missing tab => []. */
  read(table: TableName): StoredRow[];
  /** Append rows (creating the tab if needed). Unknown keys are ignored. */
  append(table: TableName, rows: RowData[]): void;
  /** Patch specific columns of one row. Unknown keys are ignored. */
  update(table: TableName, rowNumber: number, patch: RowData): void;
  /** Replace all data rows (used for _Snapshot). */
  overwrite(table: TableName, rows: RowData[]): void;
}

export interface Cache {
  get(key: string): string | null;
  /** ttlSeconds max 21600 in Apps Script. */
  put(key: string, value: string, ttlSeconds: number): void;
  remove(key: string): void;
}

export interface Clock {
  now(): Date;
}

export interface Crypto {
  /** Lower-case hex HMAC-SHA256. */
  hmacSha256Hex(key: string, message: string): string;
  /** Cryptographically random decimal digits (for one-time codes). */
  randomDigits(length: number): string;
  /** Random UUID v4 string. */
  uuid(): string;
}

export interface Secrets {
  get(name: SecretName): string | null;
  set(name: SecretName, value: string): void;
}

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface Mailer {
  /** Remaining recipients the account may email today (Apps Script quota). */
  remainingQuota(): number;
  send(msg: MailMessage): void;
}

export interface SmsSender {
  enabled(): boolean;
  send(to: string, body: string): void;
}

export type PushResult = 'ok' | 'invalid' | 'error';

export interface PushSender {
  enabled(): boolean;
  /**
   * VAPID public key browsers subscribe with (base64url), '' when unknown.
   * Exposed to the app as PublicSettings.pushPublicKey.
   */
  publicKey(): string;
  /**
   * Tokens are JSON-serialized PushSubscriptions ({endpoint, keys:{p256dh, auth}})
   * or, in demo mode, "demo-…" strings. Returns one result per token, same
   * order. 'invalid' => the token should be deleted.
   */
  send(tokens: string[], message: PushMessage): PushResult[];
}

export interface CreateOrderInput {
  amountCents: Cents; // credited to the activity
  feeCents: Cents; // optional fee contribution (0 when not covering)
  grossCents: Cents; // amount + fee
  itemName: string; // e.g. "Florida 2027 – Avery T."
  description: string;
  referenceId: string; // "<studentId>:<activityId>"
  customId: string; // internal pending-order id
  brandName: string; // org name shown on PayPal
}

export interface CaptureResult {
  status: 'COMPLETED' | 'PENDING' | 'DECLINED' | 'FAILED';
  captureId?: string;
  grossCents?: Cents;
  payerEmail?: string;
  message?: string;
}

export interface PaymentGateway {
  enabled(): boolean;
  createOrder(input: CreateOrderInput): { orderId: string };
  /** `requestId` is an idempotency key (PayPal-Request-Id). */
  captureOrder(orderId: string, requestId: string): CaptureResult;
}

export interface Logger {
  info(message: string, data?: unknown): void;
  error(message: string, data?: unknown): void;
}

export interface Services {
  mode: 'production' | 'demo' | 'test';
  store: Store;
  cache: Cache;
  clock: Clock;
  crypto: Crypto;
  secrets: Secrets;
  mailer: Mailer;
  sms: SmsSender;
  push: PushSender;
  payments: PaymentGateway;
  logger: Logger;
  /** Run fn while holding the script-wide write lock (LockService in Apps Script). */
  withLock<T>(fn: () => T): T;
}

export type { IsoDateTime };

// ---------------------------------------------------------------------------
// The backend core's public surface (implemented in src/server/app.ts):
//
//   export function createApp(services: Services): App;
//
// The Apps Script entry points (src/gas/entry.ts) and the browser demo
// (src/demo) only ever talk to the core through this interface.
// ---------------------------------------------------------------------------

export interface SetupOptions {
  /** Fill empty tables with the fictional sample households/trips used by the demo. */
  seedSampleData?: boolean;
}

export interface App {
  /** Handle one API call. Never throws: errors become { ok:false, error }. */
  handle(request: ApiRequest): ApiResponse;
  /** Every ~15 min: post approved redemptions, detect balance changes, send queued announcements. */
  syncTick(): TickReport;
  /** Once a day (morning): payment-due reminders and next-day event reminders. */
  dailyTick(): TickReport;
  /** Create/upgrade tabs + headers, write default Settings, init TOKEN_SECRET, optionally seed sample data. */
  setup(options?: SetupOptions): SetupReport;
}
