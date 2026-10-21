// @vitest-environment jsdom
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './api/client';
import { App } from './App';
import { exitDemo } from './lib/mode';
import { disablePush, refreshPushRegistration } from './lib/push';
import { fakeApi, makeBootstrap, makeSettings, TEST_PUSH_PUBLIC_KEY, type Handlers } from './test/fixtures';

vi.mock('./lib/push', () => ({
  getPushSupport: vi.fn(async () => 'unsupported'),
  enablePush: vi.fn(async () => ({ ok: true })),
  disablePush: vi.fn(async () => {}),
  refreshPushRegistration: vi.fn(async () => {}),
  isIos: () => false,
  isStandalone: () => false,
}));

vi.mock('./lib/install', () => ({
  useInstallPrompt: () => ({ canPrompt: false, installed: false, showIosHint: false, inAppBrowser: false, prompt: vi.fn() }),
}));

vi.mock('./components/PayPalCheckout', () => ({ PayPalCheckout: () => null }));

vi.mock('./lib/mode', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lib/mode')>()),
  enterDemo: vi.fn(),
  exitDemo: vi.fn(),
}));

/** A token shaped like the server's: base64url(JSON{e,v,x}) + "." + signature. */
function tokenFor(email: string): string {
  const payload = btoa(JSON.stringify({ e: email, v: '1', x: 2_000_000_000 }))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `${payload}.abc123`;
}

const EMAIL = 'parent@example.com';
const CACHE_KEY = `tma.cache.${EMAIL}`;

function renderApp(handlers: Handlers, token: string | null = tokenFor(EMAIL), mode: 'demo' | 'live' = 'live') {
  const api = fakeApi(handlers, mode, token);
  const utils = render(<App api={api} />);
  return { api, ...utils, user: userEvent.setup() };
}

