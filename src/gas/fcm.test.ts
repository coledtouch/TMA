import * as nodeCrypto from 'node:crypto';
import type { Logger } from '../server/services';
import type { PushMessage } from '../shared/types';
import {
  buildFcmMessage,
  classifyFcmResponse,
  createFcmSender,
  createServiceAccountJwt,
  FCM_SCOPE,
  GOOGLE_TOKEN_URL,
  parseServiceAccount,
} from './fcm';
import { createScriptCache, createScriptSecrets } from './services';
import { installGasFakes, uninstallGasFakes, type FakeRequest, type GasFakes } from './testing/fakes';

const { privateKey, publicKey } = nodeCrypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const PRIVATE_PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

const ACCOUNT = {
  type: 'service_account',
  project_id: 'tma-family-app',
  private_key_id: 'kid-123',
  private_key: PRIVATE_PEM,
  client_email: 'fcm-sender@tma-family-app.iam.gserviceaccount.com',
  token_uri: 'https://evil.example/token', // ignored: we always use Google's endpoint
};

const MESSAGE: PushMessage = {
  title: '+$50.00 for Avery',
  body: "$50.00 was added to Avery's TMA activity funds. New balance: $325.00.",
  url: '#/funds',
  tag: 'bal-S0001',
  topic: 'balance',
};

const NOW = new Date('2026-10-21T12:00:00Z');
const SEND_URL = 'https://fcm.googleapis.com/v1/projects/tma-family-app/messages:send';

let gas: GasFakes;
let logger: Logger & { lines: unknown[][] };

function sender() {
  return createFcmSender({ secrets: createScriptSecrets(), cache: createScriptCache(), clock: { now: () => NOW }, logger });
}

function decodeSegment(segment: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as Record<string, unknown>;
}

/** token endpoint OK; message sends answered by `send`. */
function routes(send: (r: FakeRequest, token: string) => { code: number; body?: unknown } = () => ({ code: 200, body: { name: 'projects/x/messages/1' } })) {
  let issued = 0;
  gas.fetch.handler = (r) => {
    if (r.url === GOOGLE_TOKEN_URL) {
      issued += 1;
      return { code: 200, body: { access_token: `ya29.token-${issued}`, expires_in: 3599, token_type: 'Bearer' } };
    }
    const token = (JSON.parse(r.payload as string) as { message: { token: string } }).message.token;
    return send(r, token);
  };
}

beforeEach(() => {
  gas = installGasFakes(nodeCrypto);
  gas.properties.setProperty('FCM_SERVICE_ACCOUNT', JSON.stringify(ACCOUNT));
  const lines: unknown[][] = [];
  logger = { lines, info: (...a: unknown[]) => lines.push(['info', ...a]), error: (...a: unknown[]) => lines.push(['error', ...a]) };
  routes();
});
afterEach(() => uninstallGasFakes());

describe('service account', () => {
  it('parses the JSON and repairs doubled newline escapes', () => {
    const doubled = JSON.stringify({ ...ACCOUNT, private_key: PRIVATE_PEM.replace(/\n/g, '\\n') });
    expect(parseServiceAccount(doubled)?.private_key).toBe(PRIVATE_PEM);
    expect(parseServiceAccount(JSON.stringify(ACCOUNT))).toMatchObject({ project_id: 'tma-family-app', private_key_id: 'kid-123' });
  });

  it('rejects missing or incomplete JSON', () => {
    expect(parseServiceAccount(null)).toBeNull();
    expect(parseServiceAccount('{not json')).toBeNull();
    expect(parseServiceAccount(JSON.stringify({ ...ACCOUNT, private_key: 'nope' }))).toBeNull();
    expect(parseServiceAccount(JSON.stringify({ ...ACCOUNT, client_email: undefined }))).toBeNull();
  });
});

describe('JWT', () => {
  it('is a valid RS256 JWT for the FCM scope, verifiable with the public key', () => {
    const account = parseServiceAccount(JSON.stringify(ACCOUNT))!;
    const iat = Math.floor(NOW.getTime() / 1000);
    const jwt = createServiceAccountJwt(account, iat);
    const [header, claims, signature] = jwt.split('.');
    expect(jwt).not.toContain('=');
    expect(decodeSegment(header)).toEqual({ alg: 'RS256', typ: 'JWT', kid: 'kid-123' });
    expect(decodeSegment(claims)).toEqual({
      iss: ACCOUNT.client_email,
      scope: FCM_SCOPE,
      aud: GOOGLE_TOKEN_URL,
      iat,
      exp: iat + 3600,
    });
    const verified = nodeCrypto.verify(
      'RSA-SHA256',
      Buffer.from(`${header}.${claims}`),
      publicKey,
      Buffer.from(signature, 'base64url'),
    );
    expect(verified).toBe(true);
  });
});

describe('message shape', () => {
  it('is data-only with string values and high-urgency web push headers', () => {
    expect(buildFcmMessage('tok', MESSAGE)).toEqual({
      token: 'tok',
      data: {
        title: MESSAGE.title,
        body: MESSAGE.body,
        url: '#/funds',
        tag: 'bal-S0001',
        topic: 'balance',
      },
      webpush: { headers: { Urgency: 'high', TTL: '86400' } },
    });
  });

  it('omits url/tag when absent and clips oversized text', () => {
    const msg = buildFcmMessage('tok', { title: 't'.repeat(500), body: 'b'.repeat(5000), topic: 'admin' });
    expect(msg.data).toEqual({ title: 't'.repeat(200), body: 'b'.repeat(1000), topic: 'admin' });
  });
});

