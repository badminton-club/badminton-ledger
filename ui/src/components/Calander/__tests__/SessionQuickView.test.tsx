import React from 'react';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Timestamp } from 'firebase/firestore';
import SessionQuickView from '../SessionQuickView';
import { makeClubState, makePlayersState, renderWithProviders } from '../../../test-utils/renderWithProviders';
import { resetFirebaseTestState } from '../../../test-utils/firebaseTestHelpers';
import type { Player, Session } from '../../../types';

beforeEach(() => {
  resetFirebaseTestState();
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

function makeSession(id: string, date: Date, overrides: Partial<Session> = {}): Session {
  return {
    id,
    date,
    location: 'Main Gym',
    durationHours: 2,
    courtCount: 2,
    totalCost: 0,
    totalCourtCost: 32,
    totalBirdieCost: 20,
    totalSessionCost: 52,
    birdieUsage: [
      { id: 'b1', quantity: 12 },
      { id: 'b2', quantity: 6 },
    ],
    courtCreditUsage: [{ id: 'c1', hoursUsed: 2 }],
    players: [
      { id: 'p1', percentage: 50, cost: 32, paid: false, comped: false, highlighted: false },
      { id: 'p2', percentage: 50, cost: 20, paid: true, comped: false, highlighted: false },
    ],
    createdAt: Timestamp.fromDate(new Date(2026, 0, 1)),
    ...overrides,
  };
}

describe('SessionQuickView', () => {
  it('shows the empty-day state and lets admins add a session', async () => {
    const user = userEvent.setup();
    const onAddSession = jest.fn();

    renderWithProviders(
      <SessionQuickView date={new Date(2026, 7, 10)} sessions={[]} onAddSession={onAddSession} onOpenModal={jest.fn()} />,
      {
        preloadedState: {
          club: makeClubState(),
          players: makePlayersState([]),
        },
      }
    );

    expect(screen.getByText('Monday, August 10')).toBeInTheDocument();
    expect(screen.getByText('No session this day')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '+ Add Session' }));
    expect(onAddSession).toHaveBeenCalledTimes(1);
  });

  it('renders the session summary, player list, and cost breakdown for a selected session', async () => {
    const user = userEvent.setup();
    const onOpenModal = jest.fn();
    const session = makeSession('session-1', new Date(2026, 7, 10));

    renderWithProviders(
      <SessionQuickView date={session.date} sessions={[session]} onAddSession={jest.fn()} onOpenModal={onOpenModal} />,
      {
        preloadedState: {
          club: makeClubState({ role: 'member' }),
          players: makePlayersState([
            makePlayer('p1', 'Alice', 'Zhang'),
            makePlayer('p2', 'Bob', 'Lee'),
          ]),
        },
      }
    );

    expect(screen.getByText('1 unpaid')).toBeInTheDocument();
    expect(screen.getByText('Main Gym')).toBeInTheDocument();
    expect(screen.getByText('18')).toBeInTheDocument();
    expect(screen.getByText('2 batches')).toBeInTheDocument();
    expect(screen.getByText('$52.00')).toBeInTheDocument();
    expect(within(screen.getByText('Court cost').parentElement as HTMLElement).getByText('$32.00')).toBeInTheDocument();
    expect(within(screen.getByText('Birdie cost').parentElement as HTMLElement).getByText('$20.00')).toBeInTheDocument();
    expect(screen.getByText('Alice Zhang')).toBeInTheDocument();
    expect(screen.getByText('Bob Lee')).toBeInTheDocument();
    expect(within(screen.getByText('Alice Zhang').parentElement as HTMLElement).getByText('Unpaid')).toBeInTheDocument();
    expect(within(screen.getByText('Bob Lee').parentElement as HTMLElement).getByText('Paid')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '+ Add' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'View details' }));
    expect(onOpenModal).toHaveBeenCalledWith(session);
  });

  it('switches between multiple sessions and opens the currently selected one', async () => {
    const user = userEvent.setup();
    const onOpenModal = jest.fn();
    const firstSession = makeSession('session-1', new Date(2026, 7, 10), {
      location: 'Court A',
      totalCourtCost: 24,
      totalBirdieCost: 16,
      totalSessionCost: 40,
      birdieUsage: [{ id: 'b1', quantity: 12 }],
      players: [{ id: 'p1', percentage: 100, cost: 40, paid: false, comped: false, highlighted: false }],
    });
    const secondSession = makeSession('session-2', new Date(2026, 7, 10), {
      location: 'Court B',
      totalCourtCost: 12,
      totalBirdieCost: 6,
      totalSessionCost: 18,
      birdieUsage: [{ id: 'b2', quantity: 6 }],
      players: [{ id: 'p2', percentage: 100, cost: 18, paid: true, comped: false, highlighted: false }],
    });

    renderWithProviders(
      <SessionQuickView
        date={new Date(2026, 7, 10)}
        sessions={[firstSession, secondSession]}
        onAddSession={jest.fn()}
        onOpenModal={onOpenModal}
      />,
      {
        preloadedState: {
          club: makeClubState(),
          players: makePlayersState([
            makePlayer('p1', 'Alice', 'Zhang'),
            makePlayer('p2', 'Bob', 'Lee'),
          ]),
        },
      }
    );

    expect(screen.getByText('Court A')).toBeInTheDocument();
    expect(screen.getByText('1 unpaid')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Session 2' }));

    expect(screen.getByText('Fully paid')).toBeInTheDocument();
    expect(screen.getByText('Court B')).toBeInTheDocument();
    expect(within(screen.getByText('Total cost').parentElement as HTMLElement).getByText('$18.00')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'View details' }));
    expect(onOpenModal).toHaveBeenCalledWith(secondSession);
  });
});
