// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  BAD_RESPONSE_MESSAGE,
  createApiClient,
  createLazyDemoClient,
  createLiveClient,
  getDemoControls,
  NETWORK_ERROR_MESSAGE,
  SLOW_ACTION_TIMEOUT_MS,
  TIMEOUT_MESSAGE,
  withAuthGuard,
  type ApiClient,
  type DemoApiClient,
} from './client';

const URL = 'https://script.google.com/macros/s/abc/exec';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

describe('createLiveClient', () => {
  beforeEach(() => localStorage.clear());

  it('POSTs the request as text/plain JSON with the token and returns data', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true, data: { sent: true } }));
    const api = createLiveClient(URL, { fetch: fetchMock as unknown as typeof fetch });
    api.setToken('tok-123');

    const result = await api.call('auth.requestCode', { email: 'a@example.com' });

    expect(result).toEqual({ sent: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(URL);
    expect(init.method).toBe('POST');
    expect(init.redirect).toBe('follow');
    expect(init.headers).toEqual({ 'Content-Type': 'text/plain;charset=utf-8' });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(init.body as string)).toEqual({
      action: 'auth.requestCode',
      params: { email: 'a@example.com' },
      token: 'tok-123',
    });
  });

  it('sends token null when signed out', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true, data: { sent: true } }));
    const api = createLiveClient(URL, { fetch: fetchMock as unknown as typeof fetch });
    await api.call('auth.requestCode', { email: 'a@example.com' });
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(JSON.parse(init.body as string).token).toBeNull();
  });

  it('persists the token in localStorage and reads it back on startup', () => {
    const api = createLiveClient(URL, { fetch: vi.fn() as unknown as typeof fetch });
    expect(api.getToken()).toBeNull();
    api.setToken('abc.def');
    expect(localStorage.getItem('tma.session')).toBe('abc.def');
    expect(createLiveClient(URL).getToken()).toBe('abc.def');
    api.setToken(null);
    expect(localStorage.getItem('tma.session')).toBeNull();
    expect(api.getToken()).toBeNull();
  });

  it('maps an error response to ApiError with its code and message', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ ok: false, error: { code: 'CONFLICT', message: 'Not enough funds.' } }),
    );
    const api = createLiveClient(URL, { fetch: fetchMock as unknown as typeof fetch });
    const err = await api.call('me.bootstrap', {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe('CONFLICT');
    expect((err as ApiError).message).toBe('Not enough funds.');
  });

  it('treats unknown error codes as INTERNAL', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ok: false, error: { code: 'WAT', message: 'x' } }));
    const api = createLiveClient(URL, { fetch: fetchMock as unknown as typeof fetch });
    await expect(api.call('me.bootstrap', {})).rejects.toMatchObject({ code: 'INTERNAL' });
  });

  it('clears the stored token on UNAUTHORIZED', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ ok: false, error: { code: 'UNAUTHORIZED', message: 'Please sign in again.' } }),
    );
    const api = createLiveClient(URL, { fetch: fetchMock as unknown as typeof fetch });
    localStorage.setItem('tma.demo.session', 'demo-session');
    api.setToken('old');
    await expect(api.call('me.bootstrap', {})).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(api.getToken()).toBeNull();
    expect(localStorage.getItem('tma.session')).toBeNull();
    // The demo's sign-in in this browser is a separate thing.
    expect(localStorage.getItem('tma.demo.session')).toBe('demo-session');
  });

  it('does not clear a newer token when an older request comes back UNAUTHORIZED', async () => {
    let answer: (r: Response) => void = () => {};
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => (answer = resolve)));
    const api = createLiveClient(URL, { fetch: fetchMock as unknown as typeof fetch });
    api.setToken('old');
    const pending = api.call('me.bootstrap', {}).catch((e: unknown) => e);
    api.setToken('new'); // signed in again meanwhile
    answer(jsonResponse({ ok: false, error: { code: 'UNAUTHORIZED', message: 'Expired.' } }));
    expect(await pending).toMatchObject({ code: 'UNAUTHORIZED' });
    expect(api.getToken()).toBe('new');
  });

  it('reports a browser without fetch as a network problem', async () => {
    vi.stubGlobal('fetch', undefined);
    try {
      await expect(createLiveClient(URL).call('me.bootstrap', {})).rejects.toMatchObject({
        code: 'INTERNAL',
        message: NETWORK_ERROR_MESSAGE,
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('keeps the token on other errors', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ok: false, error: { code: 'FORBIDDEN', message: 'No.' } }));
    const api = createLiveClient(URL, { fetch: fetchMock as unknown as typeof fetch });
    api.setToken('keep');
    await expect(api.call('admin.overview', {})).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(api.getToken()).toBe('keep');
  });

  it('maps network failures to INTERNAL with a friendly message', async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const api = createLiveClient(URL, { fetch: fetchMock as unknown as typeof fetch });
    await expect(api.call('me.bootstrap', {})).rejects.toMatchObject({
      code: 'INTERNAL',
      message: NETWORK_ERROR_MESSAGE,
    });
    expect(NETWORK_ERROR_MESSAGE).toBe('Network problem — check your connection');
  });

  it('maps a non-JSON body (e.g. a Google error page) to INTERNAL', async () => {
    const fetchMock = vi.fn(async () => new Response('<html>Error</html>', { status: 200 }));
    const api = createLiveClient(URL, { fetch: fetchMock as unknown as typeof fetch });
    await expect(api.call('me.bootstrap', {})).rejects.toMatchObject({ code: 'INTERNAL', message: BAD_RESPONSE_MESSAGE });
  });

  it('rejects JSON that is not an ApiResponse', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ hello: 'world' }));
    const api = createLiveClient(URL, { fetch: fetchMock as unknown as typeof fetch });
    await expect(api.call('me.bootstrap', {})).rejects.toMatchObject({ code: 'INTERNAL' });
  });

  describe('timeout', () => {
    afterEach(() => vi.useRealTimers());

    it('aborts after 30 s and reports a timeout', async () => {
      vi.useFakeTimers();
      let signal: AbortSignal | undefined;
      const fetchMock = vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            signal = init.signal ?? undefined;
            signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
          }),
      );
      const api = createLiveClient(URL, { fetch: fetchMock as unknown as typeof fetch });
      const pending = api.call('me.bootstrap', {}).catch((e: unknown) => e);

      await vi.advanceTimersByTimeAsync(29_999);
      expect(signal?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      const err = await pending;
      expect(signal?.aborted).toBe(true);
      expect(err).toMatchObject({ code: 'INTERNAL', message: TIMEOUT_MESSAGE });
    });

    it('waits up to 6 minutes for an announcement or a sync, which may still be sending', async () => {
      vi.useFakeTimers();
      const signals: AbortSignal[] = [];
      const fetchMock = vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            if (init.signal) signals.push(init.signal);
            init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
          }),
      );
      const api = createLiveClient(URL, { fetch: fetchMock as unknown as typeof fetch });
      const announce = api
        .call('admin.announce', { title: 'T', body: 'B', audience: { schools: [], ensembles: [] }, channels: { push: false, email: true, sms: false } })
        .catch((e: unknown) => e);
      const sync = api.call('admin.runSync', {}).catch((e: unknown) => e);

      await vi.advanceTimersByTimeAsync(SLOW_ACTION_TIMEOUT_MS - 1);
      expect(signals.map((s) => s.aborted)).toEqual([false, false]);
      await vi.advanceTimersByTimeAsync(1);
      expect(await announce).toMatchObject({ code: 'INTERNAL', message: TIMEOUT_MESSAGE });
      expect(await sync).toMatchObject({ code: 'INTERNAL', message: TIMEOUT_MESSAGE });
    });
  });
});

