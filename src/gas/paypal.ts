/**
 * PaymentGateway over the PayPal REST API v2 (Orders), via UrlFetchApp.
 *
 * The browser shows PayPal's own buttons (PayPal, Venmo, debit/credit card);
 * orders are created and captured here so amounts can't be tampered with.
 * The client id is public (Settings tab); the secret lives in Script
 * Properties and is never logged or returned.
 */
import type { Cache, CaptureResult, CreateOrderInput, Logger, PaymentGateway } from '../server/services';
import { parsePaypalEnv } from '../server/settings';
import { clamp, clip, isRecord, parseJson, pick, pickString } from './util';

export const PAYPAL_API = {
  live: 'https://api-m.paypal.com',
  sandbox: 'https://api-m.sandbox.paypal.com',
} as const;

export const FEE_ITEM_NAME = 'Optional processing-fee contribution';

/** Apps Script's CacheService keeps values at most 6 h; PayPal tokens last ~9 h. */
const MAX_TOKEN_TTL_SECONDS = 21600;
const ORDER_ID = /^[A-Za-z0-9-]{1,64}$/;
const MAX_ORDER_CENTS = 10000000; // $100,000 sanity cap

export interface PayPalConfig {
  clientId: string;
  secret: string | null;
  /** Settings PAYPAL_ENV: "live" (or "production"/"prod") uses real money; anything else is the sandbox. */
  env: string;
}

export interface PayPalDeps {
  /** Read on every call (cheap: Settings are memoized per execution). */
  config(): PayPalConfig;
  cache: Cache;
  logger: Logger;
}

interface Resolved {
  clientId: string;
  secret: string;
  env: 'live' | 'sandbox';
  base: string;
}

interface HttpResult {
  code: number;
  body: unknown;
}

/** The same parser the core uses for PublicSettings.paypalEnv, so the browser SDK and this gateway agree. */
export function paypalEnv(value: string): 'live' | 'sandbox' {
  return parsePaypalEnv(value);
}

/** "251.23" for 25123 cents. */
export function formatAmount(cents: number): string {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}

/** Strict "251.23" -> 25123; anything else -> undefined. */
export function parseAmount(value: unknown): number | undefined {
  if (typeof value !== 'string' || !/^\d+(\.\d{1,2})?$/.test(value)) return undefined;
  const [whole, fraction = ''] = value.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}

/**
 * Orders v2 create body (see docs/ARCHITECTURE.md §9).
 *
 * No `payment_source`: the payer picks PayPal, Venmo or a card on the JS SDK
 * buttons *after* the order exists, and a payment_source fixed here (e.g.
 * `paypal`) may not match the button they press. `application_context` sets the
 * same brand/shipping/pay-now options for every funding source.
 */
export function buildOrderBody(input: CreateOrderInput): Record<string, unknown> {
  const usd = (cents: number) => ({ currency_code: 'USD', value: formatAmount(cents) });
  const items: Array<Record<string, unknown>> = [
    { name: clip(input.itemName, 127), quantity: '1', unit_amount: usd(input.amountCents) },
  ];
  if (input.feeCents > 0) items.push({ name: FEE_ITEM_NAME, quantity: '1', unit_amount: usd(input.feeCents) });
  return {
    intent: 'CAPTURE',
    purchase_units: [
      {
        reference_id: clip(input.referenceId, 256),
        custom_id: clip(input.customId, 127),
        description: clip(input.description, 127),
        items,
        amount: { ...usd(input.grossCents), breakdown: { item_total: usd(input.grossCents) } },
      },
    ],
    application_context: {
      brand_name: clip(input.brandName, 127),
      shipping_preference: 'NO_SHIPPING',
      user_action: 'PAY_NOW',
    },
  };
}

