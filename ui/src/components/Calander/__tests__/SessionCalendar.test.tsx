import React from 'react';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Timestamp } from 'firebase/firestore';
import SessionCalendar from '../SessionCalendar';
import { makeClubState, makePlayersState, renderWithProviders } from '../../../test-utils/renderWithProviders';
import { resetFirebaseTestState, seedClubDoc, TEST_CLUB_ID, ts } from '../../../test-utils/firebaseTestHelpers';
import type { Player } from '../../../types';

jest.mock('../SessionModal', () => ({
  __esModule: true,
  default: ({ show, session }: { show: boolean; session?: { id?: string } }) => {
    if (!show) return null;
    const React = require('react');
    return React.createElement('div', { 'data-testid': 'session-modal' }, session?.id ?? 'new-session');
  },
}));

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date(2026, 7, 15));
  resetFirebaseTestState();
});

afterEach(() => {
  jest.useRealTimers();
});

function makePlayer(id: string, firstName: string, lastName: string): Player {
  return {
    id,
    firstName,
    firstNameLower: firstName.toLowerCase(),
    lastName,
    lastNameLower: lastName.toLowerCase(),
    email: `${firstName.toLowerCase()}@example.com`,
    balance: 0,
    owed: 0,
    description: '',
    sessionCount: 0,
    createdAt: Timestamp.fromDate(new Date(2026, 0, 1)),
  };
}

function seedSession(id: string, date: Date, overrides: Record<string, unknown> = {}) {
  seedClubDoc('sessions', id, {
    date: ts(date),
    location: 'Main Gym',
    durationHours: 2,
    courtCount: 2,
    totalCost: 0,
    totalCourtCost: 24,
    totalBirdieCost: 12,
    totalSessionCost: 36,
    birdieUsage: [{ id: 'b1', quantity: 12 }],
    courtCreditUsage: [{ id: 'c1', hoursUsed: 2 }],
    players: [{ id: 'p1', percentage: 100, cost: 36, paid: true, comped: false, highlighted: false }],
    createdAt: ts(new Date(2026, 0, 1)),
    ...overrides,
  });
}

function renderCalendar() {
  return renderWithProviders(<SessionCalendar />, {
    preloadedState: {
      club: makeClubState({ currentClubId: TEST_CLUB_ID }),
      players: makePlayersState([
        makePlayer('p1', 'Alice', 'Zhang'),
        makePlayer('p2', 'Bob', 'Lee'),
      ]),
    },
  });
}

describe('SessionCalendar', () => {
  it('loads the visible month and shows a clicked day in the quick view', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    seedSession('aug-10', new Date(2026, 7, 10), {
      location: 'Court A',
      totalCourtCost: 24,
      totalBirdieCost: 16,
      totalSessionCost: 40,
      players: [{ id: 'p1', percentage: 100, cost: 40, paid: false, comped: false, highlighted: false }],
    });
    seedSession('sep-02', new Date(2026, 8, 2), {
      location: 'Court B',
      totalSessionCost: 18,
    });

    renderCalendar();

    expect(screen.getByText('Select a day to see session details')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'August 2026' })).toBeInTheDocument();

    await user.click((await screen.findByText('10')).parentElement as HTMLElement);

    expect(await screen.findByText('Monday, August 10')).toBeInTheDocument();
    expect(screen.getByText('Court A')).toBeInTheDocument();
    expect(screen.getByText('1 unpaid')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'View details' }));
    expect(screen.getByTestId('session-modal')).toHaveTextContent('aug-10');
  });

  it('navigates between months and reloads the sessions for each visible month', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    seedSession('aug-10', new Date(2026, 7, 10), { location: 'Court A' });
    seedSession('sep-02', new Date(2026, 8, 2), {
      location: 'Court B',
      totalCourtCost: 12,
      totalBirdieCost: 6,
      totalSessionCost: 18,
      birdieUsage: [{ id: 'b2', quantity: 6 }],
      players: [{ id: 'p2', percentage: 100, cost: 18, paid: true, comped: false, highlighted: false }],
    });

    renderCalendar();

    expect(await screen.findByRole('button', { name: 'August 2026' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '>' }));
    expect(await screen.findByRole('button', { name: 'September 2026' })).toBeInTheDocument();

    await user.click((await screen.findByText('2')).parentElement as HTMLElement);
    expect(await screen.findByText('Wednesday, September 2')).toBeInTheDocument();
    expect(await screen.findByText('Court B')).toBeInTheDocument();
    expect(screen.getByText('Fully paid')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '<' }));
    expect(await screen.findByRole('button', { name: 'August 2026' })).toBeInTheDocument();

    await user.click((await screen.findByText('10')).parentElement as HTMLElement);
    expect(await screen.findByText('Monday, August 10')).toBeInTheDocument();
    expect(await screen.findByText('Court A')).toBeInTheDocument();
  });

  it('opens a new-session modal immediately when an admin clicks an empty day', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    renderCalendar();

    await screen.findByRole('button', { name: 'August 2026' });
    await user.click((await screen.findByText('11')).parentElement as HTMLElement);

    expect(await screen.findByText('Tuesday, August 11')).toBeInTheDocument();
    expect(screen.getByText('No session this day')).toBeInTheDocument();
    expect(screen.getByTestId('session-modal')).toHaveTextContent('new-session');
  });
});
