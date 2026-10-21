import type { ReactNode } from 'react';

export type ChipTone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info';

export function Chip({ tone = 'neutral', children }: { tone?: ChipTone; children: ReactNode }) {
  return <span className={`chip chip-${tone}`}>{children}</span>;
}

export type Status =
  | 'Pending'
  | 'Approved'
  | 'Denied'
  | 'Cancelled'
  | 'Paid'
  | 'Due soon'
  | 'Past due'
  | 'Verified'
  | 'Awaiting verification'
  | 'Waitlist'
  | 'Completed'
  | 'Refunded'
  | 'Failed';

const TONES: Record<Status, ChipTone> = {
  Pending: 'warning',
  Approved: 'success',
  Denied: 'danger',
  Cancelled: 'neutral',
  Paid: 'success',
  'Due soon': 'warning',
  'Past due': 'danger',
  Verified: 'success',
  'Awaiting verification': 'warning',
  Waitlist: 'info',
  Completed: 'success',
  Refunded: 'neutral',
  Failed: 'danger',
};

/** Status chip with a consistent color per status. */
export function StatusChip({ status }: { status: Status }) {
  return <Chip tone={TONES[status]}>{status}</Chip>;
}
