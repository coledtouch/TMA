// @vitest-environment jsdom
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiParams, Bootstrap, Report, ReportKind, ReportOptions } from '../../shared/types';
import { ApiError } from '../api/client';
import { displayColumns, downloadCsv, reportToCsv } from '../lib/csv';
import { parseHash, tabFor, useRoute } from '../lib/router';
import { fakeApi, makeBootstrap } from '../test/fixtures';
import { renderScreen } from '../test/render';
import { Admin } from './Admin';
import { REPORTS, Reports, filterSummary } from './Reports';

vi.mock('../lib/csv', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/csv')>()),
  downloadCsv: vi.fn(),
}));

const OPTIONS: ReportOptions = {
  activities: [
    { id: 'FL27', name: 'Florida 2027', open: true },
    { id: 'WC26', name: 'Winter Camp', open: true },
    { id: 'NYC26', name: 'New York 2026', open: false },
  ],
  schools: ['High School', 'Middle School', 'Elementary'],
  ensembles: ['Band', 'Jazz Band', 'Chorus'],
};

function adminData(): Bootstrap {
  return {
    ...makeBootstrap(),
    me: { email: 'treasurer@example.com', name: 'treasurer', familyId: null, familyStatus: 'None', isAdmin: true },
    family: null,
    students: [],
  };
}

function tripBalances(overrides: Partial<Report> = {}): Report {
  return {
    kind: 'trip-balances',
    title: 'Trip balances',
    description: 'One row per student going on a trip or activity.',
    generatedAt: '2026-10-21T16:00:00.000Z',
    filters: { includePaid: false },
    columns: [
      { key: 'activity', label: 'Activity', type: 'text' },
      { key: 'student', label: 'Student', type: 'text' },
      { key: 'parentEmail', label: 'Parent email', type: 'email' },
      { key: 'cost', label: 'Cost', type: 'money' },
      { key: 'remaining', label: 'Left to pay', type: 'money' },
      { key: 'dueDate', label: 'Final due', type: 'date' },
      { key: 'status', label: 'Status', type: 'text' },
    ],
    rows: [
      {
        activity: 'Florida 2027',
        student: 'Avery Thompson',
        parentEmail: 'parent@example.com',
        cost: 185000,
        remaining: 130000,
        dueDate: '2027-01-29',
        status: 'Owes',
      },
      {
        activity: 'Florida 2027',
        student: 'Sofia Ortiz',
        parentEmail: null,
        cost: 185000,
        remaining: 5050,
        dueDate: '2027-01-29',
        status: 'Owes',
      },
    ],
    totals: { cost: 370000, remaining: 135050 },
    notes: ['2 students with nothing left to pay are not listed.'],
    containsContactInfo: true,
    ...overrides,
  };
}

function studentFunds(): Report {
  return {
    kind: 'student-funds',
    title: 'Student funds',
    description: 'One row per active student.',
    generatedAt: '2026-10-21T16:00:00.000Z',
    filters: {},
    columns: [
      { key: 'student', label: 'Student', type: 'text' },
      { key: 'school', label: 'School', type: 'text' },
      { key: 'balance', label: 'Balance', type: 'money' },
      { key: 'lastActivity', label: 'Last fund activity', type: 'date' },
    ],
    rows: [{ student: 'Avery Thompson', school: 'High School', balance: 64000, lastActivity: '2026-10-18' }],
    totals: { balance: 64000 },
    containsContactInfo: false,
  };
}

function roster(): Report {
  return {
    kind: 'roster',
    title: 'Roster',
    description: 'Active students with their parents.',
    generatedAt: '2026-10-21T16:00:00.000Z',
    filters: {},
    columns: [
      { key: 'student', label: 'Student', type: 'text' },
      { key: 'parent1Email', label: 'Parent 1 email', type: 'email' },
      { key: 'parent1Phone', label: 'Parent 1 phone', type: 'phone' },
    ],
    rows: [{ student: 'Avery Thompson', parent1Email: 'parent@example.com', parent1Phone: '603-555-0101' }],
    notes: ["Contains parents' emails and phone numbers."],
    containsContactInfo: true,
  };
}

