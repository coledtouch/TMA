// @vitest-environment jsdom
import type { ApiAction, ApiParams } from '../../shared/types';
import { ApiError, type ApiClient } from '../api/client';
import {
  DEMO_TOKEN_PREFIX,
  disablePush,
  enablePush,
  forgetDemoPushToken,
  getPushSupport,
  isIos,
  isStandalone,
  PUSH_TOKEN_KEY,
  readFirebaseConfig,
  refreshPushRegistration,
} from './push';

const fb = vi.hoisted(() => ({
  initializeApp: vi.fn(),
  getApps: vi.fn(),
  isSupported: vi.fn(),
  getMessaging: vi.fn(),
  getToken: vi.fn(),
  deleteToken: vi.fn(),
}));

vi.mock('firebase/app', () => ({ initializeApp: fb.initializeApp, getApps: fb.getApps }));
vi.mock('firebase/messaging', () => ({
  isSupported: fb.isSupported,
  getMessaging: fb.getMessaging,
  getToken: fb.getToken,
  deleteToken: fb.deleteToken,
}));

const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const IPAD_DESKTOP_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';
const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';

const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyExampleExampleExample',
  authDomain: 'tma-app.firebaseapp.com',
  projectId: 'tma-app',
  messagingSenderId: '1234567890',
  appId: '1:1234567890:web:abcdef',
};
const VAPID = `B${'x'.repeat(86)}`;
const REGISTRATION = { scope: 'https://example.org/tma/' } as unknown as ServiceWorkerRegistration;

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

/** A browser that can do Web Push (Android Chrome by default). */
function pushCapableBrowser({ ua = ANDROID_UA, permission = 'default' as NotificationPermission } = {}): void {
  FakeNotification.permission = permission;
  FakeNotification.nextAnswer = 'granted';
  vi.stubGlobal('Notification', FakeNotification);
  vi.stubGlobal('PushManager', function PushManager() {});
  setNavigator({ userAgent: ua, serviceWorker: { ready: Promise.resolve(REGISTRATION) } });
}

