import '@testing-library/jest-dom/vitest';

// jsdom has no layout, so window.scrollTo only logs "Not implemented". The app
// scrolls to the top on navigation; make it a quiet no-op in DOM tests.
if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'scrollTo', { configurable: true, writable: true, value: () => undefined });
}
