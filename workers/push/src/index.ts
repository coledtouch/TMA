// tma-push: a stateless Web Push sender for the TMA Family App.
//
// Apps Script keeps the push subscriptions in the Google Sheet and calls this
// Worker to deliver notifications. The Worker only stores its VAPID key pair
// and the SHA-256 of the shared relay secret (both in KV). See README.md.
//
//   GET  /health            {"ok":true,"name":"tma-push","registered":bool,"hasKeys":bool}
//   GET  /vapid-public-key  {"publicKey":"<b64url>"}   (creates the key pair on first use)
//   POST /register          {"secret":"..."}            trust on first use
//   POST /send              Authorization: Bearer <secret>, {"messages":[...]} (max 10)
import { concat, constantTimeEqual, sha256Hex } from './b64';
import { KV_RECHECK_MS, KV_SECRET, kvGet, kvPut, kvRead, type Env } from './env';
import { DEFAULT_SUBJECT, getVapidKeys, hasVapidKeys, loadVapidKeys } from './vapid';
import { sendAll, type SendResult } from './webpush';

export type { Env } from './env';

export const NAME = 'tma-push';
/** Free plan: 50 subrequests and 10 ms CPU per request, so small batches. */
export const MAX_MESSAGES = 10;
export const MIN_SECRET = 32;
export const MAX_SECRET = 256;
/** /send body cap in bytes: 10 messages of up to 3000 bytes each, with JSON escaping headroom. */
export const MAX_BODY_BYTES = 256 * 1024;
/** /register body cap in bytes ({"secret": <= 256 chars}, even fully escaped, is far below). */
export const MAX_REGISTER_BODY_BYTES = 4 * 1024;

const ROUTES = new Map<string, string>([
  ['/health', 'GET'],
  ['/vapid-public-key', 'GET'],
  ['/register', 'POST'],
  ['/send', 'POST'],
]);

function json(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extra },
  });
}

const BAD_REQUEST = () => json(400, { error: 'bad_request' });
const UNAUTHORIZED = () => json(401, { error: 'unauthorized' });

/**
 * Reads the request body, at most maxBytes of it. The stream is read chunk by
 * chunk and abandoned as soon as the running byte count passes the cap, so a
 * chunked body without Content-Length cannot make the Worker buffer megabytes
 * (/register is unauthenticated).
 */
async function readBody(request: Request, maxBytes: number): Promise<Uint8Array | 'too_large'> {
  const declared = request.headers.get('Content-Length');
  if (declared !== null && Number(declared) > maxBytes) return 'too_large';
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      reader.cancel().catch(() => undefined);
      return 'too_large';
    }
    chunks.push(value);
  }
  return concat(...chunks);
}

/** Reads and parses a JSON body: null when it is not UTF-8 JSON, 'too_large' over maxBytes. */
async function readJson(request: Request, maxBytes: number): Promise<{ value: unknown } | 'too_large' | null> {
  const bytes = await readBody(request, maxBytes);
  if (bytes === 'too_large') return 'too_large';
  try {
    return { value: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown };
  } catch {
    return null;
  }
}

function isValidSecret(secret: unknown): secret is string {
  return typeof secret === 'string' && secret.length >= MIN_SECRET && secret.length <= MAX_SECRET;
}

/**
 * Checks a secret hash against the stored one. On a mismatch the stored value
 * is re-read (at most every KV_RECHECK_MS) in case it was rotated.
 */
async function storedSecretMatches(env: Env, hash: string): Promise<'match' | 'mismatch' | 'missing'> {
  let stored = await kvGet(env, KV_SECRET);
  if (stored !== null && constantTimeEqual(stored, hash)) return 'match';
  stored = await kvGet(env, KV_SECRET, KV_RECHECK_MS);
  if (stored === null) return 'missing';
  return constantTimeEqual(stored, hash) ? 'match' : 'mismatch';
}

async function handleHealth(env: Env): Promise<Response> {
  const [secret, hasKeys] = await Promise.all([kvGet(env, KV_SECRET), hasVapidKeys(env)]);
  return json(200, { ok: true, name: NAME, registered: secret !== null, hasKeys });
}

