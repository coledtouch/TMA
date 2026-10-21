/**
 * Household sign-up and profile (ARCHITECTURE.md §5.2): parents/guardians and
 * students, with only the information TMA needs.
 */
import { useId, useState, type FormEvent } from 'react';
import { normalizeHeader } from '../../shared/schema';
import type { Bootstrap, HouseholdInput, RecordStatus } from '../../shared/types';
import { errorMessage } from '../api/client';
import { ConfirmDialog } from '../components/Dialog';
import { CheckboxGroup, SelectField, TextField } from '../components/Field';
import { Icon } from '../components/Icon';
import { EmptyState } from '../components/States';
import { StatusChip } from '../components/StatusChip';
import { useApp } from '../hooks/app-context';
import { useToast } from '../hooks/toast';
import { gradeLabel } from '../lib/format';
import { navigate } from '../lib/router';

export const GRADES = ['K', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'] as const;
export const MAX_STUDENTS = 8;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[0-9 ()+\-.]{7,20}$/;

interface GuardianForm {
  key: string;
  name: string;
  email: string;
  phone: string;
  emailLocked: boolean;
  removable: boolean;
}

interface StudentForm {
  key: string;
  id?: string;
  status?: RecordStatus;
  firstName: string;
  lastName: string;
  grade: string;
  school: string;
  ensembles: string[];
  instrument: string;
}

type Errors = Record<string, string>;

let keySeq = 0;
const newKey = (prefix: string) => `${prefix}-new-${++keySeq}`;

function blankStudent(lastName = ''): StudentForm {
  return { key: newKey('s'), firstName: '', lastName, grade: '', school: '', ensembles: [], instrument: '' };
}

function initialGuardians(data: Bootstrap): GuardianForm[] {
  const { me, family } = data;
  if (!family) {
    return [{ key: 'g-me', name: '', email: me.email, phone: '', emailLocked: true, removable: false }];
  }
  const callerIsFirst = family.guardians[0]?.email === me.email;
  return family.guardians.map((g, i) => ({
    key: `g-${i}`,
    name: g.name,
    email: g.email,
    phone: g.phone ?? '',
    // The first guardian stays; the caller's own email stays.
    emailLocked: i === 0 || g.email === me.email || !callerIsFirst,
    removable: i > 0 && g.email !== me.email && callerIsFirst,
  }));
}

/**
 * A student's groups as the form's checkboxes name them. The sheet keeps names
 * the treasurer typed that aren't on TMA's list (ARCHITECTURE.md §3), and a
 * group can be dropped from the list later; the form has no box for those, so
 * sending them would make every save fail ("choose groups from the list")
 * with nothing on screen to fix. The server keeps them on the student's row
 * (src/server/household.ts), so leaving them out here loses nothing.
 */
function knownEnsembles(ensembles: readonly string[], options: readonly string[]): string[] {
  const chosen = new Set(ensembles.map(normalizeHeader));
  return options.filter((o) => chosen.has(normalizeHeader(o)));
}

function initialStudents(data: Bootstrap): StudentForm[] {
  const existing = data.students.map(({ student: s }) => ({
    key: s.id,
    id: s.id,
    status: s.status,
    firstName: s.firstName,
    lastName: s.lastName,
    grade: s.grade,
    school: s.school,
    ensembles: knownEnsembles(s.ensembles, data.settings.ensembles),
    instrument: s.instrument ?? '',
  }));
  return existing.length > 0 || data.family ? existing : [blankStudent()];
}

function validate(guardians: GuardianForm[], students: StudentForm[], schools: string[]): Errors {
  const errors: Errors = {};
  guardians.forEach((g, i) => {
    const name = g.name.trim();
    if (!name) errors[`g${i}.name`] = 'Please enter a name.';
    else if (name.length > 80) errors[`g${i}.name`] = 'Please keep the name under 80 characters.';
    const email = g.email.trim().toLowerCase();
    if (!EMAIL_RE.test(email)) errors[`g${i}.email`] = 'Please enter a valid email address.';
    else if (i > 0 && email === guardians[0].email.trim().toLowerCase()) {
      errors[`g${i}.email`] = 'The second parent needs a different email address.';
    }
    const phone = g.phone.trim();
    if (phone && (!PHONE_RE.test(phone) || phone.replace(/\D/g, '').length < 7)) {
      errors[`g${i}.phone`] = 'Use a phone number like 603-555-0123.';
    }
  });
  students.forEach((s, i) => {
    if (!s.firstName.trim()) errors[`s${i}.firstName`] = 'Please enter a first name.';
    else if (s.firstName.trim().length > 40) errors[`s${i}.firstName`] = 'Please keep it under 40 characters.';
    if (!s.lastName.trim()) errors[`s${i}.lastName`] = 'Please enter a last name.';
    else if (s.lastName.trim().length > 40) errors[`s${i}.lastName`] = 'Please keep it under 40 characters.';
    if (!(GRADES as readonly string[]).includes(s.grade)) errors[`s${i}.grade`] = 'Choose a grade.';
    if (!schools.includes(s.school)) errors[`s${i}.school`] = 'Choose a school.';
  });
  return errors;
}

export function toHouseholdInput(guardians: GuardianForm[], students: StudentForm[]): HouseholdInput {
  return {
    guardians: guardians.map((g) => ({
      name: g.name.trim(),
      email: g.email.trim().toLowerCase(),
      phone: g.phone.trim(), // '' clears a stored phone
    })),
    students: students.map((s) => ({
      ...(s.id ? { id: s.id } : {}),
      firstName: s.firstName.trim(),
      lastName: s.lastName.trim(),
      grade: s.grade,
      school: s.school,
      ensembles: s.ensembles,
      instrument: s.instrument.trim(),
    })),
  };
}

export function Household() {
  const { data } = useApp();
  if (data.me.familyStatus === 'Inactive') {
    return (
      <div className="screen">
        <div className="screen-head">
          <h1 className="screen-title">Your household</h1>
        </div>
        <div className="card">
          <EmptyState icon="info" title="This household is inactive">
            Please contact TMA at <a href={`mailto:${data.settings.supportEmail}`}>{data.settings.supportEmail}</a>.
          </EmptyState>
        </div>
      </div>
    );
  }
  // A new form when the household changes (e.g. after leaving one), so it starts from the fresh data.
  return <HouseholdForm key={data.family?.id ?? 'none'} />;
}

function HouseholdForm() {
  const { api, data, replaceData } = useApp();
  const toast = useToast();
  const formId = useId();
  const { settings, me } = data;
  const isNew = data.family === null;
  const [guardians, setGuardians] = useState<GuardianForm[]>(() => initialGuardians(data));
  const [students, setStudents] = useState<StudentForm[]>(() => initialStudents(data));
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const callerIsFirst = isNew || data.family?.guardians[0]?.email === me.email;
  const canAddGuardian = guardians.length < 2 && callerIsFirst;
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [leaving, setLeaving] = useState(false);

  const setGuardian = (i: number, patch: Partial<GuardianForm>) =>
    setGuardians((list) => list.map((g, j) => (j === i ? { ...g, ...patch } : g)));
  const setStudent = (i: number, patch: Partial<StudentForm>) =>
    setStudents((list) => list.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  async function submit(e: FormEvent) {
    e.preventDefault();
    const found = validate(guardians, students, settings.schools);
    setErrors(found);
    setFormError(null);
    const firstBad = Object.keys(found)[0];
    if (firstBad) {
      document.querySelector<HTMLElement>(`[data-field="${firstBad}"] input, [data-field="${firstBad}"] select`)?.focus();
      return;
    }
    setBusy(true);
    try {
      const fresh = await api.call('household.save', toHouseholdInput(guardians, students));
      replaceData(fresh);
      if (isNew) {
        toast("Thanks! We'll let you know as soon as TMA verifies your household.");
        navigate('home');
      } else {
        const addedNew = students.some((s) => !s.id);
        toast(addedNew ? 'Saved. TMA will verify the new student soon.' : 'Household saved.');
        setStudents(initialStudents(fresh));
        setGuardians(initialGuardians(fresh));
      }
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  /**
   * Second guardian only: someone may have typed this email on their household without asking.
   * Taking it off lets this parent set up their own household (ARCHITECTURE.md §5.2).
   */
  async function leave() {
    setLeaving(true);
    setFormError(null);
    try {
      const fresh = await api.call('household.save', { guardians: [], students: [], leave: true });
      setConfirmLeave(false);
      replaceData(fresh);
      toast('Your email is no longer on that household. You can set up your own.');
      // The form starts over for their own household: show it from the top.
      try {
        window.scrollTo({ top: 0 });
      } catch {
        // jsdom / old browsers
      }
    } catch (err) {
      setConfirmLeave(false);
      setFormError(errorMessage(err));
    } finally {
      setLeaving(false);
    }
  }

  const fieldError = (key: string) => errors[key] ?? null;

  return (
    <div className="screen">
      <div className="screen-head">
        <h1 className="screen-title">{isNew ? 'Set up your household' : 'Your household'}</h1>
        <p className="screen-sub">
          {isNew
            ? 'Tell us who you are and which students are in TMA music groups.'
            : 'Keep your contact info and students up to date.'}
        </p>
      </div>

      <section className="callout callout-info" aria-label="Why we ask">
        <Icon name="lock" size={18} />
        <div>
          <p>
            <strong>Why we ask:</strong> TMA uses this to match your students to its records, so you can see their
            activity funds and get only the news you want.
          </p>
          <p className="small">{settings.privacyNote}</p>
        </div>
      </section>

      <form id={formId} onSubmit={submit} noValidate className="stack">
        <fieldset className="card fieldset-card">
          <legend className="card-title">Parents & guardians</legend>
          {guardians.map((g, i) => (
            <div key={g.key} className="subcard">
              <div className="row-between">
                <h3 className="subhead">{i === 0 ? 'Parent or guardian' : 'Second parent or guardian'}</h3>
                {g.removable ? (
                  <button
                    type="button"
                    className="btn btn-link btn-sm"
                    onClick={() => setGuardians((list) => list.filter((_, j) => j !== i))}
                  >
                    Remove
                  </button>
                ) : null}
              </div>
              <div data-field={`g${i}.name`}>
                <TextField
                  label="Full name"
                  autoComplete={g.email === me.email ? 'name' : 'off'}
                  value={g.name}
                  maxLength={80}
                  onChange={(e) => setGuardian(i, { name: e.target.value })}
                  error={fieldError(`g${i}.name`)}
                />
              </div>
              <div data-field={`g${i}.email`}>
                <TextField
                  label="Email"
                  type="email"
                  inputMode="email"
                  autoCapitalize="none"
                  spellCheck={false}
                  value={g.email}
                  readOnly={g.emailLocked}
                  onChange={(e) => setGuardian(i, { email: e.target.value })}
                  error={fieldError(`g${i}.email`)}
                  hint={
                    g.email === me.email
                      ? "You're signed in with this email."
                      : g.emailLocked
                        ? 'Contact TMA to change this email.'
                        : 'They can sign in with this email too.'
                  }
                />
              </div>
              <div data-field={`g${i}.phone`}>
                <TextField
                  label="Cell phone"
                  optional
                  type="tel"
                  inputMode="tel"
                  autoComplete={g.email === me.email ? 'tel' : 'off'}
                  value={g.phone}
                  maxLength={20}
                  onChange={(e) => setGuardian(i, { phone: e.target.value })}
                  error={fieldError(`g${i}.phone`)}
                  hint="Only used to reach you about your student's trips."
                />
              </div>
            </div>
          ))}
          {canAddGuardian ? (
            <button
              type="button"
              className="btn btn-secondary btn-block"
              onClick={() =>
                setGuardians((list) => [
                  ...list,
                  { key: newKey('g'), name: '', email: '', phone: '', emailLocked: false, removable: true },
                ])
              }
            >
              <Icon name="plus" /> Add a parent or guardian
            </button>
          ) : null}
        </fieldset>

        <fieldset className="card fieldset-card">
          <legend className="card-title">Students</legend>
          {students.length === 0 ? <p className="muted">No students yet. Add each student in a TMA music group.</p> : null}
          {students.map((s, i) => {
            const nameLocked = s.status === 'Active';
            return (
              <div key={s.key} className="subcard">
                <div className="row-between">
                  <h3 className="subhead">
                    {s.firstName.trim() ? `${s.firstName.trim()} ${s.lastName.trim()}` : `Student ${i + 1}`}
                  </h3>
                  {s.id ? (
                    <StatusChip status={s.status === 'Active' ? 'Verified' : 'Awaiting verification'} />
                  ) : (
                    <button
                      type="button"
                      className="btn btn-link btn-sm"
                      onClick={() => setStudents((list) => list.filter((_, j) => j !== i))}
                    >
                      Remove
                    </button>
                  )}
                </div>
                <div className="field-row">
                  <div data-field={`s${i}.firstName`}>
                    <TextField
                      label="First name"
                      autoComplete="off"
                      value={s.firstName}
                      maxLength={40}
                      readOnly={nameLocked}
                      onChange={(e) => setStudent(i, { firstName: e.target.value })}
                      error={fieldError(`s${i}.firstName`)}
                    />
                  </div>
                  <div data-field={`s${i}.lastName`}>
                    <TextField
                      label="Last name"
                      autoComplete="off"
                      value={s.lastName}
                      maxLength={40}
                      readOnly={nameLocked}
                      onChange={(e) => setStudent(i, { lastName: e.target.value })}
                      error={fieldError(`s${i}.lastName`)}
                    />
                  </div>
                </div>
                {nameLocked ? <p className="field-hint">To change a verified student's name, contact TMA.</p> : null}
                <div className="field-row field-row-wide">
                  <div data-field={`s${i}.grade`}>
                    <SelectField
                      label="Grade"
                      value={s.grade}
                      placeholder="Choose…"
                      onChange={(e) => setStudent(i, { grade: e.target.value })}
                      options={GRADES.map((g) => ({ value: g, label: gradeLabel(g) }))}
                      error={fieldError(`s${i}.grade`)}
                    />
                  </div>
                  <div data-field={`s${i}.school`}>
                    <SelectField
                      label="School"
                      value={settings.schools.includes(s.school) ? s.school : ''}
                      placeholder="Choose…"
                      onChange={(e) => setStudent(i, { school: e.target.value })}
                      options={settings.schools.map((x) => ({ value: x, label: x }))}
                      error={fieldError(`s${i}.school`)}
                    />
                  </div>
                </div>
                <CheckboxGroup
                  legend="Music groups"
                  hint="Check all that apply."
                  options={settings.ensembles}
                  selected={s.ensembles}
                  onChange={(ensembles) => setStudent(i, { ensembles })}
                />
                <TextField
                  label="Instrument"
                  optional
                  autoComplete="off"
                  value={s.instrument}
                  maxLength={40}
                  onChange={(e) => setStudent(i, { instrument: e.target.value })}
                  placeholder="e.g. trumpet, violin, voice"
                />
              </div>
            );
          })}
          {students.length < MAX_STUDENTS ? (
            <button
              type="button"
              className="btn btn-secondary btn-block"
              onClick={() => setStudents((list) => [...list, blankStudent(list[0]?.lastName ?? '')])}
            >
              <Icon name="plus" /> Add {students.length === 0 ? 'a' : 'another'} student
            </button>
          ) : null}
        </fieldset>

        {formError ? (
          <p className="form-error" role="alert">
            {formError}
          </p>
        ) : null}

        {Object.keys(errors).length > 0 ? (
          <p className="form-error" role="alert">
            Please fix the highlighted fields.
          </p>
        ) : null}

        <button type="submit" className="btn btn-primary btn-block btn-lg" disabled={busy}>
          {busy ? 'Saving…' : isNew ? 'Send to TMA for verification' : 'Save changes'}
        </button>
        {isNew ? (
          <p className="muted small center">
            A TMA board member reviews new households, usually within a few days.
          </p>
        ) : null}
      </form>

      {!callerIsFirst ? (
        <section className="card stack" aria-labelledby={`${formId}-leave`}>
          <h2 className="card-title" id={`${formId}-leave`}>
            Not your household?
          </h2>
          <p className="muted small">
            {data.family?.guardians[0]?.name || 'Another parent'} added your email to this household. If that's a
            mistake, take your email off it. You can then set up your own household.
          </p>
          <button type="button" className="btn btn-secondary btn-block" onClick={() => setConfirmLeave(true)} disabled={busy || leaving}>
            This isn't my household
          </button>
        </section>
      ) : null}
      <ConfirmDialog
        open={confirmLeave}
        title="Take your email off this household?"
        message={
          <p>
            You'll no longer see this household's students, funds or trips in the app. The household itself doesn't
            change. To join it again, ask {data.family?.guardians[0]?.name || 'the first parent'} to add your email.
          </p>
        }
        confirmLabel="Remove my email"
        danger
        busy={leaving}
        onConfirm={leave}
        onCancel={() => setConfirmLeave(false)}
      />
    </div>
  );
}
