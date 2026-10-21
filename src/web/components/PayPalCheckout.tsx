/**
 * Pay an activity balance online through PayPal (PayPal, Venmo, or any
 * debit/credit card as a guest — no PayPal account needed).
 *
 * The order is created and captured by TMA's backend (`payment.createOrder`,
 * `payment.captureOrder`), so the amount can't be changed in the browser and
 * the payment row is written by the server. In demo mode (or with the demo
 * client id) look-alike buttons run the same API calls against the in-browser
 * demo backend, and the real PayPal SDK is never loaded.
 */
import { loadScript, type PayPalButtonsComponent, type PayPalScriptOptions } from '@paypal/paypal-js';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { formatCents } from '../../shared/money';
import type { Payment, PublicSettings } from '../../shared/types';
import { isApiError, type ApiClient } from '../api/client';
import { Icon } from './Icon';
import { Spinner } from './States';

export interface PayPalOrder {
  studentId: string;
  activityId: string;
  amountCents: number;
  coverFee: boolean;
}

export interface PayPalCheckoutProps {
  api: ApiClient;
  settings: PublicSettings;
  order: PayPalOrder;
  onPaid(payment: Payment): void;
  onError(message: string): void;
}

const DEMO_CLIENT_ID = 'demo';

export const CHECKOUT_NOTE =
  'Secure checkout by PayPal. Pay with PayPal, Venmo, or any debit/credit card — no PayPal account needed.';
const CREATE_FAILED = "Couldn't start the checkout. Nothing was charged. Please try again.";
const CAPTURE_UNCERTAIN =
  "We couldn't confirm your payment. If PayPal emailed you a receipt, it went through — check Trips again in a minute before paying again.";
const SDK_FAILED = 'PayPal ran into a problem and nothing was charged. Please try again, or use another way to pay.';
const LOAD_FAILED = "Couldn't load PayPal. Check your connection and try again.";

/** Client-side check before talking to the server (which re-checks everything). */
function orderProblem(order: PayPalOrder, settings: PublicSettings): string | null {
  if (!Number.isSafeInteger(order.amountCents) || order.amountCents <= 0) return 'Enter an amount to pay.';
  if (order.amountCents < settings.minPaymentCents) {
    return `The smallest online payment is ${formatCents(settings.minPaymentCents)}.`;
  }
  if (!order.studentId || !order.activityId) return CREATE_FAILED;
  return null;
}

function createErrorMessage(err: unknown): string {
  return isApiError(err) ? err.message : CREATE_FAILED;
}

/** Declines and expired orders are definite; anything else (network, server) may have charged. */
function captureErrorMessage(err: unknown): string {
  if (isApiError(err, 'PAYMENT_FAILED') || isApiError(err, 'NOT_FOUND') || isApiError(err, 'FORBIDDEN')) {
    return err.message;
  }
  return CAPTURE_UNCERTAIN;
}

function orderParams(order: PayPalOrder) {
  return {
    studentId: order.studentId,
    activityId: order.activityId,
    amountCents: order.amountCents,
    coverFee: order.coverFee,
  };
}

/** Keeps the latest props for callbacks that outlive a render (PayPal's iframes). */
function useLatest<T>(value: T) {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  });
  return ref;
}

function useAlive() {
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  return alive;
}

