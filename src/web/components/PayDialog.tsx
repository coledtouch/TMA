/**
 * "Pay the rest online" with PayPal (PayPal balance, Venmo, debit or credit
 * card), with an optional fee contribution so 100% reaches the student's
 * trip. When online payments are off, only "Other ways to pay" is shown.
 */
import { useState } from 'react';
import { grossUpCents, parseAmountInput } from '../../shared/money';
import type { ActivityAccount, Cents, Payment, PublicSettings, StudentSummary } from '../../shared/types';
import { useApp } from '../hooks/app-context';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useToast } from '../hooks/toast';
import { centsToInput, formatCents } from '../lib/format';
import { Dialog } from './Dialog';
import { CheckboxField, TextField } from './Field';
import { Icon } from './Icon';
import { Money } from './Money';
import { PayPalCheckout } from './PayPalCheckout';

/** Wait this long after typing before (re)rendering the PayPal buttons. */
export const AMOUNT_SETTLE_MS = 450;

export function canPayOnline(settings: PublicSettings, account: ActivityAccount): boolean {
  return (
    settings.onlinePaymentsEnabled &&
    account.allowOnlinePayment &&
    account.activityOpen &&
    account.enrollmentStatus === 'Going' &&
    account.remainingCents >= settings.minPaymentCents
  );
}

export function paymentAmountError(cents: Cents | null, settings: PublicSettings, account: ActivityAccount): string | null {
  if (cents === null) return 'Enter an amount like 125 or 125.50.';
  if (cents < settings.minPaymentCents) return `The smallest online payment is ${formatCents(settings.minPaymentCents)}.`;
  if (cents > account.remainingCents) return `That's more than what's left to pay (${formatCents(account.remainingCents)}).`;
  return null;
}

/** Suggested amount: what's left, minus fund requests already waiting for approval (if that still meets the minimum). */
export function defaultPaymentCents(settings: PublicSettings, account: ActivityAccount): Cents {
  const afterPending = account.remainingCents - account.pendingRedemptionCents;
  return account.pendingRedemptionCents > 0 && afterPending >= settings.minPaymentCents
    ? afterPending
    : account.remainingCents;
}

export function OtherWaysToPay({ settings }: { settings: PublicSettings }) {
  return (
    <section className="other-ways" aria-labelledby="other-ways-title">
      <h3 id="other-ways-title" className="subhead">
        Other ways to pay
      </h3>
      <p className="preline">{settings.otherPaymentInstructions}</p>
      {settings.supportEmail ? (
        <p className="muted small">
          Questions? Email <a href={`mailto:${settings.supportEmail}`} className="break">{settings.supportEmail}</a>.
        </p>
      ) : null}
    </section>
  );
}

export function PayDialog({
  summary,
  account,
  onClose,
}: {
  summary: StudentSummary;
  account: ActivityAccount;
  onClose(): void;
}) {
  const { api, data, refresh } = useApp();
  const { settings } = data;
  const toast = useToast();
  const online = canPayOnline(settings, account);
  const first = summary.student.firstName;

  const [amount, setAmount] = useState(() => centsToInput(defaultPaymentCents(settings, account)));
  const [coverFee, setCoverFee] = useState(settings.feeCoverDefault);
  const [payError, setPayError] = useState<string | null>(null);

  const cents = parseAmountInput(amount);
  const amountError = online ? paymentAmountError(cents, settings, account) : null;
  const validCents = online && !amountError && cents !== null ? cents : null;
  const fee = validCents !== null ? grossUpCents(validCents, settings.feePercent, settings.feeFixedCents).feeCents : null;
  const totalCents = validCents !== null ? validCents + (coverFee && fee ? fee : 0) : null;
  const settledCents = useDebouncedValue(validCents, AMOUNT_SETTLE_MS);

  function onPaid(payment: Payment) {
    if (payment.status === 'Pending') {
      toast("PayPal is still processing your payment. We'll let you know when it's complete.", 'info');
    } else {
      toast(`Payment received – thank you! ${formatCents(payment.amountCents)} toward ${account.activityName}.`);
    }
    onClose();
    void refresh({ force: true });
  }

  return (
    <Dialog
      open
      title={online ? 'Pay online' : 'How to pay'}
      onClose={onClose}
      description={
        <>
          {first} has <strong>{formatCents(account.remainingCents)}</strong> left to pay for {account.activityName}.
        </>
      }
    >
      {online ? (
        <div className="pay">
          <TextField
            label="Amount to pay"
            prefix="$"
            inputMode="decimal"
            autoComplete="off"
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
              setPayError(null);
            }}
            error={amount.trim() === '' ? null : amountError}
            hint={`Between ${formatCents(settings.minPaymentCents)} and ${formatCents(account.remainingCents)}`}
            data-autofocus
          />
          {account.pendingRedemptionCents > 0 ? (
            <p className="callout callout-warning small">
              <Icon name="info" size={16} />
              <span>
                {formatCents(account.pendingRedemptionCents)} of activity funds is waiting for approval for this trip, so
                you may not need to pay all of it now.
              </span>
            </p>
          ) : null}

          <CheckboxField
            checked={coverFee}
            onChange={setCoverFee}
            label={
              fee !== null
                ? `Add ${formatCents(fee)} to cover PayPal's processing fee so 100% goes to ${first}'s trip`
                : `Add PayPal's processing fee so 100% goes to ${first}'s trip`
            }
            description="Optional. TMA is a volunteer-run nonprofit; this keeps every dollar for the students."
          />

          <dl className="breakdown breakdown-boxed" aria-label="Payment summary">
            <div>
              <dt>Trip payment</dt>
              <dd>{validCents !== null ? <Money cents={validCents} /> : '—'}</dd>
            </div>
            {coverFee ? (
              <div>
                <dt>Fee contribution</dt>
                <dd>{fee !== null ? <Money cents={fee} /> : '—'}</dd>
              </div>
            ) : null}
            <div className="breakdown-total">
              <dt>Total charged</dt>
              <dd>{totalCents !== null ? <Money cents={totalCents} /> : '—'}</dd>
            </div>
          </dl>

          {payError ? (
            <p className="form-error" role="alert">
              {payError}
            </p>
          ) : null}

          <div className="paypal-slot">
            {settledCents !== null && settledCents === validCents ? (
              <PayPalCheckout
                key={`${settledCents}:${coverFee ? 1 : 0}`}
                api={api}
                settings={settings}
                order={{
                  studentId: summary.student.id,
                  activityId: account.activityId,
                  amountCents: settledCents,
                  coverFee,
                }}
                onPaid={onPaid}
                onError={setPayError}
              />
            ) : (
              <p className="muted small center">
                {validCents === null ? 'Enter an amount to continue.' : 'Updating…'}
              </p>
            )}
          </div>
          <hr className="divider" />
        </div>
      ) : settings.onlinePaymentsEnabled && account.allowOnlinePayment && account.remainingCents < settings.minPaymentCents ? (
        <p className="callout callout-info small">
          The online minimum is {formatCents(settings.minPaymentCents)}, so please use one of the options below.
        </p>
      ) : null}

      <OtherWaysToPay settings={settings} />
    </Dialog>
  );
}
