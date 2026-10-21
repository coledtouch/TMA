// @vitest-environment jsdom
import type { ApiAction, ApiParams } from '../../shared/types';
import { ApiError, type ApiClient } from '../api/client';
import { MODE_KEY } from './mode';
import {
  applicationServerKey,
  canonicalToken,
  DEMO_TOKEN_PREFIX,
  disablePush,
  enablePush,
  forgetDemoPushToken,
  getPushSupport,
  isDeliverableEndpoint,
  isIos,
  isStandalone,
  refreshPushRegistration,
} from './push';
import { storageKeys } from './storage';

const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const IPAD_DESKTOP_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';
const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';

/** The push Worker's VAPID public key (base64url, 65-byte P-256 point), and a rotated one. */
const KEY = 'BIeCLnOS97NnYj0RLVAmSyNq0kf9FdqRZDBYrjHNSolsjMrbO_ZNFGlion9tcR_EDhXoz0tUEw6MpU-GFVht8Z8';
const NEW_KEY = 'BLF4x_X7A6_2hr1srUFwSczcUU0tw0UmHl9Wa3Ha8a4xVYJQV3FCuzJmIwfAX-J2nQRCcJ0U4Qfpm7esz6acqKw';
/** A browser's subscription keys. */
const P256DH = 'BLiMNAE4WkUW7IsQSZJRebfRwHESWUCL0lncEToJAee__ewUFcw0C9H18fQj_OPhkhPHJLPwWclCDUerWNUgf_8';
const AUTH = 'zuANbj48wKSj0RvuadgMNQ';
const ENDPOINT_1 = 'https://fcm.googleapis.com/fcm/send/device-one:APA91bExample';
const ENDPOINT_2 = 'https://fcm.googleapis.com/fcm/send/device-two:APA91bExample';

const LIVE = storageKeys('live');
const DEMO = storageKeys('demo');

function bytes(b64url: string): number[] {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  return Array.from(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)), (c) => c.charCodeAt(0));
}

function toBase64Url(data: number[]): string {
  return btoa(String.fromCharCode(...data)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** What push.register must receive for a subscription: canonical JSON, endpoint then keys, no expirationTime. */
function tokenFor(endpoint: string): string {
  return `{"endpoint":"${endpoint}","keys":{"p256dh":"${P256DH}","auth":"${AUTH}"}}`;
}

function storeLiveRecord(endpoint: string, { key = KEY, at = new Date().toISOString() } = {}): void {
  localStorage.setItem(LIVE.push, JSON.stringify({ token: tokenFor(endpoint), key, at }));
}

function liveRecord(): { token: string; key?: string; at: string } | null {
  const raw = localStorage.getItem(LIVE.push);
  return raw ? (JSON.parse(raw) as { token: string; key?: string; at: string }) : null;
}

// --- fake Push API -------------------------------------------------------------

class FakeSubscription {
  readonly unsubscribe = vi.fn(async () => {
    if (this.manager.current === this) this.manager.current = null;
    return true;
  });

  constructor(
    private readonly manager: FakePushManager,
    readonly endpoint: string,
    private readonly key: Uint8Array | null,
  ) {}

  get options() {
    return { userVisibleOnly: true, applicationServerKey: this.key ? this.key.slice().buffer : null };
  }

  toJSON() {
    return { endpoint: this.endpoint, expirationTime: null, keys: { p256dh: P256DH, auth: AUTH } };
  }
}

class FakePushManager {
  current: FakeSubscription | null = null;
  /** Endpoints handed out by subscribe(), in order. */
  endpoints = [ENDPOINT_1, ENDPOINT_2, 'https://fcm.googleapis.com/fcm/send/device-three'];
  subscribeError: Error | null = null;

  readonly getSubscription = vi.fn(async () => this.current);

  readonly subscribe = vi.fn(async (options: PushSubscriptionOptionsInit) => {
    if (this.subscribeError) throw this.subscribeError;
    const key = new Uint8Array(options.applicationServerKey as Uint8Array);
    if (this.current) {
      // Like Chrome: a different key while a subscription exists is an error.
      const same = Array.from(new Uint8Array(this.current.options.applicationServerKey!)).join() === Array.from(key).join();
      if (!same) throw new DOMException('A subscription with a different applicationServerKey already exists.', 'InvalidStateError');
      return this.current;
    }
    this.current = new FakeSubscription(this, this.endpoints.shift() ?? ENDPOINT_1, key);
    return this.current;
  });

  /** A subscription that already exists in the browser. */
  existing(endpoint: string, key: string | null): FakeSubscription {
    this.current = new FakeSubscription(this, endpoint, key ? new Uint8Array(bytes(key)) : null);
    return this.current;
  }
}

// --- environment helpers ----------------------------------------------------

const navigatorOverrides: string[] = [];

function setNavigator(props: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(props)) {
    Object.defineProperty(navigator, key, { value, configurable: true, writable: true });
    navigatorOverrides.push(key);
  }
}

function setStandaloneMedia(matches: boolean): void {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({ matches: matches && query.includes('standalone'), media: query })),
  );
}

class FakeNotification {
  static permission: NotificationPermission = 'default';
  static nextAnswer: NotificationPermission = 'granted';
  static requestPermission = vi.fn(async () => {
    FakeNotification.permission = FakeNotification.nextAnswer;
    return FakeNotification.permission;
  });
}

