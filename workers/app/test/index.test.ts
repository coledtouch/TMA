import { describe, expect, it } from 'vitest';
import { handle, type Env } from '../src/index';

function assets(body = 'ok', init: ResponseInit = {}): Env & { seen: string[] } {
  const seen: string[] = [];
  return {
    seen,
    ASSETS: {
      async fetch(request: Request) {
        seen.push(new URL(request.url).pathname);
        return new Response(body, { status: 200, headers: { 'Content-Type': 'text/html', ETag: '"abc"' }, ...init });
      },
    },
  };
}

describe('tma-app front door', () => {
  it('redirects www to the bare domain, keeping path and query', async () => {
    const env = assets();
    const res = await handle(new Request('https://www.mytma.org/assets/app.js?v=2'), env);
    expect(res.status).toBe(301);
    expect(res.headers.get('Location')).toBe('https://mytma.org/assets/app.js?v=2');
    expect(env.seen).toEqual([]);
  });

  it('serves assets with security headers and keeps upstream headers', async () => {
    const res = await handle(new Request('https://mytma.org/'), assets('<html>'));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('<html>');
    expect(res.headers.get('ETag')).toBe('"abc"');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('X-Frame-Options')).toBe('DENY');
    expect(res.headers.get('Strict-Transport-Security')).toContain('max-age=');
  });

  it.each(['/', '/index.html', '/sw.js', '/manifest.webmanifest'])('never caches %s for long', async (path) => {
    const res = await handle(new Request(`https://mytma.org${path}`), assets());
    expect(res.headers.get('Cache-Control')).toBe('no-cache');
  });

  it('caches fingerprinted assets for a year but not missing ones', async () => {
    const ok = await handle(new Request('https://mytma.org/assets/index-abc123.js'), assets());
    expect(ok.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
    const missing = await handle(new Request('https://mytma.org/assets/gone.js'), assets('nope', { status: 404 }));
    expect(missing.status).toBe(404);
    expect(missing.headers.get('Cache-Control')).toBeNull();
  });
});
