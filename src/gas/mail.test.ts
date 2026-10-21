import * as nodeCrypto from 'node:crypto';
import { SIGN_IN_EMAIL_RESERVE } from '../server/notify';
import type { MailMessage } from '../server/services';
import {
  createGasMailer,
  describeWorkerReason,
  emailVia,
  MAX_WORKER_FAILURES_IN_A_ROW,
  readEmailAnswer,
  replyToAddress,
  WORKER_DAILY_ALLOWANCE,
  WORKER_PAUSE_CACHE_KEY,
  WORKER_PAUSE_SECONDS,
} from './mail';
import { createGasServices } from './services';
import { FakeSheet, installGasFakes, uninstallGasFakes, type FakeReply, type FakeRequest, type GasFakes } from './testing/fakes';

const WORKER = 'https://tma-push.coleciprari.workers.dev';
const SECRET = '9e2b'.repeat(16);
const SUPPORT = 'help@example.org';

const CODE_EMAIL: MailMessage = {
  to: 'parent@example.com',
  subject: 'Your TMA sign-in code: 123456',
  html: '<p>Your code is <b>123456</b></p>',
  text: 'Your code is 123456',
};

interface EmailRequest {
  auth: string;
  body: { messages: Array<Record<string, unknown>> };
}

let gas: GasFakes;
/** What the fake Worker answers to POST /email (default: sent). */
let emailReply: (request: EmailRequest) => FakeReply;
let emailRequests: EmailRequest[];
let registered: string | null;
let errorLogs: unknown[][];

function settings(rows: string[][] = []) {
  gas.spreadsheet.addSheet(FakeSheet.withRows('Settings', [['Key', 'Value'], ['SUPPORT_EMAIL', SUPPORT], ...rows]));
}

function workerHandler(r: FakeRequest): FakeReply {
  expect(r.muteHttpExceptions).toBe(true);
  if (r.url === `${WORKER}/register`) {
    const secret = (JSON.parse(r.payload as string) as { secret: string }).secret;
    if (registered === null) registered = secret;
    return registered === secret ? { code: 200, body: { registered: true, first: false } } : { code: 409, body: { error: 'already_registered' } };
  }
  if (r.url === `${WORKER}/email`) {
    expect(r.method).toBe('post');
    expect(r.contentType).toBe('application/json');
    if (registered === null || r.headers.Authorization !== `Bearer ${registered}`) return { code: 401, body: { error: 'unauthorized' } };
    const request: EmailRequest = { auth: r.headers.Authorization, body: JSON.parse(r.payload as string) as EmailRequest['body'] };
    emailRequests.push(request);
    return emailReply(request);
  }
  return { code: 404, body: { error: 'not_found' } };
}

function failWith(reason: string, code?: string): (request: EmailRequest) => FakeReply {
  return () => ({ code: 200, body: { results: [code ? { status: 'error', reason, code } : { status: 'error', reason }] } });
}

const mailer = () => createGasServices().mailer;

beforeEach(() => {
  gas = installGasFakes(nodeCrypto);
  gas.properties.setProperty('PUSH_RELAY_SECRET', SECRET);
  registered = SECRET;
  emailRequests = [];
  emailReply = () => ({ code: 200, body: { results: [{ status: 'ok', messageId: '<m-1@mytma.org>' }] } });
  gas.fetch.handler = workerHandler;
  errorLogs = [];
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    errorLogs.push(args);
  });
});
afterEach(() => uninstallGasFakes());

