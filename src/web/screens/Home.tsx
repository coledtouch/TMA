/** Home: greeting, nudges, each student's available funds, what's coming up and the latest news. */
import { useEffect, useState } from 'react';
import type { Announcement, StudentSummary } from '../../shared/types';
import { errorMessage } from '../api/client';
import { DateBadge } from '../components/DateBadge';
import { Icon } from '../components/Icon';
import { Money } from '../components/Money';
import { Nudge } from '../components/Nudge';
import { Chip, StatusChip } from '../components/StatusChip';
import { useApp } from '../hooks/app-context';
import { useToast } from '../hooks/toast';
import { IN_APP_BROWSER_HINT } from '../lib/copy';
import {
  accountStatus,
  duePhrase,
  firstName,
  formatCents,
  formatDate,
  gradeLabel,
  greeting,
  nextDue,
  studentName,
} from '../lib/format';
import { useInstallPrompt } from '../lib/install';
import { enablePush, getPushSupport, type PushSupport } from '../lib/push';
import { href } from '../lib/router';

export function Home() {
  const { data } = useApp();
  const { me } = data;
  const name = firstName(me.name);

  return (
    <div className="screen">
      <div className="screen-head">
        <h1 className="screen-title">
          {greeting()}
          {name ? `, ${name}` : ''}
        </h1>
        <p className="screen-sub">{data.settings.orgName}</p>
      </div>

      <HomeNudges />

      {me.isAdmin ? (
        <a className="card card-link admin-shortcut" href={href('admin')}>
          <Icon name="admin" size={24} />
          <span>
            <span className="card-link-title">Board tools</span>
            <span className="muted">Approve fund requests, review new families, send news</span>
          </span>
          <Icon name="chevron" />
        </a>
      ) : null}

      <HouseholdSection />

      <ComingUp />

      <LatestNews announcements={data.announcements.slice(0, 3)} />
    </div>
  );
}

function HomeNudges() {
  const { api, refresh } = useApp();
  const toast = useToast();
  const install = useInstallPrompt();
  const [support, setSupport] = useState<PushSupport | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    getPushSupport({ mode: api.mode })
      .then((s) => alive && setSupport(s))
      .catch(() => alive && setSupport('unsupported'));
    return () => {
      alive = false;
    };
  }, []);

  async function turnOn() {
    setBusy(true);
    try {
      const res = await enablePush(api);
      if (res.ok) {
        setSupport('enabled');
        toast("Notifications are on. We'll keep you posted.");
        void refresh({ force: true });
      } else {
        toast(res.reason, 'error');
        setSupport(await getPushSupport({ mode: api.mode }).catch(() => 'unsupported' as const));
      }
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {support === 'ready' ? (
        <Nudge
          id="push"
          icon="bell"
          title="Get a heads-up when funds are added"
          action={
            <button type="button" className="btn btn-primary btn-sm" onClick={turnOn} disabled={busy}>
              {busy ? 'Turning on…' : 'Turn on notifications'}
            </button>
          }
        >
          We'll let you know about fundraiser credits, payments and due dates.
        </Nudge>
      ) : null}
      {support === 'needs-install' ? (
        <Nudge
          id="push-ios"
          icon="bell"
          title="Get notifications on your iPhone"
          action={
            <a className="btn btn-primary btn-sm" href={href('notifications')}>
              Show me how
            </a>
          }
        >
          On iPhone and iPad, notifications work once TMA is on your Home Screen.
        </Nudge>
      ) : null}
      {install.inAppBrowser ? (
        <Nudge id="in-app-browser" icon="external" title="Open TMA in your browser">
          {IN_APP_BROWSER_HINT}
        </Nudge>
      ) : null}
      {install.canPrompt && !install.installed ? (
        <Nudge
          id="install"
          icon="download"
          title="Install the TMA app"
          action={
            <button type="button" className="btn btn-primary btn-sm" onClick={() => void install.prompt()}>
              Install
            </button>
          }
        >
          Open TMA from your home screen like any other app.
        </Nudge>
      ) : null}
    </>
  );
}

function HouseholdSection() {
  const { data } = useApp();
  const { me, students, settings } = data;

  if (me.familyStatus === 'None') {
    return (
      <section className="card card-feature" aria-labelledby="setup-title">
        <div className="feature-icon">
          <Icon name="users" size={26} />
        </div>
        <h2 id="setup-title" className="card-title">
          {me.isAdmin ? 'Are you a TMA parent too?' : 'Set up your household'}
        </h2>
        <p>
          Tell us who your students are. TMA will match them to its records so you can see activity funds and
          trips here. It takes about a minute.
        </p>
        <a className="btn btn-primary btn-block" href={href('household')}>
          Set up your household
        </a>
      </section>
    );
  }

  if (me.familyStatus === 'Inactive') {
    return (
      <section className="card card-feature" aria-labelledby="inactive-title">
        <h2 id="inactive-title" className="card-title">
          Your household is inactive
        </h2>
        <p>
          Please contact TMA at{' '}
          <a href={`mailto:${settings.supportEmail}`} className="break">
            {settings.supportEmail}
          </a>{' '}
          if you think this is a mistake.
        </p>
      </section>
    );
  }

  if (me.familyStatus === 'Pending') {
    return (
      <section className="card card-feature card-pending" aria-labelledby="pending-title">
        <div className="feature-icon feature-icon-warning">
          <Icon name="shield" size={26} />
        </div>
        <h2 id="pending-title" className="card-title">
          Thanks! TMA is verifying your household
        </h2>
        <p>
          A board member will match your students to TMA's records, usually within a few days. We'll send you a
          notification when it's done, and then activity funds and trips will show up here.
        </p>
        {students.length > 0 ? (
          <ul className="plain-list">
            {students.map((s) => (
              <li key={s.student.id} className="row-between">
                <span>{studentName(s.student)}</span>
                <StatusChip status="Awaiting verification" />
              </li>
            ))}
          </ul>
        ) : null}
        <a className="btn btn-secondary btn-block" href={href('household')}>
          Review your household
        </a>
      </section>
    );
  }

  if (students.length === 0) {
    return (
      <section className="card card-feature" aria-labelledby="nostudents-title">
        <h2 id="nostudents-title" className="card-title">
          Add your students
        </h2>
        <p>Add each student in a TMA music group to see their activity funds and trips.</p>
        <a className="btn btn-primary btn-block" href={href('household')}>
          Add a student
        </a>
      </section>
    );
  }

  return (
    <section aria-label="Your students" className="stack">
      {students.map((s) => (
        <StudentCard key={s.student.id} summary={s} />
      ))}
    </section>
  );
}

