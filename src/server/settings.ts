/**
 * The Settings tab -> typed settings. Blank values fall back to
 * SETTING_DEFAULTS, so a half-filled tab still works.
 */
import { dollarsToCents } from '../shared/money';
import { SETTING_DEFAULTS, type SettingKey } from '../shared/schema';
import type { PublicSettings } from '../shared/types';
import type { Services, StoredRow } from './services';
import { isEmail, normEmail, parseBool, safeUrl, splitList, str, unique, uniqueBy } from './util';

export interface AppSettings {
  pub: PublicSettings;
  adminEmails: string[];
  /** Days before a due date to send reminders, largest first. */
  reminderDays: number[];
  emailEnabled: boolean;
  /** SMS_ENABLED as typed (the sender's own `enabled()` is checked separately). */
  smsSetting: boolean;
  /** ONLINE_PAYMENTS as typed. */
  onlinePaymentsSetting: boolean;
  tokenVersion: string;
  sessionDays: number;
}

/** Shown in the Notes column when setup() writes a missing key. */
export const SETTING_NOTES: Readonly<Record<SettingKey, string>> = {
  ORG_NAME: 'Shown in the app, in emails and on PayPal checkout.',
  SUPPORT_EMAIL: 'Where families can reach TMA with questions.',
  APP_URL: 'Web address of the TMA app (used for the button in emails). Example: https://example.github.io/tma/',
  ADMIN_EMAILS: 'Comma-separated emails of board members who can approve requests and send announcements in the app.',
  SCHOOLS: 'Comma-separated school levels families can pick.',
  ENSEMBLES: 'Comma-separated groups families can pick.',
  FEE_PERCENT: 'PayPal percentage fee used for the optional "cover the fee" add-on (1.99 = confirmed 501(c)(3) charity rate).',
  FEE_FIXED: 'PayPal fixed fee per payment, in dollars.',
  FEE_COVER_DEFAULT: 'TRUE = the "cover the processing fee" box starts checked.',
  ONLINE_PAYMENTS: 'TRUE lets families pay online (also needs PAYPAL_CLIENT_ID here and PAYPAL_SECRET in Script Properties).',
  PAYPAL_ENV: 'sandbox while testing, live for real payments.',
  PAYPAL_CLIENT_ID: 'PayPal REST app client ID (public, not secret).',
  MIN_PAYMENT: 'Smallest online payment, in dollars.',
  OTHER_PAYMENT_INSTRUCTIONS: 'Shown to families under "Other ways to pay".',
  DONATE_URL: 'Link for general donations to TMA.',
  PRIVACY_NOTE: 'Shown in the app under More > Privacy.',
  REMINDER_DAYS: 'Send payment reminders this many days before a due date (comma-separated).',
  EMAIL_ENABLED: 'TRUE sends email notifications to families who chose email.',
  SMS_ENABLED: 'TRUE sends text messages to families who chose texts (needs Twilio; about 1 cent per text).',
  TOKEN_VERSION: 'Change this number to sign everyone out of the app.',
  SESSION_DAYS: 'How many days a sign-in lasts.',
};

/** "Admin Emails" / "admin_emails" -> "ADMIN_EMAILS". */
export function settingKey(value: unknown): string {
  return str(value)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function clampNumber(value: number, min: number, max: number, fallback: number): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

export function readSettingValues(rows: readonly StoredRow[]): Map<string, string> {
  const values = new Map<string, string>();
  for (const row of rows) {
    const key = settingKey(row.data.Key);
    if (key) values.set(key, str(row.data.Value));
  }
  return values;
}

export function buildSettings(rows: readonly StoredRow[], services: Services): AppSettings {
  const values = readSettingValues(rows);
  const get = (key: SettingKey): string => {
    const v = values.get(key);
    return v === undefined || v === '' ? SETTING_DEFAULTS[key] : v;
  };
  const bool = (key: SettingKey): boolean => parseBool(get(key), parseBool(SETTING_DEFAULTS[key], false));
  const list = (key: SettingKey): string[] => {
    const items = uniqueBy(splitList(get(key), /[,;\n\r]+/), (s) => s.toLowerCase());
    return items.length > 0 ? items : splitList(SETTING_DEFAULTS[key], /,/);
  };
  const safely = (fn: () => boolean): boolean => {
    try {
      return fn();
    } catch (err) {
      services.logger.error('Port enabled() check failed', err);
      return false;
    }
  };

  const paypalClientId = get('PAYPAL_CLIENT_ID').trim();
  const onlinePaymentsSetting = bool('ONLINE_PAYMENTS');
  const smsSetting = bool('SMS_ENABLED');
  const supportEmail = normEmail(get('SUPPORT_EMAIL'));
  const minPayment = dollarsToCents(get('MIN_PAYMENT'));

  const pub: PublicSettings = {
    orgName: get('ORG_NAME'),
    supportEmail: isEmail(supportEmail) ? supportEmail : SETTING_DEFAULTS.SUPPORT_EMAIL,
    appUrl: safeUrl(get('APP_URL')) ?? '',
    schools: list('SCHOOLS'),
    ensembles: list('ENSEMBLES'),
    feePercent: clampNumber(parseFloat(get('FEE_PERCENT')), 0, 20, parseFloat(SETTING_DEFAULTS.FEE_PERCENT)),
    feeFixedCents: clampNumber(dollarsToCents(get('FEE_FIXED')), 0, 1000, 49),
    feeCoverDefault: bool('FEE_COVER_DEFAULT'),
    onlinePaymentsEnabled:
      onlinePaymentsSetting && paypalClientId !== '' && safely(() => services.payments.enabled()),
    paypalClientId,
    paypalEnv: /^(live|production|prod)$/i.test(get('PAYPAL_ENV')) ? 'live' : 'sandbox',
    minPaymentCents: minPayment > 0 ? Math.min(minPayment, 100000) : 500,
    otherPaymentInstructions: get('OTHER_PAYMENT_INSTRUCTIONS'),
    donateUrl: safeUrl(get('DONATE_URL')) ?? '',
    privacyNote: get('PRIVACY_NOTE'),
    smsEnabled: smsSetting && safely(() => services.sms.enabled()),
  };

  const reminderDays = unique(
    splitList(get('REMINDER_DAYS'), /[,;\s]+/)
      .map((s) => Number(s))
      .filter((n) => Number.isInteger(n) && n >= 0 && n <= 365)
      .map(String),
  )
    .map(Number)
    .sort((a, b) => b - a);

  const sessionDays = Math.round(Number(get('SESSION_DAYS')));

  return {
    pub,
    adminEmails: unique(splitList(get('ADMIN_EMAILS'), /[,;\s]+/).map(normEmail).filter(isEmail)),
    reminderDays,
    emailEnabled: bool('EMAIL_ENABLED'),
    smsSetting,
    onlinePaymentsSetting,
    tokenVersion: get('TOKEN_VERSION').trim().replace(/\.0+$/, '') || '1',
    sessionDays: Number.isFinite(sessionDays) && sessionDays >= 1 && sessionDays <= 400 ? sessionDays : 120,
  };
}