/** Map a capture-call response body (or a GET order body) to a CaptureResult. */
export function parseCapture(body: unknown): CaptureResult {
  const capture = pick(body, 'purchase_units', 0, 'payments', 'captures', 0);
  if (!isRecord(capture)) return { status: 'FAILED', message: 'PayPal returned no capture for this order.' };
  const result: CaptureResult = { status: mapCaptureStatus(capture.status) };
  if (typeof capture.id === 'string') result.captureId = capture.id;
  if (pickString(capture, 'amount', 'currency_code') === 'USD') {
    const gross = parseAmount(pick(capture, 'amount', 'value'));
    if (gross !== undefined) result.grossCents = gross;
  }
  const payerEmail = pickString(body, 'payer', 'email_address') ?? pickString(body, 'payment_source', 'paypal', 'email_address');
  if (payerEmail) result.payerEmail = payerEmail.trim().toLowerCase();
  const reason = pickString(capture, 'status_details', 'reason');
  if (reason) result.message = reason;
  return result;
}

export function mapCaptureStatus(status: unknown): CaptureResult['status'] {
  switch (status) {
    case 'COMPLETED':
      return 'COMPLETED';
    case 'PENDING':
      return 'PENDING';
    case 'DECLINED':
      return 'DECLINED';
    default:
      return 'FAILED'; // FAILED, REFUNDED, PARTIALLY_REFUNDED, unknown
  }
}

function firstIssue(body: unknown): string | undefined {
  return pickString(body, 'details', 0, 'issue') ?? pickString(body, 'name') ?? pickString(body, 'error');
}

function hasCapture(body: unknown): boolean {
  return isRecord(pick(body, 'purchase_units', 0, 'payments', 'captures', 0));
}

/**
 * A capture reply that proves PayPal did not take the money: a 4xx business error. Timeouts (408),
 * conflicts with a request still in progress (409), throttling (429), 5xx and odd 2xx/3xx replies
 * don't prove anything.
 */
