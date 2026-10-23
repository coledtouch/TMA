import type { IsoDate } from '../../shared/types';
import { dateBadge, formatDate } from '../lib/format';

/** Calendar-style date tile ("FEB / 1"). The full date is available to screen readers. */
export function DateBadge({ date }: { date: IsoDate }) {
  const { month, day } = dateBadge(date);
  return (
    <span className="date-badge">
      <span className="visually-hidden">{formatDate(date)}</span>
      <span className="date-badge-month" aria-hidden="true">
        {month}
      </span>
      <span className="date-badge-day" aria-hidden="true">
        {day}
      </span>
    </span>
  );
}
