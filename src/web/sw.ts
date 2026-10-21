/// <reference lib="webworker" />
/**
 * Service worker (ARCHITECTURE.md §10), built by vite-plugin-pwa (injectManifest).
 *
 * - Precaches the app shell so the app opens offline; every in-scope
 *   navigation is answered with the precached index.html (hash routing).
 * - Caches same-origin images (stale-while-revalidate). API calls are never
 *   cached: they are POSTs to Apps Script on another origin.
 * - Shows push notifications (FCM data messages, FCM notification messages or
 *   a plain PushMessage) and tells open app windows, so the in-app banner and
 *   data refresh can react too.
 * - Tapping a notification focuses the app (or opens it) at the message's route.
 *
 * Note: this file must not export anything. It is bundled as an ES "library"
 * and registered as a classic worker, where `export` is a syntax error.
 */
import { clientsClaim } from 'workbox-core';
import { ExpirationPlugin } from 'workbox-expiration';
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute, type PrecacheEntry } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { StaleWhileRevalidate } from 'workbox-strategies';
import type { PushMessage } from '../shared/types';

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<PrecacheEntry | string> };

const FALLBACK_TITLE = 'TMA update';
const ICON_PATH = 'icons/icon-192.png';
/**
 * Android draws the badge from the image's alpha channel only. icon-192 is
 * opaque, so a transparent single-colour badge icon would look better here.
 */
const BADGE_PATH = 'icons/icon-192.png';
const DEFAULT_ROUTE = '#/';
const TOPICS: ReadonlyArray<PushMessage['topic']> = ['balance', 'payments', 'reminders', 'announcements', 'test', 'admin'];
/** In-app hash routes only: never let a push payload open another site. */
const ROUTE_RE = /^#\/[A-Za-z0-9\-._~/?=&%]*$/;

/** A URL inside the app's scope (works at a domain root or a GitHub Pages subpath). */
function inScope(path: string): string {
  return new URL(path, self.registration.scope).href;
}

// ---------------------------------------------------------------------------
// Caching
// ---------------------------------------------------------------------------

clientsClaim();
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

try {
  registerRoute(
    new NavigationRoute(createHandlerBoundToURL(inScope('index.html')), {
      // Real files (e.g. a PDF hosted next to the app) are not app navigations.
      denylist: [/\/[^/?#]+\.[^/?#]+$/],
    }),
  );
} catch (err) {
  // index.html missing from the precache manifest: keep the worker alive for push.
  console.warn('TMA service worker: navigation fallback disabled', err);
}

registerRoute(
  ({ request, url }) => request.destination === 'image' && url.origin === self.location.origin,
  new StaleWhileRevalidate({
    cacheName: 'tma-images',
    plugins: [new ExpirationPlugin({ maxEntries: 60, maxAgeSeconds: 30 * 24 * 60 * 60, purgeOnQuotaError: true })],
  }),
);

// ---------------------------------------------------------------------------
// Push
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function safeRoute(value: unknown): string {
  return typeof value === 'string' && value.length <= 200 && ROUTE_RE.test(value) ? value : DEFAULT_ROUTE;
}

function readPayload(data: PushMessageData | null): unknown {
  if (!data) return null;
  let raw: string;
  try {
    raw = data.text();
  } catch {
    return null;
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw; // Plain text push: use it as the body.
  }
}

/**
 * Accepts an FCM data message `{data:{title,body,url,tag,topic}}`, an FCM
 * notification message `{notification:{title,body}, data?}`, a plain
 * PushMessage, or plain text. Never throws.
 */
function toPushMessage(payload: unknown): PushMessage {
  if (typeof payload === 'string') {
    return { title: FALLBACK_TITLE, body: text(payload, 1000), url: DEFAULT_ROUTE, topic: 'announcements' };
  }
  const root = isRecord(payload) ? payload : {};
  const data = isRecord(root.data) ? root.data : {};
  const notification = isRecord(root.notification) ? root.notification : {};
  const pick = (key: string): unknown => data[key] ?? notification[key] ?? root[key];

  const topic = pick('topic');
  const tag = text(pick('tag'), 64);
  return {
    title: text(pick('title'), 120) || FALLBACK_TITLE,
    body: text(pick('body'), 1000),
    url: safeRoute(pick('url')),
    ...(tag ? { tag } : {}),
    topic: TOPICS.includes(topic as PushMessage['topic']) ? (topic as PushMessage['topic']) : 'announcements',
  };
}

async function windowClients(): Promise<readonly WindowClient[]> {
  return self.clients.matchAll({ type: 'window', includeUncontrolled: true });
}

async function tellWindows(message: PushMessage): Promise<void> {
  for (const client of await windowClients()) {
    try {
      client.postMessage({ type: 'push', message });
    } catch {
      // A closing window can't receive messages; the notification still shows.
    }
  }
}

self.addEventListener('push', (event) => {
  let message: PushMessage;
  try {
    message = toPushMessage(readPayload(event.data));
  } catch {
    message = { title: FALLBACK_TITLE, body: '', url: DEFAULT_ROUTE, topic: 'announcements' };
  }
  // iOS revokes push permission from apps that receive a push without showing a notification.
  const shown = self.registration.showNotification(message.title, {
    body: message.body,
    icon: inScope(ICON_PATH),
    badge: inScope(BADGE_PATH),
    tag: message.tag,
    data: { url: message.url },
    lang: 'en',
  });
  event.waitUntil(Promise.allSettled([shown, tellWindows(message)]).then(() => undefined));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data: unknown = event.notification.data;
  const route = safeRoute(isRecord(data) ? data.url : undefined);
  event.waitUntil(openApp(route));
});

async function openApp(route: string): Promise<void> {
  const scope = self.registration.scope;
  const clients = (await windowClients()).filter((c) => c.url.startsWith(scope));
  const client = clients.find((c) => c.focused) ?? clients.find((c) => c.visibilityState === 'visible') ?? clients[0];
  if (client) {
    try {
      const focused = await client.focus();
      focused.postMessage({ type: 'navigate', url: route });
      return;
    } catch {
      // Focus can be refused (e.g. no user activation); fall back to a new window.
    }
  }
  await self.clients.openWindow(scope + route);
}

// ---------------------------------------------------------------------------
// Updates: the "Reload" button in the app (sw-register.ts) sends SKIP_WAITING.
// ---------------------------------------------------------------------------

self.addEventListener('message', (event) => {
  const data: unknown = event.data;
  if (isRecord(data) && data.type === 'SKIP_WAITING') void self.skipWaiting();
});
