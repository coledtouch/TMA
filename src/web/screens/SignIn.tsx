/**
 * Passwordless sign-in: email → 6-digit code (ARCHITECTURE.md §4, §10).
 * New families sign in the same way and set up their household afterwards.
 *
 * Live builds also offer the demo ("See a demo with sample data"); while a
 * live build runs the demo, its banner has "Exit demo" (lib/mode.ts).
 */
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { errorMessage, type ApiClient } from '../api/client';
import { TextField } from '../components/Field';
import { Icon } from '../components/Icon';
import { useToast } from '../hooks/toast';
import { canExitDemo, enterDemo, exitDemo } from '../lib/mode';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const DEMO_ACCOUNTS = {
  parent: 'parent@example.com',
  treasurer: 'treasurer@example.com',
} as const;

function newFamilyEmail(): string {
  const n = Math.floor(1000 + Math.random() * 9000);
  return `new.family${n}@example.com`;
}

type Step = { kind: 'email' } | { kind: 'code'; email: string; devCode?: string };

export function SignIn({ api, onSignedIn }: { api: ApiClient; onSignedIn(email: string, token: string): void }) {
  const toast = useToast();
  const [step, setStep] = useState<Step>({ kind: 'email' });
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const codeRef = useRef<HTMLInputElement>(null);
  const demo = api.mode === 'demo';
  const exitable = canExitDemo(api.mode);

  useEffect(() => {
    if (step.kind === 'code') codeRef.current?.focus();
  }, [step]);

  async function requestCode(address: string): Promise<{ email: string; devCode?: string } | null> {
    const normalized = address.trim().toLowerCase();
    if (!EMAIL_RE.test(normalized)) {
      setError('Please enter a valid email address, like name@example.com.');
      return null;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api.call('auth.requestCode', { email: normalized });
      return { email: normalized, devCode: res.devCode };
    } catch (err) {
      setError(errorMessage(err));
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function verify(address: string, value: string): Promise<boolean> {
    const digits = value.replace(/\D/g, '');
    if (digits.length !== 6) {
      setError('Enter the 6-digit code from the email.');
      return false;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api.call('auth.verifyCode', { email: address, code: digits });
      onSignedIn(address, res.token);
      return true;
    } catch (err) {
      setError(errorMessage(err));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function onSubmitEmail(e: FormEvent) {
    e.preventDefault();
    const sent = await requestCode(email);
    if (!sent) return;
    setCode(sent.devCode ?? '');
    setStep({ kind: 'code', email: sent.email, devCode: sent.devCode });
  }

  async function onSubmitCode(e: FormEvent) {
    e.preventDefault();
    if (step.kind === 'code') await verify(step.email, code);
  }

  async function resend() {
    if (step.kind !== 'code') return;
    const sent = await requestCode(step.email);
    if (!sent) return;
    setCode(sent.devCode ?? '');
    setStep({ kind: 'code', email: sent.email, devCode: sent.devCode });
    toast(sent.devCode ? 'New demo code filled in.' : `We sent a new code to ${sent.email}.`, 'info');
  }

  /** Demo shortcut: request a code and sign straight in with the returned devCode. */
  async function tryAs(address: string) {
    setEmail(address);
    const sent = await requestCode(address);
    if (!sent) return;
    if (sent.devCode) {
      setCode(sent.devCode);
      const ok = await verify(sent.email, sent.devCode);
      if (ok) return;
    }
    setStep({ kind: 'code', email: sent.email, devCode: sent.devCode });
  }

  return (
    <div className="signin">
      <div className="signin-inner">
        <div className="signin-logo">
          <img
            src={`${import.meta.env.BASE_URL}brand/tma-banner.jpg`}
            alt="Timberlane Music Association"
            width={1024}
            height={267}
          />
        </div>

        {demo ? (
          <section className="card demo-banner" aria-labelledby="demo-title">
            <p className="eyebrow">
              <Icon name="sparkle" size={16} /> Demo
            </p>
            <h2 id="demo-title" className="card-title">
              Try the TMA app
            </h2>
            <p className="muted">
              This is a working preview with made-up families. Nothing here is real, and no emails or payments
              are sent.
            </p>
            <div className="demo-buttons">
              <button type="button" className="btn btn-primary btn-block" disabled={busy} onClick={() => tryAs(DEMO_ACCOUNTS.parent)}>
                Try as a parent
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-block"
                disabled={busy}
                onClick={() => tryAs(DEMO_ACCOUNTS.treasurer)}
              >
                Try as the treasurer
              </button>
              <button type="button" className="btn btn-secondary btn-block" disabled={busy} onClick={() => tryAs(newFamilyEmail())}>
                Try as a new family
              </button>
            </div>
            {exitable ? (
              <button type="button" className="btn btn-link demo-exit" disabled={busy} onClick={() => exitDemo()}>
                Exit demo
              </button>
            ) : null}
          </section>
        ) : null}

        <section className="card signin-card" aria-labelledby="signin-title">
          {step.kind === 'email' ? (
            <form onSubmit={onSubmitEmail} noValidate>
              <h1 id="signin-title" className="signin-title">
                Sign in with your email
              </h1>
              <p className="muted">We'll email you a 6-digit code. No password to remember.</p>
              <TextField
                label="Email address"
                type="email"
                name="email"
                autoComplete="email"
                inputMode="email"
                autoCapitalize="none"
                spellCheck={false}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                error={error}
                required
              />
              <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
                {busy ? 'Sending…' : 'Email me a code'}
              </button>
              <p className="signin-note">
                <Icon name="info" size={16} />
                <span>
                  <strong>New to TMA?</strong> Sign in with any email you like. You'll set up your household
                  next, and TMA will connect your students' activity funds.
                </span>
              </p>
            </form>
          ) : (
            <form onSubmit={onSubmitCode} noValidate>
              <h1 id="signin-title" className="signin-title">
                Check your email
              </h1>
              <p className="muted">
                We sent a 6-digit code to <strong className="break">{step.email}</strong>. It works for 10 minutes.
              </p>
              {step.devCode ? (
                <p className="callout callout-info">Demo: the code is filled in for you.</p>
              ) : null}
              <TextField
                ref={codeRef}
                label="6-digit code"
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]*"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                error={error}
                className="code-field"
                required
              />
              <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
                {busy ? 'Signing in…' : 'Sign in'}
              </button>
              <div className="signin-links">
                <button type="button" className="btn btn-link" onClick={resend} disabled={busy}>
                  Send a new code
                </button>
                <button
                  type="button"
                  className="btn btn-link"
                  disabled={busy}
                  onClick={() => {
                    setStep({ kind: 'email' });
                    setCode('');
                    setError(null);
                  }}
                >
                  Use a different email
                </button>
              </div>
              <p className="signin-note">
                <Icon name="mail" size={16} />
                <span>Can't find it? Check your spam or promotions folder.</span>
              </p>
            </form>
          )}
        </section>

        {!demo ? (
          <button type="button" className="btn btn-link signin-demo-link" disabled={busy} onClick={() => enterDemo()}>
            <Icon name="sparkle" size={16} /> See a demo with sample data
          </button>
        ) : null}
      </div>
    </div>
  );
}
