// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import type { Bootstrap, HouseholdInput } from '../../shared/types';
import { ApiError } from '../api/client';
import { fakeApi, makeBootstrap } from '../test/fixtures';
import { renderScreen } from '../test/render';
import { Household } from './Household';

function newFamilyData(): Bootstrap {
  return makeBootstrap({
    me: { email: 'new.family@example.com', name: 'new.family', familyId: null, familyStatus: 'None', isAdmin: false },
    family: null,
    students: [],
    ledger: [],
  });
}

describe('Household', () => {
  afterEach(() => {
    window.location.hash = '';
  });

  it('signs up a new family with minimal information', async () => {
    const saved = makeBootstrap({
      me: { email: 'new.family@example.com', name: 'Casey Rivera', familyId: 'F0009', familyStatus: 'Pending', isAdmin: false },
    });
    const api = fakeApi({ 'household.save': () => saved });
    const harness = renderScreen(<Household />, { api, data: newFamilyData() });
    const user = userEvent.setup();

    expect(screen.getByRole('heading', { name: 'Set up your household' })).toBeInTheDocument();
    expect(screen.getByText(/TMA only stores what it needs/)).toBeInTheDocument();
    const email = screen.getByLabelText('Email');
    expect(email).toHaveValue('new.family@example.com');
    expect(email).toHaveAttribute('readonly');

    await user.type(screen.getByLabelText('Full name'), 'Casey Rivera');
    await user.type(screen.getByLabelText(/Cell phone/), '603-555-0199');
    await user.type(screen.getByLabelText('First name'), 'Jamie');
    await user.type(screen.getByLabelText('Last name'), 'Rivera');
    await user.selectOptions(screen.getByLabelText('Grade'), '9');
    await user.selectOptions(screen.getByLabelText('School'), 'High School');
    await user.click(screen.getByRole('checkbox', { name: 'Marching Band' }));
    await user.type(screen.getByLabelText(/Instrument/), 'Snare drum');

    await user.click(screen.getByRole('button', { name: 'Send to TMA for verification' }));

    const expected: HouseholdInput = {
      guardians: [{ name: 'Casey Rivera', email: 'new.family@example.com', phone: '603-555-0199' }],
      students: [
        {
          firstName: 'Jamie',
          lastName: 'Rivera',
          grade: '9',
          school: 'High School',
          ensembles: ['Marching Band'],
          instrument: 'Snare drum',
        },
      ],
    };
    expect(api.call).toHaveBeenCalledWith('household.save', expected);
    await waitFor(() => expect(harness.data()).toBe(saved));
    expect(window.location.hash).toBe('#/');
    expect(await screen.findByText(/as soon as TMA verifies your household/)).toBeInTheDocument();
  });

  it('validates required fields before saving', async () => {
    const api = fakeApi();
    renderScreen(<Household />, { api, data: newFamilyData() });
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Send to TMA for verification' }));
    expect(screen.getByText('Please enter a name.')).toBeInTheDocument();
    expect(screen.getByText('Please enter a first name.')).toBeInTheDocument();
    expect(screen.getByText('Choose a grade.')).toBeInTheDocument();
    expect(screen.getByText('Choose a school.')).toBeInTheDocument();
    expect(screen.getByLabelText('Full name')).toHaveFocus();
    expect(api.call).not.toHaveBeenCalled();
  });

  it('adds and removes a second guardian and unsaved students', async () => {
    const api = fakeApi();
    renderScreen(<Household />, { api, data: newFamilyData() });
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /Add a parent or guardian/ }));
    expect(screen.getAllByLabelText('Email')).toHaveLength(2);
    expect(screen.getAllByLabelText('Email')[1]).not.toHaveAttribute('readonly');
    await user.click(screen.getAllByRole('button', { name: 'Remove' })[0]);
    expect(screen.getAllByLabelText('Email')).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: /Add another student/ }));
    expect(screen.getAllByLabelText('First name')).toHaveLength(2);
    const removes = screen.getAllByRole('button', { name: 'Remove' });
    await user.click(removes[removes.length - 1]);
    expect(screen.getAllByLabelText('First name')).toHaveLength(1);
  });

  it('edits an existing household; verified names are locked and existing students keep their ids', async () => {
    const data = makeBootstrap();
    const api = fakeApi({ 'household.save': () => data });
    renderScreen(<Household />, { api, data });
    const user = userEvent.setup();

    expect(screen.getByRole('heading', { name: 'Your household' })).toBeInTheDocument();
    const avery = screen.getByRole('group', { name: 'Students' });
    const firstNames = within(avery).getAllByLabelText('First name');
    expect(firstNames[0]).toHaveValue('Avery');
    expect(firstNames[0]).toHaveAttribute('readonly');
    expect(within(avery).getAllByText('Verified')).toHaveLength(2);

    await user.selectOptions(within(avery).getAllByLabelText('Grade')[0], '12');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    const call = api.call.mock.calls.find(([a]) => a === 'household.save');
    const input = call?.[1] as HouseholdInput;
    expect(input.students[0]).toMatchObject({ id: 'S0001', grade: '12', firstName: 'Avery' });
    expect(input.students[1]).toMatchObject({ id: 'S0002' });
    expect(input.guardians).toEqual([{ name: 'Jordan Thompson', email: 'parent@example.com', phone: '603-555-0101' }]);
    expect(await screen.findByText('Household saved.')).toBeInTheDocument();
  });

  it('shows server errors such as an email already on another household', async () => {
    const api = fakeApi({
      'household.save': () => {
        throw new ApiError('CONFLICT', 'That email is already on a TMA household. Sign in with it or contact TMA.');
      },
    });
    const data = makeBootstrap();
    renderScreen(<Household />, { api, data });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('already on a TMA household');
  });
});
