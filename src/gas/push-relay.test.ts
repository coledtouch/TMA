import * as nodeCrypto from 'node:crypto';
import { storedToken, testSubscription } from '../server/test-helpers';
import type { Logger, PushResult } from '../server/services';
import type { PushMessage } from '../shared/types';
import {
  ALREADY_REGISTERED_MESSAGE,
  buildPayload,
  createPushRelaySender,
  MAX_PAYLOAD_BYTES,
  normalizeRelayUrl,
  pushTopic,
  pushUrgency,
  readSendResponse,
  utf8Length,
} from './push-relay';
import { createScriptCache, createScriptSecrets } from './services';
import { installGasFakes, uninstallGasFakes, type FakeReply, type FakeRequest, type GasFakes } from './testing/fakes';

const BASE = 'https://tma-push.example.workers.dev';
const SECRET = '3f9a'.repeat(16);
const VAPID_KEY = Buffer.from([0x04, ...nodeCrypto.randomBytes(64)]).toString('base64url');

const MESSAGE: PushMessage = {
  title: '+$50.00 for Avery',
  body: "$50.00 was added to Avery's TMA activity funds. New balance: $325.00.",
  url: '#/funds',
  tag: 'bal-S0001',
  topic: 'balance',
};

interface SentMessage {
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } };
  payload: string;
  ttl: number;
  urgency: string;
  topic?: string;
}

/** An in-memory stand-in for the live Worker's API (workers/push/src/index.ts). */
class FakeWorker {
  registered: string | null = SECRET;
  hasKeys = true;
  /** Per-message status by endpoint (default ok). */
  statusFor: (endpoint: string) => { status: string; reason?: string } = () => ({ status: 'ok' });
  /** Force an HTTP status for /send. */
  sendHttp: number | null = null;
  readonly sends: SentMessage[][] = [];
  readonly paths: string[] = [];

  handle(r: FakeRequest): FakeReply {
    expect(r.url.startsWith(`${BASE}/`)).toBe(true);
    expect(r.muteHttpExceptions).toBe(true);
    const path = r.url.slice(BASE.length);
    this.paths.push(`${r.method.toUpperCase()} ${path}`);
    if (path === '/health') {
      return { code: 200, body: { ok: true, name: 'tma-push', registered: this.registered !== null, hasKeys: this.hasKeys } };
    }
    if (path === '/vapid-public-key') {
      this.hasKeys = true;
      return { code: 200, body: { publicKey: VAPID_KEY } };
    }
    if (path === '/register') {
      expect(r.method).toBe('post');
      const secret = (JSON.parse(r.payload as string) as { secret: string }).secret;
      if (this.registered === null) {
        this.registered = secret;
        return { code: 200, body: { registered: true, first: true } };
      }
      return this.registered === secret ? { code: 200, body: { registered: true, first: false } } : { code: 409, body: { error: 'already_registered' } };
    }
    if (path === '/send') {
      expect(r.method).toBe('post');
      expect(r.contentType).toBe('application/json');
      if (this.sendHttp !== null) return { code: this.sendHttp, body: { error: this.sendHttp === 503 ? 'no_keys' : 'oops' } };
      if (this.registered === null || r.headers.Authorization !== `Bearer ${this.registered}`) {
        return { code: 401, body: { error: 'unauthorized' } };
      }
      const { messages } = JSON.parse(r.payload as string) as { messages: SentMessage[] };
      if (messages.length > 10) return { code: 413, body: { error: 'too_many_messages', max: 10 } };
      this.sends.push(messages);
      if (!this.hasKeys) return { code: 200, body: { results: messages.map(() => ({ status: 'error', reason: 'no_keys' })) } };
      return { code: 200, body: { results: messages.map((m) => this.statusFor(m.subscription.endpoint)) } };
    }
    return { code: 404, body: { error: 'not_found' } };
  }
}

let gas: GasFakes;
let worker: FakeWorker;
let logger: Logger & { lines: unknown[][] };
let relayUrl: string;

function sender() {
  return createPushRelaySender({ secrets: createScriptSecrets(), cache: createScriptCache(), logger, relayUrl: () => relayUrl });
}

function tokens(n: number, prefix = 'd'): string[] {
  return Array.from({ length: n }, (_, i) => storedToken(testSubscription(`${prefix}${i}`)));
}

