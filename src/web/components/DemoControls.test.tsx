// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { DemoControls as DemoControlsApi, DemoOutboxItem } from '../../demo';
import type { TickReport } from '../../shared/types';
import { fakeApi } from '../test/fixtures';
import { renderScreen } from '../test/render';
import { DemoControls } from './DemoControls';

function report(): TickReport {
  return {
    ranAt: new Date().toISOString(),
    balanceChanges: 1,
    redemptionsPosted: 0,
    announcementsSent: 0,
    remindersSent: 0,
    notifications: { push: 1, email: 1, sms: 0 },
    errors: [],
  };
}

function demoApi() {
  const outbox: DemoOutboxItem[] = [];
  const demo: DemoControlsApi = {
    addCredit: vi.fn(async (_id: string, cents: number, description: string) => {
      outbox.unshift({
        at: new Date().toISOString(),
        channel: 'push',
        to: 'parent@example.com',
        title: `+$${(cents / 100).toFixed(2)} for Avery`,
        body: description,
      });
      return report();
    }),
    runDaily: vi.fn(async () => report()),
    outbox: () => outbox.slice(),
    reset: vi.fn(),
  };
  return Object.assign(fakeApi({}, 'demo'), { demo });
}

describe('DemoControls', () => {
  it('renders nothing in live mode', () => {
    const { container } = renderScreen(<DemoControls />, { api: fakeApi({}, 'live') });
    expect(container.querySelector('.demo-card')).toBeNull();
  });

  it('posts a fundraiser credit and lists what was sent', async () => {
    const api = demoApi();
    const harness = renderScreen(<DemoControls />, { api });
    const user = userEvent.setup();

    expect(await screen.findByText(/Nothing yet/)).toBeInTheDocument();
    expect(screen.getByLabelText('Student')).toHaveValue('S0001');
    expect(screen.getByLabelText('Description')).toHaveValue('Pizza Night fundraiser');
    await user.click(screen.getByRole('button', { name: 'Add credit & notify' }));

    expect(api.demo.addCredit).toHaveBeenCalledWith('S0001', 5000, 'Pizza Night fundraiser');
    const outbox = await screen.findByRole('list', { name: 'Demo outbox' });
    expect(within(outbox).getByText('+$50.00 for Avery')).toBeInTheDocument();
    expect(screen.getByText(/Added \$50\.00 \(Pizza Night fundraiser\)\. 1 push, 1 email sent\./)).toBeInTheDocument();
    expect(harness.refresh).toHaveBeenCalledWith({ force: true });
  });

  it('accepts another student id, runs reminders and resets after confirming', async () => {
    const api = demoApi();
    renderScreen(<DemoControls />, { api });
    const user = userEvent.setup();
    await screen.findByText(/Nothing yet/);

    await user.selectOptions(screen.getByLabelText('Student'), '__other__');
    const id = screen.getByLabelText('Student ID');
    await user.clear(id);
    await user.type(id, 'S0005');
    await user.clear(screen.getByLabelText('Amount'));
    await user.type(screen.getByLabelText('Amount'), '25');
    await user.click(screen.getByRole('button', { name: 'Add credit & notify' }));
    expect(api.demo.addCredit).toHaveBeenCalledWith('S0005', 2500, 'Pizza Night fundraiser');

    await waitFor(() => expect(screen.getByRole('button', { name: 'Run daily reminders' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Run daily reminders' }));
    expect(api.demo.runDaily).toHaveBeenCalled();

    await waitFor(() => expect(screen.getByRole('button', { name: 'Reset demo data' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Reset demo data' }));
    await user.click(screen.getByRole('button', { name: 'Reset demo' }));
    expect(api.demo.reset).toHaveBeenCalled();
  });

  it('validates the amount', async () => {
    const api = demoApi();
    renderScreen(<DemoControls />, { api });
    const user = userEvent.setup();
    await screen.findByText(/Nothing yet/);
    await user.clear(screen.getByLabelText('Amount'));
    await user.type(screen.getByLabelText('Amount'), '0');
    await user.click(screen.getByRole('button', { name: 'Add credit & notify' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Enter an amount like 50 or 25.50.');
    expect(api.demo.addCredit).not.toHaveBeenCalled();
  });
});
