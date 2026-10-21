/**
 * Service worker behaviour, run against a fake `self` (ServiceWorkerGlobalScope)
 * with workbox mocked. sw.ts is imported through a variable path so the DOM
 * typecheck (tsconfig.json) doesn't pull in the WebWorker-typed file.
 */
const wb = vi.hoisted(() => ({
  precacheAndRoute: vi.fn(),
  cleanupOutdatedCaches: vi.fn(),
  createHandlerBoundToURL: vi.fn((url: string) => ({ boundTo: url })),
  registerRoute: vi.fn(),
  clientsClaim: vi.fn(),
  NavigationRoute: vi.fn(function NavigationRoute(this: Record<string, unknown>, handler: unknown, options: unknown) {
    this.handler = handler;
    this.options = options;
  }),
  StaleWhileRevalidate: vi.fn(function StaleWhileRevalidate(this: Record<string, unknown>, options: unknown) {
    this.options = options;
  }),
  ExpirationPlugin: vi.fn(function ExpirationPlugin(this: Record<string, unknown>, options: unknown) {
    this.options = options;
  }),
}));

vi.mock('workbox-core', () => ({ clientsClaim: wb.clientsClaim }));
vi.mock('workbox-precaching', () => ({
  precacheAndRoute: wb.precacheAndRoute,
  cleanupOutdatedCaches: wb.cleanupOutdatedCaches,
  createHandlerBoundToURL: wb.createHandlerBoundToURL,
}));
vi.mock('workbox-routing', () => ({ registerRoute: wb.registerRoute, NavigationRoute: wb.NavigationRoute }));
vi.mock('workbox-strategies', () => ({ StaleWhileRevalidate: wb.StaleWhileRevalidate }));
vi.mock('workbox-expiration', () => ({ ExpirationPlugin: wb.ExpirationPlugin }));

const SCOPE = 'https://example.github.io/tma/';
const ICON = `${SCOPE}icons/icon-192.png`;
const BADGE = `${SCOPE}icons/badge-96.png`;
const MANIFEST = [{ url: 'index.html', revision: 'abc' }];

type Handler = (event: Record<string, unknown>) => void;

interface FakeClient {
  url: string;
  focused: boolean;
  visibilityState: string;
  postMessage: ReturnType<typeof vi.fn>;
  focus: ReturnType<typeof vi.fn>;
}

function fakeClient(url: string, focused = false): FakeClient {
  const client: FakeClient = {
    url,
    focused,
    visibilityState: focused ? 'visible' : 'hidden',
    postMessage: vi.fn(),
    focus: vi.fn(async () => client),
  };
  return client;
}

async function loadWorker(clients: FakeClient[] = []) {
  const handlers = new Map<string, Handler>();
  const self = {
    __WB_MANIFEST: MANIFEST,
    location: new URL(`${SCOPE}sw.js`),
    registration: { scope: SCOPE, showNotification: vi.fn(async () => undefined) },
    clients: {
      matchAll: vi.fn(async () => clients),
      openWindow: vi.fn(async () => null),
    },
    skipWaiting: vi.fn(async () => undefined),
    addEventListener: vi.fn((type: string, fn: Handler) => handlers.set(type, fn)),
  };
  vi.stubGlobal('self', self);
  vi.resetModules();
  const path = './sw';
  await import(/* @vite-ignore */ path);

  /** Fire an event and wait for everything passed to waitUntil. */
  const fire = async (type: string, event: Record<string, unknown>) => {
    const waits: Promise<unknown>[] = [];
    handlers.get(type)?.({ ...event, waitUntil: (p: Promise<unknown>) => waits.push(p) });
    await Promise.all(waits);
    return waits.length;
  };
  return { self, fire };
}

function pushData(payload: unknown) {
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return { data: { text: () => text } };
}

