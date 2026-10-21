import * as nodeCrypto from 'node:crypto';
import type { App, Services } from '../server/services';
import type { ApiRequest, ApiResponse, SetupReport, TickReport } from '../shared/types';
import {
  dailyTick,
  doGet,
  doPost,
  installTriggers,
  landingPage,
  onOpen,
  parseApiRequest,
  sendTestPushToMe,
  setupTma,
  setupTmaWithSampleData,
  showTmaStatus,
  syncTick,
} from './entry';
import { storedToken, testSubscription } from '../server/test-helpers';
import { FakeOutput, FakeSheet, installGasFakes, uninstallGasFakes, type GasFakes } from './testing/fakes';

const core = vi.hoisted(() => ({
  handle: vi.fn<(req: ApiRequest) => ApiResponse>(),
  syncTick: vi.fn<() => TickReport>(),
  dailyTick: vi.fn<() => TickReport>(),
  setup: vi.fn<(opts?: { seedSampleData?: boolean }) => SetupReport>(),
  services: [] as Services[],
}));

vi.mock('../server/app', () => ({
  createApp: (services: Services): App => {
    core.services.push(services);
    return { handle: core.handle, syncTick: core.syncTick, dailyTick: core.dailyTick, setup: core.setup };
  },
}));

const REPORT: TickReport = {
  ranAt: '2026-10-21T12:00:00.000Z',
  balanceChanges: 2,
  redemptionsPosted: 1,
  announcementsSent: 0,
  remindersSent: 0,
  notifications: { push: 3, email: 2, sms: 0 },
  errors: [],
};

let gas: GasFakes;

beforeEach(() => {
  gas = installGasFakes(nodeCrypto);
  core.services.length = 0;
  core.handle.mockReset();
  core.syncTick.mockReset().mockReturnValue(REPORT);
  core.dailyTick.mockReset().mockReturnValue(REPORT);
  core.setup.mockReset().mockReturnValue({ createdTables: ['Families'], addedColumns: [], seeded: false, secretsInitialized: ['TOKEN_SECRET'] });
});
afterEach(() => uninstallGasFakes());

function post(contents: unknown): ApiResponse {
  const out = doPost({ postData: { contents } } as unknown as GoogleAppsScript.Events.DoPost) as unknown as FakeOutput;
  expect(out.mimeType).toBe('JSON');
  return JSON.parse(out.getContent()) as ApiResponse;
}

describe('doPost', () => {
  it('round-trips an API request through app.handle', () => {
    core.handle.mockImplementation((req) => ({ ok: true, data: { echo: req } }) as unknown as ApiResponse);
    const request = { action: 'me.bootstrap', params: {}, token: 'tok.sig' };
    expect(post(JSON.stringify(request))).toEqual({ ok: true, data: { echo: request } });
    expect(core.handle).toHaveBeenCalledWith(request);
    expect(core.services[0].mode).toBe('production');
  });

  it('defaults params to {} and token to null', () => {
    core.handle.mockReturnValue({ ok: true, data: { sent: true } });
    post(JSON.stringify({ action: 'auth.requestCode' }));
    expect(core.handle).toHaveBeenCalledWith({ action: 'auth.requestCode', params: {}, token: null });
  });

  it('answers BAD_REQUEST for malformed envelopes without calling the core', () => {
    for (const body of [undefined, '', 'not json', '[]', '{"params":{}}', '{"action":1}', '{"action":"x","params":[]}', '{"action":"x","token":5}', `{"action":"x","pad":"${'x'.repeat(100001)}"}`]) {
      const res = post(body);
      expect(res).toMatchObject({ ok: false, error: { code: 'BAD_REQUEST' } });
    }
    expect(core.handle).not.toHaveBeenCalled();
  });

  it('turns unexpected exceptions into a generic INTERNAL error', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    core.handle.mockImplementation(() => {
      throw new Error('secret detail');
    });
    const res = post(JSON.stringify({ action: 'me.bootstrap', params: {} }));
    expect(res).toEqual({ ok: false, error: { code: 'INTERNAL', message: 'Something went wrong. Please try again.' } });
    expect(error).toHaveBeenCalled();
  });

  it('parseApiRequest passes unknown actions through for the core to reject', () => {
    expect(parseApiRequest('{"action":"nope.nope","params":{"a":1}}')).toEqual({
      request: { action: 'nope.nope', params: { a: 1 }, token: null },
    });
  });
});

