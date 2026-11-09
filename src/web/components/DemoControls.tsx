/**
 * Demo-only card: simulate the treasurer posting a fundraiser credit (which
 * triggers the balance notification), run the daily reminders, see what the
 * demo "sent", and reset the sample data.
 */
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { DemoControls as DemoControlsApi, DemoOutboxItem } from '../../demo';
import { parseAmountInput } from '../../shared/money';
import type { TickReport } from '../../shared/types';
import { errorMessage, getDemoControls } from '../api/client';
import { useApp } from '../hooks/app-context';
import { useToast } from '../hooks/toast';
import { formatCents, formatDateTime, studentName } from '../lib/format';
import { ConfirmDialog } from './Dialog';
import { SelectField, TextField } from './Field';
import { Icon } from './Icon';
import { Chip } from './StatusChip';

const OTHER = '__other__';
const MAX_CREDIT_CENTS = 1_000_000;
const OUTBOX_SHOWN = 8;

function reportSummary(r: TickReport): string {
  const n = r.notifications;
  const sent = `${n.push} push, ${n.email} email${n.sms ? `, ${n.sms} text` : ''}`;
  return r.errors.length ? `${sent}. Problems: ${r.errors.join('; ')}` : `${sent} sent.`;
}

export function DemoControls() {
  const { api, data, refresh } = useApp();
  const toast = useToast();
  const [demo, setDemo] = useState<DemoControlsApi | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [outbox, setOutbox] = useState<DemoOutboxItem[]>([]);
  const students = data.students.filter((s) => s.verified);
  const [studentId, setStudentId] = useState(students[0]?.student.id ?? OTHER);
  const [otherId, setOtherId] = useState('S0001');
  const [amount, setAmount] = useState('50.00');
  const [description, setDescription] = useState('Pizza Night fundraiser');
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | 'credit' | 'daily' | 'reset'>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  const reloadOutbox = useCallback((d: DemoControlsApi | null) => {
    try {
      setOutbox(d ? d.outbox() : []);
    } catch {
      setOutbox([]);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    getDemoControls(api)
      .then((d) => {
        if (!alive) return;
        setDemo(d);
        reloadOutbox(d);
      })
      .catch((err) => alive && setLoadError(errorMessage(err)));
    return () => {
      alive = false;
    };
  }, [api, reloadOutbox]);

  if (api.mode !== 'demo') return null;

  async function addCredit(e: FormEvent) {
    e.preventDefault();
    if (!demo) return;
    const id = (studentId === OTHER ? otherId : studentId).trim();
    const cents = parseAmountInput(amount);
    const desc = description.trim();
    if (!id) return setFormError('Choose a student.');
    if (cents === null || cents <= 0 || cents > MAX_CREDIT_CENTS) return setFormError('Enter an amount like 50 or 25.50.');
    if (!desc) return setFormError('Add a short description, like "Pizza Night fundraiser".');
    setFormError(null);
    setBusy('credit');
    try {
      const report = await demo.addCredit(id, cents, desc.slice(0, 80));
      toast(`Added ${formatCents(cents)} (${desc}). ${reportSummary(report)}`);
      reloadOutbox(demo);
      void refresh({ force: true });
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function runDaily() {
    if (!demo) return;
    setBusy('daily');
    try {
      const report = await demo.runDaily();
      toast(`Daily reminders: ${report.remindersSent} sent. ${reportSummary(report)}`, 'info');
      reloadOutbox(demo);
      void refresh({ force: true });
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(null);
    }
  }

  async function reset() {
    if (!demo) return;
    setBusy('reset');
    try {
      demo.reset();
      reloadOutbox(demo);
      setConfirmReset(false);
      toast('Demo data restored.', 'info');
      await refresh({ force: true });
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="card demo-card" aria-labelledby="demo-controls-title">
      <p className="eyebrow">
        <Icon name="sparkle" size={16} /> Demo only
      </p>
      <h2 id="demo-controls-title" className="card-title">
        Demo controls
      </h2>
      <p className="muted small">
        Pretend to be the treasurer: post a fundraiser credit and watch the notification arrive.
      </p>
      {loadError ? (
        <p className="form-error" role="alert">
          {loadError}
        </p>
      ) : null}

      <form onSubmit={addCredit} noValidate className="demo-form">
        <SelectField
          label="Student"
          value={studentId}
          onChange={(e) => setStudentId(e.target.value)}
          options={[
            ...students.map((s) => ({ value: s.student.id, label: studentName(s.student) })),
            { value: OTHER, label: 'Another student (enter ID)' },
          ]}
        />
        {studentId === OTHER ? (
          <TextField
            label="Student ID"
            hint="Sample students are S0001–S0005."
            value={otherId}
            onChange={(e) => setOtherId(e.target.value)}
            autoCapitalize="characters"
          />
        ) : null}
        <div className="field-row">
          <TextField
            label="Amount"
            prefix="$"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="field-narrow"
          />
          <TextField
            label="Description"
            value={description}
            maxLength={80}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        {formError ? (
          <p className="form-error" role="alert">
            {formError}
          </p>
        ) : null}
        <button type="submit" className="btn btn-primary btn-block" disabled={!demo || busy !== null}>
          {busy === 'credit' ? 'Posting…' : 'Add credit & notify'}
        </button>
      </form>

      <div className="card-actions">
        <button type="button" className="btn btn-secondary btn-sm" onClick={runDaily} disabled={!demo || busy !== null}>
          {busy === 'daily' ? 'Running…' : 'Run daily reminders'}
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => setConfirmReset(true)}
          disabled={!demo || busy !== null}
        >
          Reset demo data
        </button>
      </div>

      <h3 className="subhead">What the demo sent</h3>
      {outbox.length === 0 ? (
        <p className="muted small">Nothing yet. Notifications, emails and texts the demo "sends" show up here.</p>
      ) : (
        <ul className="plain-list outbox" aria-label="Demo outbox">
          {outbox.slice(0, OUTBOX_SHOWN).map((item, i) => (
            <li key={`${item.at}:${i}`} className="outbox-item">
              <div className="row-between">
                <Chip tone={item.channel === 'push' ? 'brand' : 'info'}>
                  {item.channel === 'push' ? 'Push' : item.channel === 'email' ? 'Email' : 'Text'}
                </Chip>
                <span className="muted small">{formatDateTime(item.at)}</span>
              </div>
              <p className="outbox-title">{item.title}</p>
              <p className="small">{item.body}</p>
              <p className="muted small break">To {item.to}</p>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={confirmReset}
        title="Reset the demo?"
        message={<p>All demo changes (requests, payments, sign-ups, credits) are replaced with the original sample data.</p>}
        confirmLabel="Reset demo"
        danger
        busy={busy === 'reset'}
        onConfirm={reset}
        onCancel={() => setConfirmReset(false)}
      />
    </section>
  );
}
