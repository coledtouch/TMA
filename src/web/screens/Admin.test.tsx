// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { AdminOverview, Bootstrap } from '../../shared/types';
import { ApiError } from '../api/client';
import { fakeApi, makeBootstrap } from '../test/fixtures';
import { renderScreen } from '../test/render';
import { Admin } from './Admin';

vi.mock('../components/DemoControls', () => ({ DemoControls: () => null }));

function adminData(): Bootstrap {
  const base = makeBootstrap();
  return {
    ...base,
    me: { email: 'treasurer@example.com', name: 'treasurer', familyId: null, familyStatus: 'None', isAdmin: true },
    family: null,
    students: [],
  };
}

function makeOverview(overrides: Partial<AdminOverview> = {}): AdminOverview {
  return {
    stats: {
      families: 3,
      activeFamilies: 2,
      pendingFamilies: 1,
      students: 6,
      totalFundsCents: 169000,
      pushDevices: 4,
      emailQuotaRemaining: 97,
    },
    pendingRedemptions: [
      {
        id: 'R-1',
        requestedAt: '2026-10-20T14:00:00.000Z',
        email: 'parent@example.com',
        familyId: 'F0001',
        studentId: 'S0001',
        activityId: 'FL27',
        amountCents: 20000,
        note: 'Toward the deposit',
        status: 'Pending',
        studentName: 'Avery Thompson',
        activityName: 'Florida 2027',
        availableCents: 64000,
        remainingCents: 130000,
      },
    ],
    pendingHouseholds: [
      {
        family: {
          id: 'F0003',
          guardians: [{ name: 'Marcus Ortiz', email: 'ortiz@example.com' }],
          status: 'Pending',
          member: false,
        },
        students: [
          {
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
            candidates: [
              {
                studentId: 'S0005',
                name: 'Sofia Ortiz',
                grade: '12',
                school: 'High School',
                familyId: null,
                balanceCents: 52000,
                score: 1,
              },
            ],
          },
        ],
      },
    ],
    recentLog: [{ at: '2026-10-21T12:00:00.000Z', kind: 'notify', detail: 'balance: +$50.00 → push 1, email 1, sms 0' }],
    ...overrides,
  };
}