describe('doGet', () => {
  it('answers ?action=health with version and time', () => {
    const out = doGet({ parameter: { action: 'health' } } as unknown as GoogleAppsScript.Events.DoGet) as unknown as FakeOutput;
    const body = JSON.parse(out.getContent()) as { ok: boolean; data: { version: string; time: string } };
    expect(out.mimeType).toBe('JSON');
    expect(body.ok).toBe(true);
    expect(typeof body.data.version).toBe('string');
    expect(Number.isNaN(Date.parse(body.data.time))).toBe(false);
  });

  it('otherwise renders a small page linking to APP_URL from Settings', () => {
    gas.spreadsheet.addSheet(
      FakeSheet.withRows('Settings', [['Key', 'Value'], ['APP_URL', 'https://tma.example.org/app/'], ['ORG_NAME', 'TMA <Test>']]),
    );
    const out = doGet({ parameter: {} } as unknown as GoogleAppsScript.Events.DoGet) as unknown as FakeOutput;
    expect(out.title).toBe('TMA <Test>');
    expect(out.getContent()).toContain('href="https://tma.example.org/app/" target="_top"');
    expect(out.getContent()).toContain('TMA &lt;Test&gt;');
  });

  it('never links to a non-http(s) APP_URL', () => {
    expect(landingPage('TMA', 'javascript:alert(1)')).not.toContain('href');
    expect(landingPage('TMA', '')).toContain('Ask TMA for the app link');
  });
});