describe('App', () => {
  beforeEach(() => {
    localStorage.clear();
    window.location.hash = '#/';
  });

  afterEach(() => {
    window.location.hash = '';
    vi.unstubAllEnvs();
  });

  it('shows sign-in when signed out, then loads the household after signing in', async () => {
    const { api, user } = renderApp(
      {
        'auth.requestCode': () => ({ sent: true, devCode: '123456' }),
        'auth.verifyCode': () => ({ token: tokenFor(EMAIL), expiresAt: '2030-01-01T00:00:00.000Z' }),
        'me.bootstrap': () => makeBootstrap(),
      },
      null,
    );

    await user.type(screen.getByLabelText('Email address'), EMAIL);
    await user.click(screen.getByRole('button', { name: 'Email me a code' }));
    await user.click(await screen.findByRole('button', { name: 'Sign in' }));

    expect(api.setToken).toHaveBeenCalledWith(tokenFor(EMAIL));
    expect(await screen.findByRole('article', { name: 'Avery Thompson' })).toBeInTheDocument();
    expect(localStorage.getItem('tma.email')).toBe(EMAIL);
    expect(JSON.parse(localStorage.getItem(CACHE_KEY)!).data.me.email).toBe(EMAIL);
    expect(refreshPushRegistration).toHaveBeenCalledWith(api, TEST_PUSH_PUBLIC_KEY);
  });

  it('keeps the push subscription current: with the bootstrap key, and when the browser replaces it', async () => {
    const { api } = renderApp({ 'me.bootstrap': () => makeBootstrap() });
    await screen.findByRole('article', { name: 'Avery Thompson' });
    await waitFor(() => expect(refreshPushRegistration).toHaveBeenCalledWith(api, TEST_PUSH_PUBLIC_KEY));
    vi.mocked(refreshPushRegistration).mockClear();

    act(() => {
      window.dispatchEvent(new Event('tma:pushsubscriptionchange'));
    });
    expect(refreshPushRegistration).toHaveBeenCalledTimes(1);
    expect(refreshPushRegistration).toHaveBeenCalledWith(api, TEST_PUSH_PUBLIC_KEY);
  });

  it('subscribes again with the new key when the server key changes', async () => {
    const stale = makeBootstrap({ settings: makeSettings({ pushPublicKey: 'BOldKey' }) });
    localStorage.setItem(CACHE_KEY, JSON.stringify({ savedAt: '2026-10-20T13:00:00.000Z', data: stale }));
    const { api } = renderApp({ 'me.bootstrap': () => makeBootstrap() });
    expect(refreshPushRegistration).toHaveBeenCalledWith(api, 'BOldKey');
    await waitFor(() => expect(refreshPushRegistration).toHaveBeenLastCalledWith(api, TEST_PUSH_PUBLIC_KEY));
  });

  it('paints the cached bootstrap immediately, before the network answers', async () => {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ savedAt: '2026-10-20T13:00:00.000Z', data: makeBootstrap() }));
    renderApp({ 'me.bootstrap': () => new Promise(() => {}) });
    expect(screen.getByRole('article', { name: 'Avery Thompson' })).toHaveTextContent('$640.00');
  });

  it('ignores a cache that belongs to someone else', async () => {
    const other = makeBootstrap();
    other.me = { ...other.me, email: 'someone@example.com' };
    localStorage.setItem(CACHE_KEY, JSON.stringify({ savedAt: '2026-10-20T13:00:00.000Z', data: other }));
    renderApp({ 'me.bootstrap': () => new Promise(() => {}) });
    expect(screen.queryByRole('article', { name: 'Avery Thompson' })).not.toBeInTheDocument();
    expect(screen.getByText('Loading your TMA info…')).toBeInTheDocument();
  });

  it('shows "Offline" with the cached time when the refresh fails', async () => {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ savedAt: '2026-10-20T13:00:00.000Z', data: makeBootstrap() }));
    renderApp({
      'me.bootstrap': () => {
        throw new ApiError('INTERNAL', 'Network problem — check your connection');
      },
    });
    expect(await screen.findByText(/Offline: showing info from/)).toBeInTheDocument();
    expect(screen.getByRole('article', { name: 'Avery Thompson' })).toBeInTheDocument();
  });

  it('shows an error with retry when there is no cache and loading fails', async () => {
    let fail = true;
    const { user } = renderApp({
      'me.bootstrap': () => {
        if (fail) throw new ApiError('INTERNAL', 'Network problem — check your connection');
        return makeBootstrap();
      },
    });
    expect(await screen.findByText('Network problem — check your connection')).toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole('button', { name: /Try again/ }));
    expect(await screen.findByRole('article', { name: 'Avery Thompson' })).toBeInTheDocument();
  });

  it('returns to sign-in and forgets the cache when the session has expired', async () => {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ savedAt: '2026-10-20T13:00:00.000Z', data: makeBootstrap() }));
    const { api } = renderApp({
      'me.bootstrap': () => {
        throw new ApiError('UNAUTHORIZED', 'Please sign in again.');
      },
    });
    expect(await screen.findByLabelText('Email address')).toBeInTheDocument();
    expect(api.setToken).toHaveBeenCalledWith(null);
    expect(localStorage.getItem(CACHE_KEY)).toBeNull();
    expect(screen.getByText('Your sign-in expired. Please sign in again.')).toBeInTheDocument();
  });

  it('shows pushed notifications in-app and refreshes', async () => {
    const { api, user } = renderApp({ 'me.bootstrap': () => makeBootstrap() });
    await screen.findByRole('article', { name: 'Avery Thompson' });
    const before = api.call.mock.calls.length;

    act(() => {
      window.dispatchEvent(
        new CustomEvent('tma:push', {
          detail: {
            message: {
              title: '+$50.00 for Avery',
              body: "$50.00 was added to Avery's TMA activity funds. New balance: $690.00.",
              url: '#/funds',
              topic: 'balance',
            },
            to: EMAIL,
          },
        }),
      );
    });

    const banner = screen.getByText('+$50.00 for Avery').closest('.push-banner') as HTMLElement;
    expect(within(banner).getByText(`Sent to ${EMAIL}'s phone`)).toBeInTheDocument();
    await waitFor(() => expect(api.call.mock.calls.length).toBeGreaterThan(before));

    await user.click(within(banner).getByRole('button', { name: 'Open' }));
    expect(window.location.hash).toBe('#/funds');
    expect(await screen.findByRole('heading', { level: 1, name: 'Activity funds' })).toBeInTheDocument();
  });

  it('navigates with the tab bar', async () => {
    const { user } = renderApp({ 'me.bootstrap': () => makeBootstrap() });
    await screen.findByRole('article', { name: 'Avery Thompson' });
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page');

    await user.click(within(nav).getByRole('link', { name: 'Trips' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Trips & activities' })).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'Trips' })).toHaveAttribute('aria-current', 'page');
    expect(document.title).toBe('Trips · TMA');
  });

  it('signs out from More: unregisters push, forgets the token and cache', async () => {
    window.location.hash = '#/more';
    const { api, user } = renderApp({ 'me.bootstrap': () => makeBootstrap() });
    await user.click(await screen.findByRole('button', { name: /Sign out/ }));

    expect(disablePush).toHaveBeenCalled();
    expect(await screen.findByLabelText('Email address')).toBeInTheDocument();
    expect(api.setToken).toHaveBeenLastCalledWith(null);
    expect(localStorage.getItem(CACHE_KEY)).toBeNull();
    expect(localStorage.getItem('tma.email')).toBeNull();
    expect(window.location.hash).toBe('#/');
  });

  it("clears the last person's messages on sign-out (shared phones)", async () => {
    window.location.hash = '#/notifications';
    const { user } = renderApp({
      'me.bootstrap': () => makeBootstrap(),
      'prefs.save': (p) => ({ prefs: p.prefs }),
    });
    await user.click(await screen.findByRole('button', { name: 'Save notification settings' }));
    expect(await screen.findByText('Notification settings saved.')).toBeInTheDocument();

    await user.click(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('link', { name: 'More' }));
    await user.click(await screen.findByRole('button', { name: /Sign out/ }));
    expect(await screen.findByLabelText('Email address')).toBeInTheDocument();
    expect(screen.queryByText('Notification settings saved.')).not.toBeInTheDocument();
  });

  it('shows the demo strip with "Exit demo" while a live build runs the demo', async () => {
    vi.stubEnv('VITE_API_URL', 'https://script.google.com/macros/s/abc/exec');
    const { user } = renderApp({ 'me.bootstrap': () => makeBootstrap() }, tokenFor(EMAIL), 'demo');
    await screen.findByRole('article', { name: 'Avery Thompson' });
    const strip = screen.getByRole('note', { name: 'Demo' });
    expect(strip).toHaveTextContent('Demo with made-up families');
    await user.click(within(strip).getByRole('button', { name: 'Exit demo' }));
    expect(exitDemo).toHaveBeenCalledTimes(1);
  });

  it('has no demo strip in the live app or in a demo-only build', async () => {
    vi.stubEnv('VITE_API_URL', 'https://script.google.com/macros/s/abc/exec');
    const live = renderApp({ 'me.bootstrap': () => makeBootstrap() });
    await screen.findByRole('article', { name: 'Avery Thompson' });
    expect(screen.queryByRole('note', { name: 'Demo' })).not.toBeInTheDocument();
    live.unmount();

    vi.stubEnv('VITE_API_URL', '');
    renderApp({ 'me.bootstrap': () => makeBootstrap() }, tokenFor(EMAIL), 'demo');
    await screen.findByRole('article', { name: 'Avery Thompson' });
    expect(screen.queryByRole('note', { name: 'Demo' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Exit demo' })).not.toBeInTheDocument();
  });

  it("uses the demo's own cache and leaves the live app's alone when the demo session ends", async () => {
    const demoCache = `tma.demo.cache.${EMAIL}`;
    localStorage.setItem(CACHE_KEY, JSON.stringify({ savedAt: '2026-10-20T13:00:00.000Z', data: makeBootstrap() }));
    const demoData = makeBootstrap();
    demoData.students = [];
    localStorage.setItem(demoCache, JSON.stringify({ savedAt: '2026-10-20T13:00:00.000Z', data: demoData }));
    localStorage.setItem('tma.email', EMAIL);
    renderApp(
      {
        'me.bootstrap': () => {
          throw new ApiError('UNAUTHORIZED', 'Please sign in again.');
        },
      },
      tokenFor(EMAIL),
      'demo',
    );
    expect(await screen.findByLabelText('Email address')).toBeInTheDocument();
    expect(localStorage.getItem(demoCache)).toBeNull();
    expect(localStorage.getItem(CACHE_KEY)).not.toBeNull();
    expect(localStorage.getItem('tma.email')).toBe(EMAIL);
  });

  it('never paints the live cache in the demo', async () => {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ savedAt: '2026-10-20T13:00:00.000Z', data: makeBootstrap() }));
    renderApp({ 'me.bootstrap': () => new Promise(() => {}) }, tokenFor(EMAIL), 'demo');
    expect(screen.queryByRole('article', { name: 'Avery Thompson' })).not.toBeInTheDocument();
    expect(screen.getByText('Loading your TMA info…')).toBeInTheDocument();
  });

  it('offers to reload when a new version is ready', async () => {
    renderApp({}, null);
    act(() => {
      window.dispatchEvent(new CustomEvent('tma:sw-update', { detail: { update: vi.fn(async () => {}) } }));
    });
    expect(screen.getByText('A new version of the app is ready.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
  });
});