beforeEach(() => {
  gas = installGasFakes(nodeCrypto);
  gas.properties.setProperty('PUSH_RELAY_SECRET', SECRET);
  relayUrl = BASE;
  worker = new FakeWorker();
  gas.fetch.handler = (r) => worker.handle(r);
  const lines: unknown[][] = [];
  logger = { lines, info: (...a: unknown[]) => lines.push(['info', ...a]), error: (...a: unknown[]) => lines.push(['error', ...a]) };
});
afterEach(() => uninstallGasFakes());

describe('helpers', () => {
  it('normalizeRelayUrl keeps https addresses (without trailing slashes) and refuses the rest', () => {
    expect(normalizeRelayUrl(' https://tma-push.coleciprari.workers.dev/ ')).toBe('https://tma-push.coleciprari.workers.dev');
    expect(normalizeRelayUrl('https://push.example.org/tma//')).toBe('https://push.example.org/tma');
    for (const bad of ['', 'off', 'http://tma-push.example.workers.dev', 'https://', 'https://a b.example', 'https://x.example/?q=1', 'javascript:alert(1)']) {
      expect(normalizeRelayUrl(bad), bad).toBeNull();
    }
  });

  it('pushTopic sanitizes the tag to [A-Za-z0-9_-]{1,32}', () => {
    expect(pushTopic('bal-S0001')).toBe('bal-S0001');
    expect(pushTopic('ann:A 12/ok')).toBe('ann-A-12-ok');
    expect(pushTopic('payreview-' + 'X'.repeat(40))).toHaveLength(32);
    expect(pushTopic('***')).toBeUndefined();
    expect(pushTopic(undefined)).toBeUndefined();
  });

  it('pushUrgency is normal for reminders and announcements, high otherwise', () => {
    expect(pushUrgency('reminders')).toBe('normal');
    expect(pushUrgency('announcements')).toBe('normal');
    for (const topic of ['balance', 'payments', 'admin', 'test'] as const) expect(pushUrgency(topic)).toBe('high');
  });

  it('utf8Length counts like TextEncoder', () => {
    for (const text of ['', 'abc', 'é', '€', '😀', 'a😀b€', '\ud800', 'x\udc00y']) {
      expect(utf8Length(text), text).toBe(new TextEncoder().encode(text).length);
    }
  });

  it('buildPayload is the service worker JSON and keeps short messages whole', () => {
    expect(JSON.parse(buildPayload(MESSAGE))).toEqual(MESSAGE);
    expect(JSON.parse(buildPayload({ title: 'T', body: 'B', topic: 'test' }))).toEqual({ title: 'T', body: 'B', topic: 'test' });
  });

  it('buildPayload shortens a long body to fit 3000 bytes of UTF-8, never splitting a character', () => {
    const body = '😀é€ '.repeat(1000);
    const payload = buildPayload({ ...MESSAGE, body });
    expect(utf8Length(payload)).toBeLessThanOrEqual(MAX_PAYLOAD_BYTES);
    expect(utf8Length(payload)).toBeGreaterThan(MAX_PAYLOAD_BYTES - 10);
    const parsed = JSON.parse(payload) as PushMessage;
    expect(parsed.title).toBe(MESSAGE.title);
    expect(parsed.body.endsWith('…')).toBe(true);
    expect(body.startsWith(parsed.body.slice(0, -1))).toBe(true);
    expect(parsed.body).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])/);
  });

  it('buildPayload fits even when every field is worst-case escaped', () => {
    const nasty = '\u0001'.repeat(5000);
    const payload = buildPayload({ title: nasty, body: nasty, url: nasty, tag: nasty, topic: 'test' });
    expect(utf8Length(payload)).toBeLessThanOrEqual(MAX_PAYLOAD_BYTES);
    expect(() => JSON.parse(payload)).not.toThrow();
  });

  it('readSendResponse maps the Worker answers', () => {
    const ok = JSON.stringify({ results: [{ status: 'ok', code: 201 }, { status: 'invalid', reason: 'gone' }, { status: 'error', reason: 'rate_limited' }, {}] });
    expect(readSendResponse(200, ok, 4)).toEqual({ kind: 'results', results: ['ok', 'invalid', 'error', 'error'], reasons: ['', 'gone', 'rate_limited', ''] });
    expect(readSendResponse(200, ok, 3)).toEqual({ kind: 'failed', httpCode: 200 }); // wrong length
    expect(readSendResponse(200, 'not json', 1)).toEqual({ kind: 'failed', httpCode: 200 });
    expect(readSendResponse(401, '{"error":"unauthorized"}', 1)).toEqual({ kind: 'unauthorized' });
    expect(readSendResponse(503, '{"error":"no_keys"}', 1)).toEqual({ kind: 'no_keys' });
    expect(readSendResponse(200, JSON.stringify({ results: [{ status: 'error', reason: 'no_keys' }] }), 1)).toEqual({ kind: 'no_keys' });
    expect(readSendResponse(503, '{}', 1)).toEqual({ kind: 'failed', httpCode: 503 });
    expect(readSendResponse(413, '{}', 1)).toEqual({ kind: 'failed', httpCode: 413 });
  });
});

