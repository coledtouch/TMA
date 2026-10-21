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
    expect(gas.ui.alerts[0].message).toContain('Created secrets: TOKEN_SECRET');
  });

  it('setup still works without a UI (e.g. from the script editor log)', () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    gas.uiAvailable = false;
    expect(() => setupTma()).not.toThrow();
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
  const ACCOUNT = (() => {
    const { privateKey } = nodeCrypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    return JSON.stringify({
      project_id: 'tma',
      client_email: 'sa@tma.iam.gserviceaccount.com',
      private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    });
  })();

  function devices(rows: string[][]) {
    return gas.spreadsheet.addSheet(
      FakeSheet.withRows('Devices', [['Email', 'FamilyID', 'Token', 'User Agent', 'Created', 'Last Seen'], ...rows]),
    );
  }

  it('pushes to the signed-in user\'s devices only, removes dead tokens, emails, and logs', () => {
    gas.session.email = 'Treasurer@Example.com';
    gas.properties.setProperty('FCM_SERVICE_ACCOUNT', ACCOUNT);
    const sheet = devices([
      ['treasurer@example.com', 'F1', 'tok-live', 'iPhone', 'x', 'x'],
      ['someone@example.com', 'F2', 'tok-other', 'Android', 'x', 'x'],
      [' TREASURER@example.com ', 'F1', 'tok-dead', 'Pixel', 'x', 'x'],
    ]);
    const sentTo: string[] = [];
    gas.fetch.handler = (r) => {
      if (r.url.includes('oauth2')) return { code: 200, body: { access_token: 'at', expires_in: 3600 } };
      const msg = (JSON.parse(r.payload as string) as { message: { token: string; data: Record<string, string> } }).message;
      sentTo.push(msg.token);
      expect(msg.data).toMatchObject({ title: 'Test notification ✅', topic: 'test' });
      return msg.token === 'tok-dead'
        ? { code: 404, body: { error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } } }
        : { code: 200, body: {} };
    };

    const report = sendTestPushToMe();

    expect(sentTo.sort()).toEqual(['tok-dead', 'tok-live']);
    expect(report).toMatchObject({ email: 'treasurer@example.com', devices: 2, push: 1, removed: 1, emailSent: true });
    // Dead device row blanked (so the tab now ends at row 3); the others are untouched.
    expect([1, 2, 3, 4, 5, 6].map((c) => sheet.raw(4, c))).toEqual(['', '', '', '', '', '']);
    expect(sheet.dump().map((row) => row[2])).toEqual(['Token', 'tok-live', 'tok-other']);
    expect(gas.mail.sent[0]).toMatchObject({ to: 'treasurer@example.com' });
    const log = gas.spreadsheet.getSheetByName('Log')!.dump();
    expect(log[1][1]).toBe('notify');
    expect(log[1][2]).toBe('test: Test notification ✅ → push 1, email 1, sms 0');
    expect(gas.ui.alerts[0].message).toContain('Push: delivered to 1 of 2 device(s).');
  });

  it('explains what is missing when nothing can be pushed', () => {
    devices([]);
    const report = sendTestPushToMe();
    expect(report.push).toBe(0);
    expect(report.notes[0]).toContain('No phones are registered for treasurer@example.com');
    expect(report.emailSent).toBe(true);
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
  it('lists secret names (never values), integrations and quota', () => {
    gas.properties.setProperty('TOKEN_SECRET', 'super-secret-token-value');
    gas.properties.setProperty('PAYPAL_SECRET', 'super-secret-paypal');
    gas.spreadsheet.addSheet(
      FakeSheet.withRows('Settings', [['Key', 'Value'], ['PAYPAL_CLIENT_ID', 'AbcPublic'], ['ONLINE_PAYMENTS', 'TRUE']]),
    );
    gas.scriptApp.newTrigger('syncTick').timeBased().everyMinutes(15).create();
    gas.mail.quota = 93;

    const text = showTmaStatus();

    expect(text).toContain('Web app URL: https://script.google.com/macros/s/FAKE/exec');
    expect(text).toContain('Secrets set: TOKEN_SECRET, PAYPAL_SECRET');
    expect(text).toContain('Secrets not set: FCM_SERVICE_ACCOUNT, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM');
    expect(text).toContain('PayPal: configured (sandbox); online payments on');
    expect(text).toContain('Push notifications (Firebase): not configured');
    expect(text).toContain('sync every 15 min ✓, daily reminders ✗ (TMA App → Install schedules)');
    expect(text).toContain('93 emails left today');
    expect(text).not.toContain('super-secret');
    expect(gas.ui.alerts[0]).toEqual({ title: 'TMA App status', message: text });
  });

  it('points to setup when TOKEN_SECRET is missing', () => {
    gas.scriptApp.serviceUrl = '';
    const text = showTmaStatus();
    expect(text).toContain('not deployed yet');
    expect(text).toContain('TOKEN_SECRET is missing');
  });
});