function definiteFailure(code: number): boolean {
  return code >= 400 && code < 500 && code !== 408 && code !== 409 && code !== 425 && code !== 429;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function validateOrder(input: CreateOrderInput): void {
  const { amountCents, feeCents, grossCents } = input;
  const ints = [amountCents, feeCents, grossCents].every((n) => Number.isInteger(n));
  if (!ints || amountCents < 1 || feeCents < 0 || grossCents !== amountCents + feeCents || grossCents > MAX_ORDER_CENTS) {
    throw new Error('Invalid PayPal order amounts');
  }
  if (!input.referenceId || !input.customId) throw new Error('PayPal order is missing its reference');
}

export function createPayPalGateway(deps: PayPalDeps): PaymentGateway {
  const { cache, logger } = deps;

  function resolve(): Resolved | null {
    const config = deps.config();
    const clientId = (config.clientId ?? '').trim();
    const secret = (config.secret ?? '').trim();
    if (!clientId || !secret) return null;
    const env = paypalEnv(config.env ?? '');
    return { clientId, secret, env, base: PAYPAL_API[env] };
  }

  function tokenKey(r: Resolved): string {
    return `paypal-token:${r.env}:${r.clientId}`;
  }

  function accessToken(r: Resolved): string {
    const cached = cache.get(tokenKey(r));
    if (cached) return cached;
    const res = UrlFetchApp.fetch(`${r.base}/v1/oauth2/token`, {
      method: 'post',
      headers: {
        Authorization: `Basic ${Utilities.base64Encode(`${r.clientId}:${r.secret}`, Utilities.Charset.UTF_8)}`,
        Accept: 'application/json',
      },
      contentType: 'application/x-www-form-urlencoded',
      payload: 'grant_type=client_credentials',
      muteHttpExceptions: true,
    });
    const code = res.getResponseCode();
    const body = parseJson(res.getContentText());
    const token = pickString(body, 'access_token');
    if (code !== 200 || !token) {
      logger.error('PayPal authentication failed', { status: code, env: r.env, error: pickString(body, 'error') });
      throw new Error('PayPal authentication failed. Check PAYPAL_CLIENT_ID, PAYPAL_ENV and the PAYPAL_SECRET script property.');
    }
    const expiresIn = Number(pick(body, 'expires_in')) || 32400;
    cache.put(tokenKey(r), token, clamp(Math.floor(expiresIn - 600), 60, MAX_TOKEN_TTL_SECONDS));
    return token;
  }

  /** Authenticated JSON call; a 401 drops the cached token and retries once. */
  function call(r: Resolved, method: 'get' | 'post', path: string, payload?: unknown, headers: Record<string, string> = {}): HttpResult {
    const send = (): HttpResult => {
      const options: GoogleAppsScript.URL_Fetch.URLFetchRequestOptions = {
        method,
        headers: { Authorization: `Bearer ${accessToken(r)}`, Accept: 'application/json', ...headers },
        muteHttpExceptions: true,
      };
      if (payload !== undefined) {
        options.contentType = 'application/json';
        options.payload = JSON.stringify(payload);
      }
      const res = UrlFetchApp.fetch(`${r.base}${path}`, options);
      return { code: res.getResponseCode(), body: parseJson(res.getContentText()) };
    };
    let result = send();
    if (result.code === 401) {
      cache.remove(tokenKey(r));
      result = send();
    }
    return result;
  }

  return {
    enabled: () => resolve() !== null,

    createOrder(input: CreateOrderInput): { orderId: string } {
      validateOrder(input);
      const r = resolve();
      if (!r) throw new Error('PayPal is not configured');
      const { code, body } = call(r, 'post', '/v2/checkout/orders', buildOrderBody(input));
      const orderId = pickString(body, 'id');
      if ((code === 200 || code === 201) && orderId) return { orderId };
      logger.error('PayPal create order failed', { status: code, issue: firstIssue(body), debugId: pickString(body, 'debug_id') });
      throw new Error(`PayPal could not create the order (${firstIssue(body) ?? `HTTP ${code}`}).`);
    },

    /**
     * Capture once; when the outcome is ambiguous (the capture may have happened), ask again with the
     * same PayPal-Request-Id, which PayPal answers with the original result instead of charging twice.
     * Still no definite answer -> UNKNOWN, never FAILED: "not charged" must only be said when true.
     */
    captureOrder(orderId: string, requestId: string): CaptureResult {
      if (typeof orderId !== 'string' || !ORDER_ID.test(orderId)) {
        return { status: 'FAILED', message: 'Invalid PayPal order id.' };
      }
      const r = resolve();
      if (!r) return { status: 'FAILED', message: 'PayPal is not configured.' };
      try {
        accessToken(r); // nothing has been sent to the capture endpoint yet, so a failure here is definite
      } catch (error) {
        logger.error('PayPal capture not attempted', { message: errorText(error) });
        return { status: 'FAILED', message: 'Could not reach PayPal. Please try again.' };
      }
      const path = `/v2/checkout/orders/${orderId}`;

      /** The order's capture, read back from PayPal; null when that fails too. */
      const readOrder = (): CaptureResult | null => {
        try {
          const order = call(r, 'get', path);
          if (order.code === 200 && hasCapture(order.body)) return parseCapture(order.body);
          logger.error('PayPal order lookup failed', { status: order.code, issue: firstIssue(order.body) });
        } catch (error) {
          logger.error('PayPal order lookup error', { message: errorText(error) });
        }
        return null;
      };

      /** One capture call; null = no definite answer. */
      const capture = (): CaptureResult | null => {
        let res: HttpResult;
        try {
          res = call(r, 'post', `${path}/capture`, {}, { 'PayPal-Request-Id': clip(requestId, 108), Prefer: 'return=representation' });
        } catch (error) {
          // A timeout or dropped connection after PayPal received the request may still have charged.
          logger.error('PayPal capture error', { message: errorText(error) });
          return null;
        }
        const { code, body } = res;
        if ((code === 200 || code === 201) && hasCapture(body)) return parseCapture(body);
        const issue = firstIssue(body);
        if (code === 422 && issue === 'ORDER_ALREADY_CAPTURED') return readOrder(); // captured by an earlier attempt
        logger.error('PayPal capture failed', { status: code, issue, debugId: pickString(body, 'debug_id') });
        if (!definiteFailure(code)) return null;
        if (issue === 'INSTRUMENT_DECLINED') {
          return { status: 'DECLINED', message: 'The payment method was declined. Please try another card or account.' };
        }
        return { status: 'FAILED', message: `PayPal could not complete the payment (${issue ?? `HTTP ${code}`}).` };
      };

      const result = capture() ?? capture();
      return result ?? { status: 'UNKNOWN', message: 'PayPal did not confirm whether the payment went through.' };
    },
  };
}