describe('enabled / publicKey', () => {
  it('is enabled with an https PUSH_RELAY_URL and a usable PUSH_RELAY_SECRET', () => {
    expect(sender().enabled()).toBe(true);
    relayUrl = 'http://insecure.example';
    expect(sender().enabled()).toBe(false);
    relayUrl = BASE;
    gas.properties.setProperty('PUSH_RELAY_SECRET', 'too-short');
    expect(sender().enabled()).toBe(false);
    gas.properties.setProperty('PUSH_RELAY_SECRET', '  ');
    expect(sender().enabled()).toBe(false);
  });

  it('uses the saved PUSH_PUBLIC_KEY without asking the Worker', () => {
    gas.properties.setProperty('PUSH_PUBLIC_KEY', VAPID_KEY);
    expect(sender().publicKey()).toBe(VAPID_KEY);
    expect(gas.fetch.requests).toHaveLength(0);
  });

  it('otherwise fetches it once, validates it and saves it', () => {
    const s = sender();
    expect(s.publicKey()).toBe(VAPID_KEY);
    expect(s.publicKey()).toBe(VAPID_KEY);
    expect(worker.paths).toEqual(['GET /vapid-public-key']);
    expect(gas.properties.getProperty('PUSH_PUBLIC_KEY')).toBe(VAPID_KEY);
    // A later execution reads the Script Property.
    expect(sender().publicKey()).toBe(VAPID_KEY);
    expect(worker.paths).toHaveLength(1);
  });

  it('replaces a corrupted saved key', () => {
    gas.properties.setProperty('PUSH_PUBLIC_KEY', 'garbage');
    expect(sender().publicKey()).toBe(VAPID_KEY);
    expect(gas.properties.getProperty('PUSH_PUBLIC_KEY')).toBe(VAPID_KEY);
  });

  it('returns "" for a bad key or an unreachable Worker, and waits before asking again', () => {
    gas.fetch.handler = () => ({ code: 200, body: { publicKey: Buffer.from([4, 1, 2]).toString('base64url') } });
    expect(sender().publicKey()).toBe('');
    expect(gas.properties.getProperty('PUSH_PUBLIC_KEY')).toBeNull();
    expect(sender().publicKey()).toBe(''); // negative-cached: no second request
    expect(gas.fetch.requests).toHaveLength(1);
    expect(logger.lines.some(([level, msg]) => level === 'error' && /public key/.test(String(msg)))).toBe(true);

    gas.cache.nowMs += 301_000;
    gas.fetch.handler = () => {
      throw new Error('Address unavailable: https://tma-push.example.workers.dev/vapid-public-key');
    };
    expect(sender().publicKey()).toBe('');
    gas.cache.nowMs += 301_000;
    gas.fetch.handler = (r) => worker.handle(r);
    expect(sender().publicKey()).toBe(VAPID_KEY);
  });

  it('returns "" without a valid relay URL', () => {
    relayUrl = 'off';
    expect(sender().publicKey()).toBe('');
    expect(gas.fetch.requests).toHaveLength(0);
  });
});

