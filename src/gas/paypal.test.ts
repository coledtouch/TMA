import * as nodeCrypto from 'node:crypto';
import type { CreateOrderInput, Logger } from '../server/services';
import {
  buildOrderBody,
  createPayPalGateway,
  FEE_ITEM_NAME,
  formatAmount,
  mapCaptureStatus,
  parseAmount,
  parseCapture,
  paypalEnv,
  type PayPalConfig,
} from './paypal';
import { createScriptCache } from './services';
import { installGasFakes, uninstallGasFakes, type FakeRequest, type GasFakes } from './testing/fakes';

const SANDBOX = 'https://api-m.sandbox.paypal.com';

const ORDER: CreateOrderInput = {
  amountCents: 25000,
  feeCents: 798,
  grossCents: 25798,
  itemName: 'Florida 2027 – Avery T.',
  description: 'Trip payment for Avery T.',
  referenceId: 'S0001:FL27',
  customId: 'po-123',
  brandName: 'Timberlane Music Association',
};

let gas: GasFakes;
let config: PayPalConfig;
let logger: Logger & { lines: unknown[][] };

function gateway() {
  return createPayPalGateway({ config: () => config, cache: createScriptCache(), logger });
}

function captureBody(status = 'COMPLETED', value = '257.98') {
  return {
    id: 'ORDER1',
    status: 'COMPLETED',
    payer: { email_address: 'Payer@Example.com' },
    purchase_units: [
      {
        reference_id: 'S0001:FL27',
        payments: { captures: [{ id: 'CAP1', status, amount: { currency_code: 'USD', value } }] },
      },
    ],
  };
}

/** Default PayPal: token OK, create OK, capture OK. */
function routes(overrides: Partial<Record<'token' | 'create' | 'capture' | 'get', (r: FakeRequest) => { code: number; body?: unknown }>> = {}) {
  gas.fetch.handler = (r) => {
    if (r.url.endsWith('/v1/oauth2/token')) {
      return overrides.token?.(r) ?? { code: 200, body: { access_token: 'AT-1', expires_in: 32400, token_type: 'Bearer' } };
    }
    if (r.url.endsWith('/v2/checkout/orders') && r.method === 'post') return overrides.create?.(r) ?? { code: 201, body: { id: 'ORDER1', status: 'CREATED' } };
    if (r.url.endsWith('/capture')) return overrides.capture?.(r) ?? { code: 201, body: captureBody() };
    if (r.method === 'get') return overrides.get?.(r) ?? { code: 200, body: captureBody() };
    return { code: 404, body: {} };
  };
}

beforeEach(() => {
  gas = installGasFakes(nodeCrypto);
  config = { clientId: 'client-id', secret: 'client-secret', env: 'sandbox' };
  const lines: unknown[][] = [];
  logger = { lines, info: (...a: unknown[]) => lines.push(['info', ...a]), error: (...a: unknown[]) => lines.push(['error', ...a]) };
  routes();
});
afterEach(() => uninstallGasFakes());

describe('helpers', () => {
  it('formats and parses dollar strings exactly', () => {
    expect(formatAmount(25798)).toBe('257.98');
    expect(formatAmount(5)).toBe('0.05');
    expect(formatAmount(100000)).toBe('1000.00');
    expect(parseAmount('257.98')).toBe(25798);
    expect(parseAmount('10.5')).toBe(1050);
    expect(parseAmount('7')).toBe(700);
    expect(parseAmount('1.234')).toBeUndefined();
    expect(parseAmount(12)).toBeUndefined();
  });

  it('chooses live only for "live"/"production"', () => {
    expect(paypalEnv('live')).toBe('live');
    expect(paypalEnv(' Production ')).toBe('live');
    expect(paypalEnv('sandbox')).toBe('sandbox');
    expect(paypalEnv('')).toBe('sandbox');
  });

  it('maps capture statuses', () => {
    expect(mapCaptureStatus('COMPLETED')).toBe('COMPLETED');
    expect(mapCaptureStatus('PENDING')).toBe('PENDING');
    expect(mapCaptureStatus('DECLINED')).toBe('DECLINED');
    expect(mapCaptureStatus('REFUNDED')).toBe('FAILED');
    expect(mapCaptureStatus(undefined)).toBe('FAILED');
  });
});

