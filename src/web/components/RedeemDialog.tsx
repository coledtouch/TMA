/** "Use activity funds for this trip": ask the treasurer to apply funds to an activity. */
import { useId, useState, type FormEvent } from 'react';
import { parseAmountInput } from '../../shared/money';
import type { ActivityAccount, Cents, StudentSummary } from '../../shared/types';
import { errorMessage } from '../api/client';
import { useApp } from '../hooks/app-context';
import { useToast } from '../hooks/toast';
import { centsToInput, formatCents, maxRedeemableCents } from '../lib/format';
import { Dialog } from './Dialog';
import { TextAreaField, TextField } from './Field';
import { Money } from './Money';

export const MIN_REDEMPTION_CENTS = 100;
const NOTE_MAX = 500;

/** Client-side check mirroring the server rules; returns an error message or null. */
export function redemptionAmountError(
  cents: Cents | null,
  summary: StudentSummary,
  account: ActivityAccount,
): string | null {
  if (cents === null) return 'Enter an amount like 125 or 125.50.';
  if (cents < MIN_REDEMPTION_CENTS) return 'The smallest request is $1.00.';
  if (cents > summary.availableCents) {
    return `That's more than ${summary.student.firstName}'s available funds (${formatCents(summary.availableCents)}).`;
  }
  const leftToCover = Math.max(0, account.remainingCents - account.pendingRedemptionCents);
  if (cents > leftToCover) return `That's more than what's left to cover on this trip (${formatCents(leftToCover)}).`;
  return null;
}

export function RedeemDialog({
  summary,
  account,
  onClose,
}: {
  summary: StudentSummary;
  account: ActivityAccount;
  onClose(): void;
}) {
  const { api, refresh } = useApp();
  const toast = useToast();
  const formId = useId();
  const max = maxRedeemableCents(account, summary.availableCents);
  const [amount, setAmount] = useState(() => centsToInput(max));
  const [note, setNote] = useState('');
  const [amountError, setAmountError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const first = summary.student.firstName;
  const leftToCover = Math.max(0, account.remainingCents - account.pendingRedemptionCents);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const cents = parseAmountInput(amount);
    const problem = redemptionAmountError(cents, summary, account);
    setAmountError(problem);
    setFormError(null);
    if (problem || cents === null) return;
    setBusy(true);
    try {
      const trimmed = note.trim();
      await api.call('redemption.request', {
        studentId: summary.student.id,
        activityId: account.activityId,
        amountCents: cents,
        ...(trimmed ? { note: trimmed.slice(0, NOTE_MAX) } : {}),
      });
      toast(`Request sent: ${formatCents(cents)} for ${account.activityName}. We'll let you know when TMA approves it.`);
      onClose();
      void refresh({ force: true });
    } catch (err) {
      setFormError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      title="Use activity funds"
      onClose={onClose}
      description={
        <>
          Apply {first}'s activity funds to <strong>{account.activityName}</strong>.
        </>
      }
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" form={formId} className="btn btn-primary" disabled={busy}>
            {busy ? 'Sending…' : 'Send request'}
          </button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} noValidate>
        <dl className="breakdown breakdown-boxed">
          <div>
            <dt>{first}'s available funds</dt>
            <dd>
              <Money cents={summary.availableCents} />
            </dd>
          </div>
          <div>
            <dt>Left to cover on this trip</dt>
            <dd>
              <Money cents={leftToCover} />
            </dd>
          </div>
        </dl>
        <TextField
          label="Amount to apply"
          prefix="$"
          inputMode="decimal"
          autoComplete="off"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          error={amountError}
          hint={max > 0 ? `Up to ${formatCents(max)}` : undefined}
          data-autofocus
        />
        <TextAreaField
          label="Note for the treasurer"
          optional
          maxLength={NOTE_MAX}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="For example: please apply to the deposit"
        />
        <p className="muted small">
          TMA's treasurer reviews each request, usually within a few days. The funds are applied once it's
          approved, and you'll get a notification.
        </p>
        {formError ? (
          <p className="form-error" role="alert">
            {formError}
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}
