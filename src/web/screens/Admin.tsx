/**
 * Board tools: stats, fund requests to approve, new households to verify,
 * announcements, a manual sync, and the recent activity log.
 */
import { useCallback, useEffect, useId, useState, type FormEvent, type ReactNode } from 'react';
import type {
  AdminOverview,
  NotificationChannel,
  PendingHousehold,
  PendingRedemptionView,
  PublicSettings,
  TickReport,
} from '../../shared/types';
import { errorMessage } from '../api/client';
import { ConfirmDialog } from '../components/Dialog';
import { DemoControls } from '../components/DemoControls';
import { CheckboxField, CheckboxGroup, TextAreaField, TextField } from '../components/Field';
import { Icon } from '../components/Icon';
import { Money } from '../components/Money';
import { EmptyState, ErrorState, SkeletonCards } from '../components/States';
import { Chip, StatusChip } from '../components/StatusChip';
import { useApp } from '../hooks/app-context';
import { useToast } from '../hooks/toast';
import { audienceSummary, formatCents, formatDateTime, gradeLabel, plural, safeHref, studentName } from '../lib/format';

const LOG_SHOWN = 15;
const TITLE_MAX = 120;
const BODY_MAX = 2000;
const PUSH_PREVIEW_CHARS = 180;

export function Admin() {
  const { api, data, refresh } = useApp();
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setOverview(await api.call('admin.overview', {}));
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [api]);

  useEffect(() => {
    if (data.me.isAdmin) void load();
  }, [data.me.isAdmin, load]);

  /** After any decision: reload the overview and the signed-in user's own data. */
  const afterChange = useCallback(() => {
    void load();
    void refresh({ force: true });
  }, [load, refresh]);

  if (!data.me.isAdmin) {
    return (
      <div className="screen">
        <div className="screen-head">
          <h1 className="screen-title">Board tools</h1>
        </div>
        <div className="card">
          <EmptyState icon="lock" title="For TMA board members">
            These tools are only available to the board members listed in TMA's settings.
          </EmptyState>
        </div>
      </div>
    );
  }

  return (
    <div className="screen">
      <div className="screen-head row-between">
        <div>
          <h1 className="screen-title">Board tools</h1>
          <p className="screen-sub">Signed in as {data.me.email}</p>
        </div>
        <button type="button" className="icon-button" onClick={() => void load()} aria-label="Reload board tools">
          <Icon name="refresh" />
        </button>
      </div>

      {error && !overview ? <ErrorState message={error} onRetry={() => void load()} /> : null}
      {!error && !overview ? <SkeletonCards count={3} label="Loading board tools…" /> : null}
      {error && overview ? (
        <p className="callout callout-warning small" role="alert">
          {error}
        </p>
      ) : null}

      {overview ? (
        <>
          <Stats overview={overview} />
          <PendingRequests requests={overview.pendingRedemptions} onChange={afterChange} />
          <PendingHouseholds households={overview.pendingHouseholds} onChange={afterChange} />
        </>
      ) : null}

      <Compose settings={data.settings} onSent={afterChange} />
      <SyncCard onDone={afterChange} />
      {api.mode === 'demo' ? <DemoControls /> : null}
      {overview ? <ActivityLog overview={overview} /> : null}
    </div>
  );
}

