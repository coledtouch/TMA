import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Run from the repo root: npx vitest run --config workers/push/vitest.config.ts
// Node 22's globalThis.crypto.subtle is WebCrypto, like the Workers runtime.
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    restoreMocks: true,
    unstubGlobals: true,
  },
});