export function PayPalCheckout(props: PayPalCheckoutProps) {
  const { api, settings } = props;
  const latest = useLatest(props);
  const [attempt, setAttempt] = useState(0);
  const demo = api.mode === 'demo' || settings.paypalClientId === DEMO_CLIENT_ID;

  let body: ReactNode;
  if (!settings.onlinePaymentsEnabled || (!demo && !settings.paypalClientId)) {
    body = (
      <p className="callout callout-info small">
        <Icon name="info" />
        <span>Online payment isn't available right now. Please use one of the other ways to pay.</span>
      </p>
    );
  } else if (demo) {
    body = <DemoButtons latest={latest} />;
  } else {
    body = (
      <LiveButtons
        key={`${settings.paypalClientId}:${settings.paypalEnv}:${attempt}`}
        clientId={settings.paypalClientId}
        sandbox={settings.paypalEnv === 'sandbox'}
        latest={latest}
        onRetry={() => setAttempt((n) => n + 1)}
      />
    );
  }

  return (
    <div className="paypal-checkout stack">
      {body}
      <p className="paypal-note muted small center">
        <Icon name="lock" size={14} /> {CHECKOUT_NOTE}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Live: PayPal JS SDK smart buttons
// ---------------------------------------------------------------------------

type LiveStatus = 'loading' | 'ready' | 'processing' | 'error';

function LiveButtons({
  clientId,
  sandbox,
  latest,
  onRetry,
}: {
  clientId: string;
  sandbox: boolean;
  latest: { current: PayPalCheckoutProps };
  onRetry(): void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const alive = useAlive();
  const [status, setStatus] = useState<LiveStatus>('loading');
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let buttons: PayPalButtonsComponent | null = null;
    /** Message from our own API (e.g. "The smallest online payment is $5.00"), shown instead of PayPal's generic error. */
    let pendingError: string | null = null;

    const options: PayPalScriptOptions = {
      clientId,
      currency: 'USD',
      intent: 'capture',
      components: 'buttons',
      enableFunding: 'venmo',
      disableFunding: 'paylater,credit',
      commit: true,
      // Venmo only shows to US buyers; the sandbox needs to be told the buyer is in the US.
      ...(sandbox ? { buyerCountry: 'US' } : {}),
    };

    loadScript(options)
      .then(async (paypal) => {
        if (cancelled) return;
        const container = containerRef.current;
        if (!paypal?.Buttons || !container) throw new Error('PayPal SDK unavailable');
        buttons = paypal.Buttons({
          style: { layout: 'vertical', shape: 'pill', label: 'pay', height: 48 },
          createOrder: async () => {
            pendingError = null;
            if (alive.current) setNote(null);
            const { api, order, settings: current } = latest.current;
            const problem = orderProblem(order, current);
            if (problem) {
              pendingError = problem;
              throw new Error(problem);
            }
            try {
              const created = await api.call('payment.createOrder', orderParams(order));
              return created.orderId;
            } catch (err) {
              pendingError = createErrorMessage(err);
              throw err;
            }
          },
          onApprove: async ({ orderID }) => {
            if (alive.current) setStatus('processing');
            try {
              const { payment } = await latest.current.api.call('payment.captureOrder', { orderId: orderID });
              if (alive.current) setNote('Payment received — thank you!');
              latest.current.onPaid(payment);
            } catch (err) {
              latest.current.onError(captureErrorMessage(err));
            } finally {
              if (alive.current) setStatus('ready');
            }
          },
          onCancel: () => {
            if (alive.current) setNote('Payment cancelled. Nothing was charged.');
          },
          onError: () => {
            latest.current.onError(pendingError ?? SDK_FAILED);
            pendingError = null;
          },
        });
        await buttons.render(container);
        if (!cancelled) setStatus('ready');
      })
      .catch(() => {
        if (!cancelled) setStatus('error');
      });

    return () => {
      cancelled = true;
      try {
        buttons?.close().catch(() => undefined);
      } catch {
        // Already closed or never rendered.
      }
    };
  }, [clientId, sandbox, latest, alive]);

  const processing = status === 'processing';
  // PayPal sizes its iframes from the container, so it stays visible while loading.
  const containerStyle: CSSProperties | undefined =
    status === 'error' ? { display: 'none' } : processing ? { opacity: 0.4, pointerEvents: 'none' } : undefined;

  return (
    <div className="paypal-live" aria-busy={status === 'loading' || processing}>
      {sandbox ? (
        <p className="callout callout-warning small">
          <Icon name="info" />
          <span>Test mode (PayPal sandbox): use a sandbox account. No real money moves.</span>
        </p>
      ) : null}
      {status === 'loading' ? (
        <p className="paypal-status muted small center" role="status">
          <Spinner /> Loading secure checkout…
        </p>
      ) : null}
      {status === 'error' ? (
        <div className="paypal-status center" role="alert">
          <p className="form-error">{LOAD_FAILED}</p>
          <button type="button" className="btn btn-secondary btn-sm" onClick={onRetry}>
            <Icon name="refresh" /> Try again
          </button>
        </div>
      ) : null}
      {/* PayPal renders its iframes here; it must stay mounted while a payment is in progress. */}
      <div ref={containerRef} className="paypal-buttons" style={containerStyle} />
      <p className="paypal-status muted small center" role="status" aria-live="polite">
        {processing ? (
          <>
            <Spinner /> Finishing your payment… please don't close this page.
          </>
        ) : (
          note
        )}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Demo: look-alike buttons, same API calls, no real money
// ---------------------------------------------------------------------------

type DemoMethod = 'paypal' | 'venmo' | 'card';

const DEMO_METHODS: ReadonlyArray<{ id: DemoMethod; label: string; style: CSSProperties }> = [
  { id: 'paypal', label: 'PayPal', style: { background: '#ffc439', color: '#111111', borderColor: '#ffc439' } },
  { id: 'venmo', label: 'Venmo', style: { background: '#008cff', color: '#ffffff', borderColor: '#008cff' } },
  { id: 'card', label: 'Debit or Credit Card', style: { background: '#2c2e2f', color: '#ffffff', borderColor: '#2c2e2f' } },
];

const DEMO_BUTTON_BASE: CSSProperties = { minHeight: 48, borderRadius: 999, fontWeight: 700 };

function DemoButtons({ latest }: { latest: { current: PayPalCheckoutProps } }) {
  const alive = useAlive();
  const busyRef = useRef(false);
  const [busy, setBusy] = useState<DemoMethod | null>(null);

  async function pay(method: DemoMethod) {
    if (busyRef.current) return;
    const { api, order, settings } = latest.current;
    const problem = orderProblem(order, settings);
    if (problem) {
      latest.current.onError(problem);
      return;
    }
    busyRef.current = true;
    setBusy(method);
    let phase: 'create' | 'capture' = 'create';
    try {
      const { orderId } = await api.call('payment.createOrder', orderParams(order));
      phase = 'capture';
      const { payment } = await api.call('payment.captureOrder', { orderId });
      latest.current.onPaid(payment);
    } catch (err) {
      latest.current.onError(phase === 'create' ? createErrorMessage(err) : captureErrorMessage(err));
    } finally {
      busyRef.current = false;
      if (alive.current) setBusy(null);
    }
  }

  return (
    <div className="paypal-demo stack" role="group" aria-label="Demo checkout" aria-busy={busy !== null}>
      <p className="callout callout-info small">
        <Icon name="info" />
        <span>
          <strong>Demo checkout.</strong> These buttons stand in for PayPal. No real money moves.
        </span>
      </p>
      {DEMO_METHODS.map((m) => (
        <button
          key={m.id}
          type="button"
          className={`btn btn-block paypal-demo-btn paypal-demo-btn-${m.id}`}
          style={{ ...DEMO_BUTTON_BASE, ...m.style }}
          disabled={busy !== null}
          onClick={() => void pay(m.id)}
        >
          {busy === m.id ? (
            <>
              <Spinner /> Processing…
            </>
          ) : (
            `${m.label} (Demo)`
          )}
        </button>
      ))}
      <p className="visually-hidden" role="status" aria-live="polite">
        {busy ? 'Processing your demo payment…' : ''}
      </p>
    </div>
  );
}
