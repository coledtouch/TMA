// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NotificationPrefs } from '../../shared/types';
import { disablePush, enablePush, getPushSupport } from '../lib/push';
import { fakeApi, makeBootstrap, makeSettings } from '../test/fixtures';
import { renderScreen } from '../test/render';
import { Notifications } from './Notifications';

vi.mock('../lib/push', () => ({
  getPushSupport: vi.fn(async () => 'ready'),
  enablePush: vi.fn(async () => ({ ok: true })),
  disablePush: vi.fn(async () => {}),
  isIos: vi.fn(() => false),
  isStandalone: vi.fn(() => false),
}));

const echoPrefs = { 'prefs.save': (p: { prefs: NotificationPrefs }) => ({ prefs: p.prefs }) };

describe('Notifications', () => {
  beforeEach(() => {
    vi.mocked(getPushSupport).mockResolvedValue('ready');
    vi.mocked(enablePush).mockResolvedValue({ ok: true });
  });

  it('turns on push for this device', async () => {
    const api = fakeApi();
    const harness = renderScreen(<Notifications />, { api });
    const user = userEvent.setup();

    const button = await screen.findByRole('button', { name: 'Turn on notifications' });
    vi.mocked(getPushSupport).mockResolvedValue('enabled');
    await user.click(button);

    expect(enablePush).toHaveBeenCalledWith(api);
    expect(await screen.findByText('Notifications are on for this device.')).toBeInTheDocument();
    expect(harness.refresh).toHaveBeenCalledWith({ force: true });
    expect(screen.getByRole('button', { name: 'Send a test notification' })).toBeInTheDocument();
  });

  it('shows why push could not be turned on', async () => {
    vi.mocked(enablePush).mockResolvedValue({ ok: false, reason: 'Notifications are blocked for this site.' });
    renderScreen(<Notifications />, { api: fakeApi() });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Turn on notifications' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Notifications are blocked for this site.');
  });

  it('sends a test notification and can turn push off', async () => {
    vi.mocked(getPushSupport).mockResolvedValue('enabled');
    const api = fakeApi({ 'push.test': () => ({ push: 2, email: 0, sms: 0 }) });
    renderScreen(<Notifications />, { api });
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Send a test notification' }));
    expect(api.call).toHaveBeenCalledWith('push.test', {});
    expect(await screen.findByText(/Test sent to 2 devices/)).toBeInTheDocument();

    vi.mocked(getPushSupport).mockResolvedValue('ready');
    await user.click(screen.getByRole('button', { name: 'Turn off on this device' }));
    expect(disablePush).toHaveBeenCalledWith(api);
    expect(await screen.findByRole('button', { name: 'Turn on notifications' })).toBeInTheDocument();
  });

  it('walks iPhone users through Add to Home Screen first', async () => {
    vi.mocked(getPushSupport).mockResolvedValue('needs-install');
    renderScreen(<Notifications />, { api: fakeApi() });
    const steps = await screen.findByRole('list');
    expect(within(steps).getByText(/Add to Home Screen/)).toBeInTheDocument();
    expect(within(steps).getByText(/from your Home Screen/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Turn on notifications' })).not.toBeInTheDocument();
  });

  it('explains blocked and unconfigured states', async () => {
    vi.mocked(getPushSupport).mockResolvedValue('blocked');
    const { unmount } = renderScreen(<Notifications />, { api: fakeApi() });
    expect(await screen.findByText('Notifications are blocked for this app.')).toBeInTheDocument();
    unmount();

    vi.mocked(getPushSupport).mockResolvedValue('not-configured');
    renderScreen(<Notifications />, { api: fakeApi() });
    expect(await screen.findByText(/aren't set up for TMA yet/)).toBeInTheDocument();
  });

  it('saves channel, topic and interest choices', async () => {
    const api = fakeApi(echoPrefs);
    const harness = renderScreen(<Notifications />, { api });
    const user = userEvent.setup();

    expect(screen.getByText('Leave all unchecked to get everything.')).toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: 'Text messages' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('switch', { name: 'Email' }));
    await user.click(screen.getByRole('switch', { name: 'Payment reminders' }));
    await user.click(screen.getByRole('checkbox', { name: 'High School' }));
    await user.click(screen.getByRole('checkbox', { name: 'Band' }));
    await user.click(screen.getByRole('checkbox', { name: 'Chorus' }));
    await user.click(screen.getByRole('button', { name: 'Save notification settings' }));

    expect(api.call).toHaveBeenCalledWith('prefs.save', {
      prefs: {
        channels: { push: true, email: false, sms: false },
        topics: { balance: true, payments: true, reminders: false, announcements: true },
        schools: ['High School'],
        ensembles: ['Band', 'Chorus'],
      },
    });
    expect(await screen.findByText('Notification settings saved.')).toBeInTheDocument();
    expect(harness.data().prefs.ensembles).toEqual(['Band', 'Chorus']);
    expect(harness.refresh).toHaveBeenCalledWith({ force: true });
  });

  it('asks for a cell number when texts are on and TMA has SMS', async () => {
    const data = makeBootstrap({ settings: makeSettings({ smsEnabled: true }) });
    const api = fakeApi(echoPrefs);
    renderScreen(<Notifications />, { api, data });
    const user = userEvent.setup();

    await user.click(screen.getByRole('switch', { name: 'Text messages' }));
    const phone = screen.getByLabelText('Cell number for texts');
    await user.type(phone, '555-0101');
    await user.click(screen.getByRole('button', { name: 'Save notification settings' }));
    expect(screen.getByText(/with area code/)).toBeInTheDocument();
    expect(api.call).not.toHaveBeenCalled();

    await user.clear(phone);
    await user.type(phone, '(603) 555-0101');
    await user.click(screen.getByRole('button', { name: 'Save notification settings' }));
    await waitFor(() =>
      expect(api.call).toHaveBeenCalledWith('prefs.save', {
        prefs: expect.objectContaining({
          channels: { push: true, email: true, sms: true },
          smsPhone: '6035550101',
        }),
      }),
    );
  });
});
