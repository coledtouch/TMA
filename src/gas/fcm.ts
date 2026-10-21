/**
 * PushSender over Firebase Cloud Messaging HTTP v1.
 *
 * Auth: the Firebase service-account JSON (Script Property
 * FCM_SERVICE_ACCOUNT) signs an RS256 JWT with
 * Utilities.computeRsaSha256Signature, exchanged for an OAuth token that is
 * cached for 50 minutes. Messages are data-only so the service worker always
 * decides how to show them (iOS requires a visible notification per push).
 */
import type { Cache, Clock, Logger, PushResult, PushSender, Secrets } from '../server/services';
import type { PushMessage } from '../shared/types';
import { base64UrlEncode, clamp, clip, formEncode, isRecord, parseJson, pick } from './util';

export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const TOKEN_TTL_SECONDS = 50 * 60;
/** Requests per UrlFetchApp.fetchAll call. */
const BATCH_SIZE = 100;
const MAX_DEVICE_TOKEN = 4096;
/** FCM error codes that mean "this device token will never work again". */
const DEAD_TOKEN_CODES = ['UNREGISTERED', 'INVALID_ARGUMENT', 'SENDER_ID_MISMATCH'];

export interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
  private_key_id?: string;
}

export interface FcmDeps {
  secrets: Secrets;
  cache: Cache;
  clock: Clock;
  logger: Logger;
}

/** Parse the service-account JSON; null when missing or incomplete. */
export function parseServiceAccount(json: string | null): ServiceAccount | null {
  if (!json) return null;
  const data = parseJson(json);
  if (!isRecord(data)) return null;
  const { project_id, client_email, private_key, private_key_id } = data;
  if (typeof project_id !== 'string' || typeof client_email !== 'string' || typeof private_key !== 'string') return null;
  if (!project_id || !client_email || !private_key.includes('PRIVATE KEY')) return null;
  return {
    project_id,
    client_email,
    // Tolerate JSON that was pasted with its "\n" escapes doubled.
    private_key: private_key.replace(/\\n/g, '\n'),
    ...(typeof private_key_id === 'string' && private_key_id ? { private_key_id } : {}),
  };
}

