// @vitest-environment jsdom
import type { PayPalButtonsComponentOptions } from '@paypal/paypal-js';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ApiAction, ApiParams, Payment, PublicSettings } from '../../shared/types';
import { ApiError, type ApiClient } from '../api/client';
import { CHECKOUT_NOTE, PayPalCheckout, type PayPalOrder } from './PayPalCheckout';

const sdk = vi.hoisted(() => ({ loadScript: vi.fn() }));
vi.mock('@paypal/paypal-js', () => ({ loadScript: sdk.loadScript }));

const SETTINGS: PublicSettings = {
  orgName: 'Timberlane Music Association',
  supportEmail: 'timberlanemusictma@gmail.com',
  appUrl: '',
  schools: ['High School', 'Middle School', 'Elementary'],
  ensembles: ['Band', 'Chorus'],
  feePercent: 1.99,
  feeFixedCents: 49,
  feeCoverDefault: true,
  onlinePaymentsEnabled: true,
  paypalClientId: 'demo',
  paypalEnv: 'sandbox',
  minPaymentCents: 500,
  otherPaymentInstructions: '',
  donateUrl: '',
  privacyNote: '',
  smsEnabled: false,
  pushPublicKey: '',
};

const ORDER: PayPalOrder = { studentId: 'S0001', activityId: 'FL27', amountCents: 25000, coverFee: true };

const PAYMENT: Payment = {
  id: 'DEMOCAP-1',
  date: '2026-10-21',
  studentId: 'S0001',
  activityId: 'FL27',
  amountCents: 25000,
  feeCents: 557,
  grossCents: 25557,
  method: 'PayPal',
  status: 'Completed',
};

type Handler = (params: unknown) => Promise<unknown>;

function fakeApi(mode: 'demo' | 'live', handlers: Partial<Record<ApiAction, Handler>> = {}) {
  const calls: Array<{ action: ApiAction; params: unknown }> = [];
  const api: ApiClient = {
    mode,
    getToken: () => 'tok',
    setToken: () => undefined,
    async call<A extends ApiAction>(action: A, params: ApiParams<A>) {
      calls.push({ action, params });
      const handler =
        handlers[action] ??
        (action === 'payment.createOrder'
          ? async () => ({ orderId: 'ORDER-1', amountCents: 25000, feeCents: 557, grossCents: 25557 })
          : action === 'payment.captureOrder'
            ? async () => ({ payment: PAYMENT })
            : async () => {
                throw new Error(`unexpected ${action}`);
              });
      return (await handler(params)) as never;
    },
  };
  return { api, calls };
}

function setup(
  api: ApiClient,
  { settings = SETTINGS, order = ORDER }: { settings?: PublicSettings; order?: PayPalOrder } = {},
) {
  const onPaid = vi.fn();
  const onError = vi.fn();
  const view = render(<PayPalCheckout api={api} settings={settings} order={order} onPaid={onPaid} onError={onError} />);
  return { ...view, onPaid, onError };
}

beforeEach(() => {
  sdk.loadScript.mockReset();
});