describe('sheet menu and schedules', () => {
  it('onOpen adds the TMA App menu', () => {
    onOpen();
    expect(gas.ui.menus).toEqual([
      {
        name: 'TMA App',
        items: [
          ['Run sync now', 'syncTick'],
          ['Send me a test notification', 'sendTestPushToMe'],
          ['Set up / repair tabs', 'setupTma'],
          ['Install schedules', 'installTriggers'],
          ['Status', 'showTmaStatus'],
        ],
      },
    ]);
  });

  it('syncTick runs the core; a menu run (no event) shows a toast, a trigger run does not', () => {
    expect(syncTick()).toBe(REPORT);
    expect(gas.spreadsheet.toasts[0]).toContain('Balance changes: 2');
    syncTick({ triggerUid: '1' } as unknown as GoogleAppsScript.Events.TimeDriven);
    expect(gas.spreadsheet.toasts).toHaveLength(1);
    expect(core.syncTick).toHaveBeenCalledTimes(2);
  });

  it('dailyTick logs errors reported by the core', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    core.dailyTick.mockReturnValue({ ...REPORT, errors: ['reminders: boom'] });
    dailyTick({ triggerUid: '1' } as unknown as GoogleAppsScript.Events.TimeDriven);
    expect(error).toHaveBeenCalledWith('dailyTick finished with errors', ['reminders: boom']);
  });

  it('setupTma / setupTmaWithSampleData run setup under the lock and report back', () => {
    setupTma();
    setupTmaWithSampleData();
    expect(core.setup.mock.calls).toEqual([[{ seedSampleData: false }], [{ seedSampleData: true }]]);
    expect(gas.lock.calls).toEqual(['waitLock 20000', 'releaseLock', 'waitLock 20000', 'releaseLock']);
    expect(gas.ui.alerts[0].message).toContain('Created tabs: Families');
    expect(gas.ui.alerts[0].message).toContain('Created secrets: TOKEN_SECRET, PUSH_RELAY_SECRET');
    // The second run keeps the relay secret it made the first time.
    expect(gas.ui.alerts[1].message).toContain('Created secrets: TOKEN_SECRET\n');
  });

  it('setup still works without a UI (e.g. from the script editor log)', () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    gas.uiAvailable = false;
    expect(() => setupTma()).not.toThrow();
  });

  describe('push Worker linking', () => {
    const DEFAULT_WORKER = 'https://tma-push.coleciprari.workers.dev';
    const KEY = Buffer.from([0x04, ...nodeCrypto.randomBytes(64)]).toString('base64url');

    function worker(registered: () => string | null, register?: (secret: string) => void) {
      const seen: string[] = [];
      gas.fetch.handler = (r) => {
        seen.push(`${r.method.toUpperCase()} ${r.url}`);
        if (r.url === `${DEFAULT_WORKER}/register`) {
          const secret = (JSON.parse(r.payload as string) as { secret: string }).secret;
          const current = registered();
          if (current === null) {
            register?.(secret);
            return { code: 200, body: { registered: true, first: true } };
          }
          return current === secret ? { code: 200, body: { registered: true, first: false } } : { code: 409, body: { error: 'already_registered' } };
        }
        if (r.url === `${DEFAULT_WORKER}/vapid-public-key`) return { code: 200, body: { publicKey: KEY } };
        return { code: 404, body: { error: 'not_found' } };
      };
      return seen;
    }

    it('creates PUSH_RELAY_SECRET, registers it with the Worker (first use) and saves the public key', () => {
      let stored: string | null = null;
      const seen = worker(() => stored, (secret) => (stored = secret));
      setupTma();
      const secret = gas.properties.getProperty('PUSH_RELAY_SECRET');
      expect(secret).toMatch(/^[0-9a-f]{64}$/);
      expect(stored).toBe(secret);
      expect(gas.properties.getProperty('PUSH_PUBLIC_KEY')).toBe(KEY);
      expect(seen).toEqual([`POST ${DEFAULT_WORKER}/register`, `GET ${DEFAULT_WORKER}/vapid-public-key`]);
      const message = gas.ui.alerts[0].message;
      expect(message).toContain(`Push: linked this sheet to the push Worker (${DEFAULT_WORKER}).`);
      expect(message).toContain('PUSH_PUBLIC_KEY');
      expect(message).not.toContain(secret);
    });

    it('keeps an existing secret and reports a sheet that is already linked', () => {
      gas.properties.setProperty('PUSH_RELAY_SECRET', 'e'.repeat(64));
      worker(() => 'e'.repeat(64));
      const report = setupTma();
      expect(report.secretsInitialized).toEqual(['TOKEN_SECRET']);
      expect(gas.properties.getProperty('PUSH_RELAY_SECRET')).toBe('e'.repeat(64));
      expect(gas.ui.alerts[0].message).toContain(`Push: this sheet is linked to the push Worker (${DEFAULT_WORKER}).`);
      expect(gas.properties.getProperty('PUSH_PUBLIC_KEY')).toBe(KEY);
    });

    it('warns (without failing setup) when the Worker belongs to another secret', () => {
      const seen = worker(() => 'someone-elses-secret-'.repeat(3));
      expect(() => setupTma()).not.toThrow();
      const message = gas.ui.alerts[0].message;
      expect(message).toContain('⚠ Push: The push Worker is already linked to a different Apps Script secret. See workers/push/README.md (rotate keys).');
      expect(message).not.toContain('someone-elses-secret');
      expect(gas.properties.getProperty('PUSH_PUBLIC_KEY')).toBeNull();
      expect(seen).toHaveLength(1);
    });

    it('warns (without failing setup) when the Worker is unreachable', () => {
      gas.fetch.handler = () => {
        throw new Error('Address unavailable: https://tma-push.coleciprari.workers.dev/register');
      };
      expect(() => setupTma()).not.toThrow();
      expect(gas.ui.alerts[0].message).toMatch(/⚠ Push: Could not reach the push Worker \(Address unavailable/);
      expect(gas.ui.alerts[0].message).toContain('run it again later');
    });

    it('says push is off when PUSH_RELAY_URL is not an https address', () => {
      gas.spreadsheet.addSheet(FakeSheet.withRows('Settings', [['Key', 'Value'], ['PUSH_RELAY_URL', 'off']]));
      setupTma();
      expect(gas.fetch.requests).toHaveLength(0);
      expect(gas.ui.alerts[0].message).toContain('Push notifications are off: Settings PUSH_RELAY_URL');
    });
  });

  it('installTriggers replaces only its own triggers', () => {
    gas.scriptApp.newTrigger('syncTick').timeBased().everyMinutes(5).create();
    gas.scriptApp.newTrigger('somethingElse').timeBased().everyDays(1).create();
    expect(installTriggers()).toEqual({ removed: 1, created: 2 });
    expect(gas.scriptApp.triggers.map((t) => [t.handler, t.schedule])).toEqual([
      ['somethingElse', 'every 1 day'],
      ['syncTick', 'every 15 min'],
      ['dailyTick', 'every 1 day at 8'],
    ]);
  });
});

