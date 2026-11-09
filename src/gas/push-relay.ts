/**
 * PushSender over the TMA push Worker (workers/push: a Cloudflare Worker that
 * speaks standard Web Push: VAPID signing and RFC 8291 encryption).
 *
 * Apps Script keeps each browser's PushSubscription in the Devices tab and
 * asks the Worker to deliver. It authenticates with a shared secret (Script
 * Property PUSH_RELAY_SECRET, created by setup) that it registered with the
 * Worker ("trust on first use"). The Worker's VAPID public key, which
 * browsers subscribe with, is cached in the Script Property PUSH_PUBLIC_KEY.
 *
 * The Worker runs on Cloudflare's free plan (about 10 ms of CPU per request),
 * so each /send request carries at most 5 messages, and the requests go out
 * in parallel with UrlFetchApp.fetchAll.
 *
 * The same Worker also sends the app's email (POST /email, see mail.ts),
 * with the same secret: `authorizedPost` and `authorizedPostAll` are the
 * shared way in, and a 401 from any of them (or /send) links this sheet again
 * at most once per execution. The Worker only sends email for the secret
 * whose SHA-256 is its EMAIL_KEY secret; `emailKey()` is that value, which
 * the Status dialog shows for the admin to paste into Cloudflare.
 *
 * Logs carry counts, HTTP codes and the Worker's reason codes only: never
 * the secret, payloads or subscription endpoints.
 */
import { canonicalP256Key, toSubscription, type StoredSubscription } from '../server/push-subscription';
import type { Cache, Logger, PushResult, PushSender, Secrets } from '../server/services';
import type { PushMessage } from '../shared/types';
import { bytesToHex, clip, isRecord, parseJson, pick } from './util';

/** Messages per /send request (the Worker accepts 10; 5 keeps each request well inside its CPU budget). */
export const MESSAGES_PER_REQUEST = 5;
/** /send requests per UrlFetchApp.fetchAll call. */
export const REQUESTS_PER_FETCH_ALL = 20;
/** The Worker's payload limit, in UTF-8 bytes. */
export const MAX_PAYLOAD_BYTES = 3000;
/** How long a push service keeps a message for an offline phone. */
export const PUSH_TTL_SECONDS = 86400;
const MIN_SECRET_CHARS = 32;
const MAX_SECRET_CHARS = 256;
/** After a failed public-key lookup, wait this long before asking the Worker again. */
const PUBLIC_KEY_RETRY_SECONDS = 300;
const PUBLIC_KEY_FAILED_CACHE_KEY = 'push-relay:public-key-failed';
const TOPIC_MAX_CHARS = 32;

export const ALREADY_REGISTERED_MESSAGE =
  'The push Worker is already linked to a different Apps Script secret. See workers/push/README.md (rotate keys).';

export interface PushRelayDeps {
  secrets: Secrets;
  cache: Cache;
  logger: Logger;
  /** Settings PUSH_RELAY_URL (or its default). */
  relayUrl(): string;
}

export interface RelayHealth {
  reachable: boolean;
  /** A secret is registered with the Worker (not necessarily this sheet's). */
  registered: boolean;
  /** The Worker has its VAPID key pair. */
  hasKeys: boolean;
  /** The Worker has its Cloudflare Email Sending binding (it can send as noreply@mytma.org). */
  email: boolean;
  /** The Worker has its EMAIL_KEY secret (which sheet may send email); whether it is this sheet's, only sending tells. */
  emailKey: boolean;
  /** HTTP status when the Worker answered with something other than 200. */
  httpCode?: number;
  /** Why the Worker could not be reached (network error text). */
  error?: string;
}

export interface PushRelaySender extends PushSender {
  /** The Worker's base URL without a trailing slash, or null when PUSH_RELAY_URL is not an https:// address. */
  baseUrl(): string | null;
  /** POST /register with PUSH_RELAY_SECRET. Throws with a message for the admin when that fails. */
  register(): { first: boolean };
  /** GET /vapid-public-key (the Worker creates its key pair on first use), validate it and save PUSH_PUBLIC_KEY. Throws on failure. */
  refreshPublicKey(): string;
  /** GET /health. Never throws. */
  health(): RelayHealth;
  /**
   * POST JSON to an endpoint that takes `Authorization: Bearer PUSH_RELAY_SECRET`
   * (e.g. "/email"). On a 401 it links this sheet again (POST /register, at most
   * once per execution, shared with push) and retries once. Returns the HTTP
   * code and body of the last answer. Throws when push isn't configured or the
   * Worker can't be reached; the message never contains the secret.
   */
  authorizedPost(path: string, body: unknown): RelayAnswer;
  /**
   * Like authorizedPost for several bodies at once, in parallel
   * (UrlFetchApp.fetchAll). Answers are in the same order. Requests that got a
   * 401 are retried once after linking this sheet again. Throws when the
   * Worker can't be reached; then none of the answers are known.
   */
  authorizedPostAll(path: string, bodies: unknown[]): RelayAnswer[];
  /**
   * The value for the Worker's EMAIL_KEY secret: the lowercase hex SHA-256 of
   * PUSH_RELAY_SECRET (what the Worker stores; it can't be turned back into
   * the secret). null when there is no usable secret.
   */
  emailKey(): string | null;
}

