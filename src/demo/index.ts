/**
 * Demo mode (ARCHITECTURE.md §2, §10): the real backend core (src/server)
 * running in the browser against an in-memory copy of the sample sheet,
 * persisted to localStorage so a board member can come back to it. PayPal is
 * a fake gateway; push notifications become in-app banners ('tma:push' window
 * events) and, when the browser allows it, real notifications.
 *
 * Loaded lazily by src/web/api/client.ts only in demo mode (a build without
 * VITE_API_URL, or a live build after "?demo"; see src/web/lib/mode.ts), so
 * families using the live app never download it. Everything it stores uses the
 * demo's own localStorage keys ('tma.demo.…'), never the live app's.
 */
import type { TableName } from '../shared/schema';
import { TABLES } from '../shared/schema';
import { centsToDollars } from '../shared/money';
import type {
  ApiAction,
  ApiErrorCode,
  ApiParams,
  ApiRequest,
  ApiResponse,
  ApiResult,
  PushMessage,
  TickReport,
} from '../shared/types';
import { createApp } from '../server/app';
import { createFakePaymentGateway, createMemoryServices, type MemoryDb, type MemoryServices } from '../server/memory';
import { sampleData } from '../server/sample-data';
import type { App, CellValue, PushResult, PushSender, RowData } from '../server/services';
import { idKey, nyDate } from '../server/util';
import { ApiError, persistToken, readStoredToken, type ApiClient } from '../web/api/client';
import { DEMO_TOKEN_PREFIX, forgetDemoPushToken } from '../web/lib/push';
import { DEMO_DB_KEY, getItem, removeItem, setItem } from '../web/lib/storage';

export { DEMO_DB_KEY };

export interface DemoOutboxItem {
  at: string;
  channel: 'push' | 'email' | 'sms';
  to: string;
  title: string;
  body: string;
}

export interface DemoControls {
  /** Treasurer adds a fundraiser credit (Ledger row), then the 15-minute sync runs. */
  addCredit(studentId: string, amountCents: number, description: string): Promise<TickReport>;
  /** The morning job: payment-due and event reminders. */
  runDaily(): Promise<TickReport>;
  /** Push/email/SMS the demo "sent", newest first. */
  outbox(): DemoOutboxItem[];
  /** Throw away demo changes and start again from the sample data. */
  reset(): void;
}

export type DemoClient = ApiClient & { demo: DemoControls };

export interface DemoClientOptions {
  /** Simulated network delay range in ms (default 120–350). Use [0, 0] in tests. */
  latencyMs?: readonly [number, number];
  /** Clock override (tests). */
  now?: () => Date;
  /** Expose the controls as window.__tmaDemo for the e2e tests (default true). */
  exposeGlobal?: boolean;
}

/** Detail of the 'tma:push' window event the demo dispatches. */
export interface DemoPushDetail {
  message: PushMessage;
  /** Whose "phone" received it. */
  to: string;
}

declare global {
  interface Window {
    __tmaDemo?: DemoControls;
  }
}

const DEMO_DB_VERSION = 1;
/** Sample dates are relative to the seed day; start fresh when a saved demo gets this old. */
const DEMO_MAX_AGE_DAYS = 30;
const SAVE_DEBOUNCE_MS = 300;
const OUTBOX_MAX = 100;
const MAX_CREDIT_CENTS = 500_000;
const DESCRIPTION_MAX = 120;
/**
 * Fixed so demo sign-ins survive reloads. It only signs demo sessions inside
 * this browser; the live backend generates its own secret.
 */
const DEMO_TOKEN_SECRET = '7d3f0c1e9a8b46d2b5e4c3a2918f7e6d5c4b3a29180f7e6d5c4b3a2918f7e6d5';

interface StoredDemo {
  version: number;
  seededAt: string;
  savedAt: string;
  tables: Partial<Record<TableName, RowData[]>>;
  outbox: DemoOutboxItem[];
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCell(value: unknown): value is CellValue {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value);
}

function parseTables(value: unknown): Partial<Record<TableName, RowData[]>> | null {
  if (!isRecord(value)) return null;
  const tables: Partial<Record<TableName, RowData[]>> = {};
  for (const name of Object.keys(TABLES) as TableName[]) {
    const rows = value[name];
    if (rows === undefined) continue;
    if (!Array.isArray(rows)) return null;
    const clean: RowData[] = [];
    for (const row of rows) {
      if (!isRecord(row)) return null;
      const out: RowData = {};
      for (const [key, cell] of Object.entries(row)) {
        if (!isCell(cell)) return null;
        out[key] = cell;
      }
      clean.push(out);
    }
    tables[name] = clean;
  }
  return tables;
}

function parseOutbox(value: unknown): DemoOutboxItem[] {
  if (!Array.isArray(value)) return [];
  const channels = ['push', 'email', 'sms'];
  return value
    .filter(
      (i): i is DemoOutboxItem =>
        isRecord(i) &&
        typeof i.at === 'string' &&
        channels.includes(i.channel as string) &&
        typeof i.to === 'string' &&
        typeof i.title === 'string' &&
        typeof i.body === 'string',
    )
    .slice(0, OUTBOX_MAX)
    .map((i) => ({ at: i.at, channel: i.channel, to: i.to, title: i.title, body: i.body }));
}