describe('sendTestPushToMe', () => {
  const WORKER = 'https://tma-push.coleciprari.workers.dev';
  const SECRET = '7c1d'.repeat(16);

  function devices(rows: string[][]) {
    return gas.spreadsheet.addSheet(
      FakeSheet.withRows('Devices', [['Email', 'FamilyID', 'Token', 'User Agent', 'Created', 'Last Seen'], ...rows]),
    );
  }

  it('pushes through the Worker to the signed-in user\'s devices only, removes dead ones, emails, and logs', () => {
    gas.session.email = 'Treasurer@Example.com';
    gas.properties.setProperty('PUSH_RELAY_SECRET', SECRET);
    const live = storedToken(testSubscription('live'));
    const dead = storedToken(testSubscription('dead'));
    const other = storedToken(testSubscription('other'));
    const sheet = devices([
      ['treasurer@example.com', 'F1', live, 'iPhone', 'x', 'x'],
      ['someone@example.com', 'F2', other, 'Android', 'x', 'x'],
      [' TREASURER@example.com ', 'F1', dead, 'Pixel', 'x', 'x'],
      ['treasurer@example.com', 'F1', 'demo-device-parent', 'Demo', 'x', 'x'],
    ]);
    const sentTo: string[] = [];
    const emailed: Array<Record<string, unknown>> = [];
    gas.fetch.handler = (r) => {
      expect(r.headers.Authorization).toBe(`Bearer ${SECRET}`);
      if (r.url === `${WORKER}/email`) {
        emailed.push(...(JSON.parse(r.payload as string) as { messages: Array<Record<string, unknown>> }).messages);
        return { code: 200, body: { results: [{ status: 'ok', messageId: 'm-1' }] } };
      }
      expect(r.url).toBe(`${WORKER}/send`);
      const { messages } = JSON.parse(r.payload as string) as { messages: Array<{ subscription: { endpoint: string }; payload: string }> };
      for (const m of messages) {
        sentTo.push(m.subscription.endpoint);
        expect(JSON.parse(m.payload)).toMatchObject({ title: 'Test notification ✅', topic: 'test' });
      }
      return {
        code: 200,
        body: { results: messages.map((m) => (m.subscription.endpoint.includes('device-dead') ? { status: 'invalid', reason: 'gone' } : { status: 'ok' })) },
      };
    };

    const report = sendTestPushToMe();

    expect(sentTo.map((e) => e.replace(/.*device-/, ''))).toEqual(['live:APA91bH', 'dead:APA91bH']);
    expect(report).toMatchObject({ email: 'treasurer@example.com', devices: 3, push: 1, removed: 2, emailSent: true, emailVia: 'cloudflare' });
    // Dead and demo rows blanked; the others are untouched.
    expect([1, 2, 3, 4, 5, 6].map((c) => sheet.raw(4, c))).toEqual(['', '', '', '', '', '']);
    expect(sheet.dump().map((row) => row[2])).toEqual(['Token', live, other]);
    // The test email took the same path as every email: the Worker, as noreply@mytma.org.
    expect(emailed).toEqual([
      expect.objectContaining({ to: 'treasurer@example.com', subject: 'Timberlane Music Association: test notification', replyTo: 'timberlanemusictma@gmail.com' }),
    ]);
    expect(gas.mail.sent).toHaveLength(0);
    const log = gas.spreadsheet.getSheetByName('Log')!.dump();
    expect(log[1][1]).toBe('notify');
    expect(log[1][2]).toBe('test: Test notification ✅ → push 1, email 1, sms 0');
    expect(gas.ui.alerts[0].message).toContain('Push: delivered to 1 of 3 device(s).');
    expect(gas.ui.alerts[0].message).toContain('Email: sent from noreply@mytma.org through the push Worker (Cloudflare Email Sending).');
  });

  it('reports a test email that went out with Gmail because the Worker could not send it', () => {
    gas.properties.setProperty('PUSH_RELAY_SECRET', SECRET);
    devices([]);
    gas.fetch.handler = (r) => {
      expect(r.url).toBe(`${WORKER}/email`);
      return { code: 200, body: { results: [{ status: 'error', reason: 'sender_not_verified', code: 'E_SENDER_NOT_VERIFIED' }] } };
    };
    const report = sendTestPushToMe();
    expect(report).toMatchObject({ emailSent: true, emailVia: 'gmail', emailWorkerReason: 'sender_not_verified', emailWorkerCode: 'E_SENDER_NOT_VERIFIED' });
    expect(gas.mail.sent).toEqual([expect.objectContaining({ to: 'treasurer@example.com', replyTo: 'timberlanemusictma@gmail.com' })]);
    expect(gas.ui.alerts[0].message).toContain(
      "Email: sent with Gmail from this Google account instead of noreply@mytma.org, because mytma.org isn't verified for Cloudflare Email Sending yet",
    );
    expect(gas.ui.alerts[0].message).toContain('E_SENDER_NOT_VERIFIED.');
  });

  it('reports a test email sent with Gmail on purpose (EMAIL_VIA = gmail)', () => {
    gas.properties.setProperty('PUSH_RELAY_SECRET', SECRET);
    gas.spreadsheet.addSheet(FakeSheet.withRows('Settings', [['Key', 'Value'], ['EMAIL_VIA', 'gmail']]));
    devices([]);
    expect(sendTestPushToMe()).toMatchObject({ emailSent: true, emailVia: 'gmail' });
    expect(gas.fetch.requests).toHaveLength(0);
    expect(gas.ui.alerts[0].message).toContain('Email: sent with Gmail from this Google account (Settings EMAIL_VIA is gmail).');
  });

  it('reports a test email that could not be sent at all', () => {
    gas.spreadsheet.addSheet(FakeSheet.withRows('Settings', [['Key', 'Value'], ['EMAIL_VIA', 'gmail']]));
    devices([]);
    vi.spyOn(MailApp, 'sendEmail').mockImplementation(() => {
      throw new Error('Service invoked too many times for one day: email.');
    });
    const report = sendTestPushToMe();
    expect(report.emailSent).toBe(false);
    expect(gas.ui.alerts[0].message).toContain('Email: not sent.');
    expect(gas.ui.alerts[0].message).toContain('The test email could not be sent: Service invoked too many times');
  });

  it('explains how to set push up when the relay secret is missing', () => {
    devices([['treasurer@example.com', 'F1', storedToken(testSubscription('x')), 'iPhone', 'x', 'x']]);
    const report = sendTestPushToMe();
    expect(report.notes[0]).toContain('TMA App → Set up / repair tabs');
    expect(gas.fetch.requests).toHaveLength(0);
  });

  it('explains what is missing when nothing can be pushed', () => {
    devices([]);
    const report = sendTestPushToMe();
    expect(report.push).toBe(0);
    expect(report.notes[0]).toContain('No phones are registered for treasurer@example.com');
    // Not linked to the Worker (no PUSH_RELAY_SECRET): the email still goes, with Gmail.
    expect(report).toMatchObject({ emailSent: true, emailVia: 'gmail', emailWorkerReason: 'not_linked' });
    expect(gas.fetch.requests).toHaveLength(0);
    expect(gas.ui.alerts[0].message).toContain("because this sheet isn't linked to the push Worker yet");
  });

  it('respects EMAIL_ENABLED and the mail quota', () => {
    gas.spreadsheet.addSheet(FakeSheet.withRows('Settings', [['Key', 'Value'], ['EMAIL_ENABLED', 'FALSE']]));
    expect(sendTestPushToMe()).toMatchObject({ emailSent: false, notes: expect.arrayContaining([expect.stringContaining('EMAIL_ENABLED')]) });
    expect(gas.mail.sent).toHaveLength(0);
  });

  it('handles an unknown active user', () => {
    gas.session.email = '';
    const report = sendTestPushToMe();
    expect(report.emailSent).toBe(false);
    expect(report.notes[0]).toMatch(/Could not tell/);
  });
});

