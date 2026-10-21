import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  checkMessage,
  emailSender,
  isPlainAddress,
  isSafeSubject,
  mapEmailError,
  MAX_HTML_BYTES,
  MAX_TEXT_BYTES,
  summarizeEmailResults,
} from '../src/email';
import { resetKvCache, type EmailBinding, type OutgoingEmail } from '../src/env';
import worker from '../src/index';
import { resetVapidCache } from '../src/vapid';
import { makeEnv } from './helpers';

const BASE = 'https://tma-push.example.workers.dev';
const SECRET = 's3cret-'.repeat(6); // 42 chars
const FROM = { email: 'noreply@mytma.org', name: 'Timberlane Music Association' };
const LINE_SEPARATOR = String.fromCharCode(0x2028);

/** A stand-in for the `send_email` binding: records what it was asked to send; fails on demand. */
class FakeEmail implements EmailBinding {
  readonly sent: OutgoingEmail[] = [];
  /** Recipient → error to throw for it. */
  readonly failures = new Map<string, unknown>();

  async send(message: OutgoingEmail): Promise<{ messageId: string }> {
    this.sent.push(structuredClone(message));
    const failure = this.failures.get(message.to);
    if (failure !== undefined) throw failure;
    return { messageId: `<msg-${this.sent.length}@mytma.org>` };
  }
}

/** What the binding throws: an Error with a string code (and a message we must never pass on). */
function cloudflareError(code: string, message = 'Delivery to parent@example.com failed: "Your sign-in code: 123456"'): Error {
  return Object.assign(new Error(message), { code });
}

type Env = ReturnType<typeof makeEnv> & { EMAIL?: EmailBinding; EMAIL_FROM?: string; EMAIL_FROM_NAME?: string };

let env: Env;
let mail: FakeEmail;
let logs: string[];

function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const init: RequestInit = { method, headers: { ...headers } };
  if (body !== undefined) {
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
    (init.headers as Record<string, string>)['Content-Type'] = 'application/json';
  }
  return worker.fetch(new Request(`${BASE}${path}`, init), env);
}

function email(body: unknown, secret: string = SECRET) {
  return call('POST', '/email', body, { Authorization: `Bearer ${secret}` });
}

async function jsonOf(response: Response): Promise<Record<string, unknown>> {
  expect(response.headers.get('Content-Type')).toBe('application/json');
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  return (await response.json()) as Record<string, unknown>;
}

async function resultsOf(response: Response): Promise<Array<Record<string, unknown>>> {
  expect(response.status).toBe(200);
  return (await jsonOf(response)).results as Array<Record<string, unknown>>;
}

function message(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    to: 'parent@example.com',
    subject: 'Your TMA sign-in code: 123456',
    html: '<p>Your code is <b>123456</b></p>',
    text: 'Your code is 123456',
    replyTo: 'timberlanemusictma@gmail.com',
    ...overrides,
  };
}

beforeEach(async () => {
  resetKvCache();
  resetVapidCache();
  mail = new FakeEmail();
  env = { ...makeEnv(), EMAIL: mail, EMAIL_FROM: FROM.email, EMAIL_FROM_NAME: FROM.name };
  logs = [];
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    logs.push(args.map(String).join(' '));
  });
  const res = await call('POST', '/register', { secret: SECRET });
  expect(res.status).toBe(200);
});

