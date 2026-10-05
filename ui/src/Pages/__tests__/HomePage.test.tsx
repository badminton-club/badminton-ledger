import React from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useSearchParams } from 'react-router-dom';
import HomePage from '../HomePage';
import { renderWithProviders, makeClubState, makePlayersState } from '../../test-utils/renderWithProviders';
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

// Exposes the current URL query string so tests can verify HomePage
// deep-links into the (mocked-away) calendar via ?date=/&action=, without
// needing a real SessionCalendar mounted to observe it.
function LocationSearchProbe() {
  const [params] = useSearchParams();
  return <div data-testid="location-search">{params.toString()}</div>;
}

function renderHomePage(options: Parameters<typeof renderWithProviders>[1]) {
  return renderWithProviders(
    <>
      <HomePage />
      <LocationSearchProbe />
    </>,
    options
  );
}

// The date label renders as "Weekday" <br/> "Month d" (two text nodes split
// by a <br/>, no literal space between them) — join and compare instead of
// searching for a single flat string.
function dateHeading(text: string) {
  return (_content: string, element: Element | null) => {
    if (!element || element.tagName.toLowerCase() !== 'p') return false;
    const joined = Array.from(element.childNodes)
      .map((n) => (n.nodeType === Node.TEXT_NODE ? n.textContent : ' '))
      .join('')
      .replace(/\s+/g, ' ')
      .trim();
    return joined === text;
  };
}

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
  it('renders the latest session via the shared quick-view panel, shows outstanding balances, and navigates older sessions', async () => {
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
    ];

    renderHomePage({
      preloadedState: {
        club: makeClubState(),
        players: makePlayersState(players),
      },
    });

    expect(await screen.findByText('Latest Session')).toBeInTheDocument();
    // The reused quick-view panel renders its own date label and stats grid.
    expect(screen.getByText(dateHeading('Tuesday May 5'))).toBeInTheDocument();
    expect(screen.getByText('1 unpaid')).toBeInTheDocument();

    const [playersLabel] = screen.getAllByText('Players');
    expect(playersLabel.nextElementSibling).toHaveTextContent('2');
    expect(screen.getByText('Birdies used').nextElementSibling).toHaveTextContent('3');

    // Each attendee's own paid/unpaid status shows in the player list below —
    // disambiguated from the "Chris Ng"/"Jamie Lee" links in the outstanding
    // balances card on the right by scoping to the player row itself.
    const jamieRow = screen.getByText('Jamie Lee', { selector: 'span' }).closest('div') as HTMLElement;
    expect(jamieRow).toHaveTextContent('Unpaid');
    const chrisRow = screen.getByText('Chris Ng', { selector: 'span' }).closest('div') as HTMLElement;
    expect(chrisRow).toHaveTextContent('Paid');

    // No artificial cap on the outstanding-balances list.
    expect(screen.getByRole('link', { name: 'Chris Ng' })).toHaveAttribute('href', '/players?playerId=p2');
    expect(screen.getByRole('link', { name: 'Pat Kim' })).toHaveAttribute('href', '/players?playerId=p4');

    // "View details" deep-links into the calendar below via ?date=.
    await user.click(screen.getByRole('button', { name: 'View details' }));
    await waitFor(() => expect(screen.getByTestId('location-search')).toHaveTextContent('date=2026-05-05'));
    expect(screen.getByTestId('location-search')).not.toHaveTextContent('action');

    // "+ Add" deep-links the same way but also flags the add-session action.
    await user.click(screen.getByRole('button', { name: '+ Add' }));
    await waitFor(() => expect(screen.getByTestId('location-search')).toHaveTextContent('action=add'));

    await user.click(screen.getByTitle('Older session'));

    expect(await screen.findByText('Previous Session')).toBeInTheDocument();
    expect(screen.getByText(dateHeading('Tuesday April 28'))).toBeInTheDocument();
    expect(screen.getByText('Fully paid')).toBeInTheDocument();

    await user.click(screen.getByTitle('Newer session'));

    expect(await screen.findByText('Latest Session')).toBeInTheDocument();
  });

  it('renders the calendar wrapper and reloads sessions when the calendar callback fires', async () => {
    const user = userEvent.setup();
    jest.mocked(fetchSessions).mockResolvedValue([]);

    renderHomePage({
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

  it('shows a visible error with a Retry button when loading sessions fails, instead of silently showing nothing', async () => {
    const user = userEvent.setup();
    jest.mocked(fetchSessions).mockRejectedValueOnce(new Error('network down'));

    renderHomePage({
      preloadedState: {
        club: makeClubState(),
        players: makePlayersState([]),
      },
    });

    expect(await screen.findByText('Failed to load recent sessions.')).toBeInTheDocument();

    jest.mocked(fetchSessions).mockResolvedValueOnce([makeSession({ id: 'latest' })]);
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('Latest Session')).toBeInTheDocument();
    expect(screen.queryByText('Failed to load recent sessions.')).not.toBeInTheDocument();
  });
});
