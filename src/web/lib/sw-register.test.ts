// @vitest-environment jsdom
import type { RegisterSWOptions } from 'vite-plugin-pwa/types';

const pwa = vi.hoisted(() => ({
  registerSW: vi.fn(),
  updateSW: vi.fn(async (_reload?: boolean) => undefined),
}));
vi.mock('virtual:pwa-register', () => ({ registerSW: pwa.registerSW }));

async function load() {
  vi.resetModules();
  return import('./sw-register');
}

type Listener = (event: MessageEvent) => void;

function fakeServiceWorkerContainer() {
  const listeners: Listener[] = [];
  const container = {
    addEventListener: vi.fn((type: string, fn: Listener) => {
      if (type === 'message') listeners.push(fn);
    }),
    removeEventListener: vi.fn(),
  };
  Object.defineProperty(navigator, 'serviceWorker', { value: container, configurable: true });
  return { post: (data: unknown) => listeners.forEach((fn) => fn(new MessageEvent('message', { data }))) };
}

beforeEach(() => {
  window.location.hash = '#/';
  pwa.registerSW.mockReset().mockReturnValue(pwa.updateSW);
  pwa.updateSW.mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
  delete (navigator as unknown as Record<string, unknown>).serviceWorker;
});

describe('sanitizeRoute', () => {
  it.each(['#/', '#/trips', '#/funds?student=S0001', '#/news'])('accepts the in-app route %s', async (url) => {
    const { sanitizeRoute } = await load();
    expect(sanitizeRoute(url)).toBe(url);
  });

  it.each([
    'https://evil.example/#/trips',
    'javascript:alert(1)',
    '/#/trips',
    'trips',
    '#trips',
    '#/<img src=x onerror=alert(1)>',
    `#/${'a'.repeat(300)}`,
    42,
    null,
  ])('rejects %s', async (url) => {
    const { sanitizeRoute } = await load();
    expect(sanitizeRoute(url)).toBeNull();
  });
});

describe('handleServiceWorkerMessage', () => {
  it('navigates to the tapped notification’s route', async () => {
    const { handleServiceWorkerMessage } = await load();
    expect(handleServiceWorkerMessage({ type: 'navigate', url: '#/funds' })).toBe(true);
    expect(window.location.hash).toBe('#/funds');
  });

  it('ignores navigation to anything but an in-app route', async () => {
    const { handleServiceWorkerMessage } = await load();
    expect(handleServiceWorkerMessage({ type: 'navigate', url: 'https://evil.example/' })).toBe(false);
    expect(handleServiceWorkerMessage({ type: 'navigate', url: 'javascript:alert(1)' })).toBe(false);
    expect(window.location.hash).toBe('#/');
  });

  it('re-dispatches foreground pushes as tma:push', async () => {
    const { handleServiceWorkerMessage } = await load();
    const seen: unknown[] = [];
    const onPush = (e: Event) => seen.push((e as CustomEvent).detail);
    window.addEventListener('tma:push', onPush);
    const message = { title: '+$50.00 for Avery', body: 'New balance: $690.00.', url: '#/funds', topic: 'balance' };
    expect(handleServiceWorkerMessage({ type: 'push', message })).toBe(true);
    expect(handleServiceWorkerMessage({ type: 'push', message: { title: 7 } })).toBe(false);
    expect(handleServiceWorkerMessage('hello')).toBe(false);
    expect(handleServiceWorkerMessage(null)).toBe(false);
    window.removeEventListener('tma:push', onPush);
    expect(seen).toEqual([{ message }]);
  });
});

describe('registerServiceWorker', () => {
  it('registers immediately, announces updates, and listens for messages', async () => {
    vi.stubEnv('DEV', false);
    const sw = fakeServiceWorkerContainer();
    const { registerServiceWorker } = await load();

    registerServiceWorker();
    registerServiceWorker(); // idempotent

    expect(pwa.registerSW).toHaveBeenCalledTimes(1);
    const options = pwa.registerSW.mock.calls[0][0] as RegisterSWOptions;
    expect(options.immediate).toBe(true);

    let detail: { update: () => Promise<void> } | null = null;
    const onUpdate = (e: Event) => {
      detail = (e as CustomEvent<{ update: () => Promise<void> }>).detail;
    };
    window.addEventListener('tma:sw-update', onUpdate);
    options.onNeedRefresh?.();
    window.removeEventListener('tma:sw-update', onUpdate);
    expect(detail).not.toBeNull();
    await detail!.update();
    expect(pwa.updateSW).toHaveBeenCalledWith(true);

    sw.post({ type: 'navigate', url: '#/trips' });
    expect(window.location.hash).toBe('#/trips');
    sw.post({ type: 'navigate', url: 'https://evil.example/' });
    expect(window.location.hash).toBe('#/trips');
  });

  it('does nothing without service worker support', async () => {
    vi.stubEnv('DEV', false);
    const { registerServiceWorker } = await load();
    registerServiceWorker();
    expect(pwa.registerSW).not.toHaveBeenCalled();
  });

  it('does nothing under `vite dev`, where no service worker is built', async () => {
    vi.stubEnv('DEV', true);
    fakeServiceWorkerContainer();
    const { registerServiceWorker } = await load();
    registerServiceWorker();
    expect(pwa.registerSW).not.toHaveBeenCalled();
  });
});
