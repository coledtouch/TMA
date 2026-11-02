import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Run from the repo root: npx vitest run --config workers/app/vitest.config.ts
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    restoreMocks: true,
    unstubGlobals: true,
  },
});
