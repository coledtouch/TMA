/**
 * Front door for https://mytma.org: serves the static app build through the
 * ASSETS binding, sends www.mytma.org to the bare domain, and sets security
 * and caching headers. The app itself talks to Apps Script and the push
 * Worker directly; nothing here touches family data.
 */

export interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
}

export const CANONICAL_HOST = 'mytma.org';

const SECURITY_HEADERS: Record<string, string> = {
  'Strict-Transport-Security': 'max-age=31536000',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
};

/** Files that must be revalidated so a new release reaches phones promptly. */
function isAlwaysFresh(pathname: string): boolean {
  return (
    pathname === '/' ||
    pathname.endsWith('.html') ||
    pathname.endsWith('/sw.js') ||
    pathname.endsWith('.webmanifest') ||
    pathname.endsWith('/registerSW.js')
  );
}

export async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  if (url.hostname === `www.${CANONICAL_HOST}`) {
    url.hostname = CANONICAL_HOST;
    return Response.redirect(url.toString(), 301);
  }

  const response = await env.ASSETS.fetch(request);
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) headers.set(name, value);

  if (isAlwaysFresh(url.pathname)) {
    headers.set('Cache-Control', 'no-cache');
  } else if (url.pathname.startsWith('/assets/') && response.ok) {
    // Vite fingerprints everything under /assets, so it never changes in place.
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  }

  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export default { fetch: handle };