describe('PayPalCheckout (demo)', () => {
  it('shows clearly labelled demo buttons and never loads the PayPal SDK', () => {
    const { api } = fakeApi('demo');
    setup(api);
    expect(screen.getByRole('button', { name: 'PayPal (Demo)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Venmo (Demo)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Debit or Credit Card (Demo)' })).toBeInTheDocument();
    expect(screen.getByText(/No real money moves/)).toBeInTheDocument();
    expect(screen.getByText(CHECKOUT_NOTE)).toBeInTheDocument();
    expect(sdk.loadScript).not.toHaveBeenCalled();
  });

  it('uses demo buttons for the demo client id even with a live client', () => {
    const { api } = fakeApi('live');
    setup(api, { settings: { ...SETTINGS, paypalClientId: 'demo' } });
    expect(screen.getByRole('button', { name: 'Venmo (Demo)' })).toBeInTheDocument();
    expect(sdk.loadScript).not.toHaveBeenCalled();
  });

  it('creates then captures the order and reports the payment', async () => {
    const user = userEvent.setup();
    let releaseCapture: () => void = () => undefined;
    const { api, calls } = fakeApi('demo', {
      'payment.captureOrder': () =>
        new Promise((resolve) => {
          releaseCapture = () => resolve({ payment: PAYMENT });
        }),
    });
    const { onPaid, onError } = setup(api);

    await user.click(screen.getByRole('button', { name: 'PayPal (Demo)' }));

    // Busy: every button disabled while the payment is processed.
    await waitFor(() => expect(calls).toHaveLength(2));
    for (const button of screen.getAllByRole('button')) expect(button).toBeDisabled();
    expect(screen.getByText('Processing your demo payment…')).toBeInTheDocument();

    await act(async () => releaseCapture());

    expect(calls).toEqual([
      { action: 'payment.createOrder', params: { studentId: 'S0001', activityId: 'FL27', amountCents: 25000, coverFee: true } },
      { action: 'payment.captureOrder', params: { orderId: 'ORDER-1' } },
    ]);
    expect(onPaid).toHaveBeenCalledWith(PAYMENT);
    expect(onError).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Venmo (Demo)' })).toBeEnabled());
  });

  it('surfaces the server message when the order is refused', async () => {
    const user = userEvent.setup();
    const { api, calls } = fakeApi('demo', {
      'payment.createOrder': async () => {
        throw new ApiError('BAD_REQUEST', "That's more than what's left to pay ($1,050.00).");
      },
    });
    const { onPaid, onError } = setup(api);
    await user.click(screen.getByRole('button', { name: 'Debit or Credit Card (Demo)' }));
    await waitFor(() => expect(onError).toHaveBeenCalledWith("That's more than what's left to pay ($1,050.00)."));
    expect(calls.map((c) => c.action)).toEqual(['payment.createOrder']);
    expect(onPaid).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'PayPal (Demo)' })).toBeEnabled();
  });

  it('passes on a declined capture, and warns when the outcome is unknown', async () => {
    const user = userEvent.setup();
    const declined = fakeApi('demo', {
      'payment.captureOrder': async () => {
        throw new ApiError('PAYMENT_FAILED', 'PayPal declined the payment. Nothing was charged.');
      },
    });
    const first = setup(declined.api);
    await user.click(screen.getByRole('button', { name: 'PayPal (Demo)' }));
    await waitFor(() => expect(first.onError).toHaveBeenCalledWith('PayPal declined the payment. Nothing was charged.'));
    first.unmount();

    const offline = fakeApi('demo', {
      'payment.captureOrder': async () => {
        throw new ApiError('INTERNAL', 'Network problem — check your connection');
      },
    });
    const second = setup(offline.api);
    await user.click(screen.getByRole('button', { name: 'PayPal (Demo)' }));
    await waitFor(() => expect(second.onError).toHaveBeenCalledWith(expect.stringMatching(/couldn't confirm your payment/)));
    expect(second.onPaid).not.toHaveBeenCalled();
  });

  it('checks the amount before calling the server', async () => {
    const user = userEvent.setup();
    const { api, calls } = fakeApi('demo');
    const { onError } = setup(api, { order: { ...ORDER, amountCents: 300 } });
    await user.click(screen.getByRole('button', { name: 'PayPal (Demo)' }));
    expect(onError).toHaveBeenCalledWith('The smallest online payment is $5.00.');
    expect(calls).toEqual([]);
  });

  it('explains when online payment is switched off', () => {
    const { api } = fakeApi('demo');
    setup(api, { settings: { ...SETTINGS, onlinePaymentsEnabled: false } });
    expect(screen.getByText(/Online payment isn't available right now/)).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('PayPalCheckout (live)', () => {
  const LIVE: PublicSettings = { ...SETTINGS, paypalClientId: 'AbC123-live-client', paypalEnv: 'live' };

  function fakeSdk() {
    const buttons = {
      render: vi.fn(async (_container: HTMLElement) => undefined),
      close: vi.fn(async () => undefined),
      isEligible: vi.fn(() => true),
    };
    let options: PayPalButtonsComponentOptions | null = null;
    const Buttons = vi.fn((opts: PayPalButtonsComponentOptions) => {
      options = opts;
      return buttons;
    });
    sdk.loadScript.mockResolvedValue({ Buttons, version: '5' });
    return { buttons, Buttons, options: () => options! };
  }

  it('loads the SDK with PayPal + Venmo + cards and renders the smart buttons', async () => {
    const fake = fakeSdk();
    const { api } = fakeApi('live');
    setup(api, { settings: LIVE });
    expect(screen.getByText('Loading secure checkout…')).toBeInTheDocument();

    await waitFor(() => expect(fake.buttons.render).toHaveBeenCalled());
    expect(sdk.loadScript).toHaveBeenCalledWith({
      clientId: 'AbC123-live-client',
      currency: 'USD',
      intent: 'capture',
      components: 'buttons',
      enableFunding: 'venmo',
      disableFunding: 'paylater,credit',
      commit: true,
    });
    expect(fake.options().style).toEqual({ layout: 'vertical', shape: 'pill', label: 'pay', height: 48 });
    await waitFor(() => expect(screen.queryByText('Loading secure checkout…')).toBeNull());
    expect(screen.queryByText(/Test mode/)).toBeNull();
  });

  it('marks sandbox mode and lets Venmo show for a US test buyer', async () => {
    const fake = fakeSdk();
    const { api } = fakeApi('live');
    setup(api, { settings: { ...LIVE, paypalEnv: 'sandbox' } });
    await waitFor(() => expect(fake.buttons.render).toHaveBeenCalled());
    expect(sdk.loadScript).toHaveBeenCalledWith(expect.objectContaining({ buyerCountry: 'US' }));
    expect(screen.getByText(/Test mode \(PayPal sandbox\)/)).toBeInTheDocument();
  });

  it('creates the order on the server and captures it on approval', async () => {
    const fake = fakeSdk();
    const { api, calls } = fakeApi('live');
    const { onPaid, onError } = setup(api, { settings: LIVE });
    await waitFor(() => expect(fake.buttons.render).toHaveBeenCalled());
    const opts = fake.options();

    const orderId = await opts.createOrder!({ paymentSource: 'venmo' }, { order: { create: vi.fn() } });
    expect(orderId).toBe('ORDER-1');
    await act(async () => {
      await opts.onApprove!({ orderID: 'ORDER-1' }, { redirect: vi.fn(), restart: vi.fn() });
    });

    expect(calls.map((c) => c.action)).toEqual(['payment.createOrder', 'payment.captureOrder']);
    expect(calls[1].params).toEqual({ orderId: 'ORDER-1' });
    expect(onPaid).toHaveBeenCalledWith(PAYMENT);
    expect(onError).not.toHaveBeenCalled();
    expect(screen.getByText('Payment received — thank you!')).toBeInTheDocument();
  });

  it('shows our own error message instead of PayPal’s generic one', async () => {
    const fake = fakeSdk();
    const { api } = fakeApi('live', {
      'payment.createOrder': async () => {
        throw new ApiError('NOT_CONFIGURED', 'Online payments are not set up yet.');
      },
    });
    const { onError } = setup(api, { settings: LIVE });
    await waitFor(() => expect(fake.buttons.render).toHaveBeenCalled());
    const opts = fake.options();
    await expect(opts.createOrder!({ paymentSource: 'paypal' }, { order: { create: vi.fn() } })).rejects.toThrow();
    act(() => opts.onError!({ message: 'Expected an order id to be passed' }));
    expect(onError).toHaveBeenCalledWith('Online payments are not set up yet.');

    act(() => opts.onError!({ message: 'popup closed unexpectedly' }));
    expect(onError).toHaveBeenLastCalledWith(expect.stringMatching(/PayPal ran into a problem/));
  });

  it('tells the parent when they cancel', async () => {
    const fake = fakeSdk();
    const { api } = fakeApi('live');
    const { onError } = setup(api, { settings: LIVE });
    await waitFor(() => expect(fake.buttons.render).toHaveBeenCalled());
    act(() => fake.options().onCancel!({}, { redirect: vi.fn() }));
    expect(screen.getByText('Payment cancelled. Nothing was charged.')).toBeInTheDocument();
    expect(onError).not.toHaveBeenCalled();
  });

  it('offers a retry when the SDK fails to load', async () => {
    const fake = fakeSdk();
    sdk.loadScript.mockRejectedValueOnce(new Error('blocked by an ad blocker'));
    const user = userEvent.setup();
    const { api } = fakeApi('live');
    setup(api, { settings: LIVE });

    await screen.findByText("Couldn't load PayPal. Check your connection and try again.");
    await user.click(screen.getByRole('button', { name: /Try again/ }));
    await waitFor(() => expect(fake.buttons.render).toHaveBeenCalled());
    expect(sdk.loadScript).toHaveBeenCalledTimes(2);
  });

  it('closes the PayPal buttons on unmount', async () => {
    const fake = fakeSdk();
    const { api } = fakeApi('live');
    const view = setup(api, { settings: LIVE });
    await waitFor(() => expect(fake.buttons.render).toHaveBeenCalled());
    view.unmount();
    expect(fake.buttons.close).toHaveBeenCalled();
  });
});
