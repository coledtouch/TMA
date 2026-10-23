import { defineConfig, devices } from '@playwright/test';

/**
 * Two builds are served:
 * - dist/ on :4173, the demo build (`npm run build:web` with no VITE_API_URL);
 * - dist-live/ on :4174, a live build pointed at an address that can't exist,
 *   built here, to test the "?demo" opt-in and "Exit demo" (ARCHITECTURE.md §10).
 *
 * Projects: `npm run e2e` runs "demo" and "live-build"; `npm run screenshots`
 * runs "screenshots", which rewrites the README images in docs/screenshots.
 */
const DEMO_URL = 'http://127.0.0.1:4173/';
const LIVE_URL = 'http://127.0.0.1:4174/';
/** Reserved top-level domain (RFC 2606): no request to it can reach a server. e2e/live-demo.spec.ts matches it. */
const FAKE_API_URL = 'https://example.invalid/exec';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: DEMO_URL,
    ...devices['iPhone 13'],
    browserName: 'chromium',
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
      : undefined,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'demo', testMatch: 'demo.spec.ts' },
    { name: 'live-build', testMatch: 'live-demo.spec.ts', use: { baseURL: LIVE_URL } },
    { name: 'screenshots', testMatch: 'screenshots.spec.ts' },
  ],
  webServer: [
    {
      command: 'npx vite preview --host 127.0.0.1 --port 4173 --strictPort',
      url: DEMO_URL,
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      command:
        'npx vite build --outDir dist-live --emptyOutDir --logLevel warn && ' +
        'npx vite preview --outDir dist-live --host 127.0.0.1 --port 4174 --strictPort',
      url: LIVE_URL,
      env: { VITE_API_URL: FAKE_API_URL },
      reuseExistingServer: true,
      timeout: 180_000,
    },
  ],
});
