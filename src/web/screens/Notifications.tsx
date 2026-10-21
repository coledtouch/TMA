/**
 * Notifications: turn on push for this device (with the iOS Home Screen
 * steps), and choose channels, topics and which schools/groups to hear about.
 */
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import type { NotificationChannel, NotificationPrefs, NotificationTopic } from '../../shared/types';
import { errorMessage } from '../api/client';
import { CheckboxField, CheckboxGroup, TextField } from '../components/Field';
import { Icon } from '../components/Icon';
import { Spinner } from '../components/States';
import { useApp } from '../hooks/app-context';
import { useToast } from '../hooks/toast';
import { plural } from '../lib/format';
import { disablePush, enablePush, getPushSupport, isIos, type PushSupport } from '../lib/push';

export const TOPIC_COPY: Record<NotificationTopic, { label: string; description: string }> = {
  balance: {
    label: 'Activity fund changes',
    description: "When money is added to (or used from) your students' activity funds",
  },
  payments: { label: 'Payments & fund requests', description: 'Payment receipts and approval decisions' },
  reminders: { label: 'Payment reminders', description: 'A heads-up before deposits and final payments are due' },
  announcements: { label: 'News & events', description: 'Announcements and event reminders from TMA' },
};

const TOPICS: NotificationTopic[] = ['balance', 'payments', 'reminders', 'announcements'];

function clonePrefs(p: NotificationPrefs): NotificationPrefs {
  return {
    channels: { ...p.channels },
    topics: { ...p.topics },
    schools: p.schools.slice(),
    ensembles: p.ensembles.slice(),
    ...(p.smsPhone ? { smsPhone: p.smsPhone } : {}),
  };
}

export function Notifications() {
  const { api, data, patchData, refresh } = useApp();
  const toast = useToast();
  const { settings } = data;
  const [prefs, setPrefs] = useState<NotificationPrefs>(() => clonePrefs(data.prefs));
  const [phone, setPhone] = useState(data.prefs.smsPhone ?? '');
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const setChannel = (c: NotificationChannel, on: boolean) =>
    setPrefs((p) => ({ ...p, channels: { ...p.channels, [c]: on } }));
  const setTopic = (t: NotificationTopic, on: boolean) => setPrefs((p) => ({ ...p, topics: { ...p.topics, [t]: on } }));

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaveError(null);
    const digits = phone.replace(/\D/g, '');
    if (settings.smsEnabled && prefs.channels.sms && (digits.length < 10 || digits.length > 15)) {
      setPhoneError('Enter your cell number with area code, like 603-555-0123.');
      return;
    }
    setPhoneError(null);
    const payload: NotificationPrefs = {
      channels: { ...prefs.channels },
      topics: { ...prefs.topics },
      schools: prefs.schools,
      ensembles: prefs.ensembles,
    };
    // '' clears a stored number; leaving it out keeps the stored one (when texts are off for TMA).
    if (settings.smsEnabled) payload.smsPhone = digits;
    setSaving(true);
    try {
      const res = await api.call('prefs.save', { prefs: payload });
      patchData((b) => ({ ...b, prefs: res.prefs }));
      setPrefs(clonePrefs(res.prefs));
      setPhone(res.prefs.smsPhone ?? '');
      toast('Notification settings saved.');
      void refresh({ force: true });
    } catch (err) {
      setSaveError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="screen">
      <div className="screen-head">
        <h1 className="screen-title">Notifications</h1>
        <p className="screen-sub">Choose what you hear about and how.</p>
      </div>

      <PushSection />

      <form onSubmit={save} noValidate className="stack">
        <fieldset className="card fieldset-card">
          <legend className="card-title">How to reach you</legend>
          <CheckboxField
            asSwitch
            label="Phone notifications"
            description={`On devices where you've turned them on${data.pushTokens > 0 ? ` (${plural(data.pushTokens, 'device')})` : ''}`}
            checked={prefs.channels.push}
            onChange={(on) => setChannel('push', on)}
          />
          <CheckboxField
            asSwitch
            label="Email"
            description={data.me.email}
            checked={prefs.channels.email}
            onChange={(on) => setChannel('email', on)}
          />
          {settings.smsEnabled ? (
            <>
              <CheckboxField
                asSwitch
                label="Text messages"
                description="For important reminders. Message and data rates may apply."
                checked={prefs.channels.sms}
                onChange={(on) => setChannel('sms', on)}
              />
              {prefs.channels.sms ? (
                <TextField
                  label="Cell number for texts"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  error={phoneError}
                  maxLength={20}
                />
              ) : null}
            </>
          ) : null}
        </fieldset>

        <fieldset className="card fieldset-card">
          <legend className="card-title">What to tell you about</legend>
          {TOPICS.map((t) => (
            <CheckboxField
              key={t}
              asSwitch
              label={TOPIC_COPY[t].label}
              description={TOPIC_COPY[t].description}
              checked={prefs.topics[t]}
              onChange={(on) => setTopic(t, on)}
            />
          ))}
        </fieldset>

        <section className="card fieldset-card" aria-labelledby="interests-title">
          <h2 id="interests-title" className="card-title">
            News for these schools and groups
          </h2>
          <p className="field-hint">Leave all unchecked to get everything.</p>
          <CheckboxGroup
            legend="Schools"
            options={settings.schools}
            selected={prefs.schools}
            onChange={(schools) => setPrefs((p) => ({ ...p, schools }))}
            columns={1}
          />
          <CheckboxGroup
            legend="Groups"
            options={settings.ensembles}
            selected={prefs.ensembles}
            onChange={(ensembles) => setPrefs((p) => ({ ...p, ensembles }))}
          />
        </section>

        {saveError ? (
          <p className="form-error" role="alert">
            {saveError}
          </p>
        ) : null}
        <button type="submit" className="btn btn-primary btn-block btn-lg" disabled={saving}>
          {saving ? 'Saving…' : 'Save notification settings'}
        </button>
      </form>
    </div>
  );
}

