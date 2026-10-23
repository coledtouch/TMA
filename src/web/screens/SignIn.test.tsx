// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/client';
import { ToastProvider } from '../hooks/toast';
import { enterDemo, exitDemo } from '../lib/mode';
import { fakeApi } from '../test/fixtures';
import { SignIn } from './SignIn';

vi.mock('../lib/mode', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/mode')>()),
  enterDemo: vi.fn(),
  exitDemo: vi.fn(),
}));

const API_URL = 'https://script.google.com/macros/s/abc/exec';

function renderSignIn(api: ReturnType<typeof fakeApi>) {
  const onSignedIn = vi.fn();
  render(
    <ToastProvider>
      <SignIn api={api} onSignedIn={onSignedIn} />
    </ToastProvider>,
  );
  return { onSignedIn, user: userEvent.setup() };
}

describe('SignIn', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('signs in with email then code, auto-filling the demo code', async () => {
    const api = fakeApi(
      {
        'auth.requestCode': () => ({ sent: true, devCode: '482913' }),
        'auth.verifyCode': () => ({ token: 'tok-1', expiresAt: '2027-01-01T00:00:00.000Z' }),
      },
      'demo',
      null,
    );
    const { onSignedIn, user } = renderSignIn(api);

    // The logo, with a lighter version for the dark theme.
    const logo = screen.getByRole('img', { name: 'Timberlane Music Association' });
    expect(logo.getAttribute('src')).toMatch(/brand\/tma-logo-light\.webp$/);
    expect(logo.previousElementSibling?.getAttribute('srcset')).toMatch(/brand\/tma-logo-dark\.webp$/);
    expect(logo.previousElementSibling?.getAttribute('media')).toBe('(prefers-color-scheme: dark)');
    await user.type(screen.getByLabelText('Email address'), '  Parent@Example.COM ');
    await user.click(screen.getByRole('button', { name: 'Email me a code' }));

    expect(api.call).toHaveBeenCalledWith('auth.requestCode', { email: 'parent@example.com' });
    const code = await screen.findByLabelText('6-digit code');
    expect(code).toHaveValue('482913');
    expect(code).toHaveFocus();
    expect(screen.getByText(/the code is filled in for you/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(api.call).toHaveBeenCalledWith('auth.verifyCode', { email: 'parent@example.com', code: '482913' });
    expect(onSignedIn).toHaveBeenCalledWith('parent@example.com', 'tok-1');
  });

  it('asks for the code by email in live mode and shows server errors', async () => {
    const api = fakeApi(
      {
        'auth.requestCode': () => ({ sent: true }),
        'auth.verifyCode': () => {
          throw new ApiError('UNAUTHORIZED', 'That code is not right. Check the email and try again.');
        },
      },
      'live',
      null,
    );
    const { onSignedIn, user } = renderSignIn(api);

    expect(screen.queryByText('Try as a parent')).not.toBeInTheDocument();
    expect(screen.getByText(/New to TMA\?/)).toBeInTheDocument();

    await user.type(screen.getByLabelText('Email address'), 'new.parent@example.com');
    await user.click(screen.getByRole('button', { name: 'Email me a code' }));
    const code = await screen.findByLabelText('6-digit code');
    expect(code).toHaveValue('');
    expect(screen.getByText('new.parent@example.com')).toBeInTheDocument();

    await user.type(code, '12ab34');
    expect(code).toHaveValue('1234');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(screen.getByText('Enter the 6-digit code from the email.')).toBeInTheDocument();
    expect(api.call).toHaveBeenCalledTimes(1);

    await user.type(code, '56');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    // Announced (screen readers), and focus is back on the field rather than lost with the busy button.
    expect(await screen.findByRole('alert')).toHaveTextContent(/That code is not right/);
    expect(code).toHaveFocus();
    expect(code).toHaveAccessibleDescription(/That code is not right/);
    expect(onSignedIn).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Use a different email' }));
    expect(screen.getByLabelText('Email address')).toBeInTheDocument();
  });

  it('validates the email before calling the server', async () => {
    const api = fakeApi({}, 'live', null);
    const { user } = renderSignIn(api);
    await user.type(screen.getByLabelText('Email address'), 'not-an-email');
    await user.click(screen.getByRole('button', { name: 'Email me a code' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/valid email address/);
    expect(screen.getByLabelText('Email address')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Email address')).toHaveFocus();
    expect(api.call).not.toHaveBeenCalled();
  });

  it('shows rate-limit messages from the server', async () => {
    const api = fakeApi(
      {
        'auth.requestCode': () => {
          throw new ApiError('RATE_LIMITED', 'Too many codes. Please wait an hour.');
        },
      },
      'live',
      null,
    );
    const { user } = renderSignIn(api);
    await user.type(screen.getByLabelText('Email address'), 'a@example.com');
    await user.click(screen.getByRole('button', { name: 'Email me a code' }));
    expect(await screen.findByText('Too many codes. Please wait an hour.')).toBeInTheDocument();
  });

  it('signs straight in with one tap in demo mode', async () => {
    const api = fakeApi(
      {
        'auth.requestCode': () => ({ sent: true, devCode: '111222' }),
        'auth.verifyCode': () => ({ token: 'tok-t', expiresAt: '2027-01-01T00:00:00.000Z' }),
      },
      'demo',
      null,
    );
    const { onSignedIn, user } = renderSignIn(api);
    await user.click(screen.getByRole('button', { name: 'Try as the treasurer' }));
    expect(api.call).toHaveBeenCalledWith('auth.requestCode', { email: 'treasurer@example.com' });
    expect(api.call).toHaveBeenCalledWith('auth.verifyCode', { email: 'treasurer@example.com', code: '111222' });
    expect(onSignedIn).toHaveBeenCalledWith('treasurer@example.com', 'tok-t');
  });

  it('uses a fresh example.com address for "Try as a new family"', async () => {
    const api = fakeApi(
      {
        'auth.requestCode': () => ({ sent: true, devCode: '111222' }),
        'auth.verifyCode': () => ({ token: 'tok-n', expiresAt: '2027-01-01T00:00:00.000Z' }),
      },
      'demo',
      null,
    );
    const { onSignedIn, user } = renderSignIn(api);
    await user.click(screen.getByRole('button', { name: 'Try as a new family' }));
    expect(onSignedIn).toHaveBeenCalledWith(expect.stringMatching(/^new\.family\d{4}@example\.com$/), 'tok-n');
  });

  it('offers the demo from the live sign-in screen', async () => {
    vi.stubEnv('VITE_API_URL', API_URL);
    const { user } = renderSignIn(fakeApi({}, 'live', null));
    expect(screen.queryByRole('button', { name: 'Exit demo' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'See a demo with sample data' }));
    expect(enterDemo).toHaveBeenCalledTimes(1);
  });

  it('lets a live build leave the demo', async () => {
    vi.stubEnv('VITE_API_URL', API_URL);
    const { user } = renderSignIn(fakeApi({}, 'demo', null));
    expect(screen.getByRole('button', { name: 'Try as a parent' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /See a demo/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Exit demo' }));
    expect(exitDemo).toHaveBeenCalledTimes(1);
  });

  it('has no way out of a demo-only build (there is no live app)', () => {
    vi.stubEnv('VITE_API_URL', '');
    renderSignIn(fakeApi({}, 'demo', null));
    expect(screen.getByRole('button', { name: 'Try as a parent' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Exit demo' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /See a demo/ })).not.toBeInTheDocument();
  });
});