/** A browser that can do Web Push (Android Chrome by default) with a ready service worker. */
function pushCapableBrowser({ ua = ANDROID_UA, permission = 'default' as NotificationPermission } = {}): FakePushManager {
  const pushManager = new FakePushManager();
  FakeNotification.permission = permission;
  FakeNotification.nextAnswer = 'granted';
  vi.stubGlobal('Notification', FakeNotification);
  vi.stubGlobal('PushManager', function PushManager() {});
  const registration = { scope: 'https://example.org/tma/', pushManager };
  setNavigator({ userAgent: ua, serviceWorker: { ready: Promise.resolve(registration) } });
  return pushManager;
}

type Call = { action: ApiAction; params: unknown };

function fakeApi(mode: 'demo' | 'live', fail?: ApiError): ApiClient & { calls: Call[] } {
  const calls: Call[] = [];
  return {
    mode,
    calls,
    getToken: () => 'session-token',
    setToken: () => undefined,
    async call<A extends ApiAction>(action: A, params: ApiParams<A>) {
      calls.push({ action, params });
      if (fail) throw fail;
      return { devices: 1 } as never;
    },
  };
}

/** A session token for `email` (ARCHITECTURE.md §4: base64url(JSON{e, v, x}) + "." + hmac). */
function sessionTokenFor(email: string): string {
  const payload = btoa(JSON.stringify({ e: email, v: 1, x: Date.now() + 86_400_000 }));
  return `${payload.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}.signature`;
}

/** `email` signed in on this device: the stored session (getPushSupport) and the client's token. */
function signedInAs(email: string, api: ApiClient & { calls: Call[] }): ApiClient & { calls: Call[] } {
  const token = sessionTokenFor(email);
  localStorage.setItem(LIVE.session, token);
  return { ...api, getToken: () => token };
}

function tokensOf(calls: Call[]): Array<[ApiAction, string]> {
  return calls.map((c) => [c.action, (c.params as { token: string }).token]);
}

beforeEach(() => {
  localStorage.clear();
  FakeNotification.requestPermission.mockClear();
  vi.stubEnv('VITE_API_URL', 'https://script.google.com/macros/s/abc/exec');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  for (const key of navigatorOverrides.splice(0)) delete (navigator as unknown as Record<string, unknown>)[key];
});

// --- platform ---------------------------------------------------------------

describe('isIos', () => {
  it('detects iPhone and iPadOS (desktop user agent with a touch screen)', () => {
    setNavigator({ userAgent: IPHONE_UA });
    expect(isIos()).toBe(true);
    setNavigator({ userAgent: IPAD_DESKTOP_UA, maxTouchPoints: 5 });
    expect(isIos()).toBe(true);
  });

  it('does not mistake a Mac or Android phone for iOS', () => {
    setNavigator({ userAgent: IPAD_DESKTOP_UA, maxTouchPoints: 0 });
    expect(isIos()).toBe(false);
    setNavigator({ userAgent: ANDROID_UA, maxTouchPoints: 5 });
    expect(isIos()).toBe(false);
  });
});

describe('isStandalone', () => {
  it('is true for display-mode standalone or the iOS navigator.standalone flag', () => {
    setStandaloneMedia(true);
    expect(isStandalone()).toBe(true);
    setStandaloneMedia(false);
    expect(isStandalone()).toBe(false);
    setNavigator({ standalone: true });
    expect(isStandalone()).toBe(true);
  });

  it('copes with browsers without matchMedia', () => {
    expect(isStandalone()).toBe(false);
  });
});

// --- keys and tokens ------------------------------------------------------------

describe('applicationServerKey', () => {
  it("decodes the Worker's base64url public key to the 65 key bytes", () => {
    const key = applicationServerKey(KEY);
    expect(key).toBeInstanceOf(Uint8Array);
    expect(Array.from(key!)).toEqual(bytes(KEY));
    expect(key![0]).toBe(4);
    expect(Array.from(applicationServerKey(`  ${KEY}  `)!)).toEqual(bytes(KEY));
  });

  it.each([
    ['empty', ''],
    ['missing', undefined],
    ['not base64', 'not a key!'],
    ['too short', KEY.slice(0, 40)],
    ['a compressed point', toBase64Url([2, ...bytes(KEY).slice(1, 33)])],
    ['65 bytes that are not an uncompressed point', toBase64Url([5, ...bytes(KEY).slice(1)])],
    ['too long', `${KEY}${KEY}${KEY}`],
  ])('rejects %s', (_label, value) => {
    expect(applicationServerKey(value)).toBeNull();
  });
});