function fundActivity(): Report {
  return {
    kind: 'fund-activity',
    title: 'Fund activity',
    description: 'Every Ledger row in the date range.',
    generatedAt: '2026-10-21T16:00:00.000Z',
    filters: { from: '2026-07-01', to: '2027-06-30' },
    columns: [
      { key: 'date', label: 'Date', type: 'date' },
      { key: 'student', label: 'Student', type: 'text' },
      { key: 'amount', label: 'Amount', type: 'money' },
    ],
    rows: [
      { date: '2026-09-02', student: 'Avery Thompson', amount: 5000 },
      { date: '2026-09-03', student: 'Avery Thompson', amount: -2000 },
    ],
    totals: { credits: 5000, debits: -2000, net: 3000 },
    containsContactInfo: false,
  };
}

/** A fake admin.report that answers with `make(params)` and records every call. */
function reportsApi(make: (params: ApiParams<'admin.report'>) => Report) {
  return fakeApi({ 'admin.report': (params) => ({ report: make(params), options: OPTIONS }) });
}

function reportCalls(api: ReturnType<typeof fakeApi>): Array<ApiParams<'admin.report'>> {
  return api.call.mock.calls.filter(([action]) => action === 'admin.report').map(([, params]) => params as ApiParams<'admin.report'>);
}

/** The screen as App.tsx mounts it: the report comes from the address. */
function Routed() {
  const route = useRoute();
  return <Reports kind={route.params.kind} />;
}

