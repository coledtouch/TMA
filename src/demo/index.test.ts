// @vitest-environment jsdom
import type { Bootstrap, StudentSummary } from '../shared/types';
import { ApiError } from '../web/api/client';
import { enablePush } from '../web/lib/push';
import { storageKeys } from '../web/lib/storage';
import { createDemoClient, DEMO_DB_KEY, type DemoClient, type DemoPushDetail } from './index';

const PARENT = 'parent@example.com';
const TREASURER = 'treasurer@example.com';
const DEMO = storageKeys('demo');
const LIVE = storageKeys('live');

/** The demo push token this browser registered (null when none). */
function storedDemoPushToken(): string | null {
  const raw = localStorage.getItem(DEMO.push);
  return raw ? (JSON.parse(raw) as { token: string }).token : null;
}

function newClient(): DemoClient {
  return createDemoClient({ latencyMs: [0, 0] });
}

async function signIn(client: DemoClient, email: string): Promise<string> {
  const { devCode } = await client.call('auth.requestCode', { email });
  expect(devCode).toMatch(/^\d{6}$/);
  const { token } = await client.call('auth.verifyCode', { email, code: devCode! });
  client.setToken(token);
  return token;
}

function student(data: Bootstrap, id: string): StudentSummary {
  const found = data.students.find((s) => s.student.id === id);
  if (!found) throw new Error(`no ${id}`);
  return found;
}

function capturePushes(): { events: DemoPushDetail[]; stop(): void } {
  const events: DemoPushDetail[] = [];
  const onPush = (e: Event) => events.push((e as CustomEvent<DemoPushDetail>).detail);
  window.addEventListener('tma:push', onPush);
  return { events, stop: () => window.removeEventListener('tma:push', onPush) };
}

/** Flush the debounced save the way a closing tab does. */
function flushSave(): void {
  window.dispatchEvent(new Event('pagehide'));
}

beforeEach(() => {
  localStorage.clear();
  delete window.__tmaDemo;
});