describe('isDeliverableEndpoint', () => {
  it.each([
    'https://fcm.googleapis.com/fcm/send/abc',
    'https://updates.push.services.mozilla.com/wpush/v2/abc',
    'https://web.push.apple.com/QOabc',
    'https://api.push.apple.com/3/device/abc',
    'https://wns2-by3p.notify.windows.com/w/?token=abc',
  ])('accepts %s', (endpoint) => {
    expect(isDeliverableEndpoint(endpoint)).toBe(true);
  });

  it.each([
    'http://fcm.googleapis.com/fcm/send/abc',
    'https://fcm.googleapis.com:8443/fcm/send/abc',
    'https://evil.example/fcm.googleapis.com',
    'https://fcm.googleapis.com.evil.example/x',
    'https://user:pw@fcm.googleapis.com/x',
    'https://push.apple.com.evil.example/x',
    'not a url',
    `https://fcm.googleapis.com/${'a'.repeat(2100)}`,
  ])('rejects %s', (endpoint) => {
    expect(isDeliverableEndpoint(endpoint)).toBe(false);
  });
});

describe('canonicalToken', () => {
  it('keeps only the endpoint and keys, in a fixed order', () => {
    const token = canonicalToken({ expirationTime: 123, keys: { auth: AUTH, p256dh: P256DH, extra: 'x' }, endpoint: ENDPOINT_1 });
    expect(token).toBe(tokenFor(ENDPOINT_1));
    expect(JSON.parse(token!)).toEqual({ endpoint: ENDPOINT_1, keys: { p256dh: P256DH, auth: AUTH } });
  });

  it.each([
    ['no keys', { endpoint: ENDPOINT_1 }],
    ['an unknown push service', { endpoint: 'https://push.example.com/abc', keys: { p256dh: P256DH, auth: AUTH } }],
    ['a short p256dh', { endpoint: ENDPOINT_1, keys: { p256dh: P256DH.slice(0, 20), auth: AUTH } }],
    ['a long auth', { endpoint: ENDPOINT_1, keys: { p256dh: P256DH, auth: `${AUTH}AAAA` } }],
    ['not an object', 'subscription'],
  ])('rejects %s', (_label, value) => {
    expect(canonicalToken(value)).toBeNull();
  });
});

// --- support states -------------------------------------------------------------

describe('getPushSupport (live)', () => {
  it('is not-configured without a public key from the server, or with a malformed one', async () => {
    pushCapableBrowser();
    expect(await getPushSupport({ mode: 'live' })).toBe('not-configured');
    expect(await getPushSupport({ mode: 'live', publicKey: '' })).toBe('not-configured');
    expect(await getPushSupport({ mode: 'live', publicKey: 'nonsense' })).toBe('not-configured');
    expect(await getPushSupport({ mode: 'live', publicKey: KEY })).toBe('ready');
  });

  it('uses the page mode by default (live build)', async () => {
    pushCapableBrowser();
    expect(await getPushSupport()).toBe('not-configured');
    expect(await getPushSupport({ publicKey: KEY })).toBe('ready');
  });

  it('is needs-install on iPhone Safari outside the Home Screen app', async () => {
    setStandaloneMedia(false);
    setNavigator({ userAgent: IPHONE_UA });
    expect(await getPushSupport({ mode: 'live', publicKey: KEY })).toBe('needs-install');
  });

  it('is needs-install on iPadOS with a desktop user agent', async () => {
    setNavigator({ userAgent: IPAD_DESKTOP_UA, maxTouchPoints: 5 });
    expect(await getPushSupport({ mode: 'live', publicKey: KEY })).toBe('needs-install');
  });

  it('is ready on iPhone once installed to the Home Screen', async () => {
    pushCapableBrowser({ ua: IPHONE_UA });
    setNavigator({ standalone: true });
    expect(await getPushSupport({ mode: 'live', publicKey: KEY })).toBe('ready');
  });

  it('is unsupported without the Notification / Push APIs', async () => {
    setNavigator({ userAgent: ANDROID_UA, serviceWorker: { ready: new Promise(() => {}) } });
    expect(await getPushSupport({ mode: 'live', publicKey: KEY })).toBe('unsupported');
  });

  it('reports blocked, ready and enabled from the permission and stored registration', async () => {
    pushCapableBrowser({ permission: 'denied' });
    expect(await getPushSupport({ mode: 'live', publicKey: KEY })).toBe('blocked');

    FakeNotification.permission = 'granted';
    expect(await getPushSupport({ mode: 'live', publicKey: KEY })).toBe('ready');

    storeLiveRecord(ENDPOINT_1);
    expect(await getPushSupport({ mode: 'live', publicKey: KEY })).toBe('enabled');

    FakeNotification.permission = 'default';
    expect(await getPushSupport({ mode: 'live', publicKey: KEY })).toBe('ready');
  });

  it('ignores a stored value that is not a subscription (e.g. an old Firebase or demo token)', async () => {
    pushCapableBrowser({ permission: 'granted' });
    for (const token of ['fcm-token-1234567890', 'demo-abc', '{"endpoint":"https://evil.example/x","keys":{}}']) {
      localStorage.setItem(LIVE.push, JSON.stringify({ token, at: new Date().toISOString() }));
      expect(await getPushSupport({ mode: 'live', publicKey: KEY })).toBe('ready');
    }
    localStorage.setItem(LIVE.push, '{not json');
    expect(await getPushSupport({ mode: 'live', publicKey: KEY })).toBe('ready');
  });
});

