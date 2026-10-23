/**
 * The demo inside a live build (ARCHITECTURE.md §10 "Live and demo in one
 * build"): "?demo" opens the demo with sample data, the demo is labelled and
 * can be left with "Exit demo", and the two modes keep separate sign-ins.
 *
 * playwright.config.ts builds this into dist-live/ with VITE_API_URL set to an
 * https://example.invalid address and serves it on :4174. The demo must never
 * call that backend, and the live sign-in screen doesn't call it before a
 * code is requested, so any request to it fails the test.
 */
/// <reference lib="dom" />
// (page.evaluate callbacks run in the browser.)
import { expect, test, type Page } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 }, contextOptions: { reducedMotion: 'reduce' } });

const LIVE_HEADING = { name: 'Sign in with your email', level: 1 } as const;

function storage(page: Page, key: string): Promise<string | null> {
  return page.evaluate((k) => window.localStorage.getItem(k), key);
}

async function expectLiveSignIn(page: Page): Promise<void> {
  await expect(page.getByRole('heading', LIVE_HEADING)).toBeVisible();
  await expect(page.getByRole('button', { name: 'See a demo with sample data' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Try as a parent/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Exit demo' })).toHaveCount(0);
}

test('?demo opens the demo in a live build, and Exit demo returns to the real sign-in', async ({ page }) => {
  const problems: string[] = [];
  const backendCalls: string[] = [];
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`console: ${msg.text()}`);
  });
  await page.route('https://example.invalid/**', async (route) => {
    backendCalls.push(`${route.request().method()} ${route.request().url()}`);
    await route.abort();
  });

  // --- The live build starts on the real sign-in -------------------------------
  await page.goto('./');
  await expectLiveSignIn(page);
  expect(await storage(page, 'tma.mode')).toBeNull();

  // --- "?demo" switches this browser to the demo and tidies the address --------
  await page.goto('./?demo#/funds');
  await expect(page.getByRole('button', { name: /Try as a parent/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Exit demo' })).toBeVisible();
  await expect.poll(() => new URL(page.url()).search).toBe('');
  expect(new URL(page.url()).hash).toBe('#/funds');
  expect(await storage(page, 'tma.mode')).toBe('demo');

  // A reload stays in the demo (the choice is remembered, not read from the address).
  await page.reload();
  await expect(page.getByRole('button', { name: /Try as a parent/ })).toBeVisible();

  // --- Signed in to the demo (on the route from the link): the strip says so ----
  await page.getByRole('button', { name: /Try as a parent/ }).click();
  await expect(page.getByRole('heading', { name: 'Activity funds', level: 1 })).toBeVisible();
  const strip = page.getByRole('note', { name: 'Demo' });
  await expect(strip).toContainText('Demo with made-up families. Nothing here is real.');
  expect(await storage(page, 'tma.demo.session')).toBeTruthy();
  expect(await storage(page, 'tma.session')).toBeNull();

  await strip.getByRole('button', { name: 'Exit demo' }).click();
  await expectLiveSignIn(page);
  expect(await storage(page, 'tma.mode')).toBeNull();
  // The demo sign-in is kept for next time, and never became a live session.
  expect(await storage(page, 'tma.demo.session')).toBeTruthy();
  expect(await storage(page, 'tma.session')).toBeNull();

  // --- The link on the sign-in screen goes back to the (still signed-in) demo ---
  await page.getByRole('button', { name: 'See a demo with sample data' }).click();
  await expect(page.getByText('Available activity funds').first()).toBeVisible();
  await expect(page.getByRole('note', { name: 'Demo' })).toBeVisible();

  // --- "?demo=0" also leaves the demo -------------------------------------------
  await page.goto('./?demo=0');
  await expectLiveSignIn(page);
  await expect.poll(() => new URL(page.url()).search).toBe('');
  expect(await storage(page, 'tma.mode')).toBeNull();

  expect(backendCalls).toEqual([]);
  expect(problems).toEqual([]);
});
