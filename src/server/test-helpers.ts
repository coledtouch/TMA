/**
 * Test harness for the backend core: memory services + sample data + helpers
 * to sign in and call the API. Used only by src/server/*.test.ts.
 */
import type { TableName } from '../shared/schema';
import type { ApiAction, ApiParams, ApiResponse, ApiResult } from '../shared/types';
import { createApp } from './app';
import { createMemoryServices, type MemoryServices, type MemoryServicesOptions } from './memory';
import { encodeBase64UrlBytes } from './push-subscription';
import { sampleData } from './sample-data';
import type { App, RowData } from './services';

/** Wednesday 2026-10-21, 10:00 EDT. */
export const TEST_NOW = new Date('2026-10-21T14:00:00.000Z');
export const TEST_SECRET = 'a'.repeat(32) + 'b'.repeat(32);

export const PARENT = 'parent@example.com';
export const PARENT2 = 'casey.thompson@example.com';
export const NGUYEN = 'nguyen.family@example.com';
export const ORTIZ = 'ortiz@example.com';
export const TREASURER = 'treasurer@example.com';

/** Deterministic bytes for fixtures. */
function fixtureBytes(seed: string, length: number): number[] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619) >>> 0;
  const out: number[] = [];
  for (let i = 0; i < length; i++) {
    h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
    h = (h + 0x9e3779b9) >>> 0;
    out.push(h & 0xff);
  }
  return out;
}

export interface TestSubscription {
  endpoint: string;
  expirationTime: null;
  keys: { p256dh: string; auth: string };
}

/**
 * A browser PushSubscription.toJSON() for tests: a Chrome-style endpoint
 * named after `id`, and well-formed keys (65-byte point starting 0x04, 16-byte
 * auth) derived from `keySeed` (default `id`).
 */
export function testSubscription(
  id: string | number,
  opts: { keySeed?: string | number; host?: string } = {},
): TestSubscription {
  const seed = String(opts.keySeed ?? id);
  return {
    endpoint: `https://${opts.host ?? 'fcm.googleapis.com'}/fcm/send/device-${id}:APA91bH`,
    expirationTime: null,
    keys: {
      p256dh: encodeBase64UrlBytes([0x04, ...fixtureBytes(`p256dh:${seed}`, 64)]),
      auth: encodeBase64UrlBytes(fixtureBytes(`auth:${seed}`, 16)),
    },
  };
}

/** What the app stores in Devices.Token for a subscription. */
export function storedToken(sub: TestSubscription): string {
  return JSON.stringify({ endpoint: sub.endpoint, keys: sub.keys });
}

export interface HarnessOptions extends Omit<MemoryServicesOptions, 'db'> {
  /** Start from sampleData(now, {demoSettings: true}) (default true). */
  sample?: boolean;
  /** Extra/replacement tables applied on top of the sample. */
  tables?: Partial<Record<TableName, RowData[]>>;
  /** Settings values to set (key -> value). */
  settings?: Record<string, string>;
}

export interface Harness {
  services: MemoryServices;
  app: App;
  call<A extends ApiAction>(action: A, params: ApiParams<A> | Record<string, unknown>, token?: string | null): ApiResponse<A>;
  /** Call and return data; throws with the error when the call fails. */
  ok<A extends ApiAction>(action: A, params: ApiParams<A> | Record<string, unknown>, token?: string | null): ApiResult<A>;
  /** Call and return the error; throws when the call succeeds. */
  err(action: ApiAction, params: Record<string, unknown>, token?: string | null): { code: string; message: string };
  signIn(email: string): string;
  rows(table: TableName): RowData[];
  setSetting(key: string, value: string): void;
  clearOutbox(): void;
}

export function harness(opts: HarnessOptions = {}): Harness {
  const now = opts.now ?? TEST_NOW;
  const today = typeof now === 'function' ? now() : now;
  const tables: Partial<Record<TableName, RowData[]>> = opts.sample === false ? {} : sampleData(today, { demoSettings: true });
  for (const [table, rows] of Object.entries(opts.tables ?? {}) as Array<[TableName, RowData[]]>) tables[table] = rows;
  // JSON round-trip, like the demo's localStorage copy.
  const db = JSON.parse(JSON.stringify({ tables })) as { tables: Partial<Record<TableName, RowData[]>> };
  const services = createMemoryServices({ secrets: { TOKEN_SECRET: TEST_SECRET }, ...opts, now, db });
  const app = createApp(services);

  const setSetting = (key: string, value: string) => {
    const list = services.db.tables.Settings ?? (services.db.tables.Settings = []);
    const row = list.find((r) => r.Key === key);
    if (row) row.Value = value;
    else list.push({ Key: key, Value: value, Notes: '' });
  };
  for (const [k, v] of Object.entries(opts.settings ?? {})) setSetting(k, v);

  const h: Harness = {
    services,
    app,
    call: (action, params, token) => app.handle({ action, params: params as never, token }) as never,
    ok(action, params, token) {
      const res = h.call(action, params, token);
      if (!res.ok) throw new Error(`${action} failed: ${res.error.code} ${res.error.message}`);
      return res.data as never;
    },
    err(action, params, token) {
      const res = h.call(action, params, token);
      if (res.ok) throw new Error(`${action} unexpectedly succeeded`);
      return res.error;
    },
    signIn(email) {
      const sent = h.ok('auth.requestCode', { email });
      let code = sent.devCode;
      if (!code) {
        const mail = services.outbox.mail.filter((m) => m.to === email.toLowerCase()).pop();
        code = /(\d{6})/.exec(mail?.subject ?? '')?.[1];
      }
      if (!code) throw new Error(`No sign-in code for ${email}`);
      return h.ok('auth.verifyCode', { email, code }).token;
    },
    rows: (table) => (services.db.tables[table] ?? []).slice(),
    setSetting,
    clearOutbox() {
      services.outbox.mail.length = 0;
      services.outbox.sms.length = 0;
      services.outbox.push.length = 0;
    },
  };
  return h;
}
