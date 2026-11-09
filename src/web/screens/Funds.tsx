/** Funds: each verified student's activity-fund balance and history. */
import { useState } from 'react';
import type { Bootstrap, LedgerEntry, StudentSummary } from '../../shared/types';
import { Icon } from '../components/Icon';
import { Money } from '../components/Money';
import { SegmentedControl } from '../components/SegmentedControl';
import { EmptyState } from '../components/States';
import { Chip } from '../components/StatusChip';
import { useApp } from '../hooks/app-context';
import { FUNDS_EXPLAINER } from '../lib/copy';
import { formatDate } from '../lib/format';
import { href } from '../lib/router';

/** Activity id → name, from open activities and the students' own accounts. */
export function activityNames(data: Bootstrap): Map<string, string> {
  const names = new Map<string, string>();
  for (const a of data.activities) names.set(a.id, a.name);
  for (const s of data.students) for (const acc of s.activities) names.set(acc.activityId, acc.activityName);
  return names;
}

export function NoFundsYet({ data }: { data: Bootstrap }) {
  const status = data.me.familyStatus;
  if (status === 'None') {
    return (
      <EmptyState
        icon="users"
        title="Set up your household first"
        action={
          <a className="btn btn-primary" href={href('household')}>
            Set up your household
          </a>
        }
      >
        Once TMA verifies your students, their activity funds show up here.
      </EmptyState>
    );
  }
  if (status === 'Pending') {
    return (
      <EmptyState icon="shield" title="Waiting for TMA to verify your household">
        Activity funds show up here as soon as a board member verifies your students.
      </EmptyState>
    );
  }
  if (status === 'Inactive') {
    return (
      <EmptyState icon="info" title="Your household is inactive">
        Please contact TMA at {data.settings.supportEmail}.
      </EmptyState>
    );
  }
  return (
    <EmptyState
      icon="users"
      title="No verified students yet"
      action={
        <a className="btn btn-secondary" href={href('household')}>
          Your household
        </a>
      }
    >
      Students you add show up here once TMA verifies them.
    </EmptyState>
  );
}

export function Funds({ studentId }: { studentId?: string }) {
  const { data } = useApp();
  const verified = data.students.filter((s) => s.verified);
  const [picked, setPicked] = useState<string | null>(null);
  const current =
    verified.find((s) => s.student.id === (picked ?? studentId)) ?? verified[0] ?? null;

  return (
    <div className="screen">
      <div className="screen-head">
        <h1 className="screen-title">Activity funds</h1>
      </div>

      <p className="callout callout-info">
        <Icon name="info" size={18} />
        <span>{FUNDS_EXPLAINER}</span>
      </p>

      {current === null ? (
        <NoFundsYet data={data} />
      ) : (
        <>
          {verified.length > 1 ? (
            <SegmentedControl
              label="Student"
              value={current.student.id}
              onChange={setPicked}
              options={verified.map((s) => ({ value: s.student.id, label: s.student.firstName }))}
            />
          ) : null}
          <StudentFunds summary={current} ledger={data.ledger} names={activityNames(data)} />
        </>
      )}
    </div>
  );
}

function StudentFunds({
  summary,
  ledger,
  names,
}: {
  summary: StudentSummary;
  ledger: LedgerEntry[];
  names: Map<string, string>;
}) {
  const { student } = summary;
  const rows = ledger.filter((l) => l.studentId === student.id);
  const first = student.firstName;

  return (
    <>
      <section className="card balance-card" aria-label={`${first}'s activity funds`}>
        <span className="balance-label">{first}'s available funds</span>
        <Money cents={summary.availableCents} size="xl" />
        {summary.pendingCents > 0 ? (
          <dl className="breakdown">
            <div>
              <dt>Balance</dt>
              <dd>
                <Money cents={summary.balanceCents} />
              </dd>
            </div>
            <div>
              <dt>Waiting for approval</dt>
              <dd>
                <Money cents={-summary.pendingCents} />
              </dd>
            </div>
          </dl>
        ) : null}
        {summary.availableCents > 0 && summary.activities.some((a) => a.allowFunds && a.remainingCents > 0) ? (
          <a className="btn btn-secondary btn-sm mt-12" href={href('trips')}>
            Use funds for a trip
          </a>
        ) : null}
      </section>

      <section className="section" aria-labelledby="history-title">
        <h2 id="history-title" className="section-title">
          History
        </h2>
        {rows.length === 0 ? (
          <div className="card">
            <EmptyState icon="funds" title="No activity yet">
              Fundraiser credits and donations for {first} will show up here.
            </EmptyState>
          </div>
        ) : (
          <ul className="card list" aria-label={`${first}'s fund history`}>
            {rows.map((l) => {
              const activity = l.activityId ? names.get(l.activityId) ?? l.activityId : null;
              return (
                <li key={`${l.id}:${l.date}:${l.amountCents}`} className="ledger-row">
                  <span className="list-main">
                    <span className="list-title">{l.description || l.type}</span>
                    <span className="muted small ledger-meta">
                      <span>{formatDate(l.date)}</span>
                      {l.type && l.description ? <span>{l.type}</span> : null}
                      {activity ? <Chip tone="info">{activity}</Chip> : null}
                    </span>
                  </span>
                  <span className="ledger-amount">
                    <Money cents={l.amountCents} sign tone />
                    <span className="visually-hidden">{l.amountCents >= 0 ? ' added' : ' used'}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}