describe('getPushSupport (demo)', () => {
  it('is ready on any device (banners show in the app) and enabled once a demo token is stored', async () => {
    setNavigator({ userAgent: IPHONE_UA });
    expect(await getPushSupport({ mode: 'demo' })).toBe('ready');
    localStorage.setItem(DEMO.push, JSON.stringify({ token: `${DEMO_TOKEN_PREFIX}abc`, at: new Date().toISOString() }));
    expect(await getPushSupport({ mode: 'demo' })).toBe('enabled');
  });

  it('keeps the demo and live registrations apart', async () => {
    pushCapableBrowser({ permission: 'granted' });
    storeLiveRecord(ENDPOINT_1);
    expect(await getPushSupport({ mode: 'demo' })).toBe('ready');
    localStorage.clear();
    localStorage.setItem(DEMO.push, JSON.stringify({ token: `${DEMO_TOKEN_PREFIX}abc`, at: '' }));
    expect(await getPushSupport({ mode: 'live', publicKey: KEY })).toBe('ready');
  });

  it('is the default without VITE_API_URL, or after "?demo" on a live build', async () => {
    vi.stubEnv('VITE_API_URL', '');
    expect(await getPushSupport()).toBe('ready');
    vi.stubEnv('VITE_API_URL', 'https://script.google.com/macros/s/abc/exec');
    localStorage.setItem(MODE_KEY, 'demo');
    expect(await getPushSupport()).toBe('ready'); // no key needed in the demo
  });
});

// --- enable / disable -------------------------------------------------------------

describe('enablePush (demo)', () => {
  it('registers a demo token, stores it under the demo key and never touches the real subscription', async () => {
    const pushManager = pushCapableBrowser({ permission: 'granted' });
    const api = fakeApi('demo');
    expect(await enablePush(api)).toEqual({ ok: true });
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0].action).toBe('push.register');
    const token = (api.calls[0].params as { token: string }).token;
    expect(token).toMatch(/^demo-[0-9a-f-]{32,36}$/);
    expect(JSON.parse(localStorage.getItem(DEMO.push)!).token).toBe(token);
    expect(localStorage.getItem(LIVE.push)).toBeNull();
    expect(pushManager.getSubscription).not.toHaveBeenCalled();
    expect(pushManager.subscribe).not.toHaveBeenCalled();
  });

  it('asks for permission when possible but carries on when it is denied', async () => {
    pushCapableBrowser();
    FakeNotification.nextAnswer = 'denied';
    const api = fakeApi('demo');
    expect(await enablePush(api)).toEqual({ ok: true });
    expect(FakeNotification.requestPermission).toHaveBeenCalledTimes(1);
    expect(api.calls[0].action).toBe('push.register');
  });

  it('replaces this device’s previous demo token', async () => {
    const api = fakeApi('demo');
    await enablePush(api);
    const first = JSON.parse(localStorage.getItem(DEMO.push)!).token as string;
    await enablePush(api);
    const second = JSON.parse(localStorage.getItem(DEMO.push)!).token as string;
    expect(second).not.toBe(first);
    expect(api.calls.map((c) => c.action)).toEqual(['push.register', 'push.register', 'push.unregister']);
    expect(api.calls[2].params).toEqual({ token: first });
  });

  it('returns the server message when registration fails', async () => {
    const api = fakeApi('demo', new ApiError('RATE_LIMITED', 'Too many device registrations.'));
    expect(await enablePush(api)).toEqual({ ok: false, reason: 'Too many device registrations.' });
    expect(localStorage.getItem(DEMO.push)).toBeNull();
  });

  it('forgetDemoPushToken clears only the demo registration', () => {
    storeLiveRecord(ENDPOINT_1);
    localStorage.setItem(DEMO.push, JSON.stringify({ token: 'demo-123', at: '' }));
    forgetDemoPushToken();
    expect(localStorage.getItem(DEMO.push)).toBeNull();
    expect(liveRecord()?.token).toBe(tokenFor(ENDPOINT_1));
  });
});

