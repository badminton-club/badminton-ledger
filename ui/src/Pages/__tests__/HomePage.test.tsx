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
  default: ({ onSessionsChanged, onDaySelected }: { onSessionsChanged?: () => void; onDaySelected?: (date: Date) => void }) => (
    <>
      <button type="button" onClick={onSessionsChanged}>
        Mock calendar
      </button>
      <button type="button" onClick={() => onDaySelected?.(new Date('2026-04-28T19:00:00.000Z'))}>
        Mock day click
      </button>
    </>
  ),
}));

// Exposes the current URL query string so tests can verify HomePage
// deep-links into the (mocked-away) calendar via ?date=, without needing a
// real SessionCalendar mounted to observe it.
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
      makePlayer({ id: 'p5', firstName: 'Drew', firstNameLower: 'drew', lastName: 'Bell', lastNameLower: 'bell', balance: -12 }),
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

    // "Owed" (unsettled session dues) and "overdrawn" (negative prepaid
    // balance) are distinct concerns shown in their own sub-lists — Drew Bell
    // only has a negative balance (no owed dues), so they appear in the
    // Overdrawn section but not the "Owe for sessions" one.
    expect(screen.getByText('Owe for sessions')).toBeInTheDocument();
    expect(screen.getByText('Overdrawn balance')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Drew Bell' })).toHaveAttribute('href', '/players?playerId=p5');
    expect(screen.getByText('Overdrawn $12.00')).toBeInTheDocument();
    expect(screen.queryByText('No players are overdrawn.')).not.toBeInTheDocument();

    // "+ Add" doesn't make sense while browsing an already-existing session
    // (there's no "day" being picked, just a session being paged through).
    expect(screen.queryByRole('button', { name: '+ Add' })).not.toBeInTheDocument();

    // "View details" deep-links into the calendar below via ?date=.
    await user.click(screen.getByRole('button', { name: 'View details' }));
    await waitFor(() => expect(screen.getByTestId('location-search')).toHaveTextContent('date=2026-05-05'));

    await user.click(screen.getByTitle('Older session'));

    expect(await screen.findByText('Previous Session')).toBeInTheDocument();
    expect(screen.getByText(dateHeading('Tuesday April 28'))).toBeInTheDocument();
    expect(screen.getByText('Fully paid')).toBeInTheDocument();

    await user.click(screen.getByTitle('Newer session'));

    expect(await screen.findByText('Latest Session')).toBeInTheDocument();
  });

  it('pages the Latest/Previous Session card to match a day clicked in the calendar below, so the two stay in sync', async () => {
    const user = userEvent.setup();
    jest.mocked(fetchSessions).mockResolvedValue([
      makeSession({ id: 'latest', date: new Date('2026-05-05T19:00:00.000Z') }),
      makeSession({ id: 'older', date: new Date('2026-04-28T19:00:00.000Z') }),
    ]);

    renderHomePage({
      preloadedState: {
        club: makeClubState(),
        players: makePlayersState([]),
      },
    });

    expect(await screen.findByText('Latest Session')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Mock day click' }));

    expect(await screen.findByText('Previous Session')).toBeInTheDocument();
    expect(screen.getByText(dateHeading('Tuesday April 28'))).toBeInTheDocument();
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

    expect(screen.getByText('No players owe for sessions.')).toBeInTheDocument();
    expect(screen.getByText('No players are overdrawn.')).toBeInTheDocument();
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

  it('lets an admin add a new session for today via a dedicated button, deep-linking into the calendar', async () => {
    const user = userEvent.setup();
    jest.mocked(fetchSessions).mockResolvedValue([]);

    renderHomePage({
      preloadedState: {
        club: makeClubState(),
        players: makePlayersState([]),
      },
    });

    await user.click(screen.getByRole('button', { name: '+ Add Session' }));

    // Reuses the same ?date= deep-link the calendar below watches for, plus a
    // "new=1" flag so it opens the add-session flow straight away instead of
    // just selecting today's (likely empty) day.
    await waitFor(() => {
      const search = screen.getByTestId('location-search').textContent ?? '';
      expect(search).toMatch(/date=\d{4}-\d{2}-\d{2}/);
      expect(search).toContain('new=1');
    });
  });

  it('hides the "+ Add Session" button for a non-admin', async () => {
    jest.mocked(fetchSessions).mockResolvedValue([]);

    renderHomePage({
      preloadedState: {
        club: makeClubState({ role: 'member' }),
        players: makePlayersState([]),
      },
    });

    await screen.findByText('No players owe for sessions.');
    expect(screen.queryByRole('button', { name: '+ Add Session' })).not.toBeInTheDocument();
  });
});
