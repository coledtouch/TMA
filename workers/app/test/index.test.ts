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

  it('caches fingerprinted assets for a year', async () => {
    const js = assets('export {}', { headers: { 'Content-Type': 'text/javascript' } });
    const ok = await handle(new Request('https://mytma.org/assets/index-abc123.js'), js);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
  });

  it('answers a missing asset with a 404 that is never cached, not the SPA fallback page', async () => {
    // What the ASSETS binding really returns for a missing file with
    // not_found_handling = "single-page-application": index.html with 200.
    const fallback = assets('<!doctype html><html></html>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    const res = await handle(new Request('https://mytma.org/assets/index-GONE.js'), fallback);
    expect(res.status).toBe(404);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('Content-Type')).toContain('text/plain');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(await res.text()).not.toContain('<html');
  });

  it('does not mark other failed asset answers immutable', async () => {
    const missing = await handle(
      new Request('https://mytma.org/assets/gone.js'),
      assets('nope', { status: 404, headers: { 'Content-Type': 'text/plain' } }),
    );
    expect(missing.status).toBe(404);
    expect(missing.headers.get('Cache-Control')).toBeNull();
  });

  it('still serves the app shell for routes outside /assets', async () => {
    const res = await handle(new Request('https://mytma.org/some/route'), assets('<!doctype html>'));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('<!doctype html>');
  });

  it.each([
    'https://tma-app.example.workers.dev/assets/app.js?v=2',
    'https://1a2b3c4d-tma-app.example.workers.dev/assets/app.js?v=2',
  ])('sends the Worker\'s workers.dev address %s to mytma.org', async (address) => {
    const env = assets();
    const res = await handle(new Request(address), env);
    expect(res.status).toBe(301);
    expect(res.headers.get('Location')).toBe('https://mytma.org/assets/app.js?v=2');
    expect(env.seen).toEqual([]);
  });

  it('serves local development addresses as they are', async () => {
    const env = assets();
    const res = await handle(new Request('http://localhost:8787/'), env);
    expect(res.status).toBe(200);
    expect(env.seen).toEqual(['/']);
  });
});