/** The saved demo, or null when missing, corrupt, from another version, or too old. */
function loadStored(now: Date): StoredDemo | null {
  const raw = getItem(DEMO_DB_KEY);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || parsed.version !== DEMO_DB_VERSION || typeof parsed.seededAt !== 'string') return null;
    const seeded = Date.parse(parsed.seededAt);
    if (Number.isNaN(seeded) || now.getTime() - seeded > DEMO_MAX_AGE_DAYS * 86_400_000) return null;
    const tables = parseTables(parsed.tables);
    if (!tables || !tables.Settings?.length || !tables.Families) return null;
    return {
      version: DEMO_DB_VERSION,
      seededAt: parsed.seededAt,
      savedAt: typeof parsed.savedAt === 'string' ? parsed.savedAt : parsed.seededAt,
      tables,
      outbox: parseOutbox(parsed.outbox),
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Demo client
// ---------------------------------------------------------------------------

interface Runtime {
  services: MemoryServices;
  app: App;
  seededAt: string;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function iconUrl(): string | undefined {
  try {
    return new URL('icons/icon-192.png', document.baseURI).href;
  } catch {
    return undefined;
  }
}

/** A real notification too, when the parent allowed them (looks just like the live app's). */
function showSystemNotification(message: PushMessage): void {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  const icon = iconUrl();
  const options: NotificationOptions = { body: message.body, icon, badge: icon, tag: message.tag, data: { url: message.url } };
  const viaPage = () => {
    try {
      new Notification(message.title, options);
    } catch {
      // Android Chrome only allows notifications from a service worker.
    }
  };
  const sw = typeof navigator !== 'undefined' ? navigator.serviceWorker : undefined;
  if (!sw) {
    viaPage();
    return;
  }
  sw.getRegistration()
    .then((registration) => (registration ? registration.showNotification(message.title, options) : viaPage()))
    .catch(viaPage);
}

export function createDemoClient(options: DemoClientOptions = {}): DemoClient {
  const clock = options.now ?? (() => new Date());
  const [minDelay, maxDelay] = options.latencyMs ?? [120, 350];

  let outbox: DemoOutboxItem[] = [];
  /** Push banners to show once the current operation has finished. */
  let pendingPushes: DemoPushDetail[] = [];
  let saveTimer: ReturnType<typeof setTimeout> | null = null;

  // `runtime` is assigned below, before any save can run.
  const flushSave = () => {
    if (saveTimer !== null) clearTimeout(saveTimer);
    saveTimer = null;
    const stored: StoredDemo = {
      version: DEMO_DB_VERSION,
      seededAt: runtime.seededAt,
      savedAt: clock().toISOString(),
      tables: runtime.services.db.tables,
      outbox,
    };
    setItem(DEMO_DB_KEY, JSON.stringify(stored)); // Quota/private mode: the demo still works for this visit.
  };

  const scheduleSave = () => {
    if (saveTimer !== null) clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSave, SAVE_DEBOUNCE_MS);
  };

  const record = (item: Omit<DemoOutboxItem, 'at'>) => {
    outbox.unshift({ at: clock().toISOString(), ...item });
    if (outbox.length > OUTBOX_MAX) outbox.length = OUTBOX_MAX;
    scheduleSave();
  };

  const build = (db: MemoryDb, seededAt: string): Runtime => {
    let services: MemoryServices | null = null;

    const push: PushSender = {
      enabled: () => true,
      // Demo devices register "demo-…" tokens and never subscribe the browser, so there is no key.
      publicKey: () => '',
      send(tokens, message): PushResult[] {
        const owners = new Map<string, string>();
        for (const row of services?.store.read('Devices') ?? []) {
          const token = typeof row.data.Token === 'string' ? row.data.Token.trim() : '';
          const email = typeof row.data.Email === 'string' ? row.data.Email.trim().toLowerCase() : '';
          if (token && email) owners.set(token, email);
        }
        const recipients = new Set<string>();
        const results = tokens.map((token): PushResult => {
          if (!token.startsWith(DEMO_TOKEN_PREFIX)) return 'invalid';
          const email = owners.get(token);
          if (email) recipients.add(email);
          return 'ok';
        });
        // One shared copy per message: one banner per recipient, one system notification per message.
        const copy: PushMessage = { ...message };
        for (const to of recipients) {
          record({ channel: 'push', to, title: message.title, body: message.body });
          pendingPushes.push({ message: copy, to });
        }
        return results;
      },
    };

    const created = createMemoryServices({
      mode: 'demo',
      now: clock,
      db,
      secrets: { TOKEN_SECRET: DEMO_TOKEN_SECRET },
      push,
      payments: createFakePaymentGateway(),
      onChange: scheduleSave,
    });
    services = created;

    const mailer = created.mailer;
    created.mailer = {
      remainingQuota: () => mailer.remainingQuota(),
      send(msg) {
        mailer.send(msg);
        record({ channel: 'email', to: msg.to, title: msg.subject, body: msg.text });
      },
    };
    const sms = created.sms;
    created.sms = {
      enabled: () => sms.enabled(),
      send(to, body) {
        sms.send(to, body);
        record({ channel: 'sms', to, title: 'Text message', body });
      },
    };

    return { services: created, app: createApp(created), seededAt };
  };

  const seed = (): Runtime => {
    const now = clock();
    const rt = build({ tables: sampleData(now, { demoSettings: true }) }, now.toISOString());
    rt.app.setup(); // Adds any missing settings; TOKEN_SECRET is already fixed above.
    // The seeded device list replaces any old one, so a stored demo token no longer points anywhere.
    forgetDemoPushToken();
    return rt;
  };

  const restore = (): Runtime => {
    const stored = loadStored(clock());
    if (!stored) return seed();
    try {
      const rt = build({ tables: stored.tables }, stored.seededAt);
      outbox = stored.outbox;
      return rt;
    } catch {
      return seed();
    }
  };

  let runtime: Runtime = restore();
  flushSave();

  /** Run one backend operation, then show the push banners it produced. (Saving follows store changes.) */
  const run = <T>(fn: () => T): T => {
    try {
      return fn();
    } finally {
      const deliveries = pendingPushes;
      pendingPushes = [];
      const shown = new Set<PushMessage>();
      for (const detail of deliveries) {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent<DemoPushDetail>('tma:push', { detail }));
        }
        if (!shown.has(detail.message)) {
          shown.add(detail.message);
          showSystemNotification(detail.message);
        }
      }
    }
  };

  const latency = (): Promise<void> => {
    const ms = minDelay + Math.random() * Math.max(0, maxDelay - minDelay);
    return new Promise((resolve) => setTimeout(resolve, ms > 0 ? ms : 0));
  };

  let token: string | null = readStoredToken('demo');

  const controls: DemoControls = {
    async addCredit(studentId, amountCents, description) {
      await latency();
      return run(() => {
        const id = idKey(studentId);
        const known = runtime.services.store.read('Students').some((r) => idKey(r.data.StudentID) === id);
        if (!id || !known) throw new ApiError('NOT_FOUND', 'That student is not in the demo data.');
        if (!Number.isSafeInteger(amountCents) || amountCents <= 0 || amountCents > MAX_CREDIT_CENTS) {
          throw new ApiError('BAD_REQUEST', 'Enter an amount between $0.01 and $5,000.00.');
        }
        const text = typeof description === 'string' ? description.trim().slice(0, DESCRIPTION_MAX) : '';
        runtime.services.store.append('Ledger', [
          {
            Date: nyDate(clock()),
            StudentID: id,
            Type: 'Fundraiser',
            Description: text || 'Fundraiser credit',
            Amount: centsToDollars(amountCents),
            ActivityID: '',
            Reference: '',
            'Entered By': 'Treasurer (demo)',
          },
        ]);
        return clone(runtime.app.syncTick());
      });
    },

    async runDaily() {
      await latency();
      return run(() => clone(runtime.app.dailyTick()));
    },

    outbox() {
      return outbox.map((item) => ({ ...item }));
    },

    reset() {
      if (saveTimer !== null) clearTimeout(saveTimer);
      saveTimer = null;
      removeItem(DEMO_DB_KEY);
      outbox = [];
      pendingPushes = [];
      runtime = seed();
      flushSave();
    },
  };

  const client: DemoClient = {
    mode: 'demo',
    demo: controls,
    getToken: () => token,
    setToken(next) {
      token = next && next.trim() ? next : null;
      persistToken('demo', token);
    },
    async call<A extends ApiAction>(action: A, params: ApiParams<A>): Promise<ApiResult<A>> {
      const sentToken = token;
      let request: ApiRequest;
      try {
        // A JSON round trip, exactly like the live transport (and no shared objects with the UI).
        request = clone({ action, params: params ?? {}, token: sentToken }) as ApiRequest;
      } catch {
        throw new ApiError('BAD_REQUEST', 'Invalid request.');
      }
      await latency();
      const response = clone(run(() => runtime.app.handle(request))) as ApiResponse<A>;
      if (response.ok) return response.data;
      const code: ApiErrorCode = response.error.code;
      if (code === 'UNAUTHORIZED' && token === sentToken) client.setToken(null);
      throw new ApiError(code, response.error.message);
    },
  };

  if (typeof window !== 'undefined') {
    // Don't lose the last few changes when the tab is closed or backgrounded.
    window.addEventListener('pagehide', () => {
      if (saveTimer !== null) flushSave();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden' && saveTimer !== null) flushSave();
    });
    if (options.exposeGlobal !== false) window.__tmaDemo = controls;
  }

  return client;
}