function fakeDemoClient(): DemoApiClient {
  let token: string | null = localStorage.getItem('tma.demo.session');
  return {
    mode: 'demo',
    getToken: () => token,
    setToken: (t) => {
      token = t;
      if (t) localStorage.setItem('tma.demo.session', t);
      else localStorage.removeItem('tma.demo.session');
    },
    call: vi.fn(async () => ({ sent: true, devCode: '123456' })) as unknown as ApiClient['call'],
    demo: {
      addCredit: vi.fn(),
      runDaily: vi.fn(),
      outbox: () => [],
      reset: vi.fn(),
    },
  };
}

describe('createLazyDemoClient', () => {
  beforeEach(() => localStorage.clear());

  it('loads the demo module on first call and delegates to it', async () => {
    const real = fakeDemoClient();
    const load = vi.fn(async () => ({ createDemoClient: () => real }));
    const api = createLazyDemoClient(load);

    expect(api.mode).toBe('demo');
    expect(load).not.toHaveBeenCalled();
    await expect(api.call('auth.requestCode', { email: 'parent@example.com' })).resolves.toEqual({
      sent: true,
      devCode: '123456',
    });
    await api.call('auth.requestCode', { email: 'parent@example.com' });
    expect(load).toHaveBeenCalledTimes(1);
    expect(real.call).toHaveBeenCalledWith('auth.requestCode', { email: 'parent@example.com' });
    expect(await api.loadDemo()).toBe(real.demo);
  });

  it("uses the demo's own localStorage key for the token before the module loads", async () => {
    localStorage.setItem('tma.session', 'live-token');
    localStorage.setItem('tma.demo.session', 'stored');
    const api = createLazyDemoClient(async () => ({ createDemoClient: fakeDemoClient }));
    expect(api.getToken()).toBe('stored');
    api.setToken(null);
    expect(localStorage.getItem('tma.demo.session')).toBeNull();
    expect(localStorage.getItem('tma.session')).toBe('live-token');
    api.setToken('next');
    await api.loadDemo();
    expect(api.getToken()).toBe('next');
    expect(localStorage.getItem('tma.session')).toBe('live-token');
  });

  it('reports a load failure as an ApiError and retries next time', async () => {
    const load = vi
      .fn()
      .mockRejectedValueOnce(new Error('chunk failed'))
      .mockResolvedValueOnce({ createDemoClient: fakeDemoClient });
    const api = createLazyDemoClient(load);
    await expect(api.call('me.bootstrap', {})).rejects.toBeInstanceOf(ApiError);
    await expect(api.call('auth.requestCode', { email: 'x@example.com' })).resolves.toBeTruthy();
    expect(load).toHaveBeenCalledTimes(2);
  });
});

