import { formatCents } from '../../shared/money';
import type { Cents } from '../../shared/types';

/** Money with tabular numerals. `sign` shows "+" on credits; `tone` colors credits/debits. */
export function Money({
  cents,
  sign,
  tone,
  size,
  className,
}: {
  cents: Cents;
  sign?: boolean;
  tone?: boolean;
  size?: 'xl' | 'lg' | 'md';
  className?: string;
}) {
  const classes = ['money'];
  if (size) classes.push(`money-${size}`);
  if (tone && cents > 0) classes.push('money-credit');
  if (tone && cents < 0) classes.push('money-debit');
  if (className) classes.push(className);
  return <span className={classes.join(' ')}>{formatCents(cents, { sign })}</span>;
}
