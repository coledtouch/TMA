// @vitest-environment jsdom
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { FUNDS_EXPLAINER } from '../lib/copy';
import { fakeApi, makeBootstrap } from '../test/fixtures';
import { renderScreen } from '../test/render';
import { Funds } from './Funds';
import { News } from './News';

describe('Funds', () => {
  it('explains earmarked funds and shows the selected student’s history', async () => {
    renderScreen(<Funds />, { api: fakeApi() });
    const user = userEvent.setup();

    expect(screen.getByText(FUNDS_EXPLAINER)).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Avery' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('$640.00')).toBeInTheDocument();

    const history = screen.getByRole('list', { name: "Avery's fund history" });
    expect(within(history).getByText('Pizza Night')).toBeInTheDocument();
    expect(within(history).getByText('+$50.00')).toBeInTheDocument();
    expect(within(history).getByText('-$200.00')).toBeInTheDocument();
    expect(within(history).getByText('Florida 2027')).toBeInTheDocument();
    expect(within(history).queryByText('Cookie Dough')).not.toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: 'Liam' }));
    const liam = screen.getByRole('list', { name: "Liam's fund history" });
    expect(within(liam).getByText('Cookie Dough')).toBeInTheDocument();
    expect(screen.getByText('Waiting for approval')).toBeInTheDocument();
  });

  it('opens on the student from the link', () => {
    renderScreen(<Funds studentId="S0002" />, { api: fakeApi() });
    expect(screen.getByRole('radio', { name: 'Liam' })).toHaveAttribute('aria-checked', 'true');
  });

  it('supports arrow keys in the student switcher', async () => {
    renderScreen(<Funds />, { api: fakeApi() });
    const user = userEvent.setup();
    screen.getByRole('radio', { name: 'Avery' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: 'Liam' })).toHaveFocus();
    expect(screen.getByRole('radio', { name: 'Liam' })).toHaveAttribute('aria-checked', 'true');
  });

  it('never shows money for unverified students', () => {
    const base = makeBootstrap();
    const data = {
      ...base,
      me: { ...base.me, familyStatus: 'Pending' as const },
      students: base.students.map((s) => ({ ...s, verified: false, balanceCents: 0, availableCents: 0 })),
      ledger: [],
    };
    renderScreen(<Funds />, { api: fakeApi(), data });
    expect(screen.getByText('Waiting for TMA to verify your household')).toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
  });
});

describe('News', () => {
  it('lists events with date badges and announcements with audiences', () => {
    renderScreen(<News />, { api: fakeApi() });
    const events = screen.getByRole('list', { name: 'Upcoming events' });
    expect(within(events).getByText('TMA monthly meeting')).toBeInTheDocument();
    expect(within(events).getByText(/7:00 PM/)).toBeInTheDocument();
    expect(within(events).getByText('Everyone')).toBeInTheDocument();

    const news = screen.getByRole('list', { name: 'Announcements' });
    expect(within(news).getByText('Florida 2027 deposit reminder')).toBeInTheDocument();
    expect(within(news).getByText('High School')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Change' })).toHaveAttribute('href', '#/notifications');
  });

  it('only links to http(s) URLs', () => {
    const base = makeBootstrap();
    const data = {
      ...base,
      announcements: [
        { ...base.announcements[0], id: 'A-2', link: 'javascript:alert(1)' },
        { ...base.announcements[0], id: 'A-3', title: 'Second', link: 'https://example.org/info' },
      ],
    };
    renderScreen(<News />, { api: fakeApi(), data });
    const links = screen.getAllByRole('link', { name: /Learn more/ });
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute('href', 'https://example.org/info');
    expect(links[0]).toHaveAttribute('rel', 'noopener noreferrer');
  });
});