function PushSection() {
  const { api, data, refresh } = useApp();
  const toast = useToast();
  const [support, setSupport] = useState<PushSupport | null>(null);
  const [busy, setBusy] = useState<null | 'enable' | 'disable' | 'test'>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const publicKey = data.settings.pushPublicKey ?? '';

  const check = async () => {
    try {
      setSupport(await getPushSupport({ mode: api.mode, publicKey }));
    } catch {
      setSupport('unsupported');
    }
  };

  useEffect(() => {
    let alive = true;
    getPushSupport({ mode: api.mode, publicKey })
      .then((s) => alive && setSupport(s))
      .catch(() => alive && setSupport('unsupported'));
    return () => {
      alive = false;
    };
  }, [api.mode, publicKey]);

  async function enable() {
    setBusy('enable');
    setProblem(null);
    try {
      const res = await enablePush(api, publicKey);
      if (res.ok) {
        toast("Notifications are on. We'll keep you posted.");
        void refresh({ force: true });
      } else {
        setProblem(res.reason);
      }
    } catch (err) {
      setProblem(errorMessage(err));
    } finally {
      await check();
      setBusy(null);
    }
  }

  async function disable() {
    setBusy('disable');
    setProblem(null);
    try {
      await disablePush(api);
      toast('Notifications are off for this device.', 'info');
      void refresh({ force: true });
    } catch (err) {
      setProblem(errorMessage(err));
    } finally {
      await check();
      setBusy(null);
    }
  }

  async function test() {
    setBusy('test');
    try {
      const counts = await api.call('push.test', {});
      if (counts.push > 0) toast(`Test sent to ${plural(counts.push, 'device')}. It should arrive in a few seconds.`);
      else toast('No devices got the test. Try turning notifications off and on again.', 'error');
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(null);
    }
  }

  let body: ReactNode;
  switch (support) {
    case null:
      body = (
        <p className="muted">
          <Spinner /> Checking this device…
        </p>
      );
      break;
    case 'enabled':
      body = (
        <>
          <p className="push-state push-state-on">
            <Icon name="check" /> Notifications are on for this device.
          </p>
          <div className="card-actions">
            <button type="button" className="btn btn-primary" onClick={test} disabled={busy !== null}>
              {busy === 'test' ? 'Sending…' : 'Send a test notification'}
            </button>
            <button type="button" className="btn btn-secondary" onClick={disable} disabled={busy !== null}>
              {busy === 'disable' ? 'Turning off…' : 'Turn off on this device'}
            </button>
          </div>
        </>
      );
      break;
    case 'ready':
      body = (
        <>
          <p>We'll send a notification when funds are added, a payment comes in, or something is due.</p>
          <button type="button" className="btn btn-primary btn-block" onClick={enable} disabled={busy !== null}>
            {busy === 'enable' ? 'Turning on…' : 'Turn on notifications'}
          </button>
          <p className="muted small">Your phone will ask for permission. Tap Allow.</p>
        </>
      );
      break;
    case 'needs-install':
      body = (
        <>
          <p>
            On iPhone and iPad, Apple only allows notifications from apps on your Home Screen (iOS 16.4 or later). It
            takes a few seconds:
          </p>
          <ol className="steps">
            <li>
              Tap the <strong>Share</strong> button <Icon name="share" size={16} /> at the bottom of
              Safari.
            </li>
            <li>
              Scroll down and tap <strong>Add to Home Screen</strong>{' '}
              <Icon name="addSquare" size={16} />.
            </li>
            <li>
              Open <strong>TMA</strong> from your Home Screen and sign in.
            </li>
            <li>
              Come back to <strong>More → Notifications</strong> and tap <strong>Turn on notifications</strong>.
            </li>
          </ol>
        </>
      );
      break;
    case 'blocked':
      body = (
        <>
          <p className="push-state push-state-off">
            <Icon name="alert" /> Notifications are blocked for this app.
          </p>
          <p className="small">
            {isIos()
              ? 'To turn them on: open the Settings app → Notifications → TMA → Allow Notifications. Then come back here.'
              : "To turn them on: open your browser's settings for this site (often the lock or info icon next to the address), allow notifications, then come back here."}
          </p>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void check()}>
            <Icon name="refresh" /> Check again
          </button>
        </>
      );
      break;
    case 'unsupported':
      body = (
        <p className="small">
          This browser can't show notifications. Try Chrome, Edge, Firefox, or Safari on a Mac. On iPhone, add TMA to
          your Home Screen first. You can still get updates by email below.
        </p>
      );
      break;
    case 'not-configured':
      body = (
        <p className="small">
          Phone notifications aren't set up for TMA yet. You can still get updates by email below.
        </p>
      );
      break;
  }

  return (
    <section className="card" aria-labelledby="push-title" aria-busy={support === null}>
      <h2 id="push-title" className="card-title">
        <Icon name="bell" /> Notifications on this device
      </h2>
      {body}
      {problem ? (
        <p className="form-error" role="alert">
          {problem}
        </p>
      ) : null}
    </section>
  );
}
