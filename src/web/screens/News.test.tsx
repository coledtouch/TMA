// @vitest-environment jsdom
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { daysFromNow, fakeApi, makeBootstrap } from '../test/fixtures';
import { renderScreen } from '../test/render';
import { News } from './News';

describe('News', () => {
  const data = makeBootstrap({
    events: [
      {
        id: 'E1',
        date: daysFromNow(12),
        time: '7:00 PM',
        title: 'TMA monthly meeting',
        location: 'TRHS Library',
        audience: { schools: [], ensembles: [] },
      },
      {
        id: 'CAL-1a2b3c4d5e',
        date: daysFromNow(9),
        time: '3:00 PM',
        title: 'Spring musical auditions',
        location: 'TRHS Auditorium',
        details: 'Sign up for a time slot outside the chorus room.',
        audience: { schools: ['High School'], ensembles: ['Chorus'] },
        source: 'Music Dept',
      },
    ],
  });

  it('tags events copied from a linked calendar with the calendar’s name', () => {
    renderScreen(<News />, { api: fakeApi(), data });
    const list = screen.getByRole('list', { name: 'Upcoming events' });
    const items = within(list).getAllByRole('listitem');
    const auditions = items.find((li) => within(li).queryByText('Spring musical auditions'))!;
    // Screen readers hear where it came from; sighted people see a small calendar tag.
    expect(within(auditions).getByText('Music Dept')).toBeInTheDocument();
    expect(auditions.querySelector('.source-tag')).toHaveTextContent('From the calendar: Music Dept');
    expect(auditions.querySelector('.source-tag')).toHaveAttribute('title', 'From the Music Dept calendar');
    // Its audience chips are still the event's own.
    expect(within(auditions).getByText('High School')).toBeInTheDocument();
    expect(within(auditions).getByText('Chorus')).toBeInTheDocument();
  });

  it('shows no tag on events typed into the sheet', () => {
    renderScreen(<News />, { api: fakeApi(), data });
    const list = screen.getByRole('list', { name: 'Upcoming events' });
    const meeting = within(list)
      .getAllByRole('listitem')
      .find((li) => within(li).queryByText('TMA monthly meeting'))!;
    expect(meeting.querySelector('.source-tag')).toBeNull();
    expect(within(meeting).getByText('Everyone')).toBeInTheDocument();
  });
});
