/**
 * Builds the core's Services from Apps Script globals. One instance per
 * execution: every web request, trigger run and menu click starts fresh.
 */
import type { SecretName, SettingKey } from '../shared/schema';
import type { Cache, Crypto, Logger, Secrets, Services } from '../server/services';
import { createGasMailer, type GasMailer } from './mail';
import { createPayPalGateway } from './paypal';
import { createPushRelaySender, type PushRelaySender } from './push-relay';
import { readFlag, readSetting } from './settings';
import { createSheetStore, type SheetStore } from './sheet-store';
import { createTwilioSender } from './twilio';
import { bytesToHex, clamp, describeError } from './util';

/** CacheService limits. */
const MAX_CACHE_TTL_SECONDS = 21600;
const MAX_CACHE_KEY_CHARS = 250;
const LOCK_TIMEOUT_MS = 20000;

export interface GasServices extends Services {
  store: SheetStore;
  /** Push over the TMA push Worker (also used by setup and the status dialog). */
  push: PushRelaySender;
  /** Email as noreply@mytma.org through the same Worker, Gmail (MailApp) as the fallback. */
  mailer: GasMailer;
  /** A Settings-tab value (or its default) as text. */
  setting(key: SettingKey): string;
  /** A yes/no Settings-tab value (or its default). */
  flag(key: SettingKey): boolean;
}

export function createGasServices(): GasServices {
  const spreadsheet = SpreadsheetApp.getActive();
  if (!spreadsheet) {
    throw new Error('No spreadsheet: create this script from the TMA Google Sheet (Extensions → Apps Script).');
  }
  const withLock = createScriptLock({
    onAcquire: () => store.invalidate(), // another execution may have written while we waited
    beforeRelease: () => SpreadsheetApp.flush(),
  });
  const store = createSheetStore(spreadsheet, { withLock });
  const setting = (key: SettingKey) => readSetting(store, key);
  const cache = createScriptCache();
  const clock = { now: () => new Date() };
  const secrets = createScriptSecrets();
  const logger = createConsoleLogger();
  const push = createPushRelaySender({ secrets, cache, logger, relayUrl: () => setting('PUSH_RELAY_URL') });

  return {
    mode: 'production',
    store,
    setting,
    flag: (key) => readFlag(store, key),
    cache,
    clock,
    crypto: createGasCrypto(),
    secrets,
    mailer: createGasMailer({
      relay: push,
      cache,
      logger,
      via: () => setting('EMAIL_VIA'),
      senderName: () => setting('ORG_NAME'),
      replyTo: () => setting('SUPPORT_EMAIL'),
    }),
    sms: createTwilioSender({ secrets, logger }),
    push,
    payments: createPayPalGateway({
      cache,
      logger,
      config: () => ({
        clientId: setting('PAYPAL_CLIENT_ID'),
        env: setting('PAYPAL_ENV'),
        secret: secrets.get('PAYPAL_SECRET'),
      }),
    }),
    logger,
    withLock,
  };
}

/** CacheService.getScriptCache(), with the TTL clamped and over-long keys hashed. */
export function createScriptCache(): Cache {
  const cache = () => CacheService.getScriptCache();
  const safeKey = (key: string): string =>
    key.length <= MAX_CACHE_KEY_CHARS
      ? key
      : `sha256:${bytesToHex(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, key, Utilities.Charset.UTF_8))}`;
  return {
    get: (key) => cache().get(safeKey(key)),
    put(key, value, ttlSeconds) {
      const ttl = Number.isFinite(ttlSeconds) ? Math.floor(ttlSeconds) : MAX_CACHE_TTL_SECONDS;
      cache().put(safeKey(key), value, clamp(ttl, 1, MAX_CACHE_TTL_SECONDS));
    },
    remove: (key) => cache().remove(safeKey(key)),
  };
}

export interface LockHooks {
  onAcquire(): void;
  beforeRelease(): void;
}

/**
 * Re-entrant runner around LockService.getScriptLock(): nested calls in the
 * same execution reuse the held lock instead of waiting on themselves.
 */
export function createScriptLock(hooks: LockHooks, timeoutMs = LOCK_TIMEOUT_MS): <T>(fn: () => T) => T {
  let depth = 0;
  return function withLock<T>(fn: () => T): T {
    if (depth > 0) {
      depth += 1;
      try {
        return fn();
      } finally {
        depth -= 1;
      }
    }
    const lock = LockService.getScriptLock();
    lock.waitLock(timeoutMs);
    depth = 1;
    try {
      hooks.onAcquire();
      return fn();
    } finally {
      try {
        hooks.beforeRelease();
      } finally {
        depth = 0;
        lock.releaseLock();
      }
    }
  };
}

export function createGasCrypto(): Crypto {
  return {
    hmacSha256Hex: (key, message) =>
      bytesToHex(Utilities.computeHmacSha256Signature(message, key, Utilities.Charset.UTF_8)),
    uuid: () => Utilities.getUuid().toLowerCase(),
    randomDigits,
  };
}

/**
 * Uniform random digits from Utilities.getUuid() (Java's SecureRandom-backed
 * UUID v4): take the 30 fully random hex nibbles and keep those below 10.
 */
export function randomDigits(length: number): string {
  if (!Number.isInteger(length) || length < 1 || length > 64) {
    throw new RangeError('randomDigits: length must be an integer from 1 to 64');
  }
  let out = '';
  for (let attempt = 0; out.length < length; attempt += 1) {
    if (attempt > 1000) throw new Error('randomDigits: Utilities.getUuid() returned unusable values');
    const hex = Utilities.getUuid().replace(/-/g, '').toLowerCase();
    if (!/^[0-9a-f]{32}$/.test(hex)) continue;
    for (let i = 0; i < hex.length && out.length < length; i += 1) {
      if (i === 12 || i === 16) continue; // version and variant nibbles are fixed or biased
      const n = parseInt(hex[i], 16);
      if (n < 10) out += String(n);
    }
  }
  return out;
}

/** Script Properties (Project Settings → Script Properties). Blank counts as missing. */
export function createScriptSecrets(): Secrets {
  const props = () => PropertiesService.getScriptProperties();
  return {
    get(name: SecretName) {
      const value = props().getProperty(name);
      return value && value.trim() ? value.trim() : null;
    },
    set(name: SecretName, value: string) {
      props().setProperty(name, value);
    },
  };
}

/** console.* goes to Executions / Cloud Logging in Apps Script. */
export function createConsoleLogger(): Logger {
  return {
    info(message, data) {
      if (data === undefined) console.info(message);
      else console.info(message, data);
    },
    error(message, data) {
      if (data === undefined) console.error(message);
      else console.error(message, describeError(data));
    },
  };
}