function Stats({ overview }: { overview: AdminOverview }) {
  const s = overview.stats;
  const tiles: Array<{ label: string; value: ReactNode; sub?: string }> = [
    { label: 'Families', value: s.families, sub: `${s.activeFamilies} verified · ${s.pendingFamilies} waiting` },
    { label: 'Students', value: s.students },
    { label: 'Activity funds held', value: <Money cents={s.totalFundsCents} /> },
    { label: 'Fund requests', value: overview.pendingRedemptions.length, sub: 'waiting for a decision' },
    { label: 'Phones with notifications', value: s.pushDevices },
    s.emailFrom
      ? { label: 'Gmail backup emails left today', value: s.emailBackupRemaining ?? 0, sub: `Email is sent from ${s.emailFrom}` }
      : { label: 'Emails left today', value: s.emailQuotaRemaining },
  ];
  return (
    <section className="section" aria-labelledby="stats-title">
      <h2 id="stats-title" className="visually-hidden">
        At a glance
      </h2>
      <ul className="tiles">
        {tiles.map((t) => (
          <li key={t.label} className="tile">
            <span className="tile-value">{t.value}</span>
            <span className="tile-label">{t.label}</span>
            {t.sub ? <span className="tile-sub">{t.sub}</span> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Fund requests
// ---------------------------------------------------------------------------

function PendingRequests({ requests, onChange }: { requests: PendingRedemptionView[]; onChange(): void }) {
  return (
    <section className="section" aria-labelledby="requests-title">
      <h2 id="requests-title" className="section-title">
        Fund requests <span className="count">{requests.length}</span>
      </h2>
      {requests.length === 0 ? (
        <div className="card">
          <EmptyState icon="check" title="All caught up">
            No fund requests are waiting.
          </EmptyState>
        </div>
      ) : (
        <div className="stack">
          {requests.map((r) => (
            <RequestReview key={r.id} request={r} onDecided={onChange} />
          ))}
        </div>
      )}
    </section>
  );
}

function RequestReview({ request: r, onDecided }: { request: PendingRedemptionView; onDecided(): void }) {
  const { api } = useApp();
  const toast = useToast();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<null | 'Approved' | 'Denied'>(null);
  const [error, setError] = useState<string | null>(null);
  const shortFunds = r.amountCents > r.availableCents;
  const tooMuch = r.amountCents > r.remainingCents;

  async function decide(decision: 'Approved' | 'Denied') {
    setBusy(decision);
    setError(null);
    try {
      const trimmed = note.trim();
      await api.call('admin.decideRedemption', {
        id: r.id,
        decision,
        ...(trimmed ? { adminNote: trimmed.slice(0, 500) } : {}),
      });
      toast(
        decision === 'Approved'
          ? `Approved ${formatCents(r.amountCents)} for ${r.studentName}. The family has been notified.`
          : `Request denied. The family has been notified.`,
      );
      onDecided();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <article className="card review-card" aria-label={`Fund request from ${r.studentName}`}>
      <div className="row-between">
        <div>
          <h3 className="card-title">
            {r.studentName} <span className="muted">→</span> {r.activityName}
          </h3>
          <p className="muted small break">
            Requested by {r.email} · {formatDateTime(r.requestedAt)}
          </p>
        </div>
        <Money cents={r.amountCents} size="lg" />
      </div>
      <dl className="breakdown">
        <div>
          <dt>Available funds</dt>
          <dd>
            <Money cents={r.availableCents} />
          </dd>
        </div>
        <div>
          <dt>Left to pay on trip</dt>
          <dd>
            <Money cents={r.remainingCents} />
          </dd>
        </div>
      </dl>
      {r.note ? <p className="quote small">"{r.note}"</p> : null}
      {shortFunds || tooMuch ? (
        <p className="callout callout-warning small">
          <Icon name="alert" size={16} />
          <span>
            {shortFunds ? 'The request is more than the available funds. ' : ''}
            {tooMuch ? "The request is more than what's left on the trip." : ''}
          </span>
        </p>
      ) : null}
      <TextField
        label="Note to the family"
        optional
        value={note}
        maxLength={500}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Shown to the family with the decision"
      />
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="card-actions">
        <button type="button" className="btn btn-primary" onClick={() => decide('Approved')} disabled={busy !== null}>
          {busy === 'Approved' ? 'Approving…' : `Approve ${formatCents(r.amountCents)}`}
        </button>
        <button type="button" className="btn btn-secondary" onClick={() => decide('Denied')} disabled={busy !== null}>
          {busy === 'Denied' ? 'Denying…' : 'Deny'}
        </button>
      </div>
    </article>
  );
}

// ---------------------------------------------------------------------------
// New households
// ---------------------------------------------------------------------------

const NEW_STUDENT = 'new';

function PendingHouseholds({ households, onChange }: { households: PendingHousehold[]; onChange(): void }) {
  return (
    <section className="section" aria-labelledby="households-title">
      <h2 id="households-title" className="section-title">
        New households <span className="count">{households.length}</span>
      </h2>
      {households.length === 0 ? (
        <div className="card">
          <EmptyState icon="users" title="No sign-ups to review">
            New families who sign up in the app show up here.
          </EmptyState>
        </div>
      ) : (
        <div className="stack">
          {households.map((h) => (
            <HouseholdReview key={h.family.id} household={h} onDone={onChange} />
          ))}
        </div>
      )}
    </section>
  );
}

export function HouseholdReview({ household: h, onDone }: { household: PendingHousehold; onDone(): void }) {
  const { api } = useApp();
  const toast = useToast();
  const groupName = useId();
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<null | 'approve' | 'reject'>(null);
  const [confirmReject, setConfirmReject] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const names = h.family.guardians.map((g) => g.name).join(' & ');

  async function approve() {
    const unanswered = h.students.filter((s) => s.candidates.length > 0 && !choices[s.student.id]);
    if (unanswered.length > 0) {
      setError(`Choose "link" or "new student" for ${unanswered.map((s) => studentName(s.student)).join(', ')}.`);
      return;
    }
    const links = h.students
      .map((s) => ({ pendingStudentId: s.student.id, existingStudentId: choices[s.student.id] }))
      .filter((l): l is { pendingStudentId: string; existingStudentId: string } =>
        Boolean(l.existingStudentId) && l.existingStudentId !== NEW_STUDENT,
      );
    if (new Set(links.map((l) => l.existingStudentId)).size !== links.length) {
      setError('Each existing record can only be linked to one student.');
      return;
    }
    setBusy('approve');
    setError(null);
    try {
      await api.call('admin.reviewHousehold', {
        familyId: h.family.id,
        decision: 'approve',
        ...(links.length > 0 ? { links } : {}),
      });
      toast(`${names || 'Household'} verified. They've been notified.`);
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function reject() {
    setBusy('reject');
    setError(null);
    try {
      await api.call('admin.reviewHousehold', { familyId: h.family.id, decision: 'reject' });
      toast('Sign-up rejected.', 'info');
      setConfirmReject(false);
      onDone();
    } catch (err) {
      setConfirmReject(false);
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <article className="card review-card" aria-label={`Household ${names}`}>
      <div className="row-between">
        <h3 className="card-title">{names || h.family.id}</h3>
        <StatusChip status="Awaiting verification" />
      </div>
      <ul className="plain-list small">
        {h.family.guardians.map((g) => (
          <li key={g.email} className="break">
            {g.name} · {g.email}
            {g.phone ? ` · ${g.phone}` : ''}
          </li>
        ))}
        {h.family.createdAt ? <li className="muted">Signed up {formatDateTime(h.family.createdAt)}</li> : null}
      </ul>

      {h.students.length === 0 ? <p className="muted small">No students listed.</p> : null}
      {h.students.map(({ student, candidates }) => (
        <fieldset key={student.id} className="subcard match">
          <legend className="subhead">
            {studentName(student)}
            <span className="muted small">
              {' '}
              · {[gradeLabel(student.grade), student.school].filter(Boolean).join(' · ')}
            </span>
          </legend>
          {student.ensembles.length > 0 ? (
            <div className="chips">
              {student.ensembles.map((e) => (
                <Chip key={e} tone="brand">
                  {e}
                </Chip>
              ))}
            </div>
          ) : null}
          {candidates.length === 0 ? (
            <p className="muted small">No matching record in the sheet. Approving adds {student.firstName} as a new student.</p>
          ) : (
            <div className="radio-list">
              {candidates.map((c) => (
                <label key={c.studentId} className="radio-row">
                  <input
                    type="radio"
                    name={`${groupName}-${student.id}`}
                    value={c.studentId}
                    checked={choices[student.id] === c.studentId}
                    onChange={() => setChoices((m) => ({ ...m, [student.id]: c.studentId }))}
                  />
                  <span>
                    <span className="radio-title">Link to existing record: {c.name}</span>
                    <span className="muted small">
                      {[gradeLabel(c.grade), c.school, `${formatCents(c.balanceCents)} in funds`, `${Math.round(c.score * 100)}% match`]
                        .filter(Boolean)
                        .join(' · ')}
                      {c.familyId ? ` · already in household ${c.familyId}` : ''}
                    </span>
                  </span>
                </label>
              ))}
              <label className="radio-row">
                <input
                  type="radio"
                  name={`${groupName}-${student.id}`}
                  value={NEW_STUDENT}
                  checked={choices[student.id] === NEW_STUDENT}
                  onChange={() => setChoices((m) => ({ ...m, [student.id]: NEW_STUDENT }))}
                />
                <span>
                  <span className="radio-title">New student</span>
                  <span className="muted small">Not in TMA's records yet</span>
                </span>
              </label>
            </div>
          )}
        </fieldset>
      ))}

      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="card-actions">
        <button type="button" className="btn btn-primary" onClick={approve} disabled={busy !== null}>
          {busy === 'approve' ? 'Approving…' : 'Approve household'}
        </button>
        <button type="button" className="btn btn-secondary" onClick={() => setConfirmReject(true)} disabled={busy !== null}>
          Reject
        </button>
      </div>
      <ConfirmDialog
        open={confirmReject}
        title="Reject this sign-up?"
        message={<p>The household and its students will be marked inactive. They won't see any activity funds.</p>}
        confirmLabel="Reject sign-up"
        danger
        busy={busy === 'reject'}
        onConfirm={reject}
        onCancel={() => setConfirmReject(false)}
      />
    </article>
  );
}

// ---------------------------------------------------------------------------
// Announcements
// ---------------------------------------------------------------------------

const CHANNEL_LABELS: Record<NotificationChannel, string> = { push: 'Phone notification', email: 'Email', sms: 'Text message' };

function Compose({ settings, onSent }: { settings: PublicSettings; onSent(): void }) {
  const { api } = useApp();
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [link, setLink] = useState('');
  const [schools, setSchools] = useState<string[]>([]);
  const [ensembles, setEnsembles] = useState<string[]>([]);
  const [channels, setChannels] = useState<Record<NotificationChannel, boolean>>({ push: true, email: true, sms: false });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const audience = { schools, ensembles };
  const chosenChannels = (Object.keys(channels) as NotificationChannel[]).filter(
    (c) => channels[c] && (c !== 'sms' || settings.smsEnabled),
  );

  function review(e: FormEvent) {
    e.preventDefault();
    const found: Record<string, string> = {};
    if (!title.trim()) found.title = 'Add a title.';
    else if (title.trim().length > TITLE_MAX) found.title = `Keep the title under ${TITLE_MAX} characters.`;
    if (!body.trim()) found.body = 'Add a message.';
    else if (body.trim().length > BODY_MAX) found.body = `Keep the message under ${BODY_MAX} characters.`;
    if (link.trim() && !safeHref(link)) found.link = 'Links must start with https://';
    if (chosenChannels.length === 0) found.channels = 'Choose at least one way to send it.';
    setErrors(found);
    setSendError(null);
    if (Object.keys(found).length === 0) setConfirming(true);
  }

  async function send() {
    setBusy(true);
    setSendError(null);
    try {
      const res = await api.call('admin.announce', {
        title: title.trim(),
        body: body.trim(),
        audience,
        channels: { push: channels.push, email: channels.email, sms: settings.smsEnabled && channels.sms },
        ...(link.trim() ? { link: link.trim() } : {}),
      });
      const d = res.delivered;
      toast(`Announcement sent: ${d.push} push, ${d.email} email${settings.smsEnabled ? `, ${d.sms} text` : ''}.`);
      setTitle('');
      setBody('');
      setLink('');
      setSchools([]);
      setEnsembles([]);
      setConfirming(false);
      onSent();
    } catch (err) {
      setConfirming(false);
      setSendError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const previewBody = body.trim().length > PUSH_PREVIEW_CHARS ? `${body.trim().slice(0, PUSH_PREVIEW_CHARS)}…` : body.trim();

  return (
    <section className="section" aria-labelledby="compose-title">
      <h2 id="compose-title" className="section-title">
        Send an announcement
      </h2>
      <form className="card stack" onSubmit={review} noValidate>
        <TextField
          label="Title"
          value={title}
          maxLength={TITLE_MAX}
          onChange={(e) => setTitle(e.target.value)}
          error={errors.title}
          placeholder="e.g. Winter Concert volunteers needed"
        />
        <TextAreaField
          label="Message"
          value={body}
          rows={5}
          maxLength={BODY_MAX}
          onChange={(e) => setBody(e.target.value)}
          error={errors.body}
          hint={`${body.length}/${BODY_MAX}`}
        />
        <TextField
          label="Link"
          optional
          type="url"
          inputMode="url"
          autoCapitalize="none"
          value={link}
          onChange={(e) => setLink(e.target.value)}
          error={errors.link}
          placeholder="https://"
        />
        <CheckboxGroup
          legend="Who should get it?"
          hint="Leave all unchecked to send to everyone."
          options={settings.schools}
          selected={schools}
          onChange={setSchools}
          columns={1}
        />
        <CheckboxGroup legend="Groups" options={settings.ensembles} selected={ensembles} onChange={setEnsembles} />
        <fieldset className="fieldset">
          <legend className="field-label">Send by</legend>
          <p className="field-hint">Each family's own notification settings still apply.</p>
          {(['push', 'email', 'sms'] as NotificationChannel[])
            .filter((c) => c !== 'sms' || settings.smsEnabled)
            .map((c) => (
              <CheckboxField
                key={c}
                asSwitch
                label={CHANNEL_LABELS[c]}
                checked={channels[c]}
                onChange={(on) => setChannels((prev) => ({ ...prev, [c]: on }))}
              />
            ))}
          {errors.channels ? <p className="field-error">{errors.channels}</p> : null}
        </fieldset>

        {title.trim() || body.trim() ? (
          <div className="preview" aria-label="Preview">
            <p className="eyebrow">Preview</p>
            <div className="push-banner push-banner-static" aria-hidden="true">
              <img className="push-icon" src={`${import.meta.env.BASE_URL}icons/icon-192.png`} alt="" width={36} height={36} />
              <div className="push-content">
                <p className="push-app">TMA · now</p>
                <p className="push-title">{title.trim() || 'Title'}</p>
                <p className="push-body">{previewBody || 'Message'}</p>
              </div>
            </div>
            <div className="announcement preview-card">
              <h3 className="card-title">{title.trim() || 'Title'}</h3>
              <p className="preline small">{body.trim() || 'Message'}</p>
              <p className="muted small">For: {audienceSummary(audience)}</p>
            </div>
          </div>
        ) : null}

        {sendError ? (
          <p className="form-error" role="alert">
            {sendError}
          </p>
        ) : null}
        <button type="submit" className="btn btn-primary btn-block">
          Review & send
        </button>
      </form>
      <ConfirmDialog
        open={confirming}
        title="Send this announcement?"
        message={
          <p>
            <strong>{title.trim()}</strong> goes to <strong>{audienceSummary(audience)}</strong> by{' '}
            {chosenChannels.map((c) => CHANNEL_LABELS[c].toLowerCase()).join(' and ')}. This can't be undone.
          </p>
        }
        confirmLabel="Send now"
        busy={busy}
        onConfirm={send}
        onCancel={() => setConfirming(false)}
      />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Sync + log
// ---------------------------------------------------------------------------

export function TickReportView({ report }: { report: TickReport }) {
  const n = report.notifications;
  return (
    <div className="report" aria-label="Sync report">
      <dl className="breakdown">
        <div>
          <dt>Balance changes</dt>
          <dd>{report.balanceChanges}</dd>
        </div>
        <div>
          <dt>Approved requests posted</dt>
          <dd>{report.redemptionsPosted}</dd>
        </div>
        <div>
          <dt>Announcements sent</dt>
          <dd>{report.announcementsSent}</dd>
        </div>
        <div>
          <dt>Reminders sent</dt>
          <dd>{report.remindersSent}</dd>
        </div>
        <div>
          <dt>Notifications</dt>
          <dd>
            {n.push} push · {n.email} email · {n.sms} text
          </dd>
        </div>
      </dl>
      {report.errors.length > 0 ? (
        <ul className="callout callout-warning small report-errors">
          {report.errors.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      ) : null}
      <p className="muted small">Ran {formatDateTime(report.ranAt)}</p>
    </div>
  );
}

function SyncCard({ onDone }: { onDone(): void }) {
  const { api } = useApp();
  const toast = useToast();
  const [report, setReport] = useState<TickReport | null>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    try {
      const r = await api.call('admin.runSync', {});
      setReport(r);
      toast(r.errors.length ? 'Sync finished with problems.' : 'Sync finished.', r.errors.length ? 'error' : 'success');
      onDone();
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="section" aria-labelledby="sync-title">
      <h2 id="sync-title" className="section-title">
        Sync with the spreadsheet
      </h2>
      <div className="card">
        <p className="small">
          The app checks the sheet every 15 minutes: it posts approved requests, notices new credits and sends queued
          announcements. Run it now after editing the sheet.
        </p>
        <button type="button" className="btn btn-secondary btn-block" onClick={run} disabled={busy}>
          <Icon name="refresh" /> {busy ? 'Running…' : 'Run sync now'}
        </button>
        {report ? <TickReportView report={report} /> : null}
      </div>
    </section>
  );
}

function ActivityLog({ overview }: { overview: AdminOverview }) {
  const [all, setAll] = useState(false);
  const entries = all ? overview.recentLog : overview.recentLog.slice(0, LOG_SHOWN);
  return (
    <section className="section" aria-labelledby="log-title">
      <h2 id="log-title" className="section-title">
        Recent activity
      </h2>
      {overview.recentLog.length === 0 ? (
        <div className="card">
          <EmptyState icon="info" title="Nothing logged yet" />
        </div>
      ) : (
        <ul className="card list log">
          {entries.map((e, i) => (
            <li key={`${e.at}:${i}`} className="log-row">
              <span className="log-meta">
                <Chip>{e.kind}</Chip>
                <span className="muted small">{formatDateTime(e.at)}</span>
              </span>
              <span className="small break">{e.detail}</span>
            </li>
          ))}
        </ul>
      )}
      {overview.recentLog.length > LOG_SHOWN ? (
        <button type="button" className="btn btn-link" onClick={() => setAll((v) => !v)}>
          {all ? 'Show less' : `Show all ${plural(overview.recentLog.length, 'entry', 'entries')}`}
        </button>
      ) : null}
    </section>
  );
}