/** An HTTP answer from the Worker. */
export interface RelayAnswer {
  code: number;
  text: string;
}

/** One message in a /send body. */
interface RelayMessage {
  subscription: StoredSubscription;
  payload: string;
  ttl: number;
  urgency: 'high' | 'normal';
  topic?: string;
}

interface Pending {
  /** Index into the caller's token list. */
  index: number;
  message: RelayMessage;
}

/** What one /send request came back with. */
export type ChunkOutcome =
  | { kind: 'results'; results: PushResult[]; reasons: string[] }
  | { kind: 'unauthorized' }
  | { kind: 'no_keys' }
  | { kind: 'failed'; httpCode: number };

// ---------------------------------------------------------------------------
// Pure helpers (exported for tests)
// ---------------------------------------------------------------------------

/** "https://host[/path]" without trailing slashes, or null for anything else (http, blanks, "off", spaces…). */
export function normalizeRelayUrl(value: string): string | null {
  const url = String(value ?? '').trim().replace(/\/+$/, '');
  return /^https:\/\/[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?(?::\d{1,5})?(?:\/[A-Za-z0-9._~%!$&'()*+,;=:@/-]*)?$/.test(url)
    ? url
    : null;
}

/** UTF-8 length of a string (lone surrogates count as the 3-byte replacement character). */
export function utf8Length(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    if (c < 0x80) bytes += 1;
    else if (c < 0x800) bytes += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length && (text.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
      bytes += 4;
      i += 1;
    } else bytes += 3;
  }
  return bytes;
}

/** The first `n` UTF-16 units of `text`, without splitting a surrogate pair. */
function cut(text: string, n: number): string {
  const head = text.slice(0, n);
  const last = head.charCodeAt(head.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? head.slice(0, -1) : head;
}

/**
 * The notification as the service worker reads it: JSON {title, body, url,
 * tag, topic}, at most 3000 bytes of UTF-8. Long bodies are shortened (with
 * "…"); the other fields are clipped so that even fully escaped they leave
 * room for the body.
 */
export function buildPayload(message: PushMessage): string {
  const fields = {
    title: clip(String(message.title ?? ''), 120),
    url: message.url ? clip(String(message.url), 200) : undefined,
    tag: message.tag ? clip(String(message.tag), 64) : undefined,
    topic: clip(String(message.topic ?? ''), 32),
  };
  const render = (body: string) =>
    JSON.stringify({ title: fields.title, body, url: fields.url, tag: fields.tag, topic: fields.topic });
  const body = String(message.body ?? '');
  const full = render(body);
  if (utf8Length(full) <= MAX_PAYLOAD_BYTES) return full;
  // Longest prefix of the body that still fits with an ellipsis (binary search).
  let lo = 0;
  let hi = body.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (utf8Length(render(`${cut(body, mid)}…`)) <= MAX_PAYLOAD_BYTES) lo = mid;
    else hi = mid - 1;
  }
  return render(lo > 0 ? `${cut(body, lo)}…` : '');
}

/** Web Push Topic header from a notification tag: [A-Za-z0-9_-]{1,32}, or undefined. */
export function pushTopic(tag: string | undefined): string | undefined {
  if (!tag) return undefined;
  const topic = String(tag)
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, TOPIC_MAX_CHARS);
  return topic === '' ? undefined : topic;
}

/** Reminders and announcements can wait for a phone's next wake-up; everything else is time-sensitive. */
export function pushUrgency(topic: PushMessage['topic']): 'high' | 'normal' {
  return topic === 'reminders' || topic === 'announcements' ? 'normal' : 'high';
}

/** Map one /send response (for a chunk of `size` messages). */
export function readSendResponse(code: number, text: string, size: number): ChunkOutcome {
  const body = parseJson(text);
  if (code === 401) return { kind: 'unauthorized' };
  if (code === 503 && pick(body, 'error') === 'no_keys') return { kind: 'no_keys' };
  if (code !== 200) return { kind: 'failed', httpCode: code };
  const entries = pick(body, 'results');
  if (!Array.isArray(entries) || entries.length !== size) return { kind: 'failed', httpCode: code };
  const reasons = entries.map((e) => {
    const reason = pick(e, 'reason');
    return typeof reason === 'string' ? clip(reason.replace(/[^a-z0-9_]/gi, ''), 40) : '';
  });
  // The Worker answers no_keys for every message when it has no VAPID key pair yet.
  if (size > 0 && reasons.every((r) => r === 'no_keys')) return { kind: 'no_keys' };
  const results = entries.map((e): PushResult => {
    const status = isRecord(e) ? e.status : undefined;
    return status === 'ok' ? 'ok' : status === 'invalid' ? 'invalid' : 'error';
  });
  return { kind: 'results', results, reasons };
}

function errorText(error: unknown, secret: string | null): string {
  const text = clip(error instanceof Error ? error.message : String(error), 200);
  return secret ? text.split(secret).join('[secret]') : text;
}

// ---------------------------------------------------------------------------
// Sender
// ---------------------------------------------------------------------------

export function createPushRelaySender(deps: PushRelayDeps): PushRelaySender {
  const { secrets, cache, logger } = deps;
  // Per execution (createGasServices runs once per request/trigger/menu click).
  let secretMemo: string | null = null;
  let publicKeyMemo: string | null = null;
  let reRegistered = false;
  let keysRequested = false;

  const baseUrl = (): string | null => normalizeRelayUrl(deps.relayUrl());

  /** PUSH_RELAY_SECRET when it is usable: 32–256 characters (as the Worker requires), none that would break a header. */
  function relaySecret(): string | null {
    if (secretMemo === null) {
      const value = secrets.get('PUSH_RELAY_SECRET');
      if (value && value.length >= MIN_SECRET_CHARS && value.length <= MAX_SECRET_CHARS && !/[\u0000-\u001f\u007f]/.test(value)) {
        secretMemo = value;
      }
    }
    return secretMemo;
  }

  function requireBase(): string {
    const base = baseUrl();
    if (!base) throw new Error('Settings PUSH_RELAY_URL is not an https:// address.');
    return base;
  }

  function fetchOrExplain(url: string, params: GoogleAppsScript.URL_Fetch.URLFetchRequestOptions) {
    try {
      return UrlFetchApp.fetch(url, { ...params, muteHttpExceptions: true });
    } catch (error) {
      throw new Error(`Could not reach the push Worker (${errorText(error, secretMemo)}).`);
    }
  }

  function register(): { first: boolean } {
    const base = requireBase();
    const secret = relaySecret();
    if (!secret) throw new Error('PUSH_RELAY_SECRET is missing or too short: run TMA App → Set up / repair tabs.');
    const res = fetchOrExplain(`${base}/register`, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({ secret }),
    });
    const code = res.getResponseCode();
    const body = parseJson(res.getContentText());
    if (code === 200 && pick(body, 'registered') === true) return { first: pick(body, 'first') === true };
    if (code === 409) throw new Error(ALREADY_REGISTERED_MESSAGE);
    throw new Error(`The push Worker answered HTTP ${code} when linking this sheet.`);
  }

  function refreshPublicKey(): string {
    const base = requireBase();
    const res = fetchOrExplain(`${base}/vapid-public-key`, { method: 'get', headers: { Accept: 'application/json' } });
    const code = res.getResponseCode();
    if (code !== 200) throw new Error(`The push Worker answered HTTP ${code} for its public key.`);
    const key = canonicalP256Key(pick(parseJson(res.getContentText()), 'publicKey'));
    if (!key) throw new Error('The push Worker sent a public key that is not a P-256 key.');
    secrets.set('PUSH_PUBLIC_KEY', key);
    publicKeyMemo = key;
    cache.remove(PUBLIC_KEY_FAILED_CACHE_KEY);
    return key;
  }

  function publicKey(): string {
    if (publicKeyMemo) return publicKeyMemo;
    const stored = canonicalP256Key(secrets.get('PUSH_PUBLIC_KEY'));
    if (stored) {
      publicKeyMemo = stored;
      return stored;
    }
    if (!baseUrl() || cache.get(PUBLIC_KEY_FAILED_CACHE_KEY)) return '';
    try {
      return refreshPublicKey();
    } catch (error) {
      // Don't make every page load wait on an unreachable Worker.
      cache.put(PUBLIC_KEY_FAILED_CACHE_KEY, '1', PUBLIC_KEY_RETRY_SECONDS);
      logger.error('Could not get the push public key', { message: errorText(error, secretMemo) });
      return '';
    }
  }

  function health(): RelayHealth {
    const down: RelayHealth = { reachable: false, registered: false, hasKeys: false, email: false, emailKey: false };
    const base = baseUrl();
    if (!base) return { ...down, error: 'PUSH_RELAY_URL is not an https:// address' };
    try {
      const res = UrlFetchApp.fetch(`${base}/health`, { method: 'get', muteHttpExceptions: true });
      const code = res.getResponseCode();
      const body = parseJson(res.getContentText());
      if (code !== 200 || pick(body, 'ok') !== true) return { ...down, httpCode: code };
      return {
        reachable: true,
        registered: pick(body, 'registered') === true,
        hasKeys: pick(body, 'hasKeys') === true,
        email: pick(body, 'email') === true,
        emailKey: pick(body, 'emailKey') === true,
      };
    } catch (error) {
      return { ...down, error: errorText(error, secretMemo) };
    }
  }

  /**
   * The Worker answered 401: it forgot this sheet (e.g. its KV was cleared).
   * Link again, at most once per execution for push and email together.
   * True when linking worked, so the caller should retry.
   */
  function relinkOnce(secret: string): boolean {
    if (reRegistered) return false;
    reRegistered = true;
    try {
      register();
      return true;
    } catch (error) {
      logger.error('Push Worker rejected this sheet and linking again failed', { message: errorText(error, secret) });
      return false;
    }
  }

  function authorizedRequest(base: string, path: string, secret: string, body: unknown) {
    return {
      url: `${base}${path}`,
      method: 'post' as const,
      contentType: 'application/json',
      headers: { Authorization: `Bearer ${secret}` },
      payload: JSON.stringify(body),
      muteHttpExceptions: true,
    };
  }

  function requireSecret(): string {
    const secret = relaySecret();
    if (!secret) throw new Error('PUSH_RELAY_SECRET is missing or too short: run TMA App → Set up / repair tabs.');
    return secret;
  }

  function authorizedPost(path: string, body: unknown): RelayAnswer {
    const base = requireBase();
    const secret = requireSecret();
    const once = (): RelayAnswer => {
      const { url, ...params } = authorizedRequest(base, path, secret, body);
      const res = fetchOrExplain(url, params);
      return { code: res.getResponseCode(), text: res.getContentText() };
    };
    const answer = once();
    if (answer.code !== 401 || !relinkOnce(secret)) return answer;
    return once();
  }

  function authorizedPostAll(path: string, bodies: unknown[]): RelayAnswer[] {
    const base = requireBase();
    const secret = requireSecret();
    const all = (items: unknown[]): RelayAnswer[] => {
      if (items.length === 0) return [];
      let responses: GoogleAppsScript.URL_Fetch.HTTPResponse[];
      try {
        responses = UrlFetchApp.fetchAll(items.map((body) => authorizedRequest(base, path, secret, body)));
      } catch (error) {
        throw new Error(`Could not reach the push Worker (${errorText(error, secret)}).`);
      }
      return items.map((_, i) => {
        const res = responses[i];
        return res ? { code: res.getResponseCode(), text: res.getContentText() } : { code: 0, text: '' };
      });
    };
    const answers = all(bodies);
    const rejected = answers.flatMap((a, i) => (a.code === 401 ? [i] : []));
    if (rejected.length === 0 || !relinkOnce(secret)) return answers;
    try {
      const again = all(rejected.map((i) => bodies[i]));
      rejected.forEach((i, k) => {
        answers[i] = again[k];
      });
    } catch (error) {
      // Keep the first answers: the other requests were delivered and must not be reported as unknown.
      logger.error('Push Worker unreachable on retry', { message: errorText(error, secret) });
    }
    return answers;
  }

  function emailKey(): string | null {
    const secret = relaySecret();
    if (!secret) return null;
    return bytesToHex(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, secret, Utilities.Charset.UTF_8));
  }

  /** POST each chunk to /send, REQUESTS_PER_FETCH_ALL requests per fetchAll. */
  function post(base: string, secret: string, chunks: Pending[][]): ChunkOutcome[] {
    const outcomes: ChunkOutcome[] = [];
    for (let start = 0; start < chunks.length; start += REQUESTS_PER_FETCH_ALL) {
      const group = chunks.slice(start, start + REQUESTS_PER_FETCH_ALL);
      try {
        const responses = UrlFetchApp.fetchAll(
          group.map((chunk) => ({
            url: `${base}/send`,
            method: 'post' as const,
            contentType: 'application/json',
            headers: { Authorization: `Bearer ${secret}` },
            payload: JSON.stringify({ messages: chunk.map((p) => p.message) }),
            muteHttpExceptions: true,
          })),
        );
        group.forEach((chunk, i) => {
          const res = responses[i];
          outcomes.push(res ? readSendResponse(res.getResponseCode(), res.getContentText(), chunk.length) : { kind: 'failed', httpCode: 0 });
        });
      } catch (error) {
        // Network failure (DNS, timeout): UrlFetchApp throws even with muteHttpExceptions.
        logger.error('Push Worker unreachable', { message: errorText(error, secret) });
        for (let i = 0; i < group.length; i += 1) outcomes.push({ kind: 'failed', httpCode: 0 });
      }
    }
    return outcomes;
  }

  function send(tokens: string[], message: PushMessage): PushResult[] {
    const results: PushResult[] = tokens.map(() => 'error');
    if (tokens.length === 0) return results;
    const base = baseUrl();
    const secret = relaySecret();
    if (!base || !secret) return results;

    const payload = buildPayload(message);
    const topic = pushTopic(message.tag);
    const urgency = pushUrgency(message.topic);
    const queue: Pending[] = [];
    tokens.forEach((token, index) => {
      // Not a subscription (e.g. a demo-mode token, or a row typed by hand): the Worker could never deliver it.
      const subscription = typeof token === 'string' ? toSubscription(token) : null;
      if (!subscription) {
        results[index] = 'invalid';
        return;
      }
      const msg: RelayMessage = { subscription, payload, ttl: PUSH_TTL_SECONDS, urgency };
      if (topic) msg.topic = topic;
      queue.push({ index, message: msg });
    });
    if (queue.length === 0) return results;

    const chunks: Pending[][] = [];
    for (let i = 0; i < queue.length; i += MESSAGES_PER_REQUEST) chunks.push(queue.slice(i, i + MESSAGES_PER_REQUEST));

    const httpCodes: number[] = [];
    const reasons: string[] = [];
    /** Apply outcomes; return the chunks that need a retry, by kind. */
    const apply = (batch: Pending[][], outcomes: ChunkOutcome[]) => {
      const retry = { unauthorized: [] as Pending[][], noKeys: [] as Pending[][] };
      batch.forEach((chunk, i) => {
        const outcome = outcomes[i];
        if (outcome.kind === 'results') {
          chunk.forEach((p, k) => {
            results[p.index] = outcome.results[k];
            if (outcome.results[k] === 'error' && outcome.reasons[k]) reasons.push(outcome.reasons[k]);
          });
        } else if (outcome.kind === 'unauthorized') {
          retry.unauthorized.push(chunk);
        } else if (outcome.kind === 'no_keys') {
          retry.noKeys.push(chunk);
        } else {
          httpCodes.push(outcome.httpCode);
        }
      });
      return retry;
    };

    const first = apply(chunks, post(base, secret, chunks));
    const noKeys = first.noKeys;
    if (first.unauthorized.length > 0) {
      // The Worker forgot this sheet (e.g. its keys were rotated): link again once, then retry.
      if (!relinkOnce(secret)) {
        httpCodes.push(401);
      } else {
        const again = apply(first.unauthorized, post(base, secret, first.unauthorized));
        if (again.unauthorized.length > 0) httpCodes.push(401);
        noKeys.push(...again.noKeys);
      }
    }
    if (noKeys.length > 0) {
      if (keysRequested) {
        reasons.push('no_keys');
      } else {
        // The Worker has no VAPID key pair yet: asking for the public key creates it.
        keysRequested = true;
        try {
          refreshPublicKey();
          const again = apply(noKeys, post(base, secret, noKeys));
          if (again.noKeys.length > 0) reasons.push('no_keys');
          if (again.unauthorized.length > 0) httpCodes.push(401);
        } catch (error) {
          reasons.push('no_keys');
          logger.error('Push Worker has no keys and creating them failed', { message: errorText(error, secret) });
        }
      }
    }

    const failed = results.filter((r) => r === 'error').length;
    if (failed > 0) {
      // Counts, HTTP codes and the Worker's reason codes only: never endpoints, payloads or the secret.
      logger.error('Push delivery errors', {
        failed,
        total: tokens.length,
        httpCodes: unique(httpCodes.map(String)).slice(0, 5),
        reasons: unique(reasons).slice(0, 5),
      });
    }
    return results;
  }

  return {
    enabled: () => baseUrl() !== null && relaySecret() !== null,
    publicKey,
    send,
    baseUrl,
    register,
    refreshPublicKey,
    health,
    authorizedPost,
    authorizedPostAll,
    emailKey,
  };
}

function unique(items: string[]): string[] {
  return items.filter((item, i) => items.indexOf(item) === i);
}