describe('buildOrderBody', () => {
  it('has one purchase unit with items, breakdown and the PayPal experience context', () => {
    expect(buildOrderBody(ORDER)).toEqual({
      intent: 'CAPTURE',
      purchase_units: [
        {
          reference_id: 'S0001:FL27',
          custom_id: 'po-123',
          description: 'Trip payment for Avery T.',
          items: [
            { name: 'Florida 2027 – Avery T.', quantity: '1', unit_amount: { currency_code: 'USD', value: '250.00' } },
            { name: FEE_ITEM_NAME, quantity: '1', unit_amount: { currency_code: 'USD', value: '7.98' } },
          ],
          amount: {
            currency_code: 'USD',
            value: '257.98',
            breakdown: { item_total: { currency_code: 'USD', value: '257.98' } },
          },
        },
      ],
      payment_source: {
        paypal: {
          experience_context: {
            brand_name: 'Timberlane Music Association',
            shipping_preference: 'NO_SHIPPING',
            user_action: 'PAY_NOW',
          },
        },
      },
    });
  });

  it('omits the fee item when no fee is covered and clips long text to PayPal limits', () => {
    const body = buildOrderBody({ ...ORDER, feeCents: 0, grossCents: 25000, description: 'd'.repeat(300) });
    const unit = (body.purchase_units as Array<Record<string, unknown>>)[0];
    expect(unit.items).toHaveLength(1);
    expect((unit.description as string).length).toBe(127);
    expect(unit.amount).toEqual({
      currency_code: 'USD',
      value: '250.00',
      breakdown: { item_total: { currency_code: 'USD', value: '250.00' } },
    });
  });
});

describe('createOrder', () => {
  it('authenticates with client credentials and posts the order JSON', () => {
    expect(gateway().createOrder(ORDER)).toEqual({ orderId: 'ORDER1' });
    const [token, create] = gas.fetch.requests;
    expect(token.url).toBe(`${SANDBOX}/v1/oauth2/token`);
    expect(token.method).toBe('post');
    expect(token.headers.Authorization).toBe(`Basic ${Buffer.from('client-id:client-secret').toString('base64')}`);
    expect(token.contentType).toBe('application/x-www-form-urlencoded');
    expect(token.payload).toBe('grant_type=client_credentials');
    expect(token.muteHttpExceptions).toBe(true);

    expect(create.url).toBe(`${SANDBOX}/v2/checkout/orders`);
    expect(create.method).toBe('post');
    expect(create.headers.Authorization).toBe('Bearer AT-1');
    expect(create.contentType).toBe('application/json');
    expect(JSON.parse(create.payload as string)).toEqual(buildOrderBody(ORDER));
  });

  it('uses the live API when PAYPAL_ENV is live', () => {
    config.env = 'live';
    gateway().createOrder(ORDER);
    expect(gas.fetch.requests.every((r) => r.url.startsWith('https://api-m.paypal.com/'))).toBe(true);
  });

  it('caches the access token (capped at the 6 h CacheService limit) across calls and executions', () => {
    gateway().createOrder(ORDER);
    gateway().createOrder(ORDER);
    expect(gas.fetch.requests.filter((r) => r.url.endsWith('/oauth2/token'))).toHaveLength(1);
    const [entry] = [...gas.cache.entries.values()];
    expect(entry.value).toBe('AT-1');
    expect(entry.ttl).toBe(21600);
  });

  it('drops a rejected cached token and retries once', () => {
    gas.cache.put('paypal-token:sandbox:client-id', 'STALE', 600);
    let creates = 0;
    routes({
      create: (r) => {
        creates += 1;
        return r.headers.Authorization === 'Bearer STALE' ? { code: 401, body: { error: 'invalid_token' } } : { code: 201, body: { id: 'ORDER2' } };
      },
    });
    expect(gateway().createOrder(ORDER)).toEqual({ orderId: 'ORDER2' });
    expect(creates).toBe(2);
  });

  it('throws a clear error on auth failure without leaking the secret', () => {
    routes({ token: () => ({ code: 401, body: { error: 'invalid_client' } }) });
    expect(() => gateway().createOrder(ORDER)).toThrow(/PayPal authentication failed/);
    expect(JSON.stringify(logger.lines)).not.toContain('client-secret');
  });

  it('throws with the PayPal issue when the order is rejected', () => {
    routes({ create: () => ({ code: 422, body: { name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'AMOUNT_MISMATCH' }], debug_id: 'dbg' } }) });
    expect(() => gateway().createOrder(ORDER)).toThrow(/AMOUNT_MISMATCH/);
    expect(logger.lines[0]).toEqual(['error', 'PayPal create order failed', { status: 422, issue: 'AMOUNT_MISMATCH', debugId: 'dbg' }]);
  });

  it('validates amounts before calling PayPal', () => {
    const bad: Array<Partial<CreateOrderInput>> = [
      { amountCents: 0, grossCents: 798 },
      { amountCents: 100.5, grossCents: 898.5 },
      { feeCents: -1, grossCents: 24999 },
      { grossCents: 1 },
    ];
    for (const patch of bad) expect(() => gateway().createOrder({ ...ORDER, ...patch })).toThrow(/Invalid PayPal order amounts/);
    expect(gas.fetch.requests).toHaveLength(0);
  });

  it('is disabled and refuses without a client id or secret', () => {
    config.secret = null;
    expect(gateway().enabled()).toBe(false);
    expect(() => gateway().createOrder(ORDER)).toThrow(/not configured/);
    config = { clientId: ' ', secret: 'x', env: 'sandbox' };
    expect(gateway().enabled()).toBe(false);
    config = { clientId: 'id', secret: 'x', env: 'sandbox' };
    expect(gateway().enabled()).toBe(true);
  });
});