describe('through the push Worker (EMAIL_VIA = cloudflare, the default)', () => {
  it('POSTs one message to /email with the relay secret and Reply-To SUPPORT_EMAIL, and does not touch Gmail', () => {
    settings();
    const m = mailer();
    expect(m.route()).toEqual({ via: 'cloudflare', from: 'noreply@mytma.org', workerUrl: WORKER });
    expect(m.remainingQuota()).toBe(WORKER_DAILY_ALLOWANCE);
    m.send(CODE_EMAIL);

    expect(gas.fetch.requests.map((r) => `${r.method} ${r.url}`)).toEqual([`post ${WORKER}/email`]);
    expect(emailRequests).toEqual([
      {
        auth: `Bearer ${SECRET}`,
        body: {
          messages: [
            {
              to: 'parent@example.com',
              subject: 'Your TMA sign-in code: 123456',
              html: '<p>Your code is <b>123456</b></p>',
              text: 'Your code is 123456',
              replyTo: SUPPORT,
            },
          ],
        },
      },
    ]);
    // The sender is the Worker's business: Apps Script never sends a From.
    expect(Object.keys(emailRequests[0].body.messages[0]).sort()).toEqual(['html', 'replyTo', 'subject', 'text', 'to']);
    expect(gas.mail.sent).toHaveLength(0);
    expect(m.lastDelivery()).toEqual({ via: 'cloudflare' });
    expect(errorLogs).toHaveLength(0);
  });

  it('keeps the subject on one line and within the Worker limit, and uses the default Reply-To for a bad SUPPORT_EMAIL', () => {
    settings([['SUPPORT_EMAIL', 'Help Desk <help@example.org>']]);
    mailer().send({ ...CODE_EMAIL, subject: `Hi\r\nBcc: x@example.com ${'s'.repeat(400)}` });
    const sent = emailRequests[0].body.messages[0];
    expect(sent.subject).toBe(`Hi Bcc: x@example.com ${'s'.repeat(400)}`.slice(0, 300));
    expect(sent.replyTo).toBe('timberlanemusictma@gmail.com');
  });

  it('refuses a message without a recipient before any request', () => {
    expect(() => mailer().send({ ...CODE_EMAIL, to: '' })).toThrow(/recipient/);
    expect(() => mailer().send({ ...CODE_EMAIL, to: 'nobody' })).toThrow(/recipient/);
    expect(gas.fetch.requests).toHaveLength(0);
    expect(gas.mail.sent).toHaveLength(0);
  });

  it('on 401 links this sheet again (once per execution) and retries', () => {
    registered = null; // the Worker forgot this sheet
    const m = mailer();
    m.send(CODE_EMAIL);
    expect(gas.fetch.requests.map((r) => r.url)).toEqual([`${WORKER}/email`, `${WORKER}/register`, `${WORKER}/email`]);
    expect(emailRequests).toHaveLength(1);
    expect(gas.mail.sent).toHaveLength(0);
    expect(m.lastDelivery()).toEqual({ via: 'cloudflare' });
  });
});