export function StudentCard({ summary }: { summary: StudentSummary }) {
  const { student, verified } = summary;
  const name = studentName(student);
  const titleId = `student-${student.id}`;
  return (
    <article className="card student-card" aria-labelledby={titleId}>
      <div className="student-head">
        <span className="avatar" aria-hidden="true">
          {(student.firstName[0] ?? '').toUpperCase()}
          {(student.lastName[0] ?? '').toUpperCase()}
        </span>
        <div className="student-meta">
          <h2 id={titleId} className="card-title">
            {name}
          </h2>
          <p className="muted small">{[gradeLabel(student.grade), student.school].filter(Boolean).join(' · ')}</p>
        </div>
      </div>
      {student.ensembles.length > 0 || student.instrument ? (
        <div className="chips">
          {student.ensembles.map((e) => (
            <Chip key={e} tone="brand">
              {e}
            </Chip>
          ))}
          {student.instrument ? <Chip>{student.instrument}</Chip> : null}
        </div>
      ) : null}

      {verified ? (
        <>
          <div className="balance">
            <span className="balance-label">Available activity funds</span>
            <Money cents={summary.availableCents} size="xl" />
            {summary.pendingCents > 0 ? (
              <p className="balance-note">
                <StatusChip status="Pending" /> {formatCents(summary.pendingCents)} waiting for approval
              </p>
            ) : null}
          </div>
          <div className="card-actions">
            <a className="btn btn-secondary btn-sm" href={href('funds', { student: student.id })}>
              Fund history
            </a>
            <a className="btn btn-secondary btn-sm" href={href('trips')}>
              Trips & payments
            </a>
          </div>
        </>
      ) : (
        <p className="pending-line">
          <StatusChip status="Awaiting verification" />
          <span className="muted small">Funds show up once TMA verifies {student.firstName}.</span>
        </p>
      )}
    </article>
  );
}

function ComingUp() {
  const { data } = useApp();
  const now = new Date();
  const dues = data.students
    .filter((s) => s.verified)
    .flatMap((s) =>
      s.activities
        .filter((a) => a.activityOpen && a.enrollmentStatus !== 'Withdrawn')
        .map((a) => ({ s, a, due: nextDue(a, now) })),
    )
    .filter((x): x is typeof x & { due: NonNullable<typeof x.due> } => x.due !== null)
    .sort((x, y) => x.due.date.localeCompare(y.due.date))
    .slice(0, 3);
  const events = data.events.slice(0, 3);

  if (dues.length === 0 && events.length === 0) return null;

  return (
    <section className="section" aria-labelledby="coming-title">
      <h2 id="coming-title" className="section-title">
        Coming up
      </h2>
      <ul className="card list">
        {dues.map(({ s, a, due }) => {
          const status = accountStatus(a, now);
          return (
            <li key={`${s.student.id}:${a.activityId}`}>
              <a className="list-row" href={href('trips')}>
                <DateBadge date={due.date} />
                <span className="list-main">
                  <span className="list-title">
                    {a.activityName} {due.label === 'Deposit' ? 'deposit' : 'payment'}
                  </span>
                  <span className="muted small">
                    {s.student.firstName} · {formatCents(due.amountCents)} {duePhrase(due, now)}
                  </span>
                </span>
                {status === 'overdue' ? <StatusChip status="Past due" /> : null}
                {status === 'due-soon' ? <StatusChip status="Due soon" /> : null}
              </a>
            </li>
          );
        })}
        {events.map((e) => (
          <li key={e.id}>
            <a className="list-row" href={href('news')}>
              <DateBadge date={e.date} />
              <span className="list-main">
                <span className="list-title">{e.title}</span>
                <span className="muted small">{[e.time, e.location].filter(Boolean).join(' · ') || formatDate(e.date)}</span>
              </span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

function LatestNews({ announcements }: { announcements: Announcement[] }) {
  if (announcements.length === 0) return null;
  return (
    <section className="section" aria-labelledby="news-title">
      <div className="section-head">
        <h2 id="news-title" className="section-title">
          Latest news
        </h2>
        <a className="link-more" href={href('news')}>
          See all
        </a>
      </div>
      <ul className="card list">
        {announcements.map((a) => (
          <li key={a.id}>
            <a className="list-row" href={href('news')}>
              <span className="list-main">
                <span className="list-title">{a.title}</span>
                <span className="muted small clamp-2">{a.body}</span>
              </span>
              <span className="muted small nowrap">{formatDate(a.date)}</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
