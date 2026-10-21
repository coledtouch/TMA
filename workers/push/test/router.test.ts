import { beforeEach, describe, expect, it, vi } from 'vitest';
import { b64urlEncode, sha256Hex } from '../src/b64';
import { resetKvCache } from '../src/env';
import worker from '../src/index';
import { resetVapidCache } from '../src/vapid';
import { b64, bodyBytes, decryptAsUserAgent, makeEnv, makeUserAgent, type FakeUserAgent } from './helpers';

const BASE = 'https://tma-push.example.workers.dev';
const SECRET = 's3cret-'.repeat(6); // 42 chars
const FCM = 'https://fcm.googleapis.com/fcm/send/';

type Env = ReturnType<typeof makeEnv>;
type FetchMock = ReturnType<typeof vi.fn<(input: string, init?: RequestInit) => Promise<Response>>>;

function call(env: Env, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const init: RequestInit = { method, headers: { ...headers } };
  if (body !== undefined) {
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
    (init.headers as Record<string, string>)['Content-Type'] = 'application/json';
  }
  return worker.fetch(new Request(`${BASE}${path}`, init), env);
}

async function jsonOf(response: Response): Promise<Record<string, unknown>> {
  expect(response.headers.get('Content-Type')).toBe('application/json');
  return (await response.json()) as Record<string, unknown>;
}

function send(env: Env, body: unknown, secret: string = SECRET) {
  return call(env, 'POST', '/send', body, { Authorization: `Bearer ${secret}` });
}

function subscription(ua: FakeUserAgent, endpoint: string) {
  return { endpoint, keys: { p256dh: ua.p256dh, auth: ua.auth } };
}

function mockFetch(handler: (url: string, init?: RequestInit) => Promise<Response> | Response): FetchMock {
  const fn = vi.fn(async (input: string, init?: RequestInit) => handler(input, init));
  vi.stubGlobal('fetch', fn);
  return fn;
}

function headersOf(init: RequestInit | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  new Headers(init?.headers).forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

let env: Env;
let ua: FakeUserAgent;
let logs: string[];

beforeEach(async () => {
  resetKvCache();
  resetVapidCache();
  env = makeEnv();
  ua = await makeUserAgent();
  logs = [];
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    logs.push(args.map(String).join(' '));
  });
});

/** What TMA App > Set up does: register the secret, then fetch (and so create) the VAPID key. */
async function register(): Promise<void> {
  const res = await call(env, 'POST', '/register', { secret: SECRET });
  expect(res.status).toBe(200);
  expect((await call(env, 'GET', '/vapid-public-key')).status).toBe(200);
}

describe('routing', () => {
  it('GET /health reports state', async () => {
    let res = await call(env, 'GET', '/health');
    expect(res.status).toBe(200);
    expect(await jsonOf(res)).toEqual({ ok: true, name: 'tma-push', registered: false, hasKeys: false });

    await register();
    await call(env, 'GET', '/vapid-public-key');
    res = await call(env, 'GET', '/health');
    expect(await jsonOf(res)).toEqual({ ok: true, name: 'tma-push', registered: true, hasKeys: true });
  });

  it('404s unknown paths and 405s wrong methods, without CORS headers', async () => {
    const unknown = await call(env, 'GET', '/nope');
    expect(unknown.status).toBe(404);
    expect(await jsonOf(unknown)).toEqual({ error: 'not_found' });
    expect((await call(env, 'GET', '/')).status).toBe(404);
    expect((await call(env, 'GET', '/__proto__')).status).toBe(404);

    const wrong = await call(env, 'GET', '/send');
    expect(wrong.status).toBe(405);
    expect(await jsonOf(wrong)).toEqual({ error: 'method_not_allowed' });
    expect((await call(env, 'POST', '/health')).status).toBe(405);
    expect((await call(env, 'OPTIONS', '/send')).headers.get('Access-Control-Allow-Origin')).toBeNull();
  });
});

describe('GET /vapid-public-key', () => {
  it('creates the key pair once and keeps returning it', async () => {
    const res = await call(env, 'GET', '/vapid-public-key');
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const { publicKey } = (await jsonOf(res)) as { publicKey: string };
    expect(publicKey).toMatch(/^[A-Za-z0-9_-]+$/);
    const raw = b64(publicKey);
    expect(raw.length).toBe(65);
    expect(raw[0]).toBe(4);
    expect(env.TMA_PUSH.writes).toBe(1);

    const again = (await jsonOf(await call(env, 'GET', '/vapid-public-key'))) as { publicKey: string };
    expect(again.publicKey).toBe(publicKey);

    // A new isolate (empty module caches) reads the same pair from KV.
    resetKvCache();
    resetVapidCache();
    const fresh = (await jsonOf(await call(env, 'GET', '/vapid-public-key'))) as { publicKey: string };
    expect(fresh.publicKey).toBe(publicKey);
    expect(env.TMA_PUSH.writes).toBe(1);
    expect(JSON.parse(env.TMA_PUSH.data.get('vapid:v1')!)).toMatchObject({ publicKey });
  });
});