async function handlePublicKey(env: Env): Promise<Response> {
  const keys = await getVapidKeys(env);
  return json(200, { publicKey: keys.publicKey });
}

async function handleRegister(request: Request, env: Env): Promise<Response> {
  const body = await readJson(request, MAX_REGISTER_BODY_BYTES);
  if (body === 'too_large') return json(413, { error: 'too_large' });
  if (!body || typeof body.value !== 'object' || body.value === null) return BAD_REQUEST();
  const secret = (body.value as { secret?: unknown }).secret;
  if (!isValidSecret(secret)) return BAD_REQUEST();

  const hash = await sha256Hex(secret);
  const state = await storedSecretMatches(env, hash);
  if (state === 'match') return json(200, { registered: true, first: false });
  if (state === 'mismatch') return json(409, { error: 'already_registered' });

  // First registration. Confirm with an uncached read, write, then read back
  // so that of two racing registrations only the one KV kept succeeds.
  const current = await kvRead(env, KV_SECRET);
  if (current !== null) {
    return constantTimeEqual(current, hash)
      ? json(200, { registered: true, first: false })
      : json(409, { error: 'already_registered' });
  }
  await kvPut(env, KV_SECRET, hash);
  const stored = await kvRead(env, KV_SECRET);
  if (stored !== null && !constantTimeEqual(stored, hash)) return json(409, { error: 'already_registered' });
  return json(200, { registered: true, first: true });
}

async function handleSend(request: Request, env: Env): Promise<Response> {
  const auth = request.headers.get('Authorization') ?? '';
  const match = /^Bearer (.+)$/.exec(auth);
  const secret = match?.[1];
  if (!isValidSecret(secret)) return UNAUTHORIZED();
  if ((await storedSecretMatches(env, await sha256Hex(secret))) !== 'match') return UNAUTHORIZED();

  const body = await readJson(request, MAX_BODY_BYTES);
  if (body === 'too_large') return json(413, { error: 'too_large' });
  if (!body || typeof body.value !== 'object' || body.value === null) return BAD_REQUEST();
  const messages = (body.value as { messages?: unknown }).messages;
  if (!Array.isArray(messages)) return BAD_REQUEST();
  if (messages.length > MAX_MESSAGES) return json(413, { error: 'too_many_messages', max: MAX_MESSAGES });
  if (messages.length === 0) return json(200, { results: [] });

  // Only GET /vapid-public-key creates the key pair. A pair minted here could
  // not match any subscription and would replace the published one, so every
  // push service would answer 403 and Apps Script would delete every
  // subscription. Answer a retryable error per message instead.
  const vapid = await loadVapidKeys(env);
  if (!vapid) {
    console.log('send no_keys');
    const noKeys: SendResult = { status: 'error', reason: 'no_keys' };
    return json(200, { results: messages.map(() => noKeys) });
  }
  const subject = env.VAPID_SUBJECT?.trim() || DEFAULT_SUBJECT;
  const results = await sendAll(messages, { vapid, subject });
  return json(200, { results });
}

/** Routes one request. Exported for tests; the Worker entry point is below. */
export async function handleRequest(request: Request, env: Env): Promise<Response> {
  const { pathname } = new URL(request.url);
  const method = ROUTES.get(pathname);
  if (!method) return json(404, { error: 'not_found' });
  if (request.method !== method) return json(405, { error: 'method_not_allowed' }, { Allow: method });
  try {
    switch (pathname) {
      case '/health':
        return await handleHealth(env);
      case '/vapid-public-key':
        return await handlePublicKey(env);
      case '/register':
        return await handleRegister(request, env);
      default:
        return await handleSend(request, env);
    }
  } catch (err) {
    // Never log request contents: only where it failed and the error type.
    console.log(`error ${pathname} ${err instanceof Error ? err.name : 'unknown'}`);
    return json(500, { error: 'internal' });
  }
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env);
  },
};