describe('falling back to Gmail', () => {
  function expectGmail(reason: string, httpCode?: number) {
    expect(gas.mail.sent).toEqual([
      {
        to: 'parent@example.com',
        subject: 'Your TMA sign-in code: 123456',
        htmlBody: '<p>Your code is <b>123456</b></p>',
        body: 'Your code is 123456',
        name: 'Timberlane Music Association',
        replyTo: SUPPORT,
      },
    ]);
    const logged = errorLogs.find((line) => String(line[0]).includes('Worker email failed'));
    expect(logged?.[1]).toEqual(expect.objectContaining(httpCode === undefined ? { reason } : { reason, httpCode }));
  }

  it('sends that message with MailApp when the Worker reports an error for it', () => {
    settings();
    emailReply = failWith('send_failed', 'E_SOMETHING');
    const m = mailer();
    m.send(CODE_EMAIL);
    expectGmail('send_failed');
    expect(errorLogs[0][1]).toEqual({ reason: 'send_failed', code: 'E_SOMETHING' });
    expect(m.lastDelivery()).toEqual({ via: 'gmail', workerReason: 'send_failed', workerCode: 'E_SOMETHING' });
  });

  it('… on HTTP 500', () => {
    settings();
    emailReply = () => ({ code: 500, body: { error: 'internal' } });
    mailer().send(CODE_EMAIL);
    expectGmail('http_error', 500);
  });

  it('… on HTTP 503 (no Email Sending binding), and pauses the Worker route', () => {
    settings();
    emailReply = () => ({ code: 503, body: { error: 'email_not_configured' } });
    mailer().send(CODE_EMAIL);
    expectGmail('email_not_configured', 503);
    expect(gas.cache.entries.get(WORKER_PAUSE_CACHE_KEY)).toMatchObject({ value: 'email_not_configured', ttl: WORKER_PAUSE_SECONDS });
  });

  it('… on a network failure, without logging the error text', () => {
    settings();
    gas.fetch.handler = () => {
      throw new Error(`DNS error: ${WORKER}/email parent@example.com`);
    };
    const m = mailer();
    m.send(CODE_EMAIL);
    expectGmail('network');
    expect(m.lastDelivery()).toEqual({ via: 'gmail', workerReason: 'network' });
  });

  it('… on an answer it cannot read', () => {
    settings();
    emailReply = () => ({ code: 200, body: 'not json' });
    mailer().send(CODE_EMAIL);
    expectGmail('bad_answer', 200);
  });

  it('… on a 401 that linking again cannot fix (another sheet owns the Worker), and pauses', () => {
    settings();
    registered = 'c'.repeat(64);
    mailer().send(CODE_EMAIL);
    expect(gas.fetch.requests.map((r) => r.url)).toEqual([`${WORKER}/email`, `${WORKER}/register`]);
    expectGmail('unauthorized', 401);
    expect(gas.cache.entries.get(WORKER_PAUSE_CACHE_KEY)?.value).toBe('unauthorized');
  });

  it('caches sender_not_verified for 10 minutes so later emails skip the Worker', () => {
    settings();
    emailReply = failWith('sender_not_verified', 'E_SENDER_NOT_VERIFIED');
    const first = mailer();
    first.send(CODE_EMAIL);
    expect(gas.cache.entries.get(WORKER_PAUSE_CACHE_KEY)).toMatchObject({ value: 'sender_not_verified', ttl: 600 });
    expect(first.lastDelivery()).toEqual({ via: 'gmail', workerReason: 'sender_not_verified', workerCode: 'E_SENDER_NOT_VERIFIED' });

    // Same execution, then a new one (a new web request): no request to the Worker.
    first.send(CODE_EMAIL);
    const next = mailer();
    expect(next.route()).toEqual({ via: 'gmail', reason: 'paused', detail: 'sender_not_verified' });
    gas.mail.quota = 42;
    expect(next.remainingQuota()).toBe(42); // Gmail's quota while paused
    next.send(CODE_EMAIL);
    expect(next.lastDelivery()).toEqual({ via: 'gmail', workerReason: 'sender_not_verified' });
    expect(emailRequests).toHaveLength(1);
    expect(gas.mail.sent).toHaveLength(3);

    // Ten minutes later the Worker is tried again.
    gas.cache.nowMs += WORKER_PAUSE_SECONDS * 1000;
    emailReply = () => ({ code: 200, body: { results: [{ status: 'ok', messageId: 'm' }] } });
    const later = mailer();
    expect(later.route().via).toBe('cloudflare');
    later.send(CODE_EMAIL);
    expect(emailRequests).toHaveLength(2);
    expect(gas.mail.sent).toHaveLength(3);
  });

  it('after rate_limited, uses Gmail (and its quota) for the rest of the execution', () => {
    settings();
    emailReply = failWith('rate_limited', 'E_RATE_LIMIT_EXCEEDED');
    gas.mail.quota = 80;
    const m = mailer();
    expect(m.remainingQuota()).toBe(WORKER_DAILY_ALLOWANCE);
    m.send(CODE_EMAIL);
    expect(m.route()).toEqual({ via: 'gmail', reason: 'this_run', detail: 'rate_limited' });
    expect(m.remainingQuota()).toBe(79);
    m.send({ ...CODE_EMAIL, to: 'other@example.com' });
    expect(emailRequests).toHaveLength(1);
    expect(gas.mail.sent.map((x) => x.to)).toEqual(['parent@example.com', 'other@example.com']);
    // Not cached: the next execution tries the Worker again.
    expect(gas.cache.entries.has(WORKER_PAUSE_CACHE_KEY)).toBe(false);
    expect(mailer().route().via).toBe('cloudflare');
  });

  it(`stops trying the Worker after ${MAX_WORKER_FAILURES_IN_A_ROW} failures in a row in one execution`, () => {
    settings();
    let n = 0;
    emailReply = () => (n++ === 1 ? { code: 200, body: { results: [{ status: 'ok', messageId: 'm' }] } } : { code: 502, body: {} });
    const m = mailer();
    for (let i = 0; i < 6; i += 1) m.send({ ...CODE_EMAIL, to: `p${i}@example.com` });
    // fail, ok (resets the count), fail, fail, fail → Gmail for the rest.
    expect(emailRequests).toHaveLength(5);
    expect(gas.mail.sent.map((x) => x.to)).toEqual(['p0@example.com', 'p2@example.com', 'p3@example.com', 'p4@example.com', 'p5@example.com']);
    expect(m.route()).toEqual({ via: 'gmail', reason: 'this_run', detail: 'http_error' });
  });

  it('does not count problems with one message (e.g. an address the Worker refuses) as Worker failures', () => {
    settings();
    emailReply = failWith('bad_to');
    const m = mailer();
    for (let i = 0; i < MAX_WORKER_FAILURES_IN_A_ROW + 1; i += 1) m.send({ ...CODE_EMAIL, to: `p${i}@example.com` });
    expect(emailRequests).toHaveLength(MAX_WORKER_FAILURES_IN_A_ROW + 1);
    expect(gas.mail.sent).toHaveLength(MAX_WORKER_FAILURES_IN_A_ROW + 1);
    expect(m.route().via).toBe('cloudflare');
  });

  it('forgets the last delivery when a send fails', () => {
    settings([['EMAIL_VIA', 'gmail']]);
    const m = mailer();
    m.send(CODE_EMAIL);
    expect(m.lastDelivery()).toEqual({ via: 'gmail' });
    vi.spyOn(MailApp, 'sendEmail').mockImplementation(() => {
      throw new Error('quota');
    });
    expect(() => m.send(CODE_EMAIL)).toThrow('quota');
    expect(m.lastDelivery()).toBeNull();
  });

  it("keeps Gmail's last emails for sign-in codes when the core counted on the Worker's allowance", () => {
    settings();
    emailReply = () => ({ code: 502, body: {} });
    gas.mail.quota = SIGN_IN_EMAIL_RESERVE + 1;
    const m = mailer();
    expect(m.remainingQuota()).toBe(WORKER_DAILY_ALLOWANCE); // e.g. notify read this once for a batch
    m.send({ ...CODE_EMAIL, to: 'a@example.com' }); // the first fallback always goes (it may be a sign-in code)
    expect(gas.mail.quota).toBe(SIGN_IN_EMAIL_RESERVE);
    expect(() => m.send({ ...CODE_EMAIL, to: 'b@example.com' })).toThrow(/kept for sign-in codes/);
    expect(gas.mail.sent.map((x) => x.to)).toEqual(['a@example.com']);
  });

  it('a lone sign-in code still goes out with Gmail even when the quota is nearly used up', () => {
    settings();
    emailReply = failWith('send_failed');
    gas.mail.quota = 1;
    const m = mailer();
    expect(m.remainingQuota()).toBeGreaterThan(0); // what auth.requestCode checks
    m.send(CODE_EMAIL);
    expect(gas.mail.sent).toHaveLength(1);
  });

  it('logs reason codes only: never addresses, subjects or bodies', () => {
    settings();
    emailReply = failWith('recipient_not_allowed', 'E_RECIPIENT_NOT_ALLOWED');
    mailer().send(CODE_EMAIL);
    const logged = JSON.stringify(errorLogs);
    expect(logged).toContain('recipient_not_allowed');
    expect(logged).not.toMatch(/parent@example\.com|123456|sign-in|help@example/);
  });
});

