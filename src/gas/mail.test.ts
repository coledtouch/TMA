import * as nodeCrypto from 'node:crypto';
import { SIGN_IN_EMAIL_RESERVE } from '../server/notify';
import { createApp } from '../server/app';
import { KNOWN_EMAIL_CODE_RESERVE } from '../server/auth';
import { MailReserveError, type MailMessage } from '../server/services';
import {
  createGasMailer,
  describeWorkerReason,
  EMAIL_REQUESTS_PER_FETCH_ALL,
  emailVia,
  MAX_WORKER_FAILURES_IN_A_ROW,
  readEmailAnswer,
  readEmailBatchAnswer,
  replyToAddress,
  SEND_MANY_TIME_BUDGET_MS,
  WORKER_DAILY_ALLOWANCE,
  WORKER_DOWN_PAUSE_SECONDS,
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
  return (request) => ({
    code: 200,
    body: { results: request.body.messages.map(() => (code ? { status: 'error', reason, code } : { status: 'error', reason })) },
  });
}

/** The Worker's answer when it sent every message in the request. */
function allOk(request: EmailRequest): FakeReply {
  return { code: 200, body: { results: request.body.messages.map((_, i) => ({ status: 'ok', messageId: `<m-${i}@mytma.org>` })) } };
}

const mailer = () => createGasServices().mailer;