describe('captureOrder', () => {
  it('posts to the capture URL with the idempotency key and parses the capture', () => {
    expect(gateway().captureOrder('ORDER1', 'cap-ORDER1')).toEqual({
      status: 'COMPLETED',
      captureId: 'CAP1',
      grossCents: 25798,
      payerEmail: 'payer@example.com',
    });
    const capture = gas.fetch.requests.find((r) => r.url.endsWith('/capture'))!;
    expect(capture.url).toBe(`${SANDBOX}/v2/checkout/orders/ORDER1/capture`);
    expect(capture.method).toBe('post');
    expect(capture.headers['PayPal-Request-Id']).toBe('cap-ORDER1');
    expect(capture.headers.Prefer).toBe('return=representation');
    expect(capture.muteHttpExceptions).toBe(true);
  });

  it('reports PENDING captures with their reason', () => {
    routes({
      capture: () => {
        const body = captureBody('PENDING');
        (body.purchase_units[0].payments.captures[0] as Record<string, unknown>).status_details = { reason: 'ECHECK' };
        return { code: 201, body };
      },
    });
    expect(gateway().captureOrder('ORDER1', 'cap-ORDER1')).toMatchObject({ status: 'PENDING', captureId: 'CAP1', message: 'ECHECK' });
  });

  it('leaves grossCents unset for non-USD captures', () => {
    routes({
      capture: () => {
        const body = captureBody();
        body.purchase_units[0].payments.captures[0].amount.currency_code = 'EUR';
        return { code: 201, body };
      },
    });
    expect(gateway().captureOrder('ORDER1', 'cap-ORDER1').grossCents).toBeUndefined();
  });

  it('recovers an already-captured order by reading it', () => {
    routes({ capture: () => ({ code: 422, body: { name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'ORDER_ALREADY_CAPTURED' }] } }) });
    expect(gateway().captureOrder('ORDER1', 'cap-ORDER1')).toMatchObject({ status: 'COMPLETED', captureId: 'CAP1' });
    const get = gas.fetch.requests.find((r) => r.method === 'get')!;
    expect(get.url).toBe(`${SANDBOX}/v2/checkout/orders/ORDER1`);
  });

  it('maps a declined instrument to DECLINED and other errors to FAILED', () => {
    routes({ capture: () => ({ code: 422, body: { details: [{ issue: 'INSTRUMENT_DECLINED' }] } }) });
    expect(gateway().captureOrder('ORDER1', 'r').status).toBe('DECLINED');
    routes({ capture: () => ({ code: 500, body: { name: 'INTERNAL_SERVER_ERROR' } }) });
    expect(gateway().captureOrder('ORDER1', 'r')).toMatchObject({ status: 'FAILED', message: expect.stringContaining('INTERNAL_SERVER_ERROR') });
  });

  it('returns FAILED (not a throw) when PayPal cannot be reached', () => {
    gas.fetch.handler = (r) => {
      if (r.url.endsWith('/oauth2/token')) return { code: 200, body: { access_token: 'AT', expires_in: 100 } };
      throw new Error('DNS error: api-m.sandbox.paypal.com');
    };
    expect(gateway().captureOrder('ORDER1', 'r')).toEqual({ status: 'FAILED', message: 'Could not reach PayPal. Please try again.' });
  });

  it('rejects order ids that are not PayPal ids without calling PayPal', () => {
    for (const id of ['', '../../v1/oauth2/token', 'A'.repeat(65), 'ORDER 1']) {
      expect(gateway().captureOrder(id, 'r')).toEqual({ status: 'FAILED', message: 'Invalid PayPal order id.' });
    }
    expect(gas.fetch.requests).toHaveLength(0);
  });

  it('parseCapture handles a missing capture', () => {
    expect(parseCapture({ status: 'COMPLETED', purchase_units: [{}] })).toMatchObject({ status: 'FAILED' });
    expect(parseCapture(undefined)).toMatchObject({ status: 'FAILED' });
  });
});