describe('Gmail without the Worker', () => {
  it('EMAIL_VIA = gmail sends with MailApp, reports its quota and never calls the Worker', () => {
    settings([['EMAIL_VIA', ' Gmail ']]);
    gas.mail.quota = 57;
    const m = mailer();
    expect(m.route()).toEqual({ via: 'gmail', reason: 'setting' });
    expect(m.remainingQuota()).toBe(57);
    m.send(CODE_EMAIL);
    expect(gas.fetch.requests).toHaveLength(0);
    expect(gas.mail.sent).toEqual([
      {
        to: 'parent@example.com',
        subject: 'Your TMA sign-in code: 123456',
        htmlBody: '<p>Your code is <b>123456</b></p>',
        body: 'Your code is 123456',
        name: 'Timberlane Music Association',
        replyTo: SUPPORT,
      },
    ]);
    expect(m.lastDelivery()).toEqual({ via: 'gmail' });
    expect(m.gmailQuota()).toBe(56);
  });

  it('uses Gmail when the sheet is not linked to the Worker, or push is switched off', () => {
    gas.properties.setProperty('PUSH_RELAY_SECRET', '');
    settings();
    let m = mailer();
    expect(m.route()).toEqual({ via: 'gmail', reason: 'not_linked' });
    m.send(CODE_EMAIL);
    expect(m.lastDelivery()).toEqual({ via: 'gmail', workerReason: 'not_linked' });

    gas.properties.setProperty('PUSH_RELAY_SECRET', SECRET);
    gas.spreadsheet.sheets.length = 0;
    settings([['PUSH_RELAY_URL', 'off']]);
    m = mailer();
    expect(m.route()).toEqual({ via: 'gmail', reason: 'no_worker' });
    m.send(CODE_EMAIL);
    expect(gas.fetch.requests).toHaveLength(0);
    expect(gas.mail.sent).toHaveLength(2);
  });

  it('uses the org name from Settings as the Gmail sender name, on one line', () => {
    settings([['EMAIL_VIA', 'gmail'], ['ORG_NAME', 'TMA\nBoosters']]);
    mailer().send(CODE_EMAIL);
    expect(gas.mail.sent[0].name).toBe('TMA Boosters');
  });
});