/** Signed RS256 JWT asserting the service account for the FCM scope. */
export function createServiceAccountJwt(account: ServiceAccount, nowSeconds: number): string {
  const header: Record<string, string> = { alg: 'RS256', typ: 'JWT' };
  if (account.private_key_id) header.kid = account.private_key_id;
  const claims = {
    iss: account.client_email,
    scope: FCM_SCOPE,
    aud: GOOGLE_TOKEN_URL,
    iat: nowSeconds,
    exp: nowSeconds + 3600,
  };
  const signingInput = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(claims))}`;
  const signature = Utilities.computeRsaSha256Signature(signingInput, account.private_key);
  return `${signingInput}.${base64UrlEncode(signature)}`;
}

/** The FCM v1 `message` for one device. Data values must be strings. */
export function buildFcmMessage(token: string, message: PushMessage): Record<string, unknown> {
  const data: Record<string, string> = {
    title: clip(String(message.title ?? ''), 200),
    body: clip(String(message.body ?? ''), 1000),
    topic: String(message.topic ?? ''),
  };
  if (message.url) data.url = clip(String(message.url), 500);
  if (message.tag) data.tag = clip(String(message.tag), 100);
  return { token, data, webpush: { headers: { Urgency: 'high', TTL: '86400' } } };
}

/** Map one FCM send response to a PushResult. */
export function classifyFcmResponse(code: number, bodyText: string): PushResult {
  if (code >= 200 && code < 300) return 'ok';
  if (code === 404) return 'invalid';
  const error = pick(parseJson(bodyText), 'error');
  const codes: unknown[] = [pick(error, 'status')];
  const details = pick(error, 'details');
  if (Array.isArray(details)) for (const d of details) codes.push(pick(d, 'errorCode'));
  return codes.some((c) => typeof c === 'string' && DEAD_TOKEN_CODES.includes(c)) ? 'invalid' : 'error';
}

export function createFcmSender(deps: FcmDeps): PushSender {
  const { secrets, cache, clock, logger } = deps;

  const account = (): ServiceAccount | null => parseServiceAccount(secrets.get('FCM_SERVICE_ACCOUNT'));
  const tokenKey = (sa: ServiceAccount) => `fcm-token:${sa.client_email}`;

  function accessToken(sa: ServiceAccount): string {
    const cached = cache.get(tokenKey(sa));
    if (cached) return cached;
    const jwt = createServiceAccountJwt(sa, Math.floor(clock.now().getTime() / 1000));
    const res = UrlFetchApp.fetch(GOOGLE_TOKEN_URL, {
      method: 'post',
      contentType: 'application/x-www-form-urlencoded',
      payload: formEncode({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
      muteHttpExceptions: true,
    });
    const body = parseJson(res.getContentText());
    const token = pick(body, 'access_token');
    if (res.getResponseCode() !== 200 || typeof token !== 'string' || !token) {
      throw new Error(`Firebase authentication failed (HTTP ${res.getResponseCode()} ${String(pick(body, 'error') ?? '')})`.trim());
    }
    const expiresIn = Number(pick(body, 'expires_in')) || 3600;
    cache.put(tokenKey(sa), token, clamp(Math.floor(expiresIn - 300), 60, TOKEN_TTL_SECONDS));
    return token;
  }

  /** Send to the given indexes; returns HTTP code + body per index. */
  function deliver(sa: ServiceAccount, bearer: string, payloads: string[], indexes: number[]): Map<number, { code: number; text: string }> {
    const url = `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(sa.project_id)}/messages:send`;
    const out = new Map<number, { code: number; text: string }>();
    for (let start = 0; start < indexes.length; start += BATCH_SIZE) {
      const chunk = indexes.slice(start, start + BATCH_SIZE);
      const responses = UrlFetchApp.fetchAll(
        chunk.map((i) => ({
          url,
          method: 'post' as const,
          contentType: 'application/json',
          headers: { Authorization: `Bearer ${bearer}` },
          payload: payloads[i],
          muteHttpExceptions: true,
        })),
      );
      chunk.forEach((i, k) => out.set(i, { code: responses[k].getResponseCode(), text: responses[k].getContentText() }));
    }
    return out;
  }

  return {
    enabled: () => account() !== null,

    send(tokens: string[], message: PushMessage): PushResult[] {
      const results: PushResult[] = tokens.map(() => 'error');
      if (tokens.length === 0) return results;
      const sa = account();
      if (!sa) return results;

      const payloads: string[] = [];
      const pending: number[] = [];
      tokens.forEach((raw, i) => {
        const token = typeof raw === 'string' ? raw.trim() : '';
        if (!token || token.length > MAX_DEVICE_TOKEN || /\s/.test(token)) {
          results[i] = 'invalid';
          payloads.push('');
          return;
        }
        payloads.push(JSON.stringify({ message: buildFcmMessage(token, message) }));
        pending.push(i);
      });
      if (pending.length === 0) return results;

      let responses: Map<number, { code: number; text: string }>;
      try {
        responses = deliver(sa, accessToken(sa), payloads, pending);
        const unauthorized = pending.filter((i) => responses.get(i)?.code === 401);
        if (unauthorized.length > 0) {
          // Token revoked or expired early: fetch a fresh one and retry those once.
          cache.remove(tokenKey(sa));
          const retried = deliver(sa, accessToken(sa), payloads, unauthorized);
          retried.forEach((res, i) => responses.set(i, res));
        }
      } catch (error) {
        logger.error('FCM send failed', { message: error instanceof Error ? error.message : String(error) });
        return results;
      }

      const errorCodes: number[] = [];
      for (const i of pending) {
        const res = responses.get(i);
        results[i] = res ? classifyFcmResponse(res.code, res.text) : 'error';
        if (results[i] === 'error') errorCodes.push(res ? res.code : 0);
      }
      if (errorCodes.length > 0) {
        // Counts and HTTP codes only: device tokens are never logged.
        logger.error('FCM send errors', { failed: errorCodes.length, total: tokens.length, httpCodes: errorCodes.slice(0, 5) });
      }
      return results;
    },
  };
}