describe('POST /email: access', () => {
  it('401s without the registered secret, before looking at the body, and sends nothing', async () => {
    const body = { messages: [message()] };
    expect((await email(body, 'w'.repeat(42))).status).toBe(401);
    expect((await email(body, 'short')).status).toBe(401);
    expect((await call('POST', '/email', body)).status).toBe(401);
    expect((await call('POST', '/email', body, { Authorization: SECRET })).status).toBe(401);
    expect((await call('POST', '/email', body, { Authorization: `Basic ${SECRET}` })).status).toBe(401);
    expect(await jsonOf(await email('{', 'w'.repeat(42)))).toEqual({ error: 'unauthorized' });
    expect(mail.sent).toHaveLength(0);

    expect((await email(body)).status).toBe(200);
    expect(mail.sent).toHaveLength(1);
  });

  it('401s when no secret has been registered yet', async () => {
    env.TMA_PUSH.data.clear();
    resetKvCache();
    const res = await email({ messages: [message()] });
    expect(res.status).toBe(401);
    expect(mail.sent).toHaveLength(0);
  });

  it('405s a GET', async () => {
    const res = await call('GET', '/email');
    expect(res.status).toBe(405);
    expect(res.headers.get('Allow')).toBe('POST');
  });

  it('503s when the EMAIL binding is not configured (after checking the secret)', async () => {
    delete env.EMAIL;
    expect((await email({ messages: [message()] }, 'w'.repeat(42))).status).toBe(401);
    const res = await email({ messages: [message()] });
    expect(res.status).toBe(503);
    expect(await jsonOf(res)).toEqual({ error: 'email_not_configured' });
  });
});