describe('POST /register (trust on first use)', () => {
  it('stores the SHA-256 of the first secret, accepts it again, rejects others', async () => {
    let res = await call(env, 'POST', '/register', { secret: SECRET });
    expect(res.status).toBe(200);
    expect(await jsonOf(res)).toEqual({ registered: true, first: true });
    expect(env.TMA_PUSH.data.get('relay:secret-sha256')).toBe(await sha256Hex(SECRET));

    res = await call(env, 'POST', '/register', { secret: SECRET });
    expect(res.status).toBe(200);
    expect(await jsonOf(res)).toEqual({ registered: true, first: false });

    res = await call(env, 'POST', '/register', { secret: 'x'.repeat(40) });
    expect(res.status).toBe(409);
    expect(await jsonOf(res)).toEqual({ error: 'already_registered' });
    expect(env.TMA_PUSH.data.get('relay:secret-sha256')).toBe(await sha256Hex(SECRET));

    // Another isolate sees the registration too.
    resetKvCache();
    expect((await call(env, 'POST', '/register', { secret: 'y'.repeat(40) })).status).toBe(409);
  });

  it('rejects bad input with 400', async () => {
    for (const body of [
      {},
      { secret: 'x'.repeat(31) },
      { secret: 'x'.repeat(257) },
      { secret: 12345678901234567890123456789012345 },
      { secret: null },
      [SECRET],
      'not json',
      '',
    ]) {
      const res = await call(env, 'POST', '/register', body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(await jsonOf(res)).toEqual({ error: 'bad_request' });
    }
    expect(env.TMA_PUSH.data.has('relay:secret-sha256')).toBe(false);
    expect((await call(env, 'POST', '/register', { secret: 'x'.repeat(32) })).status).toBe(200);
    expect((await call(env, 'POST', '/register', { secret: 'x'.repeat(32) })).status).toBe(200);
  });

  it('413s a body over 4 KB without storing anything', async () => {
    const res = await call(env, 'POST', '/register', { secret: SECRET, pad: 'p'.repeat(4096) });
    expect(res.status).toBe(413);
    expect(await jsonOf(res)).toEqual({ error: 'too_large' });
    expect(env.TMA_PUSH.writes).toBe(0);
    // A real registration body is far below the cap, even fully escaped.
    expect((await call(env, 'POST', '/register', { secret: '\u0001'.repeat(256) })).status).toBe(200);
  });

  it('stops reading a streamed body without Content-Length once it passes the cap', async () => {
    const chunk = new Uint8Array(1 << 20).fill(0x20); // 1 MiB of spaces
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (pulled === 64) return controller.close();
        pulled++;
        controller.enqueue(chunk);
      },
    });
    const request = new Request(`${BASE}/register`, {
      method: 'POST',
      body: stream,
      duplex: 'half', // Node needs this for a stream body; Workers ignore it
    } as RequestInit & { duplex: 'half' });
    expect(request.headers.get('Content-Length')).toBeNull();
    const res = await worker.fetch(request, env);
    expect(res.status).toBe(413);
    expect(await jsonOf(res)).toEqual({ error: 'too_large' });
    expect(pulled).toBeLessThanOrEqual(3); // was all 64 MiB
    expect(env.TMA_PUSH.writes).toBe(0);
  });

  it('rejects a body that is not UTF-8 as bad JSON', async () => {
    const bytes = Uint8Array.of(0x7b, 0x22, 0x73, 0xff, 0x22, 0x7d); // {"s\xff"}
    const res = await worker.fetch(new Request(`${BASE}/register`, { method: 'POST', body: bytes }), env);
    expect(res.status).toBe(400);
  });

  it('accepts a new secret after the stored hash is deleted (key rotation)', async () => {
    await register();
    env.TMA_PUSH.data.delete('relay:secret-sha256');
    vi.useFakeTimers({ now: Date.now() + 11_000, toFake: ['Date'] });
    try {
      const res = await call(env, 'POST', '/register', { secret: 'n'.repeat(48) });
      expect(await jsonOf(res)).toEqual({ registered: true, first: true });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('POST /send', () => {
  it('401s when nothing is registered, or the secret is wrong or missing', async () => {
    const fetchMock = mockFetch(() => new Response(null, { status: 201 }));
    const body = { messages: [{ subscription: subscription(ua, `${FCM}a`), payload: 'hi' }] };

    let res = await send(env, body);
    expect(res.status).toBe(401);
    expect(await jsonOf(res)).toEqual({ error: 'unauthorized' });

    await register();
    expect((await send(env, body, 'w'.repeat(42))).status).toBe(401);
    expect((await send(env, body, 'short')).status).toBe(401);
    expect((await call(env, 'POST', '/send', body)).status).toBe(401);
    expect((await call(env, 'POST', '/send', body, { Authorization: SECRET })).status).toBe(401);
    expect((await call(env, 'POST', '/send', body, { Authorization: `Basic ${SECRET}` })).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();

    expect((await send(env, body)).status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('400s malformed JSON or shape, 413s more than 10 messages', async () => {
    await register();
    const fetchMock = mockFetch(() => new Response(null, { status: 201 }));
    for (const body of ['{', {}, { messages: 'x' }, { messages: {} }, [], null]) {
      const res = await send(env, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    const message = { subscription: subscription(ua, `${FCM}a`), payload: 'hi' };
    const tooMany = await send(env, { messages: Array.from({ length: 11 }, () => message) });
    expect(tooMany.status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();

    // The 256 KB cap counts UTF-8 bytes: 90,000 "€" are 270,000 bytes.
    const bulky = await send(env, { messages: [], pad: '€'.repeat(90_000) });
    expect(bulky.status).toBe(413);
    expect(await jsonOf(bulky)).toEqual({ error: 'too_large' });

    const empty = await send(env, { messages: [] });
    expect(await jsonOf(empty)).toEqual({ results: [] });

    const ten = await send(env, { messages: Array.from({ length: 10 }, () => message) });
    expect(ten.status).toBe(200);
    expect(((await jsonOf(ten)).results as unknown[]).length).toBe(10);
    expect(fetchMock).toHaveBeenCalledTimes(10);
  });

  it('delivers an encrypted, VAPID-signed request the browser can decrypt', async () => {
    await register();
    const { publicKey } = (await jsonOf(await call(env, 'GET', '/vapid-public-key'))) as { publicKey: string };
    const fetchMock = mockFetch(() => new Response(null, { status: 201 }));
    const payload = JSON.stringify({ title: 'Band trip', body: 'Deposit due Friday' });
    const endpoint = `${FCM}dQw4w9WgXcQ:APA91bHun4MxP5`;

    const res = await send(env, { messages: [{ subscription: subscription(ua, endpoint), payload }] });
    expect(res.status).toBe(200);
    expect(await jsonOf(res)).toEqual({ results: [{ status: 'ok', code: 201 }] });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(endpoint);
    expect(init?.method).toBe('POST');
    const headers = headersOf(init);
    expect(headers['ttl']).toBe('86400');
    expect(headers['urgency']).toBe('high');
    expect(headers['topic']).toBeUndefined();
    expect(headers['content-encoding']).toBe('aes128gcm');
    expect(headers['content-type']).toBe('application/octet-stream');
    const auth = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(headers['authorization']!);
    expect(auth).not.toBeNull();
    expect(auth![4]).toBe(publicKey);
    const claims = JSON.parse(new TextDecoder().decode(b64(auth![2]!))) as Record<string, unknown>;
    expect(claims).toMatchObject({ aud: 'https://fcm.googleapis.com', sub: 'mailto:timberlanemusictma@gmail.com' });

    expect(await decryptAsUserAgent(await bodyBytes(init), ua)).toBe(payload);
  });

  it('sets TTL, Urgency and Topic from the message, clamped and validated', async () => {
    await register();
    const fetchMock = mockFetch(() => new Response(null, { status: 201 }));
    const sub = (n: number) => subscription(ua, `${FCM}${n}`);
    await send(env, {
      messages: [
        { subscription: sub(0), payload: 'a', ttl: 60, urgency: 'low', topic: 'trip_42-news' },
        { subscription: sub(1), payload: 'b', ttl: 99_999_999, urgency: 'very-low', topic: 'bad topic!' },
        { subscription: sub(2), payload: 'c', ttl: -1, urgency: 'whenever', topic: 'x'.repeat(33) },
        { subscription: sub(3), payload: 'd', ttl: 0, urgency: 'normal' },
      ],
    });
    // Messages go out concurrently, so order the calls by endpoint.
    const sent = [...fetchMock.mock.calls].sort(([a], [b]) => a.localeCompare(b)).map(([, init]) => headersOf(init));
    expect(sent.map((h) => [h['ttl'], h['urgency'], h['topic']])).toEqual([
      ['60', 'low', 'trip_42-news'],
      ['2419200', 'very-low', undefined],
      ['0', 'high', undefined],
      ['0', 'normal', undefined],
    ]);
  });

  it('maps push service responses and keeps results in message order', async () => {
    await register();
    const statusByToken: Record<string, number | 'throw'> = {
      created: 201,
      ok: 200,
      gone: 410,
      notfound: 404,
      forbidden: 403,
      slow: 429,
      boom: 503,
      big: 413,
      net: 'throw',
    };
    const tokens = Object.keys(statusByToken);
    const fetchMock = mockFetch(async (url) => {
      const token = url.slice(FCM.length);
      // Answer in reverse order to prove results are not in completion order.
      await new Promise((resolve) => setTimeout(resolve, (tokens.length - tokens.indexOf(token)) * 3));
      const status = statusByToken[token];
      if (status === 'throw') throw new TypeError('fetch failed');
      return new Response('{"error":"details"}', { status });
    });
    const res = await send(env, {
      messages: tokens.map((t) => ({ subscription: subscription(ua, `${FCM}${t}`), payload: 'x' })),
    });
    expect(res.status).toBe(200);
    expect((await jsonOf(res)).results).toEqual([
      { status: 'ok', code: 201 },
      { status: 'ok', code: 200 },
      { status: 'invalid', code: 410, reason: 'gone' },
      { status: 'invalid', code: 404, reason: 'gone' },
      { status: 'invalid', code: 403, reason: 'vapid_rejected' },
      { status: 'error', code: 429, reason: 'rate_limited' },
      { status: 'error', code: 503, reason: 'push_service_error' },
      { status: 'error', code: 413, reason: 'payload_too_large' },
      { status: 'error', reason: 'network' },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(9);
  });

  it('rejects disallowed endpoints, bad keys and oversized payloads without fetching', async () => {
    await register();
    const fetchMock = mockFetch(() => new Response(null, { status: 201 }));
    const offCurve = b64urlEncode(Uint8Array.from({ length: 65 }, (_, i) => (i === 0 ? 4 : 1)));
    const res = await send(env, {
      messages: [
        { subscription: subscription(ua, 'https://evil.example/collect'), payload: 'x' },
        { subscription: subscription(ua, 'http://fcm.googleapis.com/fcm/send/a'), payload: 'x' },
        { subscription: subscription(ua, 'https://169.254.169.254/latest'), payload: 'x' },
        { subscription: { endpoint: `${FCM}a`, keys: { p256dh: ua.p256dh.slice(4), auth: ua.auth } }, payload: 'x' },
        { subscription: { endpoint: `${FCM}a`, keys: { p256dh: ua.p256dh, auth: 'AAAA' } }, payload: 'x' },
        { subscription: { endpoint: `${FCM}a`, keys: { p256dh: offCurve, auth: ua.auth } }, payload: 'x' },
        { subscription: { endpoint: `${FCM}a` }, payload: 'x' },
        { subscription: subscription(ua, `${FCM}a`), payload: '€'.repeat(1001) }, // 3003 bytes
        { subscription: subscription(ua, `${FCM}a`), payload: 42 },
        { payload: 'x' },
      ],
    });
    expect(res.status).toBe(200);
    const { results } = (await jsonOf(res)) as { results: { status: string; reason?: string }[] };
    expect(results.map((r) => `${r.status}:${r.reason ?? ''}`)).toEqual([
      'invalid:endpoint_not_allowed',
      'invalid:endpoint_not_allowed',
      'invalid:endpoint_not_allowed',
      'invalid:bad_keys',
      'invalid:bad_keys',
      'invalid:bad_keys',
      'invalid:bad_keys',
      'error:payload_too_large',
      'error:bad_payload',
      'invalid:endpoint_not_allowed',
    ]);
    expect(fetchMock).not.toHaveBeenCalled();

    const rest = await send(env, {
      messages: [
        'not a message',
        { subscription: subscription(ua, `${FCM}ok`), payload: 'é'.repeat(1500) }, // exactly 3000 bytes
      ],
    });
    expect(((await jsonOf(rest)) as { results: unknown[] }).results).toEqual([
      { status: 'error', reason: 'bad_message' },
      { status: 'ok', code: 201 },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('never logs payloads, secrets or full endpoints', async () => {
    await register();
    mockFetch(() => new Response(null, { status: 410 }));
    const token = 'dQw4w9WgXcQ-private-token';
    await send(env, { messages: [{ subscription: subscription(ua, `${FCM}${token}`), payload: 'secret-payload' }] });
    await send(env, { messages: [] }, 'z'.repeat(40));
    expect(logs).toContain('push fcm.googleapis.com 410');
    for (const line of logs) {
      expect(line).not.toContain(token);
      expect(line).not.toContain('secret-payload');
      expect(line).not.toContain(SECRET);
      expect(line).not.toContain(ua.auth);
    }
  });

  it('serves repeat sends from the isolate cache instead of KV', async () => {
    await register();
    mockFetch(() => new Response(null, { status: 201 }));
    const body = { messages: [{ subscription: subscription(ua, `${FCM}a`), payload: 'hi' }] };
    expect((await send(env, body)).status).toBe(200);
    const reads = env.TMA_PUSH.reads;
    for (let i = 0; i < 5; i++) expect((await send(env, body)).status).toBe(200);
    expect(env.TMA_PUSH.reads).toBe(reads);
  });

  it('signs one VAPID JWT for a cold batch of 10 messages to one push service', async () => {
    await register();
    await call(env, 'GET', '/vapid-public-key');
    resetVapidCache(); // a fresh isolate: no imported key, no cached JWT
    const fetchMock = mockFetch(() => new Response(null, { status: 201 }));
    const sign = vi.spyOn(crypto.subtle, 'sign');
    const res = await send(env, {
      messages: Array.from({ length: 10 }, (_, i) => ({ subscription: subscription(ua, `${FCM}${i}`), payload: 'x' })),
    });
    expect(res.status).toBe(200);
    expect(sign).toHaveBeenCalledTimes(1);
    const auths = new Set(fetchMock.mock.calls.map(([, init]) => headersOf(init)['authorization']));
    expect(auths.size).toBe(1);

    await send(env, { messages: [{ subscription: subscription(ua, `${FCM}again`), payload: 'x' }] });
    expect(sign).toHaveBeenCalledTimes(1); // warm: served from the cache
  });

  it('answers a hostile p256dh quickly and still delivers the rest of the batch', async () => {
    await register();
    mockFetch(() => new Response(null, { status: 201 }));
    const good = { subscription: subscription(ua, `${FCM}ok`), payload: 'x' };
    const evil = {
      subscription: { endpoint: `${FCM}evil`, keys: { p256dh: '='.repeat(50_000) + 'A', auth: ua.auth } },
      payload: 'x',
    };
    const start = performance.now();
    const res = await send(env, { messages: [good, evil, good] });
    expect(performance.now() - start).toBeLessThan(1000); // was ~2 s of CPU for this row alone
    expect((await jsonOf(res)).results).toEqual([
      { status: 'ok', code: 201 },
      { status: 'invalid', reason: 'bad_keys' },
      { status: 'ok', code: 201 },
    ]);
  });

  it('never creates VAPID keys: a missing key pair is a retryable error', async () => {
    await register();
    const { publicKey } = (await jsonOf(await call(env, 'GET', '/vapid-public-key'))) as { publicKey: string };
    const writes = env.TMA_PUSH.writes;

    // KV reads "missing" (a stale edge cache, or deleted for a rotation).
    const realGet = env.TMA_PUSH.get.bind(env.TMA_PUSH);
    env.TMA_PUSH.get = async (key) => (key === 'vapid:v1' ? null : realGet(key));
    resetKvCache();
    resetVapidCache();
    const fetchMock = mockFetch(() => new Response(null, { status: 201 }));
    const message = { subscription: subscription(ua, `${FCM}a`), payload: 'x' };
    const res = await send(env, { messages: [message, message] });
    expect(res.status).toBe(200);
    expect(await jsonOf(res)).toEqual({
      results: [
        { status: 'error', reason: 'no_keys' },
        { status: 'error', reason: 'no_keys' },
      ],
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(env.TMA_PUSH.writes).toBe(writes);
    expect(JSON.parse(env.TMA_PUSH.data.get('vapid:v1')!)).toMatchObject({ publicKey });

    // Once KV serves the pair again, sends go out with the published key.
    env.TMA_PUSH.get = realGet;
    resetKvCache();
    const ok = await send(env, { messages: [message] });
    expect(await jsonOf(ok)).toEqual({ results: [{ status: 'ok', code: 201 }] });
    expect(headersOf(fetchMock.mock.calls[0]![1])['authorization']).toContain(`k=${publicKey}`);
  });
});