describe('createApiClient', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.unstubAllEnvs());

  it('uses the live client when VITE_API_URL is set', () => {
    vi.stubEnv('VITE_API_URL', URL);
    expect(createApiClient().mode).toBe('live');
  });

  it('falls back to the demo when VITE_API_URL is empty', () => {
    vi.stubEnv('VITE_API_URL', '');
    expect(createApiClient().mode).toBe('demo');
    expect(createApiClient('live').mode).toBe('demo'); // nothing to talk to
  });

  it('runs the demo on a live build when this browser chose it', () => {
    vi.stubEnv('VITE_API_URL', URL);
    localStorage.setItem('tma.mode', 'demo');
    expect(createApiClient().mode).toBe('demo');
    expect(createApiClient('live').mode).toBe('live');
  });

  it('keeps the live and demo sign-ins apart', () => {
    vi.stubEnv('VITE_API_URL', URL);
    localStorage.setItem('tma.session', 'live-token');
    localStorage.setItem('tma.demo.session', 'demo-token');
    expect(createApiClient('live').getToken()).toBe('live-token');
    expect(createApiClient('demo').getToken()).toBe('demo-token');
    createApiClient('demo').setToken(null);
    expect(localStorage.getItem('tma.session')).toBe('live-token');
  });
});

describe('getDemoControls', () => {
  it('returns null in live mode', async () => {
    expect(await getDemoControls(createLiveClient(URL))).toBeNull();
  });

  it('returns eager demo controls', async () => {
    const real = fakeDemoClient();
    expect(await getDemoControls(real)).toBe(real.demo);
  });

  it('loads lazy demo controls', async () => {
    const real = fakeDemoClient();
    const api = createLazyDemoClient(async () => ({ createDemoClient: () => real }));
    expect(await getDemoControls(api)).toBe(real.demo);
  });
});

describe('withAuthGuard', () => {
  it('calls onUnauthorized on UNAUTHORIZED and passes other members through', async () => {
    const real = fakeDemoClient();
    (real.call as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new ApiError('UNAUTHORIZED', 'Sign in'));
    const onUnauthorized = vi.fn();
    const guarded = withAuthGuard(real, onUnauthorized);
    await expect(guarded.call('me.bootstrap', {})).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(guarded.mode).toBe('demo');
    expect(guarded.demo).toBe(real.demo);
    await guarded.call('auth.requestCode', { email: 'x@example.com' });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });
});