function liveEnv({ config = JSON.stringify(FIREBASE_CONFIG), vapid = VAPID } = {}): void {
  vi.stubEnv('VITE_API_URL', 'https://script.google.com/macros/s/abc/exec');
  vi.stubEnv('VITE_FIREBASE_CONFIG', config);
  vi.stubEnv('VITE_FIREBASE_VAPID_KEY', vapid);
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

beforeEach(() => {
  localStorage.clear();
  fb.getApps.mockReset().mockReturnValue([]);
  fb.initializeApp.mockReset().mockImplementation((_options: unknown, name: string) => ({ name }));
  fb.isSupported.mockReset().mockResolvedValue(true);
  fb.getMessaging.mockReset().mockReturnValue({ kind: 'messaging' });
  fb.getToken.mockReset().mockResolvedValue('fcm-token-1234567890-abcdefghij');
  fb.deleteToken.mockReset().mockResolvedValue(true);
  FakeNotification.requestPermission.mockClear();
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

// --- configuration ------------------------------------------------------------

describe('readFirebaseConfig', () => {
  it('parses the JSON config and keeps only Firebase web keys', () => {
    liveEnv({ config: JSON.stringify({ ...FIREBASE_CONFIG, evil: '<script>' }) });
    const config = readFirebaseConfig();
    expect(config?.vapidKey).toBe(VAPID);
    expect(config?.options).toEqual(FIREBASE_CONFIG);
  });

  it.each([
    ['empty config', '', VAPID],
    ['not JSON', '{apiKey: "x"}', VAPID],
    ['missing appId', JSON.stringify({ ...FIREBASE_CONFIG, appId: '' }), VAPID],
    ['array', '[]', VAPID],
    ['missing VAPID key', JSON.stringify(FIREBASE_CONFIG), ''],
    ['bad VAPID key', JSON.stringify(FIREBASE_CONFIG), 'not a key!'],
  ])('returns null for %s', (_label, config, vapid) => {
    liveEnv({ config, vapid });
    expect(readFirebaseConfig()).toBeNull();
  });
});

// --- support states -------------------------------------------------------------

describe('getPushSupport (live)', () => {
  it('is not-configured when the Firebase env vars are missing', async () => {
    liveEnv({ config: '', vapid: '' });
    pushCapableBrowser();
    expect(await getPushSupport()).toBe('not-configured');
  });

  it('is needs-install on iPhone Safari outside the Home Screen app', async () => {
    liveEnv();
    setStandaloneMedia(false);
    setNavigator({ userAgent: IPHONE_UA });
    expect(await getPushSupport()).toBe('needs-install');
  });

  it('is needs-install on iPadOS with a desktop user agent', async () => {
    liveEnv();
    setNavigator({ userAgent: IPAD_DESKTOP_UA, maxTouchPoints: 5 });
    expect(await getPushSupport()).toBe('needs-install');
  });

  it('is ready on iPhone once installed to the Home Screen', async () => {
    liveEnv();
    pushCapableBrowser({ ua: IPHONE_UA });
    setNavigator({ standalone: true });
    expect(await getPushSupport()).toBe('ready');
  });

  it('is unsupported without the Notification / Push APIs', async () => {
    liveEnv();
    setNavigator({ userAgent: ANDROID_UA, serviceWorker: { ready: Promise.resolve(REGISTRATION) } });
    expect(await getPushSupport()).toBe('unsupported');
  });

  it('reports blocked, ready and enabled from the permission and stored token', async () => {
    liveEnv();
    pushCapableBrowser({ permission: 'denied' });
    expect(await getPushSupport()).toBe('blocked');

    FakeNotification.permission = 'granted';
    expect(await getPushSupport()).toBe('ready');

    localStorage.setItem(PUSH_TOKEN_KEY, 'fcm-token-1234567890-abcdefghij');
    expect(await getPushSupport()).toBe('enabled');

    FakeNotification.permission = 'default';
    expect(await getPushSupport()).toBe('ready');
  });

  it('honours an explicit mode', async () => {
    liveEnv({ config: '', vapid: '' });
    expect(await getPushSupport({ mode: 'demo' })).toBe('ready');
  });
});

describe('getPushSupport (demo)', () => {
  it('is ready on any device (banners show in the app) and enabled once a demo token is stored', async () => {
    vi.stubEnv('VITE_API_URL', '');
    setNavigator({ userAgent: IPHONE_UA });
    expect(await getPushSupport()).toBe('ready');
    localStorage.setItem(PUSH_TOKEN_KEY, `${DEMO_TOKEN_PREFIX}abc`);
    expect(await getPushSupport()).toBe('enabled');
  });
});

// --- enable / disable -------------------------------------------------------------

describe('enablePush (demo)', () => {
  it('registers a demo token and stores it', async () => {
    const api = fakeApi('demo');
    expect(await enablePush(api)).toEqual({ ok: true });
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0].action).toBe('push.register');
    const token = (api.calls[0].params as { token: string }).token;
    expect(token).toMatch(/^demo-[0-9a-f-]{32,36}$/);
    expect(localStorage.getItem(PUSH_TOKEN_KEY)).toBe(token);
    expect(fb.getToken).not.toHaveBeenCalled();
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
    const first = localStorage.getItem(PUSH_TOKEN_KEY);
    await enablePush(api);
    const second = localStorage.getItem(PUSH_TOKEN_KEY);
    expect(second).not.toBe(first);
    expect(api.calls.map((c) => c.action)).toEqual(['push.register', 'push.register', 'push.unregister']);
    expect(api.calls[2].params).toEqual({ token: first });
  });

  it('returns the server message when registration fails', async () => {
    const api = fakeApi('demo', new ApiError('RATE_LIMITED', 'Too many device registrations.'));
    expect(await enablePush(api)).toEqual({ ok: false, reason: 'Too many device registrations.' });
    expect(localStorage.getItem(PUSH_TOKEN_KEY)).toBeNull();
  });

  it('forgetDemoPushToken clears only demo tokens', () => {
    localStorage.setItem(PUSH_TOKEN_KEY, 'fcm-real-token-123456789');
    forgetDemoPushToken();
    expect(localStorage.getItem(PUSH_TOKEN_KEY)).toBe('fcm-real-token-123456789');
    localStorage.setItem(PUSH_TOKEN_KEY, 'demo-123');
    forgetDemoPushToken();
    expect(localStorage.getItem(PUSH_TOKEN_KEY)).toBeNull();
  });
});

describe('enablePush (live)', () => {
  it('asks permission, gets an FCM token with the app service worker and registers it', async () => {
    liveEnv();
    pushCapableBrowser();
    const api = fakeApi('live');

    expect(await enablePush(api)).toEqual({ ok: true });

    expect(FakeNotification.requestPermission).toHaveBeenCalledTimes(1);
    expect(fb.initializeApp).toHaveBeenCalledWith(FIREBASE_CONFIG, 'tma');
    expect(fb.getToken).toHaveBeenCalledWith({ kind: 'messaging' }, { vapidKey: VAPID, serviceWorkerRegistration: REGISTRATION });
    expect(api.calls).toEqual([
      { action: 'push.register', params: { token: 'fcm-token-1234567890-abcdefghij', userAgent: ANDROID_UA } },
    ]);
    expect(localStorage.getItem(PUSH_TOKEN_KEY)).toBe('fcm-token-1234567890-abcdefghij');
    expect(await getPushSupport()).toBe('enabled');
  });

  it('reuses the named Firebase app on later calls', async () => {
    liveEnv();
    pushCapableBrowser({ permission: 'granted' });
    fb.getApps.mockReturnValue([{ name: '[DEFAULT]' }, { name: 'tma' }]);
    await enablePush(fakeApi('live'));
    expect(fb.initializeApp).not.toHaveBeenCalled();
    expect(fb.getMessaging).toHaveBeenCalledWith({ name: 'tma' });
  });

  it('stops when the parent blocks notifications', async () => {
    liveEnv();
    pushCapableBrowser();
    FakeNotification.nextAnswer = 'denied';
    const api = fakeApi('live');
    const result = await enablePush(api);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toMatch(/blocked/i);
    expect(api.calls).toEqual([]);
  });

  it('explains needs-install / not-configured without asking for permission', async () => {
    liveEnv();
    setNavigator({ userAgent: IPHONE_UA });
    const iphone = await enablePush(fakeApi('live'));
    expect(iphone.ok === false && iphone.reason).toMatch(/Home Screen/);

    liveEnv({ config: '' });
    pushCapableBrowser();
    const unconfigured = await enablePush(fakeApi('live'));
    expect(unconfigured.ok === false && unconfigured.reason).toMatch(/hasn't switched on/);
    expect(FakeNotification.requestPermission).not.toHaveBeenCalled();
  });

  it('reports browsers Firebase cannot use', async () => {
    liveEnv();
    pushCapableBrowser();
    fb.isSupported.mockResolvedValue(false);
    const result = await enablePush(fakeApi('live'));
    expect(result.ok === false && result.reason).toMatch(/can't receive notifications/);
  });

  it('turns unexpected Firebase failures into a friendly message', async () => {
    liveEnv();
    pushCapableBrowser();
    fb.getToken.mockRejectedValue(new Error('messaging/token-subscribe-failed'));
    const api = fakeApi('live');
    const result = await enablePush(api);
    expect(result).toEqual({ ok: false, reason: "Couldn't turn on notifications on this device. Please try again." });
    expect(api.calls).toEqual([]);
    expect(localStorage.getItem(PUSH_TOKEN_KEY)).toBeNull();
  });
});

describe('disablePush', () => {
  it('unregisters the token, deletes it from Firebase and forgets it', async () => {
    liveEnv();
    pushCapableBrowser({ permission: 'granted' });
    localStorage.setItem(PUSH_TOKEN_KEY, 'fcm-token-old-1234567890');
    const api = fakeApi('live');
    await disablePush(api);
    expect(api.calls).toEqual([{ action: 'push.unregister', params: { token: 'fcm-token-old-1234567890' } }]);
    expect(fb.deleteToken).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(PUSH_TOKEN_KEY)).toBeNull();
  });

  it('keeps everything when TMA cannot be reached, so the parent can retry', async () => {
    liveEnv();
    localStorage.setItem(PUSH_TOKEN_KEY, 'fcm-token-old-1234567890');
    await expect(disablePush(fakeApi('live', new ApiError('INTERNAL', 'Network problem')))).rejects.toThrow('Network problem');
    expect(localStorage.getItem(PUSH_TOKEN_KEY)).toBe('fcm-token-old-1234567890');
  });

  it('still clears the device when the session has expired', async () => {
    liveEnv();
    localStorage.setItem(PUSH_TOKEN_KEY, 'fcm-token-old-1234567890');
    await disablePush(fakeApi('live', new ApiError('UNAUTHORIZED', 'Please sign in again.')));
    expect(localStorage.getItem(PUSH_TOKEN_KEY)).toBeNull();
  });

  it('does nothing without a token', async () => {
    const api = fakeApi('live');
    await disablePush(api);
    expect(api.calls).toEqual([]);
  });
});

describe('refreshPushRegistration', () => {
  it('re-registers when Firebase hands out a new token', async () => {
    liveEnv();
    pushCapableBrowser({ permission: 'granted' });
    localStorage.setItem(PUSH_TOKEN_KEY, 'fcm-token-old-1234567890');
    localStorage.setItem(`${PUSH_TOKEN_KEY}.at`, new Date().toISOString());
    fb.getToken.mockResolvedValue('fcm-token-new-1234567890');
    const api = fakeApi('live');
    await refreshPushRegistration(api);
    expect(api.calls.map((c) => [c.action, (c.params as { token: string }).token])).toEqual([
      ['push.register', 'fcm-token-new-1234567890'],
      ['push.unregister', 'fcm-token-old-1234567890'],
    ]);
    expect(localStorage.getItem(PUSH_TOKEN_KEY)).toBe('fcm-token-new-1234567890');
  });

  it('stays quiet when the token is unchanged and recently registered', async () => {
    liveEnv();
    pushCapableBrowser({ permission: 'granted' });
    localStorage.setItem(PUSH_TOKEN_KEY, 'fcm-token-1234567890-abcdefghij');
    localStorage.setItem(`${PUSH_TOKEN_KEY}.at`, new Date().toISOString());
    const api = fakeApi('live');
    await refreshPushRegistration(api);
    expect(api.calls).toEqual([]);
  });

  it('re-registers an unchanged token after a week', async () => {
    liveEnv();
    pushCapableBrowser({ permission: 'granted' });
    localStorage.setItem(PUSH_TOKEN_KEY, 'fcm-token-1234567890-abcdefghij');
    localStorage.setItem(`${PUSH_TOKEN_KEY}.at`, new Date(Date.now() - 8 * 86_400_000).toISOString());
    const api = fakeApi('live');
    await refreshPushRegistration(api);
    expect(api.calls.map((c) => c.action)).toEqual(['push.register']);
  });

  it('never turns push back on by itself, and is a no-op in demo mode', async () => {
    liveEnv();
    pushCapableBrowser({ permission: 'granted' });
    const api = fakeApi('live');
    await refreshPushRegistration(api); // permission granted but the parent turned push off (no token)
    localStorage.setItem(PUSH_TOKEN_KEY, 'demo-abc');
    await refreshPushRegistration(fakeApi('demo'));
    expect(api.calls).toEqual([]);
    expect(fb.getToken).not.toHaveBeenCalled();
  });

  it('swallows failures', async () => {
    liveEnv();
    pushCapableBrowser({ permission: 'granted' });
    localStorage.setItem(PUSH_TOKEN_KEY, 'fcm-token-old-1234567890');
    fb.getToken.mockRejectedValue(new Error('offline'));
    await expect(refreshPushRegistration(fakeApi('live'))).resolves.toBeUndefined();
  });
});
