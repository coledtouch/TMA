/**
 * Test harness for the backend core: memory services + sample data + helpers
 * to sign in and call the API. Used only by src/server/*.test.ts.
 */
import type { TableName } from '../shared/schema';
import type { ApiAction, ApiParams, ApiResponse, ApiResult } from '../shared/types';
import { createApp } from './app';
import { createMemoryServices, type MemoryServices, type MemoryServicesOptions } from './memory';
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