async function go(hash: string) {
  await act(async () => {
    window.location.hash = hash;
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-21T16:00:00.000Z'));
  vi.mocked(downloadCsv).mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  window.location.hash = '';
});

describe('Reports route', () => {
  it('has its own address under the More tab', () => {
    expect(parseHash('#/reports?kind=payments')).toEqual({ name: 'reports', params: { kind: 'payments' } });
    expect(tabFor('reports')).toBe('more');
  });
});

describe('Reports', () => {
  it('is only for board members, and asks the server nothing', () => {
    const api = fakeApi();
    renderScreen(<Reports kind="roster" />, { api, data: makeBootstrap() });
    expect(screen.getByText('For TMA board members')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(api.call).not.toHaveBeenCalled();
  });

  it('lists the eight reports with a plain line each', () => {
    const api = fakeApi();
    renderScreen(<Reports />, { api, data: adminData() });
    const list = screen.getByRole('list', { name: 'Reports' });
    const links = within(list).getAllByRole('link');
    expect(links).toHaveLength(8);
    expect(REPORTS.map((r) => r.kind)).toEqual([
      'trip-balances',
      'student-funds',
      'fundraiser-totals',
      'fund-activity',
      'payments',
      'roster',
      'open-items',
      'app-usage',
    ]);
    const trips = within(list).getByRole('link', { name: /Trip balances/ });
    expect(trips).toHaveAttribute('href', '#/reports?kind=trip-balances');
    expect(trips).toHaveTextContent('Who still owes what');
    expect(screen.getByRole('link', { name: /Board tools/ })).toHaveAttribute('href', '#/admin');
    expect(api.call).not.toHaveBeenCalled();
  });

  it('runs trip balances with its filters and shows the table, totals and notes', async () => {
    const api = reportsApi(() => tripBalances());
    renderScreen(<Reports kind="trip-balances" />, { api, data: adminData() });

    expect(screen.getByRole('heading', { level: 1, name: 'Trip balances' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Loading the report…');

    const table = await screen.findByRole('table', { name: /Trip balances: 2 rows/ });
    expect(reportCalls(api)).toEqual([{ kind: 'trip-balances', filters: { includePaid: false } }]);
    expect(screen.getByRole('status')).toHaveTextContent('Trip balances: 2 rows.');

    // Only this report's filters.
    expect(screen.getByRole('form', { name: 'Filters' })).toBeInTheDocument();
    expect(screen.getByLabelText('Activity')).toBeInTheDocument();
    expect(screen.getByLabelText('School')).toBeInTheDocument();
    expect(screen.getByLabelText('Group')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Include paid in full' })).not.toBeChecked();
    expect(screen.queryByLabelText('From')).not.toBeInTheDocument();

    // Open activities first.
    const activity = screen.getByLabelText('Activity');
    expect(within(activity).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'All open activities',
      'Florida 2027',
      'Winter Camp',
      'New York 2026',
    ]);
    expect(within(activity).getByRole('group', { name: 'Closed' })).toContainElement(
      within(activity).getByRole('option', { name: 'New York 2026' }),
    );

    // The student leads each row; money, dates and emails are readable.
    const headers = within(table).getAllByRole('columnheader').map((th) => th.textContent);
    expect(headers).toEqual(['Student', 'Activity', 'Parent email', 'Cost', 'Left to pay', 'Final due', 'Status']);
    const avery = within(table).getByRole('row', { name: /Avery Thompson/ });
    expect(within(avery).getByRole('rowheader')).toHaveTextContent('Avery Thompson');
    expect(within(avery).getByText('$1,850.00')).toHaveClass('num');
    expect(within(avery).getByText('Jan 29, 2027')).toBeInTheDocument();
    expect(within(avery).getByRole('link', { name: 'parent@example.com' })).toHaveAttribute('href', 'mailto:parent@example.com');

    const total = within(table).getByRole('row', { name: /^Total/ });
    expect(within(total).getByText('$3,700.00')).toBeInTheDocument();
    expect(within(total).getByText('$1,350.50')).toBeInTheDocument();

    expect(screen.getByText('2 students with nothing left to pay are not listed.')).toBeInTheDocument();
    expect(screen.getByText(/^Generated Oct 21, 2026, .* · Open activities · All schools · All groups · Paid in full left out$/)).toBeInTheDocument();
    // Trip balances list parents' emails but no phone numbers.
    expect(screen.getByText("This report has people's email addresses. Keep it private.")).toBeInTheDocument();
  });

  it('runs again with the new filters when one changes', async () => {
    const api = reportsApi((p) => tripBalances({ filters: { includePaid: false, ...p.filters } }));
    const user = userEvent.setup();
    renderScreen(<Reports kind="trip-balances" />, { api, data: adminData() });
    await screen.findByRole('table');

    await user.selectOptions(screen.getByLabelText('Activity'), 'NYC26');
    await waitFor(() => expect(reportCalls(api)).toHaveLength(2));
    expect(reportCalls(api)[1]).toEqual({ kind: 'trip-balances', filters: { activityId: 'NYC26', includePaid: false } });

    await user.click(screen.getByRole('switch', { name: 'Include paid in full' }));
    await user.selectOptions(screen.getByLabelText('School'), 'Middle School');
    await waitFor(() => expect(reportCalls(api)).toHaveLength(3)); // both changes in one run
    expect(reportCalls(api)[2]).toEqual({
      kind: 'trip-balances',
      filters: { activityId: 'NYC26', school: 'Middle School', includePaid: true },
    });
    expect(await screen.findByText(/New York 2026 · Middle School · All groups · Paid in full included/)).toBeInTheDocument();
    // Focus stays on the filter the person is using.
    expect(screen.getByLabelText('School')).toHaveFocus();
  });

  it('sends the school year for dated reports and checks the range', async () => {
    const api = reportsApi((p) => ({ ...fundActivity(), kind: 'payments', title: 'Payments', filters: p.filters ?? {} }));
    const user = userEvent.setup();
    renderScreen(<Reports kind="payments" />, { api, data: adminData() });
    await screen.findByRole('table');

    expect(reportCalls(api)).toEqual([{ kind: 'payments', filters: { from: '2026-07-01', to: '2027-06-30' } }]);
    expect(screen.getByLabelText('From')).toHaveValue('2026-07-01');
    expect(screen.getByLabelText('To')).toHaveValue('2027-06-30');
    expect(screen.getByLabelText('Activity')).toBeInTheDocument();
    expect(within(screen.getByLabelText('Activity')).getByRole('option', { name: 'All activities' })).toBeInTheDocument();
    expect(screen.queryByLabelText('School')).not.toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();

    // An end before the start is explained, and not sent.
    await user.clear(screen.getByLabelText('To'));
    await user.type(screen.getByLabelText('To'), '2026-06-01');
    expect(await screen.findByText('The end date must be on or after the start date.')).toBeInTheDocument();
    await act(() => new Promise((r) => setTimeout(r, 600))); // past the filter delay
    expect(reportCalls(api).some((p) => p.filters?.to === '2026-06-01')).toBe(false);

    // From the keyboard: the button goes away once pressed, and focus moves to the line that
    // replaces it rather than to the page.
    screen.getByRole('button', { name: 'Use this school year' }).focus();
    await user.keyboard('{Enter}');
    expect(screen.getByLabelText('To')).toHaveValue('2027-06-30');
    expect(screen.queryByText('The end date must be on or after the start date.')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Use this school year' })).not.toBeInTheDocument();
    expect(screen.getByText('This school year (July 1 to June 30).')).toHaveFocus();
  });

  it('shows totals that have no column of their own (credits, debits, net)', async () => {
    const api = reportsApi(() => fundActivity());
    renderScreen(<Reports kind="fund-activity" />, { api, data: adminData() });
    const table = await screen.findByRole('table');
    expect(within(within(table).getByRole('row', { name: /^Credits/ })).getByText('$50.00')).toBeInTheDocument();
    expect(within(within(table).getByRole('row', { name: /^Debits/ })).getByText('-$20.00')).toBeInTheDocument();
    expect(within(within(table).getByRole('row', { name: /^Net/ })).getByText('$30.00')).toBeInTheDocument();
  });

  it('runs reports without filters with no filters at all, and says when nothing is waiting', async () => {
    const api = reportsApi(() => ({
      kind: 'open-items',
      title: 'Open items',
      description: 'What is waiting on the treasurer.',
      generatedAt: '2026-10-21T16:00:00.000Z',
      filters: {},
      columns: [{ key: 'kind', label: 'Item', type: 'text' }],
      rows: [],
      notes: ['0 fund requests, 0 new households, 0 new students, 0 payments still clearing.'],
      containsContactInfo: false,
    }));
    renderScreen(<Reports kind="open-items" />, { api, data: adminData() });
    expect(await screen.findByText('All caught up')).toBeInTheDocument();
    expect(reportCalls(api)).toEqual([{ kind: 'open-items' }]);
    expect(screen.queryByRole('form')).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Download CSV/ })).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Open items: 0 rows.');
  });

  it('downloads the CSV straight away when it has no contact details', async () => {
    const report = studentFunds();
    const api = reportsApi(() => report);
    const user = userEvent.setup();
    renderScreen(<Reports kind="student-funds" />, { api, data: adminData() });
    await screen.findByRole('table');

    await user.click(screen.getByRole('button', { name: 'Download CSV' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(downloadCsv).toHaveBeenCalledTimes(1);
    expect(downloadCsv).toHaveBeenCalledWith(
      'tma-student-funds-2026-10-21.csv',
      reportToCsv(report, { filters: filterSummary(report, OPTIONS) }),
    );
    const [, csv] = vi.mocked(downloadCsv).mock.calls[0];
    expect(csv.slice(1).split('\r\n').slice(0, 3)).toEqual([
      'Student,School,Balance,Last fund activity',
      'Avery Thompson,High School,640.00,2026-10-18',
      'Total,,640.00,',
    ]);
    expect(await screen.findByText('Downloaded tma-student-funds-2026-10-21.csv.')).toBeInTheDocument();
  });

  it("warns before downloading families' contact details", async () => {
    const api = reportsApi(() => roster());
    const user = userEvent.setup();
    renderScreen(<Reports kind="roster" />, { api, data: adminData() });
    await screen.findByRole('table');
    const download = screen.getByRole('button', { name: 'Download CSV' });

    await user.click(download);
    let dialog = screen.getByRole('alertdialog', { name: 'Download contact details?' });
    expect(dialog).toHaveTextContent("This file has people's email addresses and phone numbers. Keep it private.");
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(downloadCsv).not.toHaveBeenCalled();

    await user.click(download);
    dialog = screen.getByRole('alertdialog', { name: 'Download contact details?' });
    await user.click(within(dialog).getByRole('button', { name: 'Download CSV' }));
    expect(downloadCsv).toHaveBeenCalledWith('tma-roster-2026-10-21.csv', expect.stringContaining('Avery Thompson,parent@example.com,603-555-0101'));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('prints the report', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    const api = reportsApi(() => studentFunds());
    const user = userEvent.setup();
    renderScreen(<Reports kind="student-funds" />, { api, data: adminData() });
    await screen.findByRole('table');
    await user.click(screen.getByRole('button', { name: 'Print' }));
    expect(print).toHaveBeenCalledTimes(1);
  });

  it('shows the error and runs again on Try again', async () => {
    let fail = true;
    const api = fakeApi({
      'admin.report': () => {
        if (fail) throw new ApiError('BAD_REQUEST', 'Group "Bagpipes" is not in Settings ENSEMBLES.');
        return { report: studentFunds(), options: OPTIONS };
      },
    });
    const user = userEvent.setup();
    renderScreen(<Reports kind="student-funds" />, { api, data: adminData() });

    expect(await screen.findByRole('alert')).toHaveTextContent('Group "Bagpipes" is not in Settings ENSEMBLES.');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();

    fail = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('table')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(reportCalls(api)).toHaveLength(2);
    // The Try again button is gone, so focus goes to the results.
    expect(screen.getByRole('heading', { level: 2, name: /Results/ })).toHaveFocus();
  });

  it('moves focus to the report, then to its results, when one is picked from the list', async () => {
    const api = reportsApi((p) => (p.kind === 'student-funds' ? studentFunds() : tripBalances()));
    const user = userEvent.setup();
    await go('#/reports');
    renderScreen(<Routed />, { api, data: adminData() });

    await user.click(screen.getByRole('link', { name: /Student funds/ }));
    await go('#/reports?kind=student-funds'); // jsdom doesn't always fire hashchange for link clicks
    expect(screen.getByRole('heading', { level: 1, name: 'Student funds' })).toBeInTheDocument();
    await screen.findByRole('table');
    await waitFor(() => expect(screen.getByRole('heading', { level: 2, name: /Results/ })).toHaveFocus());

    await user.click(screen.getByRole('link', { name: /All reports/ }));
    await go('#/reports');
    expect(screen.getByRole('heading', { level: 1, name: 'Reports' })).toHaveFocus();
  });

  it('keeps the filters when moving to another report', async () => {
    const api = reportsApi((p) => ({ ...(p.kind === 'roster' ? roster() : studentFunds()), filters: p.filters ?? {} }));
    const user = userEvent.setup();
    await go('#/reports?kind=student-funds');
    renderScreen(<Routed />, { api, data: adminData() });
    await screen.findByRole('table');
    await user.selectOptions(screen.getByLabelText('Group'), 'Chorus');
    await waitFor(() => expect(reportCalls(api)).toHaveLength(2));

    await go('#/reports?kind=roster');
    await waitFor(() => expect(reportCalls(api)).toHaveLength(3));
    expect(reportCalls(api)[2]).toEqual({ kind: 'roster', filters: { ensemble: 'Chorus' } });
  });

  it('pins the student column first, on screen and in the CSV', () => {
    expect(displayColumns(tripBalances().columns).map((c) => c.key)).toEqual([
      'student',
      'activity',
      'parentEmail',
      'cost',
      'remaining',
      'dueDate',
      'status',
    ]);
    expect(displayColumns(fundActivity().columns).map((c) => c.key)).toEqual(['student', 'date', 'amount']);
    expect(reportToCsv(fundActivity()).slice(1).split('\r\n')[0]).toBe('Student,Date,Amount');
  });

  it.each<[ReportKind, string]>([
    ['fundraiser-totals', 'Jul 1, 2026 to Jun 30, 2027'],
    ['payments', 'Jul 1, 2026 to Jun 30, 2027 · All activities'],
    ['roster', 'All schools · All groups'],
    ['app-usage', ''],
  ])('sums up the %s filters in words', (kind, words) => {
    const report = { ...studentFunds(), kind, filters: { from: '2026-07-01', to: '2027-06-30' } };
    expect(filterSummary(report, OPTIONS)).toBe(words);
  });
});

describe('Board tools', () => {
  it('links to Reports', () => {
    const api = fakeApi({ 'admin.overview': () => new Promise(() => undefined) });
    renderScreen(<Admin />, { api, data: adminData() });
    expect(screen.getByRole('link', { name: /Reports/ })).toHaveAttribute('href', '#/reports');
  });
});
