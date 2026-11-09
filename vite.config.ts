/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

// Relative base so the same build works at https://<user>.github.io/<repo>/,
// on any other static host, or at a custom domain root. Routing is hash-based.
export default defineConfig({
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    react(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src/web',
      filename: 'sw.ts',
      registerType: 'prompt',
      injectRegister: false, // registered manually in src/web/lib/sw-register.ts
      // Not brand/* whole: see globIgnores below.
      includeAssets: ['icons/*.png', 'brand/tma-logo-*.webp', 'brand/tma-owl-mark.png'],
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,png,svg,webp,jpg,woff2}'],
        // Published but never shown in the app, so phones don't store them: the artwork
        // `npm run icons` starts from, and the logo emails load from the site.
        globIgnores: ['brand/tma-music-logo-source.webp', 'brand/tma-logo-email.png'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
      devOptions: { enabled: false, type: 'module' },
      manifest: {
        id: './',
        name: 'TMA Family App – Timberlane Music Association',
        short_name: 'TMA',
        description:
          'Timberlane Music Association: activity-fund balances, trips, payments and news for music families.',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#faf7f5',
        theme_color: '#5a0f13',
        categories: ['education', 'finance', 'music'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  build: {
    target: 'es2020',
    sourcemap: true,
  },
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.{ts,mjs}'],
    restoreMocks: true,
  },
});