describe('send', () => {
  it('posts 5 messages per request, all requests in one fetchAll, with the bearer secret', () => {
    const list = tokens(12);
    const results = sender().send(list, MESSAGE);
    expect(results).toEqual(new Array(12).fill('ok'));
    expect(gas.fetch.batches).toEqual([3]);
    expect(worker.sends.map((m) => m.length)).toEqual([5, 5, 2]);
    const request = gas.fetch.requests[0];
    expect(request).toMatchObject({ url: `${BASE}/send`, method: 'post', contentType: 'application/json', muteHttpExceptions: true });
    expect(request.headers).toEqual({ Authorization: `Bearer ${SECRET}` });
    const first = worker.sends[0][0];
    expect(first).toEqual({
      subscription: JSON.parse(list[0]),
      payload: JSON.stringify(MESSAGE),
      ttl: 86400,
      urgency: 'high',
      topic: 'bal-S0001',
    });
    expect(worker.sends.flat().map((m) => JSON.stringify(m.subscription))).toEqual(list);
  });

  it('uses normal urgency for announcements and omits Topic without a tag', () => {
    sender().send(tokens(1), { title: 'News', body: 'Hi', url: '#/news', topic: 'announcements' });
    expect(worker.sends[0][0].urgency).toBe('normal');
    expect('topic' in worker.sends[0][0]).toBe(false);
  });

  it('sends a raw browser subscription JSON in canonical form', () => {
    const sub = testSubscription('raw');
    sender().send([JSON.stringify(sub)], MESSAGE);
    expect(worker.sends[0][0].subscription).toEqual({ endpoint: sub.endpoint, keys: sub.keys });
  });

  it('maps results 1:1 and marks unusable tokens invalid without sending them', () => {
    const live = tokens(3);
    worker.statusFor = (endpoint) =>
      endpoint.includes('device-d1') ? { status: 'invalid', reason: 'gone' } : endpoint.includes('device-d2') ? { status: 'error', reason: 'rate_limited' } : { status: 'ok' };
    const list = ['demo-device-parent', live[0], 'not json', live[1], '{"endpoint":"https://evil.example/x","keys":{}}', live[2]];
    expect(sender().send(list, MESSAGE)).toEqual<PushResult[]>(['invalid', 'ok', 'invalid', 'invalid', 'invalid', 'error']);
    expect(worker.sends.flat()).toHaveLength(3);
    const logged = JSON.stringify(logger.lines);
    expect(logged).toContain('rate_limited');
    expect(logged).not.toContain('device-d');
    expect(logged).not.toContain(SECRET);
  });

  it('does nothing for no tokens, or when push is not configured', () => {
    expect(sender().send([], MESSAGE)).toEqual([]);
    gas.properties.setProperty('PUSH_RELAY_SECRET', '');
    expect(sender().send(tokens(2), MESSAGE)).toEqual(['error', 'error']);
    expect(gas.fetch.requests).toHaveLength(0);
  });

  it('marks a chunk error when the Worker fails, keeping the others', () => {
    let calls = 0;
    gas.fetch.handler = (r) => (++calls === 2 ? { code: 500, body: { error: 'internal' } } : worker.handle(r));
    const results = sender().send(tokens(11), MESSAGE);
    expect(results).toEqual([...new Array(5).fill('ok'), ...new Array(5).fill('error'), 'ok']);
    expect(logger.lines.find(([level]) => level === 'error')?.[2]).toMatchObject({ failed: 5, total: 11, httpCodes: ['500'] });
  });

  it('answers error for everything when the Worker cannot be reached', () => {
    gas.fetch.handler = () => {
      throw new Error('DNS error: https://tma-push.example.workers.dev/send');
    };
    expect(sender().send(tokens(7), MESSAGE)).toEqual(new Array(7).fill('error'));
    expect(JSON.stringify(logger.lines)).not.toContain(SECRET);
  });

  it('splits more than 20 requests over several fetchAll calls', () => {
    expect(sender().send(tokens(103), MESSAGE).every((r) => r === 'ok')).toBe(true);
    expect(gas.fetch.batches).toEqual([20, 1]);
    expect(worker.sends.every((m) => m.length <= 5)).toBe(true);
  });

  it('on 401 links the sheet again once per execution, then retries those chunks', () => {
    worker.registered = null; // the Worker's KV was wiped
    const s = sender();
    expect(s.send(tokens(7), MESSAGE)).toEqual(new Array(7).fill('ok'));
    expect(worker.registered).toBe(SECRET);
    expect(worker.paths).toEqual(['POST /send', 'POST /send', 'POST /register', 'POST /send', 'POST /send']);

    // Rejected again in the same execution: no second registration.
    worker.registered = 'someone-else'.repeat(4);
    expect(s.send(tokens(2), MESSAGE)).toEqual(['error', 'error']);
    expect(worker.paths.filter((p) => p === 'POST /register')).toHaveLength(1);
  });

  it('on 401 with a Worker linked to another secret, reports the rotation hint and gives up', () => {
    worker.registered = 'b'.repeat(64);
    expect(sender().send(tokens(2), MESSAGE)).toEqual(['error', 'error']);
    const logged = JSON.stringify(logger.lines);
    expect(logged).toContain(ALREADY_REGISTERED_MESSAGE);
    expect(logged).not.toContain(SECRET);
    expect(worker.paths).toEqual(['POST /send', 'POST /register']);
  });

  it('on no_keys asks for the public key (creating the key pair), saves it and retries once', () => {
    worker.hasKeys = false;
    const results = sender().send(tokens(6), MESSAGE);
    expect(results).toEqual(new Array(6).fill('ok'));
    expect(worker.paths).toEqual(['POST /send', 'POST /send', 'GET /vapid-public-key', 'POST /send', 'POST /send']);
    expect(gas.properties.getProperty('PUSH_PUBLIC_KEY')).toBe(VAPID_KEY);
  });

  it('also handles an HTTP 503 no_keys answer, and never deletes subscriptions for it', () => {
    worker.sendHttp = 503;
    const s = sender();
    expect(s.send(tokens(2), MESSAGE)).toEqual(['error', 'error']);
    expect(worker.paths).toEqual(['POST /send', 'GET /vapid-public-key', 'POST /send']);
    // Once per execution.
    expect(s.send(tokens(1), MESSAGE)).toEqual(['error']);
    expect(worker.paths.filter((p) => p === 'GET /vapid-public-key')).toHaveLength(1);
  });
});