describe('classifyFcmResponse', () => {
  const err = (status: string, errorCode?: string) =>
    JSON.stringify({
      error: { code: 400, status, details: errorCode ? [{ '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError', errorCode }] : [] },
    });

  it('maps dead-token responses to invalid and everything else to error', () => {
    expect(classifyFcmResponse(200, '{}')).toBe('ok');
    expect(classifyFcmResponse(404, err('NOT_FOUND', 'UNREGISTERED'))).toBe('invalid');
    expect(classifyFcmResponse(404, '')).toBe('invalid');
    expect(classifyFcmResponse(400, err('INVALID_ARGUMENT', 'INVALID_ARGUMENT'))).toBe('invalid');
    expect(classifyFcmResponse(403, err('PERMISSION_DENIED', 'SENDER_ID_MISMATCH'))).toBe('invalid');
    expect(classifyFcmResponse(429, err('RESOURCE_EXHAUSTED', 'QUOTA_EXCEEDED'))).toBe('error');
    expect(classifyFcmResponse(503, err('UNAVAILABLE', 'UNAVAILABLE'))).toBe('error');
    expect(classifyFcmResponse(500, 'not json')).toBe('error');
  });
});

describe('send', () => {
  it('exchanges the JWT for a token, then sends one request per device with fetchAll', () => {
    const results = sender().send(['tok-a', 'tok-b'], MESSAGE);
    expect(results).toEqual(['ok', 'ok']);

    const [tokenReq, ...sends] = gas.fetch.requests;
    expect(tokenReq.url).toBe(GOOGLE_TOKEN_URL);
    expect(tokenReq.method).toBe('post');
    expect(tokenReq.contentType).toBe('application/x-www-form-urlencoded');
    const form = new URLSearchParams(tokenReq.payload as string);
    expect(form.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
    expect(form.get('assertion')?.split('.')).toHaveLength(3);

    expect(gas.fetch.batches).toEqual([2]);
    expect(sends.map((r) => r.url)).toEqual([SEND_URL, SEND_URL]);
    expect(sends[0].headers.Authorization).toBe('Bearer ya29.token-1');
    expect(sends[0].contentType).toBe('application/json');
    expect(sends[0].muteHttpExceptions).toBe(true);
    expect(JSON.parse(sends[1].payload as string)).toEqual({ message: buildFcmMessage('tok-b', MESSAGE) });
  });

  it('caches the access token for 50 minutes', () => {
    sender().send(['a'], MESSAGE);
    sender().send(['b'], MESSAGE);
    expect(gas.fetch.requests.filter((r) => r.url === GOOGLE_TOKEN_URL)).toHaveLength(1);
    expect([...gas.cache.entries.values()][0].ttl).toBe(3000);
  });

  it('maps per-device failures, keeping order', () => {
    routes((_r, token) => {
      if (token === 'gone') return { code: 404, body: { error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } } };
      if (token === 'busy') return { code: 503, body: { error: { status: 'UNAVAILABLE' } } };
      return { code: 200, body: {} };
    });
    expect(sender().send(['ok-1', 'gone', 'busy', 'ok-2'], MESSAGE)).toEqual(['ok', 'invalid', 'error', 'ok']);
    const logged = JSON.stringify(logger.lines);
    expect(logged).toContain('FCM send errors');
    expect(logged).not.toContain('ok-1'); // tokens are never logged
  });

  it('marks blank/garbage tokens invalid without sending them', () => {
    expect(sender().send(['', '  ', 'has space', 'x'.repeat(5000), 'good'], MESSAGE)).toEqual([
      'invalid',
      'invalid',
      'invalid',
      'invalid',
      'ok',
    ]);
    expect(gas.fetch.batches).toEqual([1]);
  });

  it('retries 401s once with a fresh token', () => {
    routes((r) => (r.headers.Authorization === 'Bearer ya29.token-1' ? { code: 401, body: { error: { status: 'UNAUTHENTICATED' } } } : { code: 200 }));
    expect(sender().send(['a', 'b'], MESSAGE)).toEqual(['ok', 'ok']);
    expect(gas.fetch.batches).toEqual([2, 2]);
    expect(gas.fetch.requests.filter((r) => r.url === GOOGLE_TOKEN_URL)).toHaveLength(2);
  });

  it('batches large sends', () => {
    const tokens = Array.from({ length: 250 }, (_, i) => `t${i}`);
    expect(sender().send(tokens, MESSAGE).every((r) => r === 'ok')).toBe(true);
    expect(gas.fetch.batches).toEqual([100, 100, 50]);
  });

  it('returns errors (and logs) when authentication or the network fails', () => {
    gas.fetch.handler = () => ({ code: 400, body: { error: 'invalid_grant' } });
    expect(sender().send(['a', 'b'], MESSAGE)).toEqual(['error', 'error']);
    expect(JSON.stringify(logger.lines)).toContain('Firebase authentication failed');
    expect(JSON.stringify(logger.lines)).not.toContain('PRIVATE KEY');

    routes(() => {
      throw new Error('Address unavailable');
    });
    expect(sender().send(['a'], MESSAGE)).toEqual(['error']);
  });

  it('is disabled without a usable service account', () => {
    expect(sender().enabled()).toBe(true);
    gas.properties.setProperty('FCM_SERVICE_ACCOUNT', '');
    expect(sender().enabled()).toBe(false);
    expect(sender().send(['a'], MESSAGE)).toEqual(['error']);
    expect(sender().send([], MESSAGE)).toEqual([]);
    expect(gas.fetch.requests).toHaveLength(0);
  });
});
