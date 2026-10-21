/**
 * Smoke test of the demo build at phone size (ARCHITECTURE.md §11): a parent
 * asks to use activity funds and pays online, the treasurer approves and posts
 * a fundraiser credit, and the parent's "phone" gets the notification.
 * (The README screenshots come from screenshots.spec.ts: `npm run screenshots`.)
 *
 * Run `npm run build:web` first; playwright.config.ts serves dist with vite preview.
 */
import { expect, test, type Page } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, contextOptions: { reducedMotion: 'reduce' } });

async function tab(page: Page, name: 'Home' | 'Funds' | 'Trips' | 'News' | 'More'): Promise<void> {
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name }).click();
}

/** Dismiss toasts and in-app push banners (keeps later assertions clear). */
async function clearMessages(page: Page): Promise<void> {
  const dismissers = page
    .getByRole('button', { name: 'Dismiss message' })
    .or(page.locator('.push-banner').getByRole('button', { name: 'Dismiss' }));
  while ((await dismissers.count()) > 0) await dismissers.first().click();
}

async function signOut(page: Page): Promise<void> {
  await tab(page, 'More');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('button', { name: /Try as a parent/ })).toBeVisible();
}

test('parent pays and redeems, treasurer approves, parent is notified', async ({ page }) => {
  const problems: string[] = [];
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`console: ${msg.text()}`);
  });

  // --- Sign in as a parent -----------------------------------------------------
  await page.goto('./');
  await expect(page.getByRole('button', { name: /Try as a parent/ })).toBeVisible();

  await page.getByRole('button', { name: /Try as a parent/ }).click();
  await expect(page.getByText('Available activity funds').first()).toBeVisible();
  await expect(page.getByText('$440.00').first()).toBeVisible(); // Avery: $640 − $200 pending

  // --- Ask to use $100 of Avery's funds for Florida ----------------------------
  await tab(page, 'Trips');
  const useFunds = page.getByRole('button', { name: 'Use activity funds' }).first();
  await expect(useFunds).toBeVisible();

  await useFunds.click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel('Amount to apply').fill('100.00');
  await dialog.getByRole('button', { name: 'Send request' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(/Request sent: \$100\.00/)).toBeVisible();
  await clearMessages(page);

  // --- Pay $250 online with the demo PayPal buttons ----------------------------
  await page.getByRole('button', { name: 'Pay online' }).first().click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('Amount to pay').fill('250.00');
  const paypal = dialog.getByRole('button', { name: 'PayPal (Demo)' });
  await expect(paypal).toBeEnabled();
  await paypal.click();
  await expect(page.getByText(/Payment received – thank you! \$250\.00/)).toBeVisible();
  // The demo also "sends" the payment notification to this phone.
  await expect(page.locator('.push-banner').filter({ hasText: 'Payment received' })).toBeVisible();
  await clearMessages(page);

  await page.goto('./#/notifications');
  await expect(page.getByRole('heading', { name: 'Notifications', level: 1 })).toBeVisible();

  // --- Treasurer approves the request and posts a fundraiser credit ------------
  await signOut(page);
  await page.getByRole('button', { name: /Try as the treasurer/ }).click();
  await page.goto('./#/admin');
  const approve = page.getByRole('button', { name: 'Approve $100.00' });
  await expect(approve).toBeVisible();
  await approve.click();
  await expect(page.getByText(/Approved \$100\.00 for Avery/)).toBeVisible();

  await tab(page, 'More');
  await clearMessages(page); // so the banner below is the credit's own notification
  await page.getByRole('button', { name: 'Add credit & notify' }).click();
  const banner = page.locator('.push-banner').filter({ hasText: '+$50.00 for Avery' });
  await expect(banner).toBeVisible();
  await expect(banner).toContainText("Sent to parent@example.com's phone");

  // --- Back as the parent: the new balance -------------------------------------
  await signOut(page);
  await page.getByRole('button', { name: /Try as a parent/ }).click();
  // $640 − $100 approved + $50 credit, minus the $200 still waiting = $390.
  await expect(page.getByText('$390.00').first()).toBeVisible();
  await tab(page, 'Funds');
  await expect(page.getByText('Pizza Night fundraiser').first()).toBeVisible();

  expect(problems).toEqual([]);
});
