/**
 * Public surface of the backend core. The in-memory services (memory.ts) are
 * deliberately not re-exported so they never end up in the Apps Script bundle.
 */
export { createApp } from './app';
export { sampleData } from './sample-data';
export type { App, Services, SetupOptions } from './services';
