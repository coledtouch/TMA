/**
 * Minimal Settings-tab reader for the adapters (PayPal client id/env, the
 * mail sender name, the status dialog). It resolves keys exactly like the
 * core's Settings parser: keys compare as UPPER_SNAKE ("Paypal client id" =
 * PAYPAL_CLIENT_ID), the last row for a key wins, and blank means default.
 */
import { SETTING_DEFAULTS, type SettingKey } from '../shared/schema';
import type { CellValue, Store } from '../server/services';

/** The Settings value for `key` as text, or its default when the row is missing or blank. */
export function readSetting(store: Store, key: SettingKey): string {
  let value: string | undefined;
  for (const row of store.read('Settings')) {
    if (settingKey(row.data.Key) === key) value = cellText(row.data.Value);
  }
  return value === undefined || value === '' ? SETTING_DEFAULTS[key] : value;
}

/** "Admin Emails" / "admin_emails" -> "ADMIN_EMAILS". */
export function settingKey(value: CellValue | undefined): string {
  return cellText(value)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** A yes/no setting; text the core wouldn't recognize falls back to the default, as in the core. */
export function readFlag(store: Store, key: SettingKey): boolean {
  return parseFlag(readSetting(store, key), parseFlag(SETTING_DEFAULTS[key], false));
}

const TRUE_WORDS = ['true', 'yes', 'y', 'x', '1', 'on', '✓', '✔'];
const FALSE_WORDS = ['false', 'no', 'n', '0', 'off'];

/** TRUE/FALSE, Y/N, Yes/No, x, 1/0, on/off (case-insensitive); anything else -> `fallback`. */
export function parseFlag(value: string, fallback: boolean): boolean {
  const word = value.trim().toLowerCase();
  if (TRUE_WORDS.includes(word)) return true;
  if (FALSE_WORDS.includes(word)) return false;
  return fallback;
}

function cellText(value: CellValue | undefined): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : value.toISOString();
  return String(value).trim();
}