beforeEach(() => {
  gas = installGasFakes(nodeCrypto);
  gas.properties.setProperty('PUSH_RELAY_SECRET', SECRET);
  registered = SECRET;
  emailRequests = [];
  emailReply = allOk;
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

  it('a sign-in code sent with a reserve: its Gmail fallback keeps that many, refusing with MailReserveError', () => {
    settings();
    emailReply = failWith('recipient_not_allowed', 'E_RECIPIENT_NOT_ALLOWED'); // before mytma.org is onboarded
    gas.mail.quota = 41;
    expect(mailer().remainingQuota()).toBe(WORKER_DAILY_ALLOWANCE); // all the core can see
    mailer().send({ ...CODE_EMAIL, to: 'new1@example.net' }, { reserve: 40 });
    expect(gas.mail.quota).toBe(40);
    let refused: unknown;
    try {
      mailer().send({ ...CODE_EMAIL, to: 'new2@example.net' }, { reserve: 40 });
    } catch (error) {
      refused = error;
    }
    expect(refused).toBeInstanceOf(MailReserveError);
    expect((refused as MailReserveError).remaining).toBe(40);
    expect(gas.mail.quota).toBe(40);
    // On the Gmail route too; and a code without a reserve (a known family) still goes.
    gas.cache.put(WORKER_PAUSE_CACHE_KEY, 'sender_not_verified', 600);
    expect(mailer().route().via).toBe('gmail');
    expect(() => mailer().send({ ...CODE_EMAIL, to: 'new3@example.net' }, { reserve: 40 })).toThrow(MailReserveError);
    mailer().send(CODE_EMAIL);
    expect(gas.mail.sent.map((m) => m.to)).toEqual(['new1@example.net', 'parent@example.com']);
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

describe('reasons about one recipient vs. the Worker failing', () => {
  it('a suppressed, refused or unverified recipient only sends that email with Gmail: the Worker keeps sending the rest', () => {
    settings();
    const bad = new Map([
      ['old1@example.com', ['recipient_suppressed', 'E_RECIPIENT_SUPPRESSED']],
      ['old2@example.com', ['invalid_message', 'E_VALIDATION_ERROR']],
      ['old3@example.com', ['delivery_failed', 'E_DELIVERY_FAILED']],
      ['old4@example.com', ['recipient_not_allowed', 'E_RECIPIENT_NOT_ALLOWED']],
      ['old5@example.com', ['content_too_large', 'E_CONTENT_TOO_LARGE']],
    ]);
    emailReply = (request) => ({
      code: 200,
      body: {
        results: request.body.messages.map((m) => {
          const hit = bad.get(String(m.to));
          return hit ? { status: 'error', reason: hit[0], code: hit[1] } : { status: 'ok', messageId: 'm' };
        }),
      },
    });
    const m = mailer();
    for (const to of bad.keys()) m.send({ ...CODE_EMAIL, to });
    expect(m.route().via).toBe('cloudflare');
    m.send(CODE_EMAIL);
    expect(m.lastDelivery()).toEqual({ via: 'cloudflare' });

    // The reviewer's case: a few stale addresses at the start of an announcement.
    const families = [...bad.keys(), ...Array.from({ length: 40 }, (_, i) => `family${i}@example.com`)];
    const results = m.sendMany(families.map((to) => ({ ...CODE_EMAIL, to })));
    expect(results.every((r) => r.ok)).toBe(true);
    expect(gas.mail.sent.map((x) => x.to)).toEqual([...bad.keys(), ...bad.keys()]);
    expect(m.route().via).toBe('cloudflare');
    expect(gas.cache.entries.has(WORKER_PAUSE_CACHE_KEY)).toBe(false);
  });

  it(`after ${MAX_WORKER_FAILURES_IN_A_ROW} Worker failures in a row, Gmail sends for ${WORKER_DOWN_PAUSE_SECONDS / 60} minutes, and later runs report Gmail's quota`, () => {
    settings();
    emailReply = failWith('send_failed', 'E_INTERNAL_SERVER_ERROR');
    gas.mail.quota = 80;
    const m = mailer();
    for (let i = 0; i < MAX_WORKER_FAILURES_IN_A_ROW; i += 1) m.send({ ...CODE_EMAIL, to: `p${i}@example.com` });
    expect(m.route()).toEqual({ via: 'gmail', reason: 'this_run', detail: 'send_failed' });
    expect(gas.cache.entries.get(WORKER_PAUSE_CACHE_KEY)).toMatchObject({ value: 'send_failed', ttl: WORKER_DOWN_PAUSE_SECONDS });

    const next = mailer();
    expect(next.route()).toEqual({ via: 'gmail', reason: 'paused', detail: 'send_failed' });
    expect(next.remainingQuota()).toBe(80 - MAX_WORKER_FAILURES_IN_A_ROW);
    gas.cache.nowMs += WORKER_DOWN_PAUSE_SECONDS * 1000;
    expect(mailer().route().via).toBe('cloudflare');
  });

  it('pauses for 10 minutes when the Worker has no email key, or another one', () => {
    settings();
    emailReply = () => ({ code: 503, body: { error: 'email_key_missing' } });
    const m = mailer();
    m.send(CODE_EMAIL);
    expect(m.lastDelivery()).toEqual({ via: 'gmail', workerReason: 'email_key_missing' });
    expect(gas.cache.entries.get(WORKER_PAUSE_CACHE_KEY)).toMatchObject({ value: 'email_key_missing', ttl: WORKER_PAUSE_SECONDS });

    gas.cache.entries.clear();
    emailReply = () => ({ code: 403, body: { error: 'email_key_mismatch' } });
    const other = mailer();
    other.send(CODE_EMAIL);
    expect(other.lastDelivery()).toEqual({ via: 'gmail', workerReason: 'email_key_mismatch' });
    expect(gas.cache.entries.get(WORKER_PAUSE_CACHE_KEY)).toMatchObject({ value: 'email_key_mismatch', ttl: WORKER_PAUSE_SECONDS });
    // 401 handling didn't kick in: the sheet is linked, it just isn't the one allowed to send email.
    expect(gas.fetch.requests.map((r) => r.url)).toEqual([`${WORKER}/email`, `${WORKER}/email`]);
  });
});

describe('sendMany (notification batches)', () => {
  const families = (n: number) => Array.from({ length: n }, (_, i): MailMessage => ({ ...CODE_EMAIL, to: `family${i}@example.com` }));

  it('sends 10 emails per request and the requests in parallel, each email to one family, with Reply-To', () => {
    settings();
    const m = mailer();
    expect(m.remainingQuota()).toBe(WORKER_DAILY_ALLOWANCE);
    const results = m.sendMany(families(73));
    expect(results).toHaveLength(73);
    expect(results.every((r) => r.ok)).toBe(true);
    // 8 requests: one fetchAll of 5, then one of 3.
    expect(gas.fetch.batches).toEqual([5, 3]);
    expect(emailRequests.map((r) => r.body.messages.length)).toEqual([10, 10, 10, 10, 10, 10, 10, 3]);
    expect(emailRequests.every((r) => r.auth === `Bearer ${SECRET}`)).toBe(true);
    const sent = emailRequests.flatMap((r) => r.body.messages);
    expect(sent.map((x) => x.to)).toEqual(families(73).map((x) => x.to));
    expect(sent.every((x) => x.replyTo === SUPPORT && Object.keys(x).sort().join() === 'html,replyTo,subject,text,to')).toBe(true);
    expect(gas.mail.sent).toHaveLength(0);
  });

  it('keeps each request under the Worker body cap by splitting big emails into smaller requests', () => {
    settings();
    const big = families(7).map((x) => ({ ...x, html: `<p>${'é'.repeat(30_000)}</p>` })); // ~60 KB each
    const results = mailer().sendMany(big);
    expect(results.every((r) => r.ok)).toBe(true);
    const sizes = gas.fetch.requests.map((r) => Buffer.byteLength(String(r.payload), 'utf8'));
    expect(Math.max(...sizes)).toBeLessThanOrEqual(200 * 1024);
    expect(emailRequests.map((r) => r.body.messages.length)).toEqual([3, 3, 1]);
  });

  it('on 401 links this sheet again once and retries the batch', () => {
    settings();
    registered = null;
    const results = mailer().sendMany(families(12));
    expect(results.every((r) => r.ok)).toBe(true);
    expect(gas.fetch.requests.map((r) => r.url.slice(WORKER.length))).toEqual(['/email', '/email', '/register', '/email', '/email']);
    expect(gas.mail.sent).toHaveLength(0);
  });

  it('sends a request that failed (HTTP 500, unreachable) with Gmail, and stops asking the Worker after repeated failures', () => {
    settings();
    emailReply = () => ({ code: 500, body: { error: 'internal' } });
    const m = mailer();
    expect(m.remainingQuota()).toBe(WORKER_DAILY_ALLOWANCE);
    const results = m.sendMany(families(80));
    expect(results.every((r) => r.ok)).toBe(true);
    // One fetchAll of 5 failing requests trips the breaker; the other 30 go straight to Gmail.
    expect(gas.fetch.batches).toEqual([5]);
    expect(gas.mail.sent).toHaveLength(80);
    expect(m.route()).toEqual({ via: 'gmail', reason: 'this_run', detail: 'http_error' });
    const failures = errorLogs.filter((line) => String(line[0]).includes('Worker email failed'));
    expect(failures[0][1]).toEqual({ reason: 'http_error', httpCode: 500, messages: 10 });

    gas.cache.entries.clear();
    gas.mail.sent.length = 0;
    gas.mail.quota = 100;
    gas.fetch.handler = () => {
      throw new Error(`DNS error ${WORKER}`);
    };
    expect(mailer().sendMany(families(3)).every((r) => r.ok)).toBe(true);
    expect(gas.mail.sent).toHaveLength(3);
    expect(JSON.stringify(errorLogs)).not.toContain('DNS error');
  });

  it('a 400 or 413 for a request is about its content: Gmail sends those emails, and the Worker keeps the rest', () => {
    settings();
    let n = 0;
    emailReply = (request) => (n++ < 4 ? { code: 413, body: { error: 'too_large' } } : allOk(request));
    const m = mailer();
    const results = m.sendMany(families(60));
    expect(results.every((r) => r.ok)).toBe(true);
    expect(gas.mail.sent).toHaveLength(40);
    expect(m.route().via).toBe('cloudflare');
  });

  it("its Gmail fallback never uses the day's last emails kept for sign-in codes, across runs (Worker down)", () => {
    // The reviewer's case: the Worker is unreachable, Gmail has exactly the reserve left, and
    // several small notification runs (reminder ticks, admin alerts) each plan a send.
    settings();
    gas.fetch.handler = () => {
      throw new Error('Address unavailable');
    };
    gas.mail.quota = SIGN_IN_EMAIL_RESERVE;
    let sent = 0;
    for (let run = 0; run < 5; run += 1) {
      const m = mailer();
      if (m.remainingQuota() - SIGN_IN_EMAIL_RESERVE <= 0) continue; // what deliver() does
      const [result] = m.sendMany([{ ...CODE_EMAIL, to: `family${run}@example.com` }]);
      if (result.ok) sent += 1;
      else expect(result.error).toMatch(/kept for sign-in codes/);
    }
    expect(sent).toBe(0);
    expect(gas.mail.quota).toBe(SIGN_IN_EMAIL_RESERVE);

    // A sign-in code (send()) may still use the reserve: that's what it is for.
    mailer().send(CODE_EMAIL);
    expect(gas.mail.quota).toBe(SIGN_IN_EMAIL_RESERVE - 1);
  });

  it('within one batch, Gmail stops at the reserve and says why', () => {
    settings();
    emailReply = failWith('recipient_suppressed', 'E_RECIPIENT_SUPPRESSED');
    gas.mail.quota = SIGN_IN_EMAIL_RESERVE + 2;
    const results = mailer().sendMany(families(4));
    expect(results.map((r) => r.ok)).toEqual([true, true, false, false]);
    expect(results[2]).toEqual({ ok: false, error: expect.stringMatching(/kept for sign-in codes/), quota: true });
    expect(gas.mail.quota).toBe(SIGN_IN_EMAIL_RESERVE);
  });

  it("reads Gmail's quota before each email, so another execution sending at the same time can't push it below the reserve", () => {
    // Notifications go out after the write lock is released: e.g. an announcement from the app while
    // a scheduled run sends its own notices with Gmail.
    settings([['EMAIL_VIA', 'gmail']]);
    gas.mail.quota = SIGN_IN_EMAIL_RESERVE + 4;
    const send = gas.mail.sendEmail.bind(gas.mail);
    let otherRunSent = false;
    gas.mail.sendEmail = (message) => {
      send(message);
      if (otherRunSent) return;
      otherRunSent = true;
      for (let i = 0; i < 3; i += 1) send({ ...message, to: `other-run-${i}@example.com` });
    };
    const results = mailer().sendMany(families(4));
    expect(results.map((r) => r.ok)).toEqual([true, false, false, false]);
    expect(results.slice(1).every((r) => !r.ok && r.quota)).toBe(true);
    expect(gas.mail.quota).toBe(SIGN_IN_EMAIL_RESERVE);
  });

  it('uses Gmail (with the reserve) when EMAIL_VIA is gmail or the Worker is paused, without asking the Worker', () => {
    settings([['EMAIL_VIA', 'gmail']]);
    gas.mail.quota = SIGN_IN_EMAIL_RESERVE + 3;
    const results = mailer().sendMany(families(5));
    expect(results.map((r) => r.ok)).toEqual([true, true, true, false, false]);
    expect(gas.fetch.requests).toHaveLength(0);
    expect(gas.mail.sent[0]).toMatchObject({ name: 'Timberlane Music Association', replyTo: SUPPORT });
  });

  it('reports a bad recipient as a result and still sends the others', () => {
    settings();
    const results = mailer().sendMany([{ ...CODE_EMAIL, to: 'nobody' }, CODE_EMAIL]);
    expect(results).toEqual([{ ok: false, error: 'Invalid email recipient' }, { ok: true }]);
    expect(emailRequests[0].body.messages.map((x) => x.to)).toEqual(['parent@example.com']);
  });

  it('stops starting new sends before the Apps Script time limit', () => {
    settings();
    let now = Date.parse('2026-10-21T12:00:00Z');
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    emailReply = (request) => {
      // Each round of parallel requests takes over 2 minutes.
      if (emailRequests.length % EMAIL_REQUESTS_PER_FETCH_ALL === 1) now += SEND_MANY_TIME_BUDGET_MS / 2 + 1;
      return allOk(request);
    };
    const results = mailer().sendMany(families(120));
    // Two rounds of 50 went out; the last 20 were never started.
    expect(results.filter((r) => r.ok)).toHaveLength(100);
    expect(results.slice(100).every((r) => !r.ok && /time limit/.test(r.error))).toBe(true);
    expect(JSON.stringify(errorLogs)).toContain('"notSent":20');
  });

  it('relayStatus: the Worker sender and the Gmail backup quota, or null while Gmail sends anyway', () => {
    settings();
    gas.mail.quota = 64;
    expect(mailer().relayStatus()).toEqual({ from: 'noreply@mytma.org', backupRemaining: 64 });
    gas.cache.put(WORKER_PAUSE_CACHE_KEY, 'sender_not_verified', 600);
    expect(mailer().relayStatus()).toBeNull();
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
    // About the request's content, not the Worker:
    expect(readEmailAnswer(413, '{"error":"too_large"}')).toEqual({ ok: false, reason: 'too_large', httpCode: 413 });
    expect(readEmailAnswer(400, '{"error":"bad_request"}')).toEqual({ ok: false, reason: 'bad_request', httpCode: 400 });
    // The pinned email key (workers/push EMAIL_KEY):
    expect(readEmailAnswer(503, '{"error":"email_key_missing"}')).toEqual({ ok: false, reason: 'email_key_missing', httpCode: 503 });
    expect(readEmailAnswer(403, '{"error":"email_key_mismatch"}')).toEqual({ ok: false, reason: 'email_key_mismatch', httpCode: 403 });
    expect(readEmailAnswer(403, '{"error":"other"}')).toEqual({ ok: false, reason: 'http_error', httpCode: 403 });
  });

  it('readEmailBatchAnswer wants one result per message', () => {
    const two = JSON.stringify({ results: [{ status: 'ok', messageId: 'a' }, { status: 'error', reason: 'recipient_suppressed', code: 'E_RECIPIENT_SUPPRESSED' }] });
    expect(readEmailBatchAnswer(200, two, 2)).toEqual({
      kind: 'results',
      outcomes: [
        { ok: true, messageId: 'a' },
        { ok: false, reason: 'recipient_suppressed', code: 'E_RECIPIENT_SUPPRESSED' },
      ],
    });
    expect(readEmailBatchAnswer(200, two, 3)).toEqual({ kind: 'failed', outcome: { ok: false, reason: 'bad_answer', httpCode: 200 } });
    expect(readEmailBatchAnswer(200, JSON.stringify({ results: [null, {}] }), 2)).toMatchObject({ kind: 'failed' });
    expect(readEmailBatchAnswer(502, '', 10)).toEqual({ kind: 'failed', outcome: { ok: false, reason: 'http_error', httpCode: 502 } });
  });

  it('describeWorkerReason explains the common reasons and sanitizes unknown ones', () => {
    expect(describeWorkerReason('sender_not_verified')).toContain("mytma.org isn't verified");
    expect(describeWorkerReason('not_linked')).toContain('Set up / repair tabs');
    expect(describeWorkerReason('email_key_missing')).toContain('EMAIL_KEY');
    expect(describeWorkerReason('email_key_mismatch')).toContain('TMA App → Status');
    expect(describeWorkerReason('recipient_not_allowed')).toContain('A and B');
    expect(describeWorkerReason('weird<script>')).toBe("the push Worker couldn't send it (weirdscript)");
  });

  it('createGasMailer works with any relay (e.g. one that is not configured)', () => {
    const m = createGasMailer({
      relay: { baseUrl: () => null, enabled: () => false, authorizedPost: () => ({ code: 500, text: '' }), authorizedPostAll: () => [] },
      cache: { get: () => null, put: () => undefined, remove: () => undefined },
      logger: { info: () => undefined, error: () => undefined },
      via: () => 'cloudflare',
      senderName: () => 'TMA',
      replyTo: () => SUPPORT,
    });
    expect(m.route()).toEqual({ via: 'gmail', reason: 'no_worker' });
  });
});

describe('sign-in codes through the whole app (one execution per request)', () => {
  const requestCode = (email: string): string => {
    const answer = createApp(createGasServices()).handle({ action: 'auth.requestCode', params: { email } });
    return answer.ok ? 'sent' : `${answer.error.code}: ${answer.error.message}`;
  };

  it(`keeps Gmail's last ${KNOWN_EMAIL_CODE_RESERVE} for verified families while the Worker refuses every email`, () => {
    // Before mytma.org is onboarded (or past Cloudflare's daily limit, or while the Worker fails),
    // remainingQuota() still reports the Worker's allowance and every code falls back to Gmail.
    settings();
    createApp(createGasServices()).setup({ seedSampleData: true });
    emailReply = failWith('recipient_not_allowed', 'E_RECIPIENT_NOT_ALLOWED');
    gas.mail.quota = KNOWN_EMAIL_CODE_RESERVE + 5;
    const answers = Array.from({ length: 30 }, (_, i) => requestCode(`made.up.${i}@example.net`));
    expect(answers.slice(0, 5)).toEqual(Array(5).fill('sent'));
    expect(answers.slice(5)).toEqual(Array(25).fill(expect.stringMatching(/^RATE_LIMITED: .*new sign-ups are paused/)));
    expect(gas.mail.quota).toBe(KNOWN_EMAIL_CODE_RESERVE);
    // A guardian of an Active household still gets a code, from the reserve.
    expect(requestCode('parent@example.com')).toBe('sent');
    expect(gas.mail.quota).toBe(KNOWN_EMAIL_CODE_RESERVE - 1);
  });
});