describe('demo client', () => {
  it('signs in with the dev code and shows the sample balances', async () => {
    const client = newClient();
    expect(client.mode).toBe('demo');
    const token = await signIn(client, PARENT);
    expect(client.getToken()).toBe(token);
    expect(localStorage.getItem(DEMO.session)).toBe(token);
    expect(localStorage.getItem(LIVE.session)).toBeNull();

    const data = await client.call('me.bootstrap', {});
    expect(data.me).toMatchObject({ email: PARENT, familyId: 'F0001', familyStatus: 'Active', isAdmin: false });
    const avery = student(data, 'S0001');
    expect(avery.balanceCents).toBe(64000);
    expect(avery.pendingCents).toBe(20000);
    expect(avery.availableCents).toBe(44000);
    expect(student(data, 'S0002').balanceCents).toBe(8500);
    // Only this family's students.
    expect(data.students.map((s) => s.student.id).sort()).toEqual(['S0001', 'S0002']);
    expect(data.settings).toMatchObject({ paypalClientId: 'demo', onlinePaymentsEnabled: true });
  });

  it('turns backend errors into ApiError and signs out on UNAUTHORIZED', async () => {
    const client = newClient();
    client.setToken('not-a-real-token');
    const err = await client.call('me.bootstrap', {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe('UNAUTHORIZED');
    expect(client.getToken()).toBeNull();
    expect(localStorage.getItem(DEMO.session)).toBeNull();

    await signIn(client, PARENT);
    const forbidden = await client.call('admin.overview', {}).catch((e: unknown) => e);
    expect((forbidden as ApiError).code).toBe('FORBIDDEN');
    expect(client.getToken()).not.toBeNull();
  });

  it("never reads or clears the live app's sign-in", async () => {
    localStorage.setItem(LIVE.session, 'live-token');
    const client = newClient();
    expect(client.getToken()).toBeNull();
    client.setToken('not-a-real-token');
    await client.call('me.bootstrap', {}).catch(() => undefined); // UNAUTHORIZED
    expect(client.getToken()).toBeNull();
    expect(localStorage.getItem(LIVE.session)).toBe('live-token');
    await signIn(client, PARENT);
    expect(localStorage.getItem(LIVE.session)).toBe('live-token');
  });

  it('never shares objects with the caller (JSON round trip like the live transport)', async () => {
    const client = newClient();
    await signIn(client, PARENT);
    const first = await client.call('me.bootstrap', {});
    student(first, 'S0001').balanceCents = 1;
    const second = await client.call('me.bootstrap', {});
    expect(student(second, 'S0001').balanceCents).toBe(64000);
  });

  it('addCredit posts a ledger row, runs the sync and "pushes" to the parent’s phone', async () => {
    const client = newClient();
    const pushes = capturePushes();
    const report = await client.demo.addCredit('S0001', 5000, 'Car wash');
    pushes.stop();

    expect(report.balanceChanges).toBe(1);
    expect(report.errors).toEqual([]);
    expect(pushes.events).toHaveLength(1);
    expect(pushes.events[0].to).toBe(PARENT);
    expect(pushes.events[0].message).toMatchObject({
      title: '+$50.00 for Avery',
      body: "$50.00 was added to Avery's TMA activity funds. New balance: $690.00.",
      url: '#/funds',
    });

    const outbox = client.demo.outbox();
    expect(outbox[0]).toMatchObject({ channel: expect.any(String) });
    expect(outbox.filter((i) => i.channel === 'push')).toEqual([
      expect.objectContaining({ to: PARENT, title: '+$50.00 for Avery' }),
    ]);
    expect(outbox.filter((i) => i.channel === 'email').map((i) => i.to).sort()).toEqual([
      'casey.thompson@example.com',
      PARENT,
    ]);

    await signIn(client, PARENT);
    const data = await client.call('me.bootstrap', {});
    expect(student(data, 'S0001').balanceCents).toBe(69000);
    expect(data.ledger[0]).toMatchObject({ description: 'Car wash', amountCents: 5000, type: 'Fundraiser' });
  });

  it('lists the outbox newest first', async () => {
    const client = newClient();
    await client.demo.addCredit('S0003', 2500, 'Pizza Night');
    await client.demo.addCredit('S0001', 1000, 'Bake sale');
    const pushes = client.demo.outbox().filter((i) => i.channel === 'push');
    expect(pushes.map((i) => i.title)).toEqual(['+$10.00 for Avery']);
    const titles = client.demo.outbox().map((i) => i.title);
    expect(titles.indexOf('+$10.00 for Avery')).toBeLessThan(titles.indexOf('+$25.00 for Maya'));
  });

  it('validates addCredit input', async () => {
    const client = newClient();
    await expect(client.demo.addCredit('S9999', 5000, 'x')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(client.demo.addCredit('S0001', 0, 'x')).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(client.demo.addCredit('S0001', 12.5, 'x')).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(client.demo.addCredit('S0001', 600_000, 'x')).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(client.demo.outbox()).toEqual([]);
  });

  it('runs a whole demo payment through the fake PayPal gateway', async () => {
    const client = newClient();
    await signIn(client, PARENT);
    const order = await client.call('payment.createOrder', {
      studentId: 'S0001',
      activityId: 'FL27',
      amountCents: 25000,
      coverFee: true,
    });
    expect(order.grossCents).toBeGreaterThan(25000);
    const { payment } = await client.call('payment.captureOrder', { orderId: order.orderId });
    expect(payment).toMatchObject({ amountCents: 25000, status: 'Completed', method: 'PayPal' });
  });

  it('delivers to demo devices registered through enablePush', async () => {
    const client = newClient();
    await signIn(client, TREASURER);
    expect(await enablePush(client)).toEqual({ ok: true });
    expect(storedDemoPushToken()).toMatch(/^demo-/);
    expect(localStorage.getItem(LIVE.push)).toBeNull();

    const pushes = capturePushes();
    await client.call('push.test', {});
    pushes.stop();
    expect(pushes.events.map((e) => [e.to, e.message.title])).toEqual([[TREASURER, 'Test notification ✅']]);
  });

  it('persists to localStorage and picks up where it left off', async () => {
    const first = newClient();
    await first.demo.addCredit('S0001', 5000, 'Car wash');
    flushSave();

    const stored = JSON.parse(localStorage.getItem(DEMO_DB_KEY)!) as { version: number; tables: object };
    expect(stored.version).toBe(1);

    const second = newClient();
    await signIn(second, PARENT);
    const data = await second.call('me.bootstrap', {});
    expect(student(data, 'S0001').balanceCents).toBe(69000);
    expect(second.demo.outbox().some((i) => i.title === '+$50.00 for Avery')).toBe(true);
  });

  it('notes sign-ins like the live app, keeps them across reloads, and reports who is using it', async () => {
    const first = newClient();
    await signIn(first, PARENT);
    await first.call('me.bootstrap', {});
    flushSave();
    type Row = Record<string, unknown>;
    const signIns = () => (JSON.parse(localStorage.getItem(DEMO_DB_KEY)!) as { tables: Record<string, Row[]> }).tables['Sign-ins'];
    const parentRow = () => signIns().find((r) => r.Email === PARENT)!;
    // The sample row had 2 sign-ins; this one makes 3, and the household and times are filled in.
    expect(parentRow()).toMatchObject({ FamilyID: 'F0001', 'Sign-ins': 3 });
    expect(parentRow()['Last Signed In']).toBe(parentRow()['Last Opened App']);
    expect(Date.now() - Date.parse(String(parentRow()['Last Signed In']))).toBeLessThan(60_000);

    const second = newClient();
    await signIn(second, TREASURER);
    const { report } = await second.call('admin.report', { kind: 'app-activity' });
    // Both just signed in, so they lead the list.
    expect(report.rows.slice(0, 2).map((r) => r.who).sort()).toEqual(['Jordan Thompson & Casey Thompson', TREASURER]);
    expect(report.rows.find((r) => r.familyId === 'F0001')).toMatchObject({ signIns: 3, daysSince: 0 });
  });

  it('keeps a session across reloads', async () => {
    const first = newClient();
    await signIn(first, PARENT);
    const second = newClient();
    expect(second.getToken()).toBe(first.getToken());
    const data = await second.call('me.bootstrap', {});
    expect(data.me.email).toBe(PARENT);
  });

  it('re-seeds when the saved copy is corrupt, from another version, or stale', async () => {
    for (const saved of [
      '{not json',
      JSON.stringify({ version: 99, seededAt: new Date().toISOString(), tables: {} }),
      JSON.stringify({ version: 1, seededAt: new Date().toISOString(), tables: { Ledger: 'oops' } }),
      JSON.stringify({ version: 1, seededAt: '2020-01-01T00:00:00.000Z', tables: { Families: [], Settings: [{}] } }),
    ]) {
      localStorage.setItem(DEMO_DB_KEY, saved);
      const client = newClient();
      await signIn(client, PARENT);
      const data = await client.call('me.bootstrap', {});
      expect(student(data, 'S0001').balanceCents).toBe(64000);
    }
  });

  it('reset() restores the sample data and forgets the demo push token', async () => {
    const client = newClient();
    await signIn(client, PARENT);
    await enablePush(client);
    await client.demo.addCredit('S0001', 5000, 'Car wash');
    expect(client.demo.outbox().length).toBeGreaterThan(0);

    client.demo.reset();

    expect(client.demo.outbox()).toEqual([]);
    expect(storedDemoPushToken()).toBeNull();
    const data = await client.call('me.bootstrap', {});
    expect(student(data, 'S0001').balanceCents).toBe(64000);
    expect(data.pushTokens).toBe(1); // the sample "parent's phone" only

    const reloaded = newClient();
    await signIn(reloaded, PARENT);
    expect(student(await reloaded.call('me.bootstrap', {}), 'S0001').balanceCents).toBe(64000);
  });

  it('runDaily sends the morning reminders', async () => {
    const client = newClient();
    const report = await client.demo.runDaily();
    expect(report.errors).toEqual([]);
    expect(typeof report.remindersSent).toBe('number');
  });

  it('exposes the controls on window for the e2e tests', () => {
    const client = newClient();
    expect(window.__tmaDemo).toBe(client.demo);
    createDemoClient({ latencyMs: [0, 0], exposeGlobal: false });
    expect(window.__tmaDemo).toBe(client.demo);
  });

  it('simulates network latency by default', async () => {
    vi.useFakeTimers();
    try {
      const client = createDemoClient();
      let done = false;
      const pending = client.call('auth.requestCode', { email: PARENT }).then(() => (done = true));
      await vi.advanceTimersByTimeAsync(100);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(300);
      await pending;
      expect(done).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
