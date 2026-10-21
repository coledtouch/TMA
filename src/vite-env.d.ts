/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Google Apps Script web-app /exec URL. Empty = the build is only the
   * built-in demo. When set, "?demo" still opens the demo in that browser
   * (src/web/lib/mode.ts). Push needs no build setting: the app gets the push
   * Worker's public key from the server (PublicSettings.pushPublicKey).
   */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare const __APP_VERSION__: string;
