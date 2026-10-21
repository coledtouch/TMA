/**
 * Registers the service worker (vite-plugin-pwa, "prompt" updates) and turns
 * its messages into window events the React app listens for:
 *
 *   'tma:sw-update'              { update }   a new version is waiting; call update() to reload into it
 *   'tma:push'                   { message }  a push arrived while the app is open (shown in-app too)
 *   'tma:pushsubscriptionchange'              the browser replaced or dropped the push subscription;
 *                                             the signed-in app re-registers it (push.ts)
 *
 * Notification taps on an open window arrive as {type:'navigate', url} and
 * move the hash router to that in-app route.
 *
 * Real pushes belong to the live app, so while a live build runs the demo
 * they only show as system notifications, never inside the demo.
 */
import { registerSW } from 'virtual:pwa-register';
import type { PushMessage } from '../../shared/types';
import type { AppMode } from './mode';

export interface SwUpdateDetail {
  update: () => Promise<void>;
}

export interface SwPushDetail {
  message: PushMessage;
}

const UPDATE_CHECK_MS = 60 * 60 * 1000;
/** Same rule as the service worker: only in-app hash routes, never another site. */
const ROUTE_RE = /^#\/[A-Za-z0-9\-._~/?=&%]*$/;

let registered = false;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** '#/trips' → '#/trips'; anything else (other sites, javascript:, paths) → null. */
export function sanitizeRoute(url: unknown): string | null {
  if (typeof url !== 'string' || url.length > 200 || !ROUTE_RE.test(url)) return null;
  return url;
}

function isPushMessage(value: unknown): value is PushMessage {
  return isRecord(value) && typeof value.title === 'string' && typeof value.body === 'string';
}

/**
 * Handle one message posted by the service worker. Returns true when it was
 * understood. `mode` is this page's (default 'live').
 */
export function handleServiceWorkerMessage(data: unknown, mode: AppMode = 'live'): boolean {
  if (!isRecord(data)) return false;
  if (data.type === 'navigate') {
    const route = sanitizeRoute(data.url);
    if (!route) return false;
    if (window.location.hash !== route) window.location.hash = route;
    return true;
  }
  if (mode !== 'live') return false;
  if (data.type === 'push' && isPushMessage(data.message)) {
    window.dispatchEvent(new CustomEvent<SwPushDetail>('tma:push', { detail: { message: data.message } }));
    return true;
  }
  if (data.type === 'pushsubscriptionchange') {
    window.dispatchEvent(new Event('tma:pushsubscriptionchange'));
    return true;
  }
  return false;
}

/** Ask an installed app that stays open for days to look for a new version now and then. */
function scheduleUpdateChecks(registration: ServiceWorkerRegistration): void {
  setInterval(() => {
    if (document.visibilityState !== 'visible' || navigator.onLine === false) return;
    registration.update().catch(() => undefined);
  }, UPDATE_CHECK_MS);
}

/**
 * Call once at startup with this page's mode. No-op without service-worker
 * support and in `vite dev` (no SW is built there).
 */
export function registerServiceWorker(mode: AppMode = 'live'): void {
  if (registered || typeof window === 'undefined' || typeof navigator === 'undefined') return;
  if (!('serviceWorker' in navigator) || !navigator.serviceWorker) return;
  if (import.meta.env.DEV) return;
  registered = true;

  navigator.serviceWorker.addEventListener('message', (event: MessageEvent) => {
    handleServiceWorkerMessage(event.data, mode);
  });

  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      window.dispatchEvent(
        new CustomEvent<SwUpdateDetail>('tma:sw-update', { detail: { update: () => updateSW(true) } }),
      );
    },
    onRegisteredSW(_url, registration) {
      if (registration) scheduleUpdateChecks(registration);
    },
    onRegisterError(error: unknown) {
      console.warn('TMA: service worker registration failed', error);
    },
  });
}
