/**
 * Checks the generated apps-script/Code.js itself (run `npm run build:gas`
 * first; skipped when the file doesn't exist): it must be one plain script
 * Apps Script can load, and its entry points must work end to end against the
 * Apps Script fakes.
 */
import * as nodeCrypto from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { installGasFakes, uninstallGasFakes, type FakeOutput, type GasFakes } from './testing/fakes';

const CODE_PATH = fileURLToPath(new URL('../../apps-script/Code.js', import.meta.url));
const code = existsSync(CODE_PATH) ? readFileSync(CODE_PATH, 'utf8') : '';

const ENTRY_POINTS = [
  'doGet',
  'doPost',
  'onOpen',
  'syncTick',
  'dailyTick',
  'setupTma',
  'setupTmaWithSampleData',
  'installTriggers',
  'sendTestPushToMe',
  'showTmaStatus',
] as const;

const APPS_SCRIPT_GLOBALS = [
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
];

/** A service stub that fails the test if module code touches it while loading. */
function untouchable(name: string): unknown {
  return new Proxy(
    {},
    {
      get(_target, prop) {
        throw new Error(`${name}.${String(prop)} was used while the script loaded`);
      },
    },
  );
}

describe.skipIf(!code)('apps-script/Code.js', () => {
  it('is a single classic script with no module syntax or browser/Node APIs', () => {
    expect(code.startsWith('// GENERATED FILE')).toBe(true);
    expect(code).not.toMatch(/^\s*import[\s{*]/m);
    expect(code).not.toMatch(/^\s*export[\s{*]/m);
    expect(code).not.toMatch(/\bimport\s*\(/); // no dynamic imports either
    // UrlFetchApp.fetch/fetchAll are fine; the browser's global fetch() doesn't exist in Apps Script.
    expect(code).not.toMatch(/(^|[^.\w$])fetch\s*\(/m);
    expect(code).not.toMatch(/\b(?:window|document|localStorage|navigator|process)\.\w/);
    expect(code).not.toMatch(/\brequire\s*\(/);
    // Web/Node globals the Apps Script V8 runtime doesn't have (Utilities replaces most of them).
    expect(code).not.toMatch(
      /\bnew URL\(|\bURLSearchParams\b|\bTextEncoder\b|\bTextDecoder\b|\batob\(|\bbtoa\(|\bsetTimeout\(|\bsetInterval\(|\bstructuredClone\(|\bqueueMicrotask\(|\bcrypto\.(?:randomUUID|getRandomValues|subtle)\b|\bBuffer\./,
    );
    // The test-only in-memory services must never ship.
    expect(code).not.toContain('createMemoryServices');
    // Push goes through the TMA push Worker: nothing of the old Firebase sender may remain. The one
    // allowed mention is fcm.googleapis.com, Chrome's Web Push host, on the subscription allowlist.
    expect(code.replace(/\bfcm\.googleapis\.com\b/g, '')).not.toMatch(/firebase|fcm/i);
    expect(code).not.toMatch(/oauth2\.googleapis\.com|messages:send|computeRsaSha256Signature/);
    expect(code).toContain('tma-push.coleciprari.workers.dev');
    // Literal U+2028/U+2029 would end a line inside a string or regex in older parsers.
    expect(code).not.toMatch(new RegExp(`[${String.fromCharCode(0x2028, 0x2029)}]`));
    new vm.Script(code, { filename: 'Code.js' }); // parses
  });

  it('loads with Apps Script stubs, touches no service at load time, and exposes every entry point', () => {
    const sandbox: Record<string, unknown> = { console };
    for (const name of APPS_SCRIPT_GLOBALS) sandbox[name] = untouchable(name);
    vm.createContext(sandbox);
    vm.runInContext(code, sandbox, { filename: 'Code.js' });
    for (const name of ENTRY_POINTS) {
      expect(typeof sandbox[name], name).toBe('function');
    }
    expect(typeof sandbox.TMA).toBe('object');
  });

  describe('against the Apps Script fakes', () => {
    let gas: GasFakes;
    const WORKER = 'https://tma-push.coleciprari.workers.dev';
    const VAPID_KEY = Buffer.from([0x04, ...nodeCrypto.randomBytes(64)]).toString('base64url');
    let workerSecret = '';
    let parentToken = '';
    const pushed: Array<{ subscription: { endpoint: string }; payload: string }> = [];
    /** Emails the Worker was asked to send as noreply@mytma.org. */
    const emailed: Array<{ to: string; subject: string; html?: string; text?: string; replyTo?: string }> = [];
    const g = globalThis as unknown as Record<string, (e?: unknown) => unknown>;

    beforeAll(() => {
      gas = installGasFakes(nodeCrypto);
      // As a script in this realm, like Apps Script loads Code.js: top-level functions become globals.
      vm.runInThisContext(code, { filename: 'Code.js' });
    });

    // The script's top-level functions are non-deletable globals; Vitest isolates each test file anyway.
    afterAll(() => uninstallGasFakes());

    const post = (body: unknown): { ok: boolean; data?: any; error?: { code: string; message: string } } => {
      const out = g.doPost({ postData: { contents: JSON.stringify(body), type: 'text/plain' } }) as FakeOutput;
      expect(out.mimeType).toBe('JSON');
      return JSON.parse(out.getContent());
    };

    it('sets up the sheet with sample data, links the push Worker and answers the health check', () => {
      gas.fetch.handler = (r) => {
        if (r.url === `${WORKER}/register`) {
          workerSecret = (JSON.parse(String(r.payload)) as { secret: string }).secret;
          return { code: 200, body: { registered: true, first: true } };
        }
        if (r.url === `${WORKER}/vapid-public-key`) return { code: 200, body: { publicKey: VAPID_KEY } };
        if (r.url === `${WORKER}/send`) {
          if (r.headers.Authorization !== `Bearer ${workerSecret}`) return { code: 401, body: { error: 'unauthorized' } };
          const { messages } = JSON.parse(String(r.payload)) as { messages: Array<{ subscription: { endpoint: string }; payload: string }> };
          pushed.push(...messages);
          return { code: 200, body: { results: messages.map(() => ({ status: 'ok' })) } };
        }
        if (r.url === `${WORKER}/email`) {
          if (r.headers.Authorization !== `Bearer ${workerSecret}`) return { code: 401, body: { error: 'unauthorized' } };
          const { messages } = JSON.parse(String(r.payload)) as { messages: typeof emailed };
          emailed.push(...messages);
          return { code: 200, body: { results: messages.map((_, i) => ({ status: 'ok', messageId: `m-${emailed.length + i}` })) } };
        }
        return { code: 404, body: { error: 'not_found' } };
      };
      g.setupTmaWithSampleData();
      const tabs = gas.spreadsheet.getSheets().map((s) => s.getName());
      expect(tabs).toEqual(expect.arrayContaining(['Settings', 'Families', 'Students', 'Ledger', 'Payments', 'Redemptions']));
      expect(gas.properties.getProperty('TOKEN_SECRET')).toMatch(/^[0-9a-f]{64}$/);
      expect(gas.properties.getProperty('PUSH_RELAY_SECRET')).toMatch(/^[0-9a-f]{64}$/);
      expect(workerSecret).toBe(gas.properties.getProperty('PUSH_RELAY_SECRET'));
      expect(gas.properties.getProperty('PUSH_PUBLIC_KEY')).toBe(VAPID_KEY);
      expect(gas.ui.alerts.at(-1)?.message).toContain('Push: linked this sheet to the push Worker');
      expect(gas.spreadsheet.getSheetByName('_Snapshot')?.isSheetHidden()).toBe(true);

      const health = JSON.parse((g.doGet({ parameter: { action: 'health' } }) as FakeOutput).getContent());
      expect(health).toMatchObject({ ok: true, data: { version: expect.any(String) } });
      const landing = g.doGet({ parameter: {} }) as FakeOutput;
      expect(landing.mimeType).toBe('TEXT');
      expect(landing.getContent()).toContain("This address is the TMA app's server.");
      // No HtmlService page anywhere: one would hand its visitors google.script.run.
      expect(code).not.toMatch(/HtmlService\s*\./);
    });

    it('adds the TMA App menu and installs the schedules', () => {
      g.onOpen();
      const menu = gas.ui.menus.find((m) => m.name === 'TMA App');
      expect(menu?.items.map(([, fn]) => fn)).toEqual(
        expect.arrayContaining(['syncTick', 'sendTestPushToMe', 'setupTma', 'installTriggers', 'showTmaStatus']),
      );
      // Every menu item must point at a real top-level function.
      for (const [, fn] of menu!.items) expect(typeof g[fn], fn).toBe('function');

      g.installTriggers();
      expect(gas.scriptApp.triggers.map((t) => t.handler).sort()).toEqual(['dailyTick', 'syncTick']);
    });

    it("writes the menu's reports to their tabs, and gives a web-app visitor nothing (google.script.run)", () => {
      // From the menu: the tab is written and shown, and nothing comes back.
      expect(g.reportRoster()).toBeUndefined();
      expect(gas.spreadsheet.getSheetByName('Report: Roster')?.dump()[2][0]).toBe('Ethan Nguyen');

      // The web app's own page can call any top-level function, as the sheet owner. A web request
      // has no spreadsheet UI, and Execute as: Me hides the visitor's email.
      gas.uiAvailable = false;
      gas.session.email = '';
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const tabs = gas.spreadsheet.getSheets().length;
      const alerts = gas.ui.alerts.length;
      try {
        for (const fn of ['reportRoster', 'reportTripBalances', 'reportPayments', 'reportStudentFunds', 'showTmaStatus']) {
          expect(g[fn](), fn).toBeUndefined();
        }
        expect(g.setupTmaWithSampleData()).toBeNull();
        expect(gas.spreadsheet.getSheets()).toHaveLength(tabs);
        expect(gas.spreadsheet.getSheetByName('Report: Trip balances')).toBeNull();
        expect(gas.ui.alerts).toHaveLength(alerts);
      } finally {
        gas.uiAvailable = true;
        gas.session.email = 'treasurer@example.com';
        warn.mockRestore();
      }
    });

    it('signs a parent in with an emailed code and returns their household', () => {
      expect(post({ action: 'me.bootstrap', params: {} }).error?.code).toBe('UNAUTHORIZED');
      expect(post('not json').error?.code).toBe('BAD_REQUEST');

      const sent = post({ action: 'auth.requestCode', params: { email: 'parent@example.com' } });
      expect(sent).toEqual({ ok: true, data: { sent: true } }); // production mode: no devCode
      // The code went out through the Worker (as noreply@mytma.org), not from the script's Gmail.
      const mail = emailed.at(-1)!;
      expect(mail.to).toBe('parent@example.com');
      expect(mail.replyTo).toBe('timberlanemusictma@gmail.com');
      expect(gas.mail.sent).toHaveLength(0);
      const code = /(\d{6})/.exec(String(mail.subject))?.[1];
      expect(code).toBeDefined();

      const verified = post({ action: 'auth.verifyCode', params: { email: 'parent@example.com', code } });
      expect(verified.ok).toBe(true);
      const token = verified.data.token as string;

      const home = post({ action: 'me.bootstrap', params: {}, token });
      expect(home.ok).toBe(true);
      expect(home.data.me).toMatchObject({ email: 'parent@example.com', familyId: 'F0001', familyStatus: 'Active' });
      const avery = home.data.students.find((s: { student: { id: string } }) => s.student.id === 'S0001');
      expect(avery).toMatchObject({ balanceCents: 64_000, availableCents: 44_000 });
      // PayPal isn't configured in a fresh production sheet; push is (through the Worker).
      expect(home.data.settings.onlinePaymentsEnabled).toBe(false);
      expect(home.data.settings.pushPublicKey).toBe(VAPID_KEY);
      parentToken = token;
    });

    it('notes the sign-in in the Sign-ins tab, lists it in the menu report, and still signs in when the lock is busy', () => {
      const tab = () => gas.spreadsheet.getSheetByName('Sign-ins')!.dump();
      expect(tab()[0]).toEqual(['Email', 'FamilyID', 'First Signed In', 'Last Signed In', 'Last Opened App', 'Sign-ins']);
      expect(tab().slice(1).map((r) => [r[0], r[1], r[5]])).toEqual([['parent@example.com', 'F0001', 1]]);
      expect(gas.spreadsheet.getSheetByName('Sign-ins')!.isSheetHidden()).toBe(true);

      g.onOpen();
      const menu = gas.ui.menus.find((m) => m.name === 'TMA App')!;
      expect(menu.items).toContainEqual(["Reports › Who's using the app", 'reportAppActivity']);
      expect(g.reportAppActivity()).toBeUndefined();
      const report = gas.spreadsheet.getSheetByName("Report: Who's using the app")!.dump();
      expect(report[2].slice(0, 3)).toEqual(['Jordan Thompson & Casey Thompson', 'F0001', 'Active']);

      const sent = post({ action: 'auth.requestCode', params: { email: 'casey.thompson@example.com' } });
      expect(sent.ok).toBe(true);
      const code = /(\d{6})/.exec(String(emailed.at(-1)?.subject))?.[1];
      gas.lock.busy = true;
      const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      try {
        const verified = post({ action: 'auth.verifyCode', params: { email: 'casey.thompson@example.com', code } });
        expect(verified.ok).toBe(true);
        expect(post({ action: 'me.bootstrap', params: {}, token: verified.data.token }).ok).toBe(true);
      } finally {
        gas.lock.busy = false;
        error.mockRestore();
      }
      expect(tab()).toHaveLength(2); // Casey's sign-in was skipped, not an error
    });

    it('registers a browser subscription and pushes a credit to it through the Worker', () => {
      const sub = {
        endpoint: 'https://web.push.apple.com/QGuQyavXutnMH-test-device',
        expirationTime: null,
        keys: {
          p256dh: Buffer.from([0x04, ...nodeCrypto.randomBytes(64)]).toString('base64url'),
          auth: nodeCrypto.randomBytes(16).toString('base64url'),
        },
      };
      const registered = post({ action: 'push.register', params: { token: JSON.stringify(sub), userAgent: 'iPhone' }, token: parentToken });
      expect(registered).toEqual({ ok: true, data: { devices: 1 } });
      const devices = gas.spreadsheet.getSheetByName('Devices')!.dump();
      expect(devices.map((row) => row[2])).toContain(JSON.stringify({ endpoint: sub.endpoint, keys: sub.keys }));
      expect(post({ action: 'push.register', params: { token: 'demo-0123456789abcdef' }, token: parentToken }).error?.code).toBe('BAD_REQUEST');
    });

    it('notices a credit the treasurer typed into the Ledger tab and emails the family', () => {
      const ledger = gas.spreadsheet.getSheetByName('Ledger')!;
      const headers = ledger.dump()[0] as string[];
      const row = ledger.getLastRow() + 1;
      const today = new Date().toISOString().slice(0, 10);
      const values: Record<string, string | number> = {
        Date: today,
        StudentID: 'S0001',
        Type: 'Fundraiser',
        Description: 'Wreath sale',
        Amount: 50,
      };
      headers.forEach((h, i) => {
        if (h in values) ledger.write(row, i + 1, values[h]);
      });

      const before = emailed.length;
      pushed.length = 0;
      g.syncTick();
      const alerts = emailed.slice(before).filter((m) => m.subject === '+$50.00 for Avery');
      expect(alerts.map((m) => m.to).sort()).toEqual(['casey.thompson@example.com', 'parent@example.com']);
      // And the parent's phone got it through the push Worker.
      expect(pushed.map((m) => m.subscription.endpoint)).toEqual(['https://web.push.apple.com/QGuQyavXutnMH-test-device']);
      expect(JSON.parse(pushed[0].payload)).toMatchObject({ title: '+$50.00 for Avery', url: '#/funds', topic: 'balance' });
      expect(gas.mail.sent).toHaveLength(0);
    });

    it('falls back to Gmail for a sign-in code when the Worker cannot send email', () => {
      const handler = gas.fetch.handler;
      gas.fetch.handler = (r) =>
        r.url === `${WORKER}/email`
          ? { code: 200, body: { results: [{ status: 'error', reason: 'sender_not_verified', code: 'E_SENDER_NOT_VERIFIED' }] } }
          : handler(r);
      try {
        const sent = post({ action: 'auth.requestCode', params: { email: 'nguyen.family@example.com' } });
        expect(sent).toEqual({ ok: true, data: { sent: true } });
        expect(gas.mail.sent.at(-1)).toMatchObject({ to: 'nguyen.family@example.com', replyTo: 'timberlanemusictma@gmail.com' });
        expect(String(gas.mail.sent.at(-1)?.subject)).toMatch(/^Your TMA sign-in code: \d{6}$/);
      } finally {
        gas.fetch.handler = handler;
      }
    });

    /** Type a value under a header of the Ledger tab, in a new row. */
    const typeCredit = (amount: number, description: string) => {
      const ledger = gas.spreadsheet.getSheetByName('Ledger')!;
      const headers = ledger.dump()[0] as string[];
      const row = ledger.getLastRow() + 1;
      const values: Record<string, string | number> = { Date: new Date().toISOString().slice(0, 10), StudentID: 'S0001', Type: 'Fundraiser', Description: description, Amount: amount };
      headers.forEach((h, i) => {
        if (h in values) ledger.write(row, i + 1, values[h]);
      });
    };

    it('sends notifications only after releasing the script lock', () => {
      typeCredit(10, 'Bake sale');
      const lockedSends: string[] = [];
      const sendEmail = gas.mail.sendEmail.bind(gas.mail);
      gas.mail.sendEmail = (message) => {
        if (gas.lock.held) lockedSends.push(String(message.to));
        sendEmail(message);
      };
      // The push Worker carries push and (unless paused) email too: none of that under the lock either.
      const handler = gas.fetch.handler;
      gas.fetch.handler = (r) => {
        if (gas.lock.held && (r.url === `${WORKER}/send` || r.url === `${WORKER}/email`)) lockedSends.push(r.url);
        return handler(r);
      };
      try {
        const before = gas.mail.sent.length;
        g.syncTick();
        expect(gas.mail.sent.slice(before).filter((m) => m.subject === '+$10.00 for Avery')).toHaveLength(2);
        expect(lockedSends).toEqual([]);
        expect(gas.lock.held).toBe(false);
      } finally {
        gas.fetch.handler = handler;
      }
    });

    it('does not tell families their balance fell to $0 when the Ledger "Amount" header is renamed', () => {
      const ledger = gas.spreadsheet.getSheetByName('Ledger')!;
      const amountColumn = (ledger.dump()[0] as string[]).indexOf('Amount') + 1;
      ledger.write(1, amountColumn, 'Amount (USD)');
      const before = gas.mail.sent.length;
      g.syncTick();
      expect(gas.mail.sent.slice(before)).toEqual([]);
      const log = gas.spreadsheet.getSheetByName('Log')!.dump();
      expect(log.some((row) => row.some((cell) => String(cell).includes('The Ledger tab has no "Amount" column')))).toBe(true);

      ledger.write(1, amountColumn, 'Amount');
      g.syncTick();
      expect(gas.mail.sent.slice(before)).toEqual([]);
    });
  });
});
