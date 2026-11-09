/** Trips: each activity account (cost, paid, remaining, due dates), fund requests, and ways to pay. */
import { useState } from 'react';
import type { ActivityAccount, Payment, RedemptionRequest, StudentSummary } from '../../shared/types';
import { errorMessage } from '../api/client';
import { ConfirmDialog } from '../components/Dialog';
import { Icon } from '../components/Icon';
import { Money } from '../components/Money';
import { canPayOnline, PayDialog } from '../components/PayDialog';
import { ProgressBar } from '../components/ProgressBar';
import { MIN_REDEMPTION_CENTS, RedeemDialog } from '../components/RedeemDialog';
import { EmptyState } from '../components/States';
import { StatusChip } from '../components/StatusChip';
import { useApp } from '../hooks/app-context';
import { useToast } from '../hooks/toast';
import { accountStatus, formatCents, formatDate, maxRedeemableCents, safeHref } from '../lib/format';
import { NoFundsYet } from './Funds';

type OpenDialog = { kind: 'redeem' | 'pay'; studentId: string; activityId: string };

export function Trips() {
  const { data } = useApp();
  const [dialog, setDialog] = useState<OpenDialog | null>(null);
  const verified = data.students.filter((s) => s.verified);

  // Look the account up on every render so the dialog follows refreshed data.
  const dialogStudent = dialog ? verified.find((s) => s.student.id === dialog.studentId) : undefined;
  const dialogAccount = dialogStudent?.activities.find((a) => a.activityId === dialog?.activityId);

  return (
    <div className="screen">
      <div className="screen-head">
        <h1 className="screen-title">Trips & activities</h1>
        <p className="screen-sub">What each trip costs, what's paid and what's left.</p>
      </div>

      {verified.length === 0 ? (
        <NoFundsYet data={data} />
      ) : (
        verified.map((s) => (
          <section key={s.student.id} className="section" aria-labelledby={`trips-${s.student.id}`}>
            <h2 id={`trips-${s.student.id}`} className="section-title">
              {s.student.firstName} {s.student.lastName}
              <span className="section-aside">
                <Money cents={s.availableCents} /> in activity funds
              </span>
            </h2>
            {s.activities.length === 0 ? (
              <div className="card">
                <EmptyState icon="trips" title="No trips or activities yet">
                  When the music department signs {s.student.firstName} up for a trip or camp, it shows up here.
                </EmptyState>
              </div>
            ) : (
              <div className="stack">
                {s.activities.map((a) => (
                  <AccountCard
                    key={a.activityId}
                    summary={s}
                    account={a}
                    onRedeem={() => setDialog({ kind: 'redeem', studentId: s.student.id, activityId: a.activityId })}
                    onPay={() => setDialog({ kind: 'pay', studentId: s.student.id, activityId: a.activityId })}
                  />
                ))}
              </div>
            )}
          </section>
        ))
      )}

      {dialog?.kind === 'redeem' && dialogStudent && dialogAccount ? (
        <RedeemDialog summary={dialogStudent} account={dialogAccount} onClose={() => setDialog(null)} />
      ) : null}
      {dialog?.kind === 'pay' && dialogStudent && dialogAccount ? (
        <PayDialog summary={dialogStudent} account={dialogAccount} onClose={() => setDialog(null)} />
      ) : null}
    </div>
  );
}

function AccountCard({
  summary,
  account,
  onRedeem,
  onPay,
}: {
  summary: StudentSummary;
  account: ActivityAccount;
  onRedeem(): void;
  onPay(): void;
}) {
  const { data } = useApp();
  const now = new Date();
  const status = accountStatus(account, now);
  const titleId = `acct-${account.studentId}-${account.activityId}`;
  const going = account.enrollmentStatus === 'Going';
  const actionable = going && account.activityOpen && account.remainingCents > 0;
  const redeemable = maxRedeemableCents(account, summary.availableCents);
  const canRedeem = actionable && account.allowFunds && redeemable >= MIN_REDEMPTION_CENTS;
  const online = canPayOnline(data.settings, account);
  const infoUrl = safeHref(data.activities.find((x) => x.id === account.activityId)?.infoUrl);

  const requests = data.redemptions.filter(
    (r) => r.studentId === account.studentId && r.activityId === account.activityId && r.status !== 'Cancelled',
  );
  const payments = data.payments.filter(
    (p) => p.studentId === account.studentId && p.activityId === account.activityId,
  );

  return (
    <article className="card account-card" aria-labelledby={titleId}>
      <div className="account-head">
        <div className="account-title">
          <h3 id={titleId} className="card-title">
            {account.activityName}
          </h3>
          <p className="muted small">
            {account.kind}
            {account.enrollmentStatus !== 'Going' ? ` · ${account.enrollmentStatus}` : ''}
            {!account.activityOpen ? ' · Closed' : ''}
          </p>
        </div>
        <div className="chips chips-end">
          {status === 'paid' ? <StatusChip status="Paid" /> : null}
          {status === 'overdue' ? <StatusChip status="Past due" /> : null}
          {status === 'due-soon' ? <StatusChip status="Due soon" /> : null}
          {account.enrollmentStatus === 'Waitlist' ? <StatusChip status="Waitlist" /> : null}
        </div>
      </div>

      <ProgressBar
        paidCents={account.paidCents}
        pendingCents={account.pendingRedemptionCents}
        totalCents={account.costCents}
      />

      <div className="figures">
        <div className="figure">
          <span className="figure-label">Paid</span>
          <Money cents={account.paidCents} />
        </div>
        <div className="figure">
          <span className="figure-label">Cost</span>
          <Money cents={account.costCents} />
        </div>
        <div className="figure figure-main">
          <span className="figure-label">Left to pay</span>
          <Money cents={account.remainingCents} size="lg" />
        </div>
      </div>

      {account.paidCents > 0 ? (
        <p className="muted small">
          {formatCents(account.paidFromFundsCents)} from activity funds · {formatCents(account.paidDirectCents)} paid
          directly
        </p>
      ) : null}
      {account.pendingPaymentCents ? (
        <p className="muted small">
          {formatCents(account.pendingPaymentCents)} payment still processing. It counts as paid once it clears, so it's
          not in "Left to pay".
        </p>
      ) : null}

      <DueDates account={account} />

      {requests.length > 0 ? <Requests requests={requests} /> : null}
      {payments.length > 0 ? <Payments payments={payments} /> : null}

      {!going && account.remainingCents > 0 ? (
        <p className="muted small">Payments open once {summary.student.firstName} is confirmed for this activity.</p>
      ) : null}

      {actionable ? (
        <div className="card-actions">
          {canRedeem ? (
            <button type="button" className="btn btn-primary" onClick={onRedeem}>
              Use activity funds
            </button>
          ) : null}
          <button type="button" className={`btn ${canRedeem ? 'btn-secondary' : 'btn-primary'}`} onClick={onPay}>
            {online ? 'Pay online' : 'How to pay'}
          </button>
        </div>
      ) : null}
      {actionable && !account.allowFunds ? (
        <p className="muted small">Activity funds can't be used for this one.</p>
      ) : null}
      {infoUrl ? (
        <a className="link-more" href={infoUrl} target="_blank" rel="noopener noreferrer">
          Trip details <Icon name="external" size={14} />
        </a>
      ) : null}
    </article>
  );
}

