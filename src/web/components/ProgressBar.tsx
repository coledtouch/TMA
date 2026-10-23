import { formatCents } from '../../shared/money';
import type { Cents } from '../../shared/types';

/** Paid-of-cost bar. The pending part (fund requests awaiting approval) shows as a lighter segment. */
export function ProgressBar({
  paidCents,
  pendingCents = 0,
  totalCents,
  label,
}: {
  paidCents: Cents;
  pendingCents?: Cents;
  totalCents: Cents;
  label?: string;
}) {
  const total = Math.max(0, totalCents);
  const paid = Math.min(Math.max(0, paidCents), total);
  const pending = Math.min(Math.max(0, pendingCents), total - paid);
  const pct = (n: number) => (total > 0 ? (n / total) * 100 : 0);
  const text = label ?? `${formatCents(paid)} of ${formatCents(total)} paid`;
  return (
    <div
      className="progress"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct(paid))}
      aria-valuetext={text}
      aria-label={text}
    >
      <div className="progress-paid" style={{ width: `${pct(paid)}%` }} />
      {pending > 0 ? <div className="progress-pending" style={{ width: `${pct(pending)}%` }} /> : null}
    </div>
  );
}