describe('helpers', () => {
  it('emailVia: only "gmail" forces Gmail', () => {
    expect(emailVia('gmail')).toBe('gmail');
    expect(emailVia(' GMAIL ')).toBe('gmail');
    for (const v of ['cloudflare', '', 'Cloudflare', 'mailapp', 'off']) expect(emailVia(v), v).toBe('cloudflare');
  });

  it('replyToAddress keeps one plain address and falls back to the default', () => {
    expect(replyToAddress(' Help@Example.org ')).toBe('help@example.org');
    for (const bad of ['', 'nope', 'a@b', 'Help <help@example.org>', 'a@example.org, b@example.org', 'a@example.org\r\nBcc: x@example.org']) {
      expect(replyToAddress(bad), bad).toBe('timberlanemusictma@gmail.com');
    }
  });

  it('readEmailAnswer maps the Worker answer', () => {
    const ok = JSON.stringify({ results: [{ status: 'ok', messageId: 'm-1' }] });
    expect(readEmailAnswer(200, ok)).toEqual({ ok: true, messageId: 'm-1' });
    expect(readEmailAnswer(200, JSON.stringify({ results: [{ status: 'error', reason: 'rate_limited', code: 'E_RATE_LIMIT_EXCEEDED' }] }))).toEqual({
      ok: false,
      reason: 'rate_limited',
      code: 'E_RATE_LIMIT_EXCEEDED',
    });
    expect(readEmailAnswer(200, JSON.stringify({ results: [{ status: 'error', reason: '<b>x</b>' }] }))).toEqual({ ok: false, reason: 'bxb' });
    expect(readEmailAnswer(200, JSON.stringify({ results: [{ status: 'error' }] }))).toEqual({ ok: false, reason: 'send_failed' });
    expect(readEmailAnswer(200, JSON.stringify({ results: [] }))).toEqual({ ok: false, reason: 'bad_answer', httpCode: 200 });
    expect(readEmailAnswer(401, '')).toEqual({ ok: false, reason: 'unauthorized', httpCode: 401 });
    expect(readEmailAnswer(404, '')).toEqual({ ok: false, reason: 'no_email_endpoint', httpCode: 404 });
    expect(readEmailAnswer(503, '{"error":"email_not_configured"}')).toEqual({ ok: false, reason: 'email_not_configured', httpCode: 503 });
    expect(readEmailAnswer(503, '{"error":"other"}')).toEqual({ ok: false, reason: 'http_error', httpCode: 503 });
    expect(readEmailAnswer(413, '')).toEqual({ ok: false, reason: 'http_error', httpCode: 413 });
  });

  it('describeWorkerReason explains the common reasons and sanitizes unknown ones', () => {
    expect(describeWorkerReason('sender_not_verified')).toContain("mytma.org isn't verified");
    expect(describeWorkerReason('not_linked')).toContain('Set up / repair tabs');
    expect(describeWorkerReason('weird<script>')).toBe("the push Worker couldn't send it (weirdscript)");
  });

  it('createGasMailer works with any relay (e.g. one that is not configured)', () => {
    const m = createGasMailer({
      relay: { baseUrl: () => null, enabled: () => false, authorizedPost: () => ({ code: 500, text: '' }) },
      cache: { get: () => null, put: () => undefined, remove: () => undefined },
      logger: { info: () => undefined, error: () => undefined },
      via: () => 'cloudflare',
      senderName: () => 'TMA',
      replyTo: () => SUPPORT,
    });
    expect(m.route()).toEqual({ via: 'gmail', reason: 'no_worker' });
  });
});