function DueDates({ account }: { account: ActivityAccount }) {
  const items: Array<{ key: string; label: string; date: string; done: boolean; amount?: number }> = [];
  if (account.depositCents && account.depositDueDate) {
    items.push({
      key: 'deposit',
      label: 'Deposit',
      date: account.depositDueDate,
      amount: account.depositCents,
      done: account.paidCents >= account.depositCents,
    });
  }
  if (account.dueDate) {
    items.push({ key: 'final', label: 'Final payment', date: account.dueDate, done: account.remainingCents <= 0 });
  }
  if (items.length === 0) return null;
  return (
    <ul className="due-list" aria-label="Due dates">
      {items.map((d) => (
        <li key={d.key} className={d.done ? 'is-done' : undefined}>
          <Icon name={d.done ? 'check' : 'calendar'} size={16} />
          <span>
            {d.label}
            {d.amount ? ` ${formatCents(d.amount)}` : ''} due {formatDate(d.date)}
            {d.done ? <span className="visually-hidden"> (paid)</span> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Requests({ requests }: { requests: RedemptionRequest[] }) {
  const { api, refresh } = useApp();
  const toast = useToast();
  const [confirming, setConfirming] = useState<RedemptionRequest | null>(null);
  const [busy, setBusy] = useState(false);

  async function cancel() {
    if (!confirming) return;
    setBusy(true);
    try {
      await api.call('redemption.cancel', { id: confirming.id });
      toast('Request cancelled.');
      setConfirming(null);
      void refresh({ force: true });
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="subsection">
      <h4 className="subhead">Fund requests</h4>
      <ul className="plain-list">
        {requests.slice(0, 5).map((r) => (
          <li key={r.id} className="request-row">
            <div className="row-between">
              <span>
                <Money cents={r.amountCents} /> <span className="muted small">requested {formatDate(r.requestedAt.slice(0, 10))}</span>
              </span>
              <StatusChip status={r.status} />
            </div>
            {r.status === 'Pending' ? (
              <div className="row-between">
                <span className="muted small">Waiting for the treasurer to approve.</span>
                <button type="button" className="btn btn-link btn-sm" onClick={() => setConfirming(r)}>
                  Cancel request
                </button>
              </div>
            ) : null}
            {r.adminNote ? <p className="muted small">Note from TMA: {r.adminNote}</p> : null}
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={confirming !== null}
        title="Cancel this request?"
        message={
          confirming ? (
            <p>
              Your request to apply {formatCents(confirming.amountCents)} of activity funds will be withdrawn. You can
              send a new one any time.
            </p>
          ) : null
        }
        confirmLabel="Cancel request"
        cancelLabel="Keep it"
        danger
        busy={busy}
        onConfirm={cancel}
        onCancel={() => setConfirming(null)}
      />
    </div>
  );
}

function Payments({ payments }: { payments: Payment[] }) {
  return (
    <div className="subsection">
      <h4 className="subhead">Payments</h4>
      <ul className="plain-list">
        {payments.slice(0, 5).map((p) => (
          <li key={`${p.id}:${p.date}`} className="row-between">
            <span>
              <Money cents={p.amountCents} />{' '}
              <span className="muted small">
                {p.method} · {formatDate(p.date)}
              </span>
            </span>
            <StatusChip status={p.status} />
          </li>
        ))}
      </ul>
    </div>
  );
}