describe('enablePush (live)', () => {
  it('asks permission, subscribes with the decoded key and registers the canonical subscription JSON', async () => {
    const pushManager = pushCapableBrowser();
    const api = fakeApi('live');

    expect(await enablePush(api, KEY)).toEqual({ ok: true });

    expect(FakeNotification.requestPermission).toHaveBeenCalledTimes(1);
    expect(pushManager.subscribe).toHaveBeenCalledTimes(1);
    const options = pushManager.subscribe.mock.calls[0][0];
    expect(options.userVisibleOnly).toBe(true);
    expect(options.applicationServerKey).toBeInstanceOf(Uint8Array);
    expect(Array.from(options.applicationServerKey as Uint8Array)).toEqual(bytes(KEY));
    expect(api.calls).toEqual([{ action: 'push.register', params: { token: tokenFor(ENDPOINT_1), userAgent: ANDROID_UA } }]);
    expect(liveRecord()).toMatchObject({ token: tokenFor(ENDPOINT_1), key: KEY });
    expect(localStorage.getItem(DEMO.push)).toBeNull();
    expect(await getPushSupport({ mode: 'live', publicKey: KEY })).toBe('enabled');
  });

  it('reuses a subscription this browser already has for the same key', async () => {
    const pushManager = pushCapableBrowser({ permission: 'granted' });
    pushManager.existing(ENDPOINT_2, KEY);
    const api = fakeApi('live');
    expect(await enablePush(api, KEY)).toEqual({ ok: true });
    expect(pushManager.subscribe).not.toHaveBeenCalled();
    expect(tokensOf(api.calls)).toEqual([['push.register', tokenFor(ENDPOINT_2)]]);
  });

  it('drops a subscription made with an old key before subscribing with the new one', async () => {
    const pushManager = pushCapableBrowser({ permission: 'granted' });
    const old = pushManager.existing(ENDPOINT_2, KEY);
    const api = fakeApi('live');

    expect(await enablePush(api, NEW_KEY)).toEqual({ ok: true });

    expect(old.unsubscribe).toHaveBeenCalledTimes(1);
    expect(old.unsubscribe.mock.invocationCallOrder[0]).toBeLessThan(pushManager.subscribe.mock.invocationCallOrder[0]);
    expect(Array.from(pushManager.subscribe.mock.calls[0][0].applicationServerKey as Uint8Array)).toEqual(bytes(NEW_KEY));
    expect(tokensOf(api.calls)).toEqual([['push.register', tokenFor(ENDPOINT_1)]]);
    expect(liveRecord()?.key).toBe(NEW_KEY);
  });

  it('replaces a subscription that was made without a key', async () => {
    const pushManager = pushCapableBrowser({ permission: 'granted' });
    const keyless = pushManager.existing(ENDPOINT_2, null);
    expect(await enablePush(fakeApi('live'), KEY)).toEqual({ ok: true });
    expect(keyless.unsubscribe).toHaveBeenCalled();
    expect(pushManager.subscribe).toHaveBeenCalledTimes(1);
  });

  it('replaces the token this device registered before', async () => {
    const pushManager = pushCapableBrowser({ permission: 'granted' });
    storeLiveRecord(ENDPOINT_2);
    pushManager.existing(ENDPOINT_1, KEY);
    const api = fakeApi('live');
    await enablePush(api, KEY);
    expect(tokensOf(api.calls)).toEqual([
      ['push.register', tokenFor(ENDPOINT_1)],
      ['push.unregister', tokenFor(ENDPOINT_2)],
    ]);
  });

  it('stops when the parent blocks notifications', async () => {
    const pushManager = pushCapableBrowser();
    FakeNotification.nextAnswer = 'denied';
    const api = fakeApi('live');
    const result = await enablePush(api, KEY);
    expect(result.ok === false && result.reason).toMatch(/blocked/i);
    expect(api.calls).toEqual([]);
    expect(pushManager.subscribe).not.toHaveBeenCalled();
  });

  it('asks again when the parent closes the prompt', async () => {
    pushCapableBrowser();
    FakeNotification.nextAnswer = 'default';
    const result = await enablePush(fakeApi('live'), KEY);
    expect(result.ok === false && result.reason).toMatch(/still off/);
  });

  it('explains needs-install / not-configured without asking for permission', async () => {
    setNavigator({ userAgent: IPHONE_UA });
    const iphone = await enablePush(fakeApi('live'), KEY);
    expect(iphone.ok === false && iphone.reason).toMatch(/Home Screen/);

    pushCapableBrowser();
    const unconfigured = await enablePush(fakeApi('live'), '');
    expect(unconfigured.ok === false && unconfigured.reason).toMatch(/hasn't switched on/);
    const noKey = await enablePush(fakeApi('live'));
    expect(noKey.ok === false && noKey.reason).toMatch(/hasn't switched on/);
    expect(FakeNotification.requestPermission).not.toHaveBeenCalled();
  });

  it('does not keep a subscription on a push service TMA cannot deliver to', async () => {
    const pushManager = pushCapableBrowser({ permission: 'granted' });
    pushManager.endpoints = ['https://push.example.com/send/abc'];
    const api = fakeApi('live');
    const result = await enablePush(api, KEY);
    expect(result.ok === false && result.reason).toMatch(/can't receive notifications/);
    expect(pushManager.current).toBeNull();
    expect(api.calls).toEqual([]);
    expect(liveRecord()).toBeNull();
  });

  it('turns subscribe failures into friendly messages and stores nothing', async () => {
    const pushManager = pushCapableBrowser();
    pushManager.subscribeError = new DOMException('Registration failed - push service not available', 'AbortError');
    const api = fakeApi('live');
    expect(await enablePush(api, KEY)).toEqual({
      ok: false,
      reason: "Couldn't turn on notifications on this device. Please try again.",
    });
    expect(api.calls).toEqual([]);
    expect(liveRecord()).toBeNull();

    pushManager.subscribeError = new DOMException('Permission denied', 'NotAllowedError');
    const denied = await enablePush(api, KEY);
    expect(denied.ok === false && denied.reason).toMatch(/blocked/);
  });

  it('gives up when the service worker never becomes ready', async () => {
    vi.useFakeTimers();
    try {
      pushCapableBrowser({ permission: 'granted' });
      setNavigator({ serviceWorker: { ready: new Promise(() => {}) } });
      const pending = enablePush(fakeApi('live'), KEY);
      await vi.advanceTimersByTimeAsync(15_000);
      const result = await pending;
      expect(result.ok === false && result.reason).toMatch(/still getting ready/);
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows the server message when TMA refuses the registration', async () => {
    pushCapableBrowser({ permission: 'granted' });
    const result = await enablePush(fakeApi('live', new ApiError('BAD_REQUEST', 'That device token is not valid.')), KEY);
    expect(result).toEqual({ ok: false, reason: 'That device token is not valid.' });
    expect(liveRecord()).toBeNull();
  });
});

describe('disablePush', () => {
  it('unregisters the token, unsubscribes the browser and forgets it', async () => {
    const pushManager = pushCapableBrowser({ permission: 'granted' });
    const sub = pushManager.existing(ENDPOINT_1, KEY);
    storeLiveRecord(ENDPOINT_1);
    const api = fakeApi('live');
    await disablePush(api);
    expect(tokensOf(api.calls)).toEqual([['push.unregister', tokenFor(ENDPOINT_1)]]);
    expect(sub.unsubscribe).toHaveBeenCalledTimes(1);
    expect(liveRecord()).toBeNull();
  });

  it('keeps everything when TMA cannot be reached, so the parent can retry', async () => {
    const pushManager = pushCapableBrowser({ permission: 'granted' });
    const sub = pushManager.existing(ENDPOINT_1, KEY);
    storeLiveRecord(ENDPOINT_1);
    await expect(disablePush(fakeApi('live', new ApiError('INTERNAL', 'Network problem')))).rejects.toThrow('Network problem');
    expect(liveRecord()?.token).toBe(tokenFor(ENDPOINT_1));
    expect(sub.unsubscribe).not.toHaveBeenCalled();
  });

  it('on sign-out, unsubscribes the browser and forgets the device even when TMA cannot be reached', async () => {
    const pushManager = pushCapableBrowser({ permission: 'granted' });
    const sub = pushManager.existing(ENDPOINT_1, KEY);
    storeLiveRecord(ENDPOINT_1);
    const api = fakeApi('live', new ApiError('INTERNAL', 'Network problem'));
    await expect(disablePush(api, { signingOut: true })).resolves.toBeUndefined();
    expect(tokensOf(api.calls)).toEqual([['push.unregister', tokenFor(ENDPOINT_1)]]);
    // The push service now answers "gone", so TMA drops the row on its next send.
    expect(sub.unsubscribe).toHaveBeenCalledTimes(1);
    expect(liveRecord()).toBeNull();
    expect(await getPushSupport({ mode: 'live', publicKey: KEY })).toBe('ready');
  });

  it('on sign-out, does not wait for a slow TMA before unsubscribing the browser', async () => {
    const pushManager = pushCapableBrowser({ permission: 'granted' });
    const sub = pushManager.existing(ENDPOINT_1, KEY);
    storeLiveRecord(ENDPOINT_1);
    let fail!: (err: unknown) => void;
    const api: ApiClient = {
      mode: 'live',
      getToken: () => 'session-token',
      setToken: () => undefined,
      call: () => new Promise<never>((_, reject) => (fail = reject)),
    };
    const signingOut = disablePush(api, { signingOut: true });
    // Sign-out waits at most 4 s, and the tab may be closed right after: don't depend on TMA answering.
    await vi.waitFor(() => expect(sub.unsubscribe).toHaveBeenCalledTimes(1));
    expect(liveRecord()).toBeNull();
    fail(new ApiError('INTERNAL', 'The TMA server took too long to answer.'));
    await expect(signingOut).resolves.toBeUndefined();
  });

  it('on sign-out in the demo, forgets the demo token even when the call fails', async () => {
    const pushManager = pushCapableBrowser({ permission: 'granted' });
    const sub = pushManager.existing(ENDPOINT_1, KEY);
    localStorage.setItem(DEMO.push, JSON.stringify({ token: 'demo-abc', at: '' }));
    await disablePush(fakeApi('demo', new ApiError('INTERNAL', 'oops')), { signingOut: true });
    expect(localStorage.getItem(DEMO.push)).toBeNull();
    expect(sub.unsubscribe).not.toHaveBeenCalled();
  });

  it('still clears the device when the session has expired', async () => {
    pushCapableBrowser({ permission: 'granted' }).existing(ENDPOINT_1, KEY);
    storeLiveRecord(ENDPOINT_1);
    await disablePush(fakeApi('live', new ApiError('UNAUTHORIZED', 'Please sign in again.')));
    expect(liveRecord()).toBeNull();
  });

  it('does nothing without a registration', async () => {
    const pushManager = pushCapableBrowser({ permission: 'granted' });
    const api = fakeApi('live');
    await disablePush(api);
    expect(api.calls).toEqual([]);
    expect(pushManager.getSubscription).not.toHaveBeenCalled();
  });

  it('in the demo, forgets only the demo token and leaves the real subscription alone', async () => {
    const pushManager = pushCapableBrowser({ permission: 'granted' });
    const sub = pushManager.existing(ENDPOINT_1, KEY);
    storeLiveRecord(ENDPOINT_1);
    localStorage.setItem(DEMO.push, JSON.stringify({ token: 'demo-abc', at: '' }));
    const api = fakeApi('demo');
    await disablePush(api);
    expect(tokensOf(api.calls)).toEqual([['push.unregister', 'demo-abc']]);
    expect(localStorage.getItem(DEMO.push)).toBeNull();
    expect(sub.unsubscribe).not.toHaveBeenCalled();
    expect(liveRecord()?.token).toBe(tokenFor(ENDPOINT_1));
  });
});

describe('refreshPushRegistration', () => {
  it('stays quiet when the subscription is unchanged and recently registered', async () => {
    const pushManager = pushCapableBrowser({ permission: 'granted' });
    pushManager.existing(ENDPOINT_1, KEY);
    storeLiveRecord(ENDPOINT_1);
    const api = fakeApi('live');
    await refreshPushRegistration(api, KEY);
    expect(api.calls).toEqual([]);
    expect(pushManager.subscribe).not.toHaveBeenCalled();
  });

  it('re-registers when the endpoint changed since last time', async () => {
    const pushManager = pushCapableBrowser({ permission: 'granted' });
    pushManager.existing(ENDPOINT_2, KEY);
    storeLiveRecord(ENDPOINT_1);
    const api = fakeApi('live');
    await refreshPushRegistration(api, KEY);
    expect(tokensOf(api.calls)).toEqual([
      ['push.register', tokenFor(ENDPOINT_2)],
      ['push.unregister', tokenFor(ENDPOINT_1)],
    ]);
    expect(liveRecord()?.token).toBe(tokenFor(ENDPOINT_2));
  });

  it('subscribes again when the browser dropped the subscription', async () => {
    const pushManager = pushCapableBrowser({ permission: 'granted' });
    storeLiveRecord(ENDPOINT_2);
    const api = fakeApi('live');
    await refreshPushRegistration(api, KEY);
    expect(Array.from(pushManager.subscribe.mock.calls[0][0].applicationServerKey as Uint8Array)).toEqual(bytes(KEY));
    expect(tokensOf(api.calls)).toEqual([
      ['push.register', tokenFor(ENDPOINT_1)],
      ['push.unregister', tokenFor(ENDPOINT_2)],
    ]);
  });

  it('re-subscribes with the new key after the Worker keys were replaced', async () => {
    const pushManager = pushCapableBrowser({ permission: 'granted' });
    const old = pushManager.existing(ENDPOINT_2, KEY);
    storeLiveRecord(ENDPOINT_2);
    const api = fakeApi('live');
    await refreshPushRegistration(api, NEW_KEY);
    expect(old.unsubscribe).toHaveBeenCalled();
    expect(Array.from(pushManager.subscribe.mock.calls[0][0].applicationServerKey as Uint8Array)).toEqual(bytes(NEW_KEY));
    expect(tokensOf(api.calls)).toEqual([
      ['push.register', tokenFor(ENDPOINT_1)],
      ['push.unregister', tokenFor(ENDPOINT_2)],
    ]);
    expect(liveRecord()).toMatchObject({ token: tokenFor(ENDPOINT_1), key: NEW_KEY });
  });

  it('does not unregister the old token when only the keys changed (TMA matches devices by endpoint)', async () => {
    const pushManager = pushCapableBrowser({ permission: 'granted' });
    pushManager.existing(ENDPOINT_1, KEY);
    const oldKeys = `{"endpoint":"${ENDPOINT_1}","keys":{"p256dh":"${NEW_KEY}","auth":"${AUTH}"}}`;
    localStorage.setItem(LIVE.push, JSON.stringify({ token: oldKeys, key: KEY, at: new Date().toISOString() }));
    const api = fakeApi('live');
    await refreshPushRegistration(api, KEY);
    expect(tokensOf(api.calls)).toEqual([['push.register', tokenFor(ENDPOINT_1)]]);
    expect(liveRecord()?.token).toBe(tokenFor(ENDPOINT_1));
  });

  it('remembers which account turned push on, and keeps quiet for that account', async () => {
    const pushManager = pushCapableBrowser({ permission: 'granted' });
    const avery = signedInAs('parent@example.com', fakeApi('live'));
    expect(await enablePush(avery, KEY)).toEqual({ ok: true });
    expect(liveRecord()).toMatchObject({ token: tokenFor(ENDPOINT_1), email: 'parent@example.com' });

    avery.calls.length = 0;
    await refreshPushRegistration(avery, KEY);
    expect(avery.calls).toEqual([]);
    expect(pushManager.current?.unsubscribe).not.toHaveBeenCalled();
    expect(await getPushSupport({ mode: 'live', publicKey: KEY })).toBe('enabled');
  });

  it("turns off another account's registration left on this device (failed sign-out or expired session)", async () => {
    const pushManager = pushCapableBrowser({ permission: 'granted' });
    const sub = pushManager.existing(ENDPOINT_1, KEY);
    localStorage.setItem(
      LIVE.push,
      JSON.stringify({ token: tokenFor(ENDPOINT_1), key: KEY, email: 'parent@example.com', at: new Date().toISOString() }),
    );
    const other = signedInAs('nguyen@example.com', fakeApi('live'));

    // The device isn't on for the person signed in now, whatever the browser says…
    expect(await getPushSupport({ mode: 'live', publicKey: KEY })).toBe('ready');
    await refreshPushRegistration(other, KEY);

    // …and the first family's notifications stop: the push service will answer "gone" for their row.
    expect(sub.unsubscribe).toHaveBeenCalledTimes(1);
    expect(liveRecord()).toBeNull();
    expect(other.calls).toEqual([]); // never moved to this account without asking
    expect(pushManager.subscribe).not.toHaveBeenCalled();
  });

  it('re-registers an unchanged subscription after a week', async () => {
    const pushManager = pushCapableBrowser({ permission: 'granted' });
    pushManager.existing(ENDPOINT_1, KEY);
    storeLiveRecord(ENDPOINT_1, { at: new Date(Date.now() - 8 * 86_400_000).toISOString() });
    const api = fakeApi('live');
    await refreshPushRegistration(api, KEY);
    expect(tokensOf(api.calls)).toEqual([['push.register', tokenFor(ENDPOINT_1)]]);
  });

  it('never turns push back on by itself, and does nothing in the demo, signed out, or without a key', async () => {
    const pushManager = pushCapableBrowser({ permission: 'granted' });
    pushManager.existing(ENDPOINT_2, KEY);
    const api = fakeApi('live');
    await refreshPushRegistration(api, KEY); // permission granted but the parent turned push off (no record)

    storeLiveRecord(ENDPOINT_1);
    await refreshPushRegistration(fakeApi('demo'), KEY);
    await refreshPushRegistration(api, '');
    await refreshPushRegistration(api);
    const signedOut = { ...fakeApi('live'), getToken: () => null };
    await refreshPushRegistration(signedOut, KEY);
    FakeNotification.permission = 'denied';
    await refreshPushRegistration(api, KEY);

    expect(api.calls).toEqual([]);
    expect(signedOut.calls).toEqual([]);
    expect(pushManager.getSubscription).not.toHaveBeenCalled();
  });

  it('shows "Turn on" again when the subscription is gone and a new one cannot be made', async () => {
    const pushManager = pushCapableBrowser({ permission: 'granted' });
    pushManager.subscribeError = new DOMException('no', 'AbortError');
    storeLiveRecord(ENDPOINT_1);
    const api = fakeApi('live');
    await expect(refreshPushRegistration(api, KEY)).resolves.toBeUndefined();
    expect(tokensOf(api.calls)).toEqual([['push.unregister', tokenFor(ENDPOINT_1)]]);
    expect(liveRecord()).toBeNull();
    expect(await getPushSupport({ mode: 'live', publicKey: KEY })).toBe('ready');
  });

  it('swallows other failures and keeps the registration', async () => {
    const pushManager = pushCapableBrowser({ permission: 'granted' });
    pushManager.existing(ENDPOINT_2, KEY);
    storeLiveRecord(ENDPOINT_1);
    await expect(refreshPushRegistration(fakeApi('live', new ApiError('INTERNAL', 'offline')), KEY)).resolves.toBeUndefined();
    expect(liveRecord()?.token).toBe(tokenFor(ENDPOINT_1));
  });

  it('does not undo "Turn off" pressed while it was registering', async () => {
    const pushManager = pushCapableBrowser({ permission: 'granted' });
    pushManager.existing(ENDPOINT_2, KEY);
    storeLiveRecord(ENDPOINT_1);
    let release!: () => void;
    const calls: Call[] = [];
    const api: ApiClient = {
      mode: 'live',
      getToken: () => 'session-token',
      setToken: () => undefined,
      async call<A extends ApiAction>(action: A, params: ApiParams<A>) {
        calls.push({ action, params });
        if (action === 'push.register') await new Promise<void>((resolve) => (release = resolve));
        return { devices: 1 } as never;
      },
    };

    const refreshing = refreshPushRegistration(api, KEY);
    await vi.waitFor(() => expect(calls).toHaveLength(1)); // push.register is in flight
    await disablePush(api);
    release();
    await refreshing;

    expect(tokensOf(calls)).toEqual([
      ['push.register', tokenFor(ENDPOINT_2)],
      ['push.unregister', tokenFor(ENDPOINT_1)], // Turn off
      ['push.unregister', tokenFor(ENDPOINT_2)], // the refresh takes its registration back out
    ]);
    expect(liveRecord()).toBeNull();
  });

  it('leaves the registration to a newer refresh that took over', async () => {
    const pushManager = pushCapableBrowser({ permission: 'granted' });
    pushManager.existing(ENDPOINT_2, KEY);
    storeLiveRecord(ENDPOINT_1);
    let release!: () => void;
    const calls: Call[] = [];
    const api: ApiClient = {
      mode: 'live',
      getToken: () => 'session-token',
      setToken: () => undefined,
      async call<A extends ApiAction>(action: A, params: ApiParams<A>) {
        calls.push({ action, params });
        if (action === 'push.register' && calls.length === 1) await new Promise<void>((resolve) => (release = resolve));
        return { devices: 1 } as never;
      },
    };

    const first = refreshPushRegistration(api, KEY);
    await vi.waitFor(() => expect(calls).toHaveLength(1)); // the first refresh is registering
    await refreshPushRegistration(api, KEY); // e.g. 'pushsubscriptionchange' meanwhile
    release();
    await first;

    expect(tokensOf(calls)).toEqual([
      ['push.register', tokenFor(ENDPOINT_2)],
      ['push.register', tokenFor(ENDPOINT_2)],
      ['push.unregister', tokenFor(ENDPOINT_1)],
    ]);
    expect(liveRecord()?.token).toBe(tokenFor(ENDPOINT_2));
  });
});
