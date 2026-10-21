/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Google Apps Script web-app /exec URL. Empty = built-in demo mode. */
  readonly VITE_API_URL?: string;
  /** Firebase web config as JSON: {"apiKey","projectId","messagingSenderId","appId"}. Empty = push disabled (demo uses local notifications). */
  readonly VITE_FIREBASE_CONFIG?: string;
  /** Web Push certificate (VAPID public key) from Firebase console > Cloud Messaging. */
  readonly VITE_FIREBASE_VAPID_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare const __APP_VERSION__: string;