describe('Admin', () => {
  it('is only for board members', () => {
    renderScreen(<Admin />, { api: fakeApi(), data: makeBootstrap() });
    expect(screen.getByText('For TMA board members')).toBeInTheDocument();
  });

  it('shows stats and approves a fund request', async () => {
    let overview = makeOverview();
    const api = fakeApi({
      'admin.overview': () => overview,
      'admin.decideRedemption': (p) => {
        overview = makeOverview({ pendingRedemptions: [] });
        return { redemption: { ...makeOverview().pendingRedemptions[0], status: p.decision } };
      },
    });
    const harness = renderScreen(<Admin />, { api, data: adminData() });
    const user = userEvent.setup();

    expect(screen.getByText('Loading board tools…')).toBeInTheDocument();
    const card = await screen.findByRole('article', { name: 'Fund request from Avery Thompson' });
    expect(screen.getByText('$1,690.00')).toBeInTheDocument();
    expect(within(card).getByText('"Toward the deposit"')).toBeInTheDocument();

    await user.click(within(card).getByRole('button', { name: 'Approve $200.00' }));

    expect(api.call).toHaveBeenCalledWith('admin.decideRedemption', { id: 'R-1', decision: 'Approved' });
    expect(await screen.findByText(/Approved \$200\.00 for Avery Thompson/)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('article', { name: /Fund request/ })).not.toBeInTheDocument());
    expect(screen.getByText('All caught up')).toBeInTheDocument();
    expect(api.call.mock.calls.filter(([a]) => a === 'admin.overview')).toHaveLength(2);
    expect(harness.refresh).toHaveBeenCalledWith({ force: true });
  });

  it('denies with a note and shows conflicts from the server', async () => {
    const api = fakeApi({
      'admin.overview': () => makeOverview(),
      'admin.decideRedemption': () => {
        throw new ApiError('CONFLICT', 'Only $100.00 is available now.');
      },
    });
    renderScreen(<Admin />, { api, data: adminData() });
    const user = userEvent.setup();
    const card = await screen.findByRole('article', { name: 'Fund request from Avery Thompson' });
    await user.type(within(card).getByLabelText(/Note to the family/), 'Please call us');
    await user.click(within(card).getByRole('button', { name: 'Deny' }));
    expect(api.call).toHaveBeenCalledWith('admin.decideRedemption', {
      id: 'R-1',
      decision: 'Denied',
      adminNote: 'Please call us',
    });
    expect(await within(card).findByRole('alert')).toHaveTextContent('Only $100.00 is available now.');
  });

  it('requires a match choice before approving a household, then links the record', async () => {
    const api = fakeApi({
      'admin.overview': () => makeOverview(),
      'admin.reviewHousehold': () => ({
        family: { id: 'F0003', guardians: [], status: 'Active', member: false },
      }),
    });
    renderScreen(<Admin />, { api, data: adminData() });
    const user = userEvent.setup();
    const card = await screen.findByRole('article', { name: 'Household Marcus Ortiz' });

    await user.click(within(card).getByRole('button', { name: 'Approve household' }));
    expect(within(card).getByRole('alert')).toHaveTextContent(/Choose "link" or "new student" for Sofia Ortiz/);
    expect(api.call).not.toHaveBeenCalledWith('admin.reviewHousehold', expect.anything());

    const link = within(card).getByRole('radio', { name: /Link to existing record: Sofia Ortiz/ });
    expect(within(card).getByText(/\$520\.00 in funds · 100% match/)).toBeInTheDocument();
    await user.click(link);
    await user.click(within(card).getByRole('button', { name: 'Approve household' }));
    expect(api.call).toHaveBeenCalledWith('admin.reviewHousehold', {
      familyId: 'F0003',
      decision: 'approve',
      links: [{ pendingStudentId: 'S0006', existingStudentId: 'S0005' }],
    });
  });

  it('approves as a new student without links, or rejects after confirming', async () => {
    const api = fakeApi({
      'admin.overview': () => makeOverview(),
      'admin.reviewHousehold': () => ({ family: { id: 'F0003', guardians: [], status: 'Active', member: false } }),
    });
    renderScreen(<Admin />, { api, data: adminData() });
    const user = userEvent.setup();
    const card = await screen.findByRole('article', { name: 'Household Marcus Ortiz' });

    await user.click(within(card).getByRole('radio', { name: /New student/ }));
    await user.click(within(card).getByRole('button', { name: 'Approve household' }));
    expect(api.call).toHaveBeenCalledWith('admin.reviewHousehold', { familyId: 'F0003', decision: 'approve' });

    await user.click(within(card).getByRole('button', { name: 'Reject' }));
    const confirm = screen.getByRole('alertdialog', { name: 'Reject this sign-up?' });
    expect(within(confirm).getByRole('button', { name: 'Cancel' })).toHaveFocus();
    await user.click(within(confirm).getByRole('button', { name: 'Reject sign-up' }));
    expect(api.call).toHaveBeenCalledWith('admin.reviewHousehold', { familyId: 'F0003', decision: 'reject' });
  });

  it('composes, previews, confirms and sends an announcement', async () => {
    const api = fakeApi({
      'admin.overview': () => makeOverview(),
      'admin.announce': (p) => ({
        announcement: { id: 'A-9', date: '2026-10-21', title: p.title, body: p.body, audience: p.audience },
        delivered: { push: 12, email: 30, sms: 0 },
      }),
    });
    const harness = renderScreen(<Admin />, { api, data: adminData() });
    const user = userEvent.setup();
    await screen.findByRole('article', { name: /Fund request/ });

    await user.click(screen.getByRole('button', { name: 'Review & send' }));
    expect(screen.getByText('Add a title.')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Title'), 'Concert volunteers needed');
    await user.type(screen.getByLabelText('Message'), 'Please sign up to help.');
    await user.type(screen.getByRole('textbox', { name: /^Link/ }), 'http//bad');
    await user.click(screen.getByRole('button', { name: 'Review & send' }));
    expect(screen.getByText('Links must start with https://')).toBeInTheDocument();
    await user.clear(screen.getByRole('textbox', { name: /^Link/ }));

    const compose = screen.getByRole('region', { name: 'Send an announcement' });
    await user.click(within(compose).getByRole('checkbox', { name: 'High School' }));
    await user.click(within(compose).getByRole('checkbox', { name: 'Chorus' }));
    await user.click(within(compose).getByRole('switch', { name: 'Email' }));
    expect(within(compose).getByText('For: High School, Chorus')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Review & send' }));
    const confirm = screen.getByRole('alertdialog', { name: 'Send this announcement?' });
    expect(confirm).toHaveTextContent('High School, Chorus');
    expect(confirm).toHaveTextContent('by phone notification.');
    await user.click(within(confirm).getByRole('button', { name: 'Send now' }));

    expect(api.call).toHaveBeenCalledWith('admin.announce', {
      title: 'Concert volunteers needed',
      body: 'Please sign up to help.',
      audience: { schools: ['High School'], ensembles: ['Chorus'] },
      channels: { push: true, email: false, sms: false },
    });
    expect(await screen.findByText('Announcement sent: 12 push, 30 email.')).toBeInTheDocument();
    expect(screen.getByLabelText('Title')).toHaveValue('');
    expect(harness.refresh).toHaveBeenCalledWith({ force: true });
  });

  it('runs the sync and shows the report', async () => {
    const api = fakeApi({
      'admin.overview': () => makeOverview(),
      'admin.runSync': () => ({
        ranAt: '2026-10-21T12:00:00.000Z',
        balanceChanges: 2,
        redemptionsPosted: 1,
        announcementsSent: 0,
        remindersSent: 0,
        notifications: { push: 3, email: 2, sms: 0 },
        errors: [],
      }),
    });
    renderScreen(<Admin />, { api, data: adminData() });
    const user = userEvent.setup();
    await screen.findByText('Recent activity');
    await user.click(screen.getByRole('button', { name: 'Run sync now' }));
    const report = await screen.findByLabelText('Sync report');
    expect(within(report).getByText('Balance changes').nextSibling).toHaveTextContent('2');
    expect(within(report).getByText('3 push · 2 email · 0 text')).toBeInTheDocument();
  });

  it('shows an error with retry when the overview fails', async () => {
    let fail = true;
    const api = fakeApi({
      'admin.overview': () => {
        if (fail) throw new ApiError('INTERNAL', 'Network problem — check your connection');
        return makeOverview();
      },
    });
    renderScreen(<Admin />, { api, data: adminData() });
    const user = userEvent.setup();
    expect(await screen.findByText('Network problem — check your connection')).toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole('button', { name: /Try again/ }));
    expect(await screen.findByRole('article', { name: /Fund request/ })).toBeInTheDocument();
  });
});
