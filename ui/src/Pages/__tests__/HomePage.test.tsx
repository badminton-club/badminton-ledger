import React from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import HomePage from '../HomePage';
import { renderWithProviders, makeClubState, makePlayersState } from '../../test-utils/renderWithProviders';
import { ts } from '../../test-utils/firebaseTestHelpers';
import { fetchSessions } from 'services/firebase/sessions';
import type { Player, Session } from '../../types';

jest.mock('services/firebase/sessions', () => ({
  fetchSessions: jest.fn(),
}));

jest.mock('components/Calander/SessionCalendar', () => ({
  __esModule: true,
  default: ({ onSessionsChanged }: { onSessionsChanged?: () => void }) => (
    <button type="button" onClick={onSessionsChanged}>
      Mock calendar
    </button>
  ),
}));

function makePlayer(overrides: Partial<Player> = {}): Player {
  return {
    id: 'p1',
    firstName: 'Jamie',
    firstNameLower: 'jamie',
    lastName: 'Lee',
    lastNameLower: 'lee',
    email: 'jamie@example.com',
    balance: 0,
    owed: 0,
    description: '',
    sessionCount: 0,
    createdAt: undefined as never,
    ...overrides,
  };
}

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 's1',
    date: new Date('2026-05-05T19:00:00.000Z'),
    durationHours: 2,
    courtCount: 2,
    totalCost: 30,
    totalCourtCost: 20,
    totalBirdieCost: 10,
    totalSessionCost: 30,
    birdieUsage: [{ id: 'b1', quantity: 3 }],
    courtCreditUsage: [],
    players: [],
    createdAt: undefined as never,
    ...overrides,
  };
}

beforeEach(() => {
  jest.mocked(fetchSessions).mockReset();
});

describe('HomePage', () => {
  it('renders the latest session summary, unpaid players, and outstanding balances, and navigates older sessions', async () => {
    const user = userEvent.setup();
    jest.mocked(fetchSessions).mockResolvedValue([
      makeSession({
        id: 'latest',
        date: new Date('2026-05-05T19:00:00.000Z'),
        players: [
          { id: 'p1', percentage: 100, cost: 20, paid: false, highlighted: false },
          { id: 'p2', percentage: 100, cost: 20, paid: true, highlighted: false },
        ],
        birdieUsage: [{ id: 'b1', quantity: 3 }],
      }),
      makeSession({
        id: 'older',
        date: new Date('2026-04-28T19:00:00.000Z'),
        players: [{ id: 'p3', percentage: 100, cost: 18, paid: true, highlighted: false }],
        birdieUsage: [{ id: 'b2', quantity: 1 }],
      }),
    ]);

    const players = [
      makePlayer({ id: 'p1', firstName: 'Jamie', firstNameLower: 'jamie', lastName: 'Lee', lastNameLower: 'lee', owed: 25 }),
      makePlayer({ id: 'p2', firstName: 'Chris', firstNameLower: 'chris', lastName: 'Ng', lastNameLower: 'ng', owed: 20 }),
      makePlayer({ id: 'p3', firstName: 'Sam', firstNameLower: 'sam', lastName: 'Cho', lastNameLower: 'cho', owed: 15 }),
      makePlayer({ id: 'p4', firstName: 'Pat', firstNameLower: 'pat', lastName: 'Kim', lastNameLower: 'kim', owed: 10 }),
      makePlayer({ id: 'p5', firstName: 'Alex', firstNameLower: 'alex', lastName: 'Yu', lastNameLower: 'yu', owed: 5 }),
      makePlayer({ id: 'p6', firstName: 'Morgan', firstNameLower: 'morgan', lastName: 'Ho', lastNameLower: 'ho', owed: 1 }),
    ];

    renderWithProviders(<HomePage />, {
      preloadedState: {
        club: makeClubState(),
        players: makePlayersState(players),
      },
    });

    expect(await screen.findByText('Latest Session')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'May 5, 2026' })).toHaveAttribute('href', '/?date=2026-05-05');
    expect(screen.getByText('Players: 2')).toBeInTheDocument();
    expect(screen.getByText('Birdies Used: 3')).toBeInTheDocument();
    expect(screen.getByText('Jamie Lee', { selector: '.unpaid-player' })).toBeInTheDocument();
    expect(screen.getByText('+ 1 more with outstanding balances.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Chris Ng' })).toHaveAttribute('href', '/players?playerId=p2');

    await user.click(screen.getByTitle('Older session'));

    expect(await screen.findByText('Previous Session')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'April 28, 2026' })).toHaveAttribute('href', '/?date=2026-04-28');
    expect(screen.getByText('All players have paid.')).toBeInTheDocument();

    await user.click(screen.getByTitle('Newer session'));

    expect(await screen.findByText('Latest Session')).toBeInTheDocument();
  });

  it('renders the calendar wrapper and reloads sessions when the calendar callback fires', async () => {
    const user = userEvent.setup();
    jest.mocked(fetchSessions).mockResolvedValue([]);

    renderWithProviders(<HomePage />, {
      preloadedState: {
        club: makeClubState(),
        players: makePlayersState([]),
      },
    });

    expect(screen.getByText('No players with outstanding balances.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mock calendar' })).toBeInTheDocument();

    await waitFor(() => expect(fetchSessions).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole('button', { name: 'Mock calendar' }));
    await waitFor(() => expect(fetchSessions).toHaveBeenCalledTimes(2));
  });
});