describe('POST /email: request shape', () => {
  it('400s malformed JSON or shape, and an empty list', async () => {
    for (const body of ['{', 'not json', '', {}, { messages: 'x' }, { messages: {} }, { messages: [] }, [], null, [message()]]) {
      const res = await email(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(await jsonOf(res)).toEqual({ error: 'bad_request' });
    }
    expect(mail.sent).toHaveLength(0);
  });

  it('413s more than 10 messages or a body over 256 KB', async () => {
    const tooMany = await email({ messages: Array.from({ length: 11 }, () => message()) });
    expect(tooMany.status).toBe(413);
    expect(await jsonOf(tooMany)).toEqual({ error: 'too_many_messages', max: 10 });

    // The cap counts UTF-8 bytes: 90,000 "€" are 270,000 bytes.
    const bulky = await email({ messages: [message({ html: '€'.repeat(90_000) })] });
    expect(bulky.status).toBe(413);
    expect(await jsonOf(bulky)).toEqual({ error: 'too_large' });
    expect(mail.sent).toHaveLength(0);

    const ten = await email({ messages: Array.from({ length: 10 }, (_, i) => message({ to: `p${i}@example.com` })) });
    expect(await resultsOf(ten)).toHaveLength(10);
    expect(mail.sent.map((m) => m.to)).toEqual(Array.from({ length: 10 }, (_, i) => `p${i}@example.com`));
  });
});

describe('POST /email: sending', () => {
  it('sends one email per message from the fixed sender, passing Reply-To and both bodies through', async () => {
    const res = await email({ messages: [message()] });
    expect(await resultsOf(res)).toEqual([{ status: 'ok', messageId: '<msg-1@mytma.org>' }]);
    expect(mail.sent).toEqual([
      {
        from: FROM,
        to: 'parent@example.com',
        subject: 'Your TMA sign-in code: 123456',
        html: '<p>Your code is <b>123456</b></p>',
        text: 'Your code is 123456',
        replyTo: 'timberlanemusictma@gmail.com',
      },
    ]);
  });

  it('never takes the sender, extra recipients or headers from the request', async () => {
    const res = await email({
      messages: [
        message({
          from: 'treasurer@example.com',
          fromName: 'Someone Else',
          name: 'Someone Else',
          cc: 'other@example.com',
          bcc: ['x@example.com'],
          headers: { 'X-Evil': '1' },
          attachments: [{ content: 'AA==', filename: 'a.txt', type: 'text/plain', disposition: 'attachment' }],
        }),
      ],
    });
    expect(await resultsOf(res)).toEqual([{ status: 'ok', messageId: '<msg-1@mytma.org>' }]);
    expect(Object.keys(mail.sent[0]!).sort()).toEqual(['from', 'html', 'replyTo', 'subject', 'text', 'to']);
    expect(mail.sent[0]!.from).toEqual(FROM);
  });

  it('uses the wrangler.toml vars, with defaults when they are missing or unusable', async () => {
    env.EMAIL_FROM = 'alerts@mytma.org';
    env.EMAIL_FROM_NAME = 'TMA Alerts';
    await email({ messages: [message()] });
    expect(mail.sent[0]!.from).toEqual({ email: 'alerts@mytma.org', name: 'TMA Alerts' });

    expect(emailSender({ TMA_PUSH: env.TMA_PUSH })).toEqual(FROM);
    expect(emailSender({ TMA_PUSH: env.TMA_PUSH, EMAIL_FROM: 'Not An Address', EMAIL_FROM_NAME: '  ' })).toEqual(FROM);
    expect(emailSender({ TMA_PUSH: env.TMA_PUSH, EMAIL_FROM_NAME: 'TMA\r\nBcc: x@example.com' }).name).toBe('TMA  Bcc: x@example.com');
  });

  it('sends html-only and text-only messages, and leaves Reply-To out when none is given', async () => {
    const res = await email({
      messages: [message({ text: undefined, replyTo: undefined }), message({ html: '', replyTo: null, to: 'b@example.com' })],
    });
    expect((await resultsOf(res)).map((r) => r.status)).toEqual(['ok', 'ok']);
    expect(mail.sent[0]).toEqual({ from: FROM, to: 'parent@example.com', subject: 'Your TMA sign-in code: 123456', html: '<p>Your code is <b>123456</b></p>' });
    expect(mail.sent[1]).toEqual({ from: FROM, to: 'b@example.com', subject: 'Your TMA sign-in code: 123456', text: 'Your code is 123456' });
  });

  it('rejects header-injection attempts in to, replyTo and subject without sending them', async () => {
    const attempts: Array<[Record<string, unknown>, string]> = [
      [message({ subject: 'Hi\r\nBcc: victim@example.com' }), 'bad_subject'],
      [message({ subject: 'Hi\nX-Header: 1' }), 'bad_subject'],
      [message({ subject: 'Hi\rthere' }), 'bad_subject'],
      [message({ subject: `Hi${LINE_SEPARATOR}there` }), 'bad_subject'],
      [message({ subject: 'Hi\u0000there' }), 'bad_subject'],
      [message({ to: 'parent@example.com\r\nBcc: victim@example.com' }), 'bad_to'],
      [message({ to: 'parent@example.com\n' }), 'bad_to'],
      [message({ to: 'Parent <parent@example.com>' }), 'bad_to'],
      [message({ to: 'parent@example.com, victim@example.com' }), 'bad_to'],
      [message({ to: 'parent@example.com;victim@example.com' }), 'bad_to'],
      [message({ to: ['parent@example.com', 'victim@example.com'] }), 'bad_to'],
      [message({ to: { email: 'parent@example.com', name: 'P' } }), 'bad_to'],
      [message({ replyTo: 'help@example.com\r\nBcc: victim@example.com' }), 'bad_reply_to'],
      [message({ replyTo: 'Help <help@example.com>' }), 'bad_reply_to'],
      [message({ replyTo: 'help@example.com,victim@example.com' }), 'bad_reply_to'],
    ];
    const res = await email({ messages: attempts.map(([m]) => m).slice(0, 10) });
    const rest = await email({ messages: attempts.map(([m]) => m).slice(10) });
    const results = [...(await resultsOf(res)), ...(await resultsOf(rest))];
    expect(results).toEqual(attempts.map(([, reason]) => ({ status: 'error', reason })));
    expect(mail.sent).toHaveLength(0);
  });

  it('checks every message on its own: valid ones still go out, in order', async () => {
    const res = await email({
      messages: [
        message({ to: 'a@example.com' }),
        'not an object',
        null,
        message({ to: 'not-an-address' }),
        message({ subject: '' }),
        message({ subject: '   ' }),
        message({ subject: 's'.repeat(301) }),
        message({ html: undefined, text: undefined }),
        message({ html: 42 }),
        message({ to: 'b@example.com', subject: 's'.repeat(300) }),
      ],
    });
    expect((await resultsOf(res)).map((r) => r.reason ?? r.status)).toEqual([
      'ok',
      'bad_message',
      'bad_message',
      'bad_to',
      'bad_subject',
      'bad_subject',
      'bad_subject',
      'no_content',
      'bad_content',
      'ok',
    ]);
    expect(mail.sent.map((m) => m.to)).toEqual(['a@example.com', 'b@example.com']);
  });

  it('limits html to 200 KB and text to 100 KB of UTF-8', async () => {
    // One request each: together they would pass the 256 KB request cap.
    const cases: Array<[Record<string, unknown>, string]> = [
      [message({ html: 'a'.repeat(MAX_HTML_BYTES) }), 'ok'],
      [message({ html: 'a'.repeat(MAX_HTML_BYTES + 1) }), 'content_too_large'],
      [message({ html: undefined, text: 'é'.repeat(MAX_TEXT_BYTES / 2) }), 'ok'],
      [message({ html: undefined, text: 'é'.repeat(MAX_TEXT_BYTES / 2 + 1) }), 'content_too_large'],
    ];
    for (const [m, expected] of cases) {
      const [result] = await resultsOf(await email({ messages: [m] }));
      expect(result!.reason ?? result!.status).toBe(expected);
    }
    expect(mail.sent).toHaveLength(2);
  });

  it('maps Cloudflare error codes, keeps order, and never passes on the error message', async () => {
    const codes: Array<[string, unknown]> = [
      ['sender@example.com', cloudflareError('E_SENDER_NOT_VERIFIED')],
      ['rate@example.com', cloudflareError('E_RATE_LIMIT_EXCEEDED')],
      ['daily@example.com', cloudflareError('E_DAILY_LIMIT_EXCEEDED')],
      ['recipient@example.com', cloudflareError('E_RECIPIENT_NOT_ALLOWED')],
      ['destination@example.com', cloudflareError('E_DESTINATION_NOT_VERIFIED')],
      ['suppressed@example.com', cloudflareError('E_RECIPIENT_SUPPRESSED')],
      ['other@example.com', cloudflareError('E_SOMETHING_NEW')],
      ['nocode@example.com', new Error('boom parent@example.com')],
      ['string@example.com', 'a thrown string'],
    ];
    for (const [to, error] of codes) mail.failures.set(to, error);
    const res = await email({ messages: [...codes.map(([to]) => message({ to })), message({ to: 'fine@example.com' })] });
    const text = await res.clone().text();
    expect(await resultsOf(res)).toEqual([
      { status: 'error', reason: 'sender_not_verified', code: 'E_SENDER_NOT_VERIFIED' },
      { status: 'error', reason: 'rate_limited', code: 'E_RATE_LIMIT_EXCEEDED' },
      { status: 'error', reason: 'rate_limited', code: 'E_DAILY_LIMIT_EXCEEDED' },
      { status: 'error', reason: 'recipient_not_allowed', code: 'E_RECIPIENT_NOT_ALLOWED' },
      { status: 'error', reason: 'recipient_not_allowed', code: 'E_DESTINATION_NOT_VERIFIED' },
      { status: 'error', reason: 'send_failed', code: 'E_RECIPIENT_SUPPRESSED' },
      { status: 'error', reason: 'send_failed', code: 'E_SOMETHING_NEW' },
      { status: 'error', reason: 'send_failed' },
      { status: 'error', reason: 'send_failed' },
      { status: 'ok', messageId: '<msg-10@mytma.org>' },
    ]);
    expect(text).not.toMatch(/Delivery|123456|boom|thrown/);
    expect(mail.sent).toHaveLength(10); // one failure doesn't stop the rest
  });

  it('logs counts and error codes only: never addresses, subjects or bodies', async () => {
    mail.failures.set('rate@example.com', cloudflareError('E_RATE_LIMIT_EXCEEDED'));
    await email({
      messages: [message(), message({ to: 'rate@example.com' }), message({ to: 'Bad <bad@example.com>' })],
    });
    delete env.EMAIL;
    await email({ messages: [message()] });
    expect(logs).toEqual(['email ok 1 error 2 rate_limited:E_RATE_LIMIT_EXCEEDED,bad_to', 'email not_configured']);
    for (const line of logs) {
      expect(line).not.toMatch(/@|123456|sign-in|<p>|timberlane/i);
    }
  });
});

describe('GET /health', () => {
  it('reports whether the EMAIL binding is configured, alongside the push fields', async () => {
    let body = await jsonOf(await call('GET', '/health'));
    expect(body).toEqual({ ok: true, name: 'tma-push', registered: true, hasKeys: false, email: true });
    delete env.EMAIL;
    body = await jsonOf(await call('GET', '/health'));
    expect(body).toEqual({ ok: true, name: 'tma-push', registered: true, hasKeys: false, email: false });
  });
});

describe('helpers', () => {
  it('isPlainAddress accepts one ordinary address only', () => {
    for (const ok of ['parent@example.com', 'first.last+tma@sub.example.org', "o'brien@example.co.uk", 'a@b.io', `${'x'.repeat(64)}@example.com`]) {
      expect(isPlainAddress(ok), ok).toBe(true);
    }
    for (const bad of [
      '',
      'parent',
      '@example.com',
      'parent@',
      'parent@example',
      'parent@@example.com',
      'a@b@example.com',
      'parent@example.123',
      'parent@-example.com',
      'parent@example..com',
      '.parent@example.com',
      'pa..rent@example.com',
      'pa rent@example.com',
      '"quoted"@example.com',
      'Parent <parent@example.com>',
      '<parent@example.com>',
      'parent@example.com ',
      'parent@example.com\r\n',
      `${'x'.repeat(65)}@example.com`,
      `a@${'b'.repeat(250)}.com`,
      42,
      null,
      undefined,
      ['parent@example.com'],
    ]) {
      expect(isPlainAddress(bad), JSON.stringify(bad)).toBe(false);
    }
  });

  it('isSafeSubject allows 1–300 characters without control characters', () => {
    expect(isSafeSubject('Your TMA sign-in code: 123456')).toBe(true);
    expect(isSafeSubject('+$50.00 for Avery – thank you ✅')).toBe(true);
    expect(isSafeSubject('x'.repeat(300))).toBe(true);
    for (const bad of ['', ' ', 'x'.repeat(301), 'a\tb', 'a\u007fb', 'a\u0085b', 42, null]) {
      expect(isSafeSubject(bad), JSON.stringify(bad)).toBe(false);
    }
  });

  it('checkMessage copies only the fields it checked', () => {
    const checked = checkMessage(message({ subject: 'Hi', replyTo: undefined }), FROM);
    expect(checked).toEqual({
      ok: true,
      email: { from: FROM, to: 'parent@example.com', subject: 'Hi', html: '<p>Your code is <b>123456</b></p>', text: 'Your code is 123456' },
    });
  });

  it('mapEmailError keeps a sanitized code and nothing else', () => {
    expect(mapEmailError(cloudflareError('E_SENDER_NOT_VERIFIED'))).toEqual({ status: 'error', reason: 'sender_not_verified', code: 'E_SENDER_NOT_VERIFIED' });
    expect(mapEmailError({ code: 'E_X\r\n<script>' })).toEqual({ status: 'error', reason: 'send_failed', code: 'E_Xscript' });
    expect(mapEmailError({ code: 42 })).toEqual({ status: 'error', reason: 'send_failed' });
    expect(mapEmailError(undefined)).toEqual({ status: 'error', reason: 'send_failed' });
  });

  it('summarizeEmailResults counts results and lists distinct codes', () => {
    expect(summarizeEmailResults([{ status: 'ok', messageId: 'x' }])).toBe('email ok 1 error 0');
    expect(
      summarizeEmailResults([
        { status: 'error', reason: 'send_failed', code: 'E_A' },
        { status: 'error', reason: 'send_failed', code: 'E_A' },
        { status: 'error', reason: 'bad_to' },
      ]),
    ).toBe('email ok 0 error 3 send_failed:E_A,bad_to');
  });
});
