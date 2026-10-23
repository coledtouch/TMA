/**
 * README screenshots (docs/screenshots/*.png), taken from the demo build at the
 * iPhone 13 screen size (390×844 CSS pixels, as the app looks when opened from
 * the Home Screen), light theme, plus one dark-theme Home.
 *
 * Run `npm run build:web`, then `npm run screenshots`. The images are committed,
 * so only run this when the screens change, and look at every image before
 * committing it.
 */
/// <reference lib="dom" />
// (page.evaluate callbacks run in the browser.)
import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SHOTS = fileURLToPath(new URL('../docs/screenshots/', import.meta.url));
mkdirSync(SHOTS, { recursive: true });

test.use({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  colorScheme: 'light',
  contextOptions: { reducedMotion: 'reduce' },
});

async function shot(page: Page, name: string): Promise<void> {
  // Let images decode and fonts settle so nothing is caught half-drawn.
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      Array.from(document.images, (img) => (img.complete ? null : img.decode().catch(() => undefined))),
    );
  });
  await page.screenshot({ path: `${SHOTS}${name}.png`, animations: 'disabled', caret: 'hide' });
}

async function tab(page: Page, name: 'Home' | 'Funds' | 'Trips' | 'News' | 'More'): Promise<void> {
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name }).click();
}

/** Dismiss toasts and in-app push banners, so they don't cover the screen. */
async function clearMessages(page: Page): Promise<void> {
  const dismissers = page
    .getByRole('button', { name: 'Dismiss message' })
    .or(page.locator('.push-banner').getByRole('button', { name: 'Dismiss' }));
  while ((await dismissers.count()) > 0) await dismissers.first().click();
}

async function signInAs(page: Page, who: 'parent' | 'the treasurer'): Promise<void> {
  await page.goto('./');
  await page.getByRole('button', { name: `Try as ${who === 'parent' ? 'a parent' : who}` }).click();
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
}

function watchForProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`console: ${msg.text()}`);
  });
  page.on('requestfailed', (req) => problems.push(`requestfailed: ${req.url()}`));
  return problems;
}

test('parent screens', async ({ page }) => {
  const problems = watchForProblems(page);

  await page.goto('./');
  await expect(page.getByRole('button', { name: /Try as a parent/ })).toBeVisible();
  await shot(page, 'signin');

  await page.getByRole('button', { name: /Try as a parent/ }).click();
  await expect(page.getByText('Available activity funds').first()).toBeVisible();
  await clearMessages(page);
  await shot(page, 'home');

  await tab(page, 'Funds');
  await expect(page.getByRole('heading', { name: 'Activity funds', level: 1 })).toBeVisible();
  await shot(page, 'funds');

  await tab(page, 'Trips');
  await expect(page.getByRole('button', { name: 'Use activity funds' }).first()).toBeVisible();
  await shot(page, 'trips');

  await page.getByRole('button', { name: 'Pay online' }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Amount to pay').fill('250.00');
  await expect(dialog.getByRole('button', { name: 'PayPal (Demo)' })).toBeEnabled();
  await dialog.getByLabel('Amount to pay').blur();
  await shot(page, 'pay');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  await tab(page, 'News');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await shot(page, 'news');

  await page.goto('./#/notifications');
  await expect(page.getByRole('heading', { name: 'Notifications', level: 1 })).toBeVisible();
  await shot(page, 'notifications');

  expect(problems).toEqual([]);
});

test('treasurer screen', async ({ page }) => {
  const problems = watchForProblems(page);
  await signInAs(page, 'the treasurer');
  await page.goto('./#/admin');
  await expect(page.getByRole('button', { name: 'Approve $200.00' })).toBeVisible();
  await clearMessages(page);
  await shot(page, 'admin');
  expect(problems).toEqual([]);
});

test.describe('dark theme', () => {
  test.use({ colorScheme: 'dark' });

  test('home', async ({ page }) => {
    const problems = watchForProblems(page);
    await signInAs(page, 'parent');
    await expect(page.getByText('Available activity funds').first()).toBeVisible();
    await clearMessages(page);
    await shot(page, 'home-dark');
    expect(problems).toEqual([]);
  });
});