describe('register / health', () => {
  it('registers the secret (first or again) and explains a conflict', () => {
    worker.registered = null;
    const s = sender();
    expect(s.register()).toEqual({ first: true });
    expect(JSON.parse(gas.fetch.requests[0].payload as string)).toEqual({ secret: SECRET });
    expect(s.register()).toEqual({ first: false });
    worker.registered = 'c'.repeat(64);
    expect(() => s.register()).toThrow(ALREADY_REGISTERED_MESSAGE);
  });

  it('throws clear errors for a missing secret, a bad URL, HTTP errors and network failures', () => {
    gas.properties.setProperty('PUSH_RELAY_SECRET', '');
    expect(() => sender().register()).toThrow(/PUSH_RELAY_SECRET is missing/);
    gas.properties.setProperty('PUSH_RELAY_SECRET', SECRET);
    relayUrl = 'nope';
    expect(() => sender().register()).toThrow(/PUSH_RELAY_URL/);
    relayUrl = BASE;
    gas.fetch.handler = () => ({ code: 500, body: { error: 'internal' } });
    expect(() => sender().register()).toThrow(/HTTP 500/);
    gas.fetch.handler = () => {
      throw new Error(`Timeout while sending ${SECRET}`);
    };
    let message = '';
    try {
      sender().register();
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/Could not reach the push Worker/);
    expect(message).not.toContain(SECRET);
  });

  it('health reports the Worker state, or why it is unreachable', () => {
    expect(sender().health()).toEqual({ reachable: true, registered: true, hasKeys: true });
    worker.registered = null;
    worker.hasKeys = false;
    expect(sender().health()).toEqual({ reachable: true, registered: false, hasKeys: false });
    gas.fetch.handler = () => ({ code: 522, body: 'origin down' });
    expect(sender().health()).toMatchObject({ reachable: false, httpCode: 522 });
    gas.fetch.handler = () => {
      throw new Error('Address unavailable');
    };
    expect(sender().health()).toMatchObject({ reachable: false, error: 'Address unavailable' });
    relayUrl = '';
    expect(sender().health()).toMatchObject({ reachable: false, error: expect.stringContaining('PUSH_RELAY_URL') });
  });
});
