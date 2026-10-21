// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { enablePush, getPushSupport } from '../lib/push';
import { fakeApi, makeBootstrap, makeStudent, TEST_PUSH_PUBLIC_KEY } from '../test/fixtures';
import { renderScreen } from '../test/render';
import { Home } from './Home';

vi.mock('../lib/push', () => ({
  getPushSupport: vi.fn(async () => 'unsupported'),
  enablePush: vi.fn(async () => ({ ok: true })),
  disablePush: vi.fn(async () => {}),
  isIos: () => false,
  isStandalone: () => false,
}));

vi.mock('../lib/install', () => ({
  useInstallPrompt: () => ({ canPrompt: false, installed: false, showIosHint: false, inAppBrowser: false, prompt: vi.fn() }),
}));

describe('Home', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(getPushSupport).mockResolvedValue('unsupported');
  });

  it('greets the parent and shows each student’s available funds', () => {
    renderScreen(<Home />, { api: fakeApi() });

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/Jordan$/);
    const avery = screen.getByRole('article', { name: 'Avery Thompson' });
    expect(within(avery).getByText('$640.00')).toBeInTheDocument();
    expect(within(avery).getByText('Grade 11 · High School')).toBeInTheDocument();
    expect(within(avery).getByText('Jazz Band')).toBeInTheDocument();
    expect(within(avery).getByRole('link', { name: 'Fund history' })).toHaveAttribute('href', '#/funds?student=S0001');

    const liam = screen.getByRole('article', { name: 'Liam Thompson' });
    expect(within(liam).getByText('$65.00')).toBeInTheDocument();
    expect(within(liam).getByText(/\$20\.00 waiting for approval/)).toBeInTheDocument();
  });

  it('lists what is coming up and the latest news', () => {
    renderScreen(<Home />, { api: fakeApi() });
    const coming = screen.getByRole('region', { name: 'Coming up' });
    expect(within(coming).getByText('Florida 2027 payment')).toBeInTheDocument();
    expect(within(coming).getByText(/Avery · \$1,300\.00 due/)).toBeInTheDocument();
    expect(within(coming).getByText('TMA monthly meeting')).toBeInTheDocument();
    expect(screen.getByText('Florida 2027 deposit reminder')).toBeInTheDocument();
  });

  it('explains verification while the household is pending', () => {
    const data = makeBootstrap({
      me: { email: 'ortiz@example.com', name: 'Marcus Ortiz', familyId: 'F0003', familyStatus: 'Pending', isAdmin: false },
      family: { id: 'F0003', guardians: [{ name: 'Marcus Ortiz', email: 'ortiz@example.com' }], status: 'Pending', member: false },
      students: [
        makeStudent({
          student: {
            id: 'S0006',
            familyId: 'F0003',
            firstName: 'Sofia',
            lastName: 'Ortiz',
            grade: '12',
            school: 'High School',
            ensembles: ['Chorus'],
            status: 'Pending',
          },
          verified: false,
          balanceCents: 0,
          pendingCents: 0,
          availableCents: 0,
          activities: [],
        }),
      ],
      ledger: [],
    });
    renderScreen(<Home />, { api: fakeApi(), data });

    expect(screen.getByRole('heading', { name: /TMA is verifying your household/ })).toBeInTheDocument();
    expect(screen.getByText('Sofia Ortiz')).toBeInTheDocument();
    expect(screen.getByText('Awaiting verification')).toBeInTheDocument();
    expect(screen.queryByText(/Available activity funds/)).not.toBeInTheDocument();
  });

  it('invites a new family to set up their household', () => {
    const data = makeBootstrap({
      me: { email: 'new@example.com', name: 'new', familyId: null, familyStatus: 'None', isAdmin: false },
      family: null,
      students: [],
      ledger: [],
    });
    renderScreen(<Home />, { api: fakeApi(), data });
    expect(screen.getByRole('link', { name: 'Set up your household' })).toHaveAttribute('href', '#/household');
  });

  it('shows the board tools shortcut to admins', () => {
    const base = makeBootstrap();
    renderScreen(<Home />, { api: fakeApi(), data: { ...base, me: { ...base.me, isAdmin: true } } });
    expect(screen.getByRole('link', { name: /Board tools/ })).toHaveAttribute('href', '#/admin');
  });

  it('turns on notifications from the nudge', async () => {
    vi.mocked(getPushSupport).mockResolvedValue('ready');
    const api = fakeApi();
    const harness = renderScreen(<Home />, { api });
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Turn on notifications' }));
    expect(getPushSupport).toHaveBeenCalledWith({ mode: 'live', publicKey: TEST_PUSH_PUBLIC_KEY });
    expect(enablePush).toHaveBeenCalledWith(api, TEST_PUSH_PUBLIC_KEY);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Turn on notifications' })).not.toBeInTheDocument());
    expect(screen.getByText(/Notifications are on/)).toBeInTheDocument();
    expect(harness.refresh).toHaveBeenCalledWith({ force: true });
  });

  it('remembers "Not now" on a nudge', async () => {
    vi.mocked(getPushSupport).mockResolvedValue('ready');
    renderScreen(<Home />, { api: fakeApi() });
    const user = userEvent.setup();
    await screen.findByRole('button', { name: 'Turn on notifications' });
    await user.click(screen.getByRole('button', { name: 'Not now' }));
    expect(screen.queryByRole('button', { name: 'Turn on notifications' })).not.toBeInTheDocument();
    expect(localStorage.getItem('tma.dismissed.push')).not.toBeNull();
    expect(localStorage.getItem('tma.demo.dismissed.push')).toBeNull();
  });

  it('keeps "Not now" in the demo separate from the live app', async () => {
    vi.mocked(getPushSupport).mockResolvedValue('ready');
    localStorage.setItem('tma.dismissed.push', '2026-10-01T00:00:00.000Z'); // dismissed in the live app
    renderScreen(<Home />, { api: fakeApi({}, 'demo') });
    const user = userEvent.setup();
    await screen.findByRole('button', { name: 'Turn on notifications' });
    await user.click(screen.getByRole('button', { name: 'Not now' }));
    expect(localStorage.getItem('tma.demo.dismissed.push')).not.toBeNull();
  });
});
