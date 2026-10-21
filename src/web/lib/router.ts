/**
 * Tiny hash router. Hash routes keep the app working from any static host and
 * any subpath (GitHub Pages), and match the `url` in push notifications
 * ("#/funds", "#/trips", …).
 */
import { useSyncExternalStore } from 'react';

export type RouteName =
  | 'home'
  | 'funds'
  | 'trips'
  | 'news'
  | 'more'
  | 'household'
  | 'notifications'
  | 'admin'
  | 'reports';

export interface Route {
  name: RouteName;
  params: Record<string, string>;
}

const PATHS: Record<RouteName, string> = {
  home: '/',
  funds: '/funds',
  trips: '/trips',
  news: '/news',
  more: '/more',
  household: '/household',
  notifications: '/notifications',
  admin: '/admin',
  reports: '/reports',
};

const BY_PATH = new Map<string, RouteName>(
  (Object.keys(PATHS) as RouteName[]).map((name) => [PATHS[name], name]),
);

export type TabName = 'home' | 'funds' | 'trips' | 'news' | 'more';

/** Which bottom tab is highlighted for a route. */
export function tabFor(name: RouteName): TabName {
  switch (name) {
    case 'home':
    case 'funds':
    case 'trips':
    case 'news':
    case 'more':
      return name;
    default:
      return 'more';
  }
}

/** "#/funds?student=S0001" → { name: 'funds', params: { student: 'S0001' } }. Unknown → home. */
export function parseHash(hash: string): Route {
  let h = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!h.startsWith('/')) h = `/${h}`;
  const q = h.indexOf('?');
  const rawPath = q >= 0 ? h.slice(0, q) : h;
  const query = q >= 0 ? h.slice(q + 1) : '';
  const path = rawPath.length > 1 ? rawPath.replace(/\/+$/, '').toLowerCase() : '/';
  const name = BY_PATH.get(path) ?? 'home';
  const params: Record<string, string> = {};
  if (BY_PATH.has(path)) {
    for (const [k, v] of new URLSearchParams(query)) params[k] = v;
  }
  return { name, params };
}

export function href(name: RouteName, params?: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {})) if (v) search.set(k, v);
  const qs = search.toString();
  return `#${PATHS[name]}${qs ? `?${qs}` : ''}`;
}

/** Go to a route, or to a hash string such as a notification's url ("#/trips"). */
export function navigate(to: RouteName | `#${string}`, params?: Record<string, string | undefined>): void {
  const next = to.startsWith('#') ? to : href(to as RouteName, params);
  if (window.location.hash !== next) window.location.hash = next;
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}

const getHash = () => window.location.hash;

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, getHash, () => '');
  return parseHash(hash);
}