beforeEach(() => {
  for (const fn of Object.values(wb)) fn.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('caching', () => {
  it('precaches the build and serves index.html for navigations', async () => {
    await loadWorker();
    expect(wb.clientsClaim).toHaveBeenCalled();
    expect(wb.cleanupOutdatedCaches).toHaveBeenCalled();
    expect(wb.precacheAndRoute).toHaveBeenCalledWith(MANIFEST);
    expect(wb.createHandlerBoundToURL).toHaveBeenCalledWith(`${SCOPE}index.html`);
    const navigation = wb.registerRoute.mock.calls.map((c) => c[0]).find((r) => r instanceof wb.NavigationRoute);
    expect(navigation).toMatchObject({ handler: { boundTo: `${SCOPE}index.html` } });
    const denylist = (navigation as { options: { denylist: RegExp[] } }).options.denylist;
    expect(denylist.some((re) => re.test('/tma/docs/handbook.pdf'))).toBe(true);
    expect(denylist.some((re) => re.test('/tma/'))).toBe(false);
  });

  it('keeps working (for push) when index.html is not precached', async () => {
    wb.createHandlerBoundToURL.mockImplementationOnce(() => {
      throw new Error('non-precached-url');
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { fire, self } = await loadWorker();
    expect(warn).toHaveBeenCalled();
    await fire('push', pushData({ title: 'Hi', body: 'There', topic: 'test' }));
    expect(self.registration.showNotification).toHaveBeenCalled();
  });

  it('caches same-origin images only, with an expiration plugin', async () => {
    await loadWorker();
    const [match, strategy] = wb.registerRoute.mock.calls.find((c) => typeof c[0] === 'function') as [
      (o: { request: { destination: string }; url: URL }) => boolean,
      { options: { cacheName: string; plugins: Array<{ options: { maxEntries: number } }> } },
    ];
    const image = { destination: 'image' };
    expect(match({ request: image, url: new URL(`${SCOPE}brand/tma-banner.jpg`) })).toBe(true);
    expect(match({ request: image, url: new URL('https://other.example/pic.png') })).toBe(false);
    expect(match({ request: { destination: '' }, url: new URL(`${SCOPE}api`) })).toBe(false);
    expect(strategy.options.cacheName).toBe('tma-images');
    expect(strategy.options.plugins[0].options.maxEntries).toBe(60);
  });
});

describe('push', () => {
  it("shows the push Worker's payload and tells this app's open windows only", async () => {
    const win = fakeClient(`${SCOPE}#/`);
    // Another site under the same GitHub Pages origin must not see a family's message.
    const otherSite = fakeClient('https://example.github.io/other-site/');
    const { self, fire } = await loadWorker([win, otherSite]);
    const data = { title: '+$50.00 for Avery', body: '$50.00 was added…', url: '#/funds', tag: 'bal-S0001', topic: 'balance' };

    // The Worker sends exactly this: JSON.stringify(PushMessage), read with event.data.text().
    expect(await fire('push', pushData(JSON.stringify(data)))).toBe(1);

    expect(self.registration.showNotification).toHaveBeenCalledWith('+$50.00 for Avery', {
      body: '$50.00 was added…',
      icon: ICON,
      badge: BADGE,
      tag: 'bal-S0001',
      data: { url: '#/funds' },
      lang: 'en',
      // Replaces Monday's "+$50.00 for Avery" if it's still in the tray, and alerts again.
      renotify: true,
    });
    expect(win.postMessage).toHaveBeenCalledWith({ type: 'push', message: data });
    expect(otherSite.postMessage).not.toHaveBeenCalled();
  });

  it('fills in what a payload leaves out and trims what is too long', async () => {
    const { self, fire } = await loadWorker();
    await fire('push', pushData({ title: 'Test notification ✅', body: 'Working.', topic: 'test' }));
    await fire('push', pushData({ title: 'x'.repeat(500), body: 'y'.repeat(5000), tag: 't'.repeat(100), topic: 'nope' }));
    const calls = self.registration.showNotification.mock.calls as unknown as Array<
      [string, { body: string; tag?: string; data: unknown }]
    >;
    expect(calls[0][0]).toBe('Test notification ✅');
    expect(calls[0][1]).toMatchObject({ body: 'Working.', tag: undefined, data: { url: '#/' } });
    expect(calls[0][1]).not.toHaveProperty('renotify'); // renotify without a tag is a TypeError
    expect(calls[1][0]).toHaveLength(120);
    expect(calls[1][1].body).toHaveLength(1000);
    expect(calls[1][1].tag).toHaveLength(64);
  });

  it('always shows something, even for empty or malformed pushes', async () => {
    const { self, fire } = await loadWorker();
    await fire('push', { data: null });
    await fire('push', pushData('Concert moved to 7:30'));
    await fire('push', pushData({ title: 42, body: ['x'] }));
    await fire('push', { data: { text: () => { throw new Error('bad'); } } });
    const calls = self.registration.showNotification.mock.calls as unknown as Array<[string, { body: string }]>;
    expect(calls.map((c) => [c[0], c[1].body])).toEqual([
      ['TMA update', ''],
      ['TMA update', 'Concert moved to 7:30'],
      ['TMA update', ''],
      ['TMA update', ''],
    ]);
  });

  it('never lets a payload point outside the app', async () => {
    const { self, fire } = await loadWorker();
    await fire('push', pushData({ title: 'Hi', body: 'x', url: 'https://evil.example/' }));
    await fire('push', pushData({ title: 'Hi', body: 'x', url: 'javascript:alert(1)' }));
    const calls = self.registration.showNotification.mock.calls as unknown as Array<[string, { data: unknown }]>;
    expect(calls.map((c) => c[1].data)).toEqual([{ url: '#/' }, { url: '#/' }]);
  });

  it('still shows the notification when a window cannot be messaged', async () => {
    const win = fakeClient(`${SCOPE}#/`);
    win.postMessage.mockImplementation(() => {
      throw new Error('gone');
    });
    const { self, fire } = await loadWorker([win]);
    await fire('push', pushData({ title: 'Hi', body: 'There', topic: 'test' }));
    expect(self.registration.showNotification).toHaveBeenCalledTimes(1);
  });
});

describe('pushsubscriptionchange', () => {
  it("tells this app's open windows so the signed-in app registers the new subscription", async () => {
    const win = fakeClient(`${SCOPE}#/more`);
    const otherSite = fakeClient('https://example.github.io/other-site/');
    const { fire } = await loadWorker([win, otherSite]);
    expect(await fire('pushsubscriptionchange', { oldSubscription: null, newSubscription: null })).toBe(1);
    expect(win.postMessage).toHaveBeenCalledWith({ type: 'pushsubscriptionchange' });
    expect(otherSite.postMessage).not.toHaveBeenCalled();
  });

  it('copes with no open window and with a window that cannot be messaged', async () => {
    const win = fakeClient(`${SCOPE}#/`);
    win.postMessage.mockImplementation(() => {
      throw new Error('gone');
    });
    expect(await (await loadWorker([])).fire('pushsubscriptionchange', {})).toBe(1);
    expect(await (await loadWorker([win])).fire('pushsubscriptionchange', {})).toBe(1);
  });
});

describe('notificationclick', () => {
  const click = (url: unknown) => ({ notification: { data: { url }, close: vi.fn() } });

  it('focuses an open app window and navigates it', async () => {
    const other = fakeClient('https://elsewhere.example/');
    const win = fakeClient(`${SCOPE}#/`, true);
    const { self, fire } = await loadWorker([other, win]);
    const event = click('#/trips');
    await fire('notificationclick', event);
    expect(event.notification.close).toHaveBeenCalled();
    expect(win.focus).toHaveBeenCalled();
    expect(win.postMessage).toHaveBeenCalledWith({ type: 'navigate', url: '#/trips' });
    expect(other.focus).not.toHaveBeenCalled();
    expect(self.clients.openWindow).not.toHaveBeenCalled();
  });

  it('opens the app at the route when no window is open', async () => {
    const { self, fire } = await loadWorker([]);
    await fire('notificationclick', click('#/funds'));
    expect(self.clients.openWindow).toHaveBeenCalledWith(`${SCOPE}#/funds`);
  });

  it('falls back to a new window when focusing fails, and sanitises the route', async () => {
    const win = fakeClient(`${SCOPE}#/`);
    win.focus.mockRejectedValue(new Error('not allowed'));
    const { self, fire } = await loadWorker([win]);
    await fire('notificationclick', click('https://evil.example/'));
    expect(self.clients.openWindow).toHaveBeenCalledWith(`${SCOPE}#/`);
  });
});

describe('message', () => {
  it('activates a waiting update on SKIP_WAITING only', async () => {
    const { self, fire } = await loadWorker();
    await fire('message', { data: { type: 'HELLO' } });
    expect(self.skipWaiting).not.toHaveBeenCalled();
    await fire('message', { data: { type: 'SKIP_WAITING' } });
    expect(self.skipWaiting).toHaveBeenCalledTimes(1);
  });
});
