/**
 * Front door for https://mytma.org: serves the static app build through the
 * ASSETS binding, sends every other address of this Worker (www.mytma.org and
 * its workers.dev addresses) to the bare domain, and sets security and caching
 * headers. The app itself talks to Apps Script and the push Worker directly;
 * nothing here touches family data.
 */

export interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
}

// Not exported: workerd treats every named export of the main module as a
// handler and refuses to start (`wrangler dev`) on a plain string.
const CANONICAL_HOST = 'mytma.org';

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

/**
 * The app has one address. Sign-ins, cached family data and push subscriptions
 * belong to a web origin, so www or a workers.dev address (normally switched
 * off in wrangler.toml) would otherwise be a second, separate copy of the app.
 */
function isOtherAddress(hostname: string): boolean {
  return hostname === `www.${CANONICAL_HOST}` || hostname.endsWith('.workers.dev');
}

function isHtml(response: Response): boolean {
  return (response.headers.get('Content-Type') ?? '').toLowerCase().includes('text/html');
}

export async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  if (isOtherAddress(url.hostname)) {
    url.protocol = 'https:';
    url.hostname = CANONICAL_HOST;
    url.port = '';
    return Response.redirect(url.toString(), 301);
  }

  const response = await env.ASSETS.fetch(request);

  if (url.pathname.startsWith('/assets/') && isHtml(response)) {
    // not_found_handling = "single-page-application" answers a missing file
    // with index.html and 200. A page from an older release asking for a chunk
    // a deploy replaced must get a 404 that no cache keeps, not HTML marked
    // immutable for a year under that script's address.
    await response.body?.cancel();
    return new Response('Not found', {
      status: 404,
      headers: { ...SECURITY_HEADERS, 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }

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