describe('showTmaStatus', () => {
  it('lists secret names (never values), integrations, the push Worker and quota', () => {
    gas.properties.setProperty('TOKEN_SECRET', 'super-secret-token-value');
    gas.properties.setProperty('PAYPAL_SECRET', 'super-secret-paypal');
    gas.properties.setProperty('PUSH_RELAY_SECRET', 'super-secret-relay-value-0123456789abcdef');
    gas.spreadsheet.addSheet(
      FakeSheet.withRows('Settings', [['Key', 'Value'], ['PAYPAL_CLIENT_ID', 'AbcPublic'], ['ONLINE_PAYMENTS', 'TRUE']]),
    );
    gas.scriptApp.newTrigger('syncTick').timeBased().everyMinutes(15).create();
    gas.mail.quota = 93;
    gas.fetch.handler = (r) =>
      r.url === 'https://tma-push.coleciprari.workers.dev/health'
        ? { code: 200, body: { ok: true, name: 'tma-push', registered: true, hasKeys: false } }
        : { code: 404, body: {} };

    const text = showTmaStatus();

    expect(text).toContain('Web app URL: https://script.google.com/macros/s/FAKE/exec');
    expect(text).toContain('Secrets set: TOKEN_SECRET, PAYPAL_SECRET, PUSH_RELAY_SECRET');
    expect(text).toContain('Secrets not set: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM');
    expect(text).toContain('PayPal: configured (sandbox); online payments on');
    expect(text).toContain('Push Worker: https://tma-push.coleciprari.workers.dev');
    expect(text).toContain('Push Worker health: reachable ✓, linked to a sheet ✓, keys ✗ (TMA App → Set up / repair tabs)');
    expect(text).toContain('Push public key (PUSH_PUBLIC_KEY): not saved yet');
    expect(text).toContain('Push notifications: configured');
    expect(text).toContain('sync every 15 min ✓, daily reminders ✗ (TMA App → Install schedules)');
    // The Worker answered without "email": true, so it can't send email yet; Gmail does meanwhile.
    expect(text).toContain(
      'Email: on; from noreply@mytma.org through the push Worker (Cloudflare Email Sending ✗: not set up on the Worker yet, so Gmail sends meanwhile; see docs/SETUP.md); Reply-To timberlanemusictma@gmail.com; Gmail fallback: 93 emails left today',
    );
    expect(text).not.toContain('super-secret');
    expect(text).not.toMatch(/firebase|fcm/i);
    expect(gas.ui.alerts[0]).toEqual({ title: 'TMA App status', message: text });
    // Read-only: only the health check went out.
    expect(gas.fetch.requests.map((r) => `${r.method} ${r.url}`)).toEqual(['get https://tma-push.coleciprari.workers.dev/health']);
  });

  it('shows a saved public key and an unreachable Worker', () => {
    gas.properties.setProperty('PUSH_PUBLIC_KEY', Buffer.from([0x04, ...nodeCrypto.randomBytes(64)]).toString('base64url'));
    gas.fetch.handler = () => {
      throw new Error('Address unavailable');
    };
    const text = showTmaStatus();
    expect(text).toContain('Push Worker health: unreachable (Address unavailable)');
    expect(text).toContain('Push public key (PUSH_PUBLIC_KEY): saved ✓');
    expect(text).toContain('Push notifications: not configured (TMA App → Set up / repair tabs)');
  });

  it('shows the email route: the Worker with Email Sending, Gmail by setting, or Gmail while paused', () => {
    gas.properties.setProperty('PUSH_RELAY_SECRET', 'f'.repeat(64));
    gas.spreadsheet.addSheet(FakeSheet.withRows('Settings', [['Key', 'Value'], ['SUPPORT_EMAIL', 'Help@Example.org']]));
    gas.mail.quota = 88;
    gas.fetch.handler = () => ({ code: 200, body: { ok: true, name: 'tma-push', registered: true, hasKeys: true, email: true } });
    expect(showTmaStatus()).toContain(
      'Email: on; from noreply@mytma.org through the push Worker (Cloudflare Email Sending ✓); Reply-To help@example.org; Gmail fallback: 88 emails left today',
    );

    gas.cache.put('email-worker:paused', 'sender_not_verified', 600);
    expect(showTmaStatus()).toContain(
      "Email: on; with Gmail from this Google account, because mytma.org isn't verified for Cloudflare Email Sending yet",
    );
    expect(showTmaStatus()).toContain('(Gmail for up to 10 minutes, then the Worker is tried again); Reply-To help@example.org; 88 emails left today');

    gas.spreadsheet.sheets.length = 0;
    gas.spreadsheet.addSheet(FakeSheet.withRows('Settings', [['Key', 'Value'], ['EMAIL_VIA', 'gmail'], ['EMAIL_ENABLED', 'FALSE']]));
    expect(showTmaStatus()).toContain(
      'Email: notifications off (sign-in codes are still emailed); with Gmail from this Google account, because Settings EMAIL_VIA is gmail; Reply-To timberlanemusictma@gmail.com; 88 emails left today',
    );
    // Still read-only: one health check per Status, no email sent.
    expect(gas.fetch.requests.every((r) => r.url.endsWith('/health'))).toBe(true);
    expect(gas.fetch.requests).toHaveLength(4);
    expect(gas.mail.sent).toHaveLength(0);
  });

  it('points to setup when TOKEN_SECRET is missing', () => {
    gas.scriptApp.serviceUrl = '';
    const text = showTmaStatus();
    expect(text).toContain('not deployed yet');
    expect(text).toContain('TOKEN_SECRET is missing');
  });
});
