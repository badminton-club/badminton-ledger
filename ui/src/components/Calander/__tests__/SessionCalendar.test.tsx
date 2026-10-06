import React from 'react';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Timestamp } from 'firebase/firestore';
import { useLocation } from 'react-router-dom';
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

function renderCalendar(route?: string, props?: { onDaySelected?: (date: Date) => void; highlightDate?: Date | null }) {
  return renderWithProviders(<SessionCalendar {...props} />, {
    route,
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
  it('loads the visible month, highlights a clicked day, and reports it via onDaySelected', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    const onDaySelected = jest.fn();
    seedSession('aug-10', new Date(2026, 7, 10), {
      location: 'Court A',
      totalCourtCost: 24,
      totalBirdieCost: 16,
      totalSessionCost: 40,
      players: [{ id: 'p1', percentage: 100, cost: 40, paid: false, comped: false, highlighted: false }],
    });

    renderCalendar(undefined, { onDaySelected });

    expect(await screen.findByRole('button', { name: 'August 2026' })).toBeInTheDocument();

    const dayCell = (await screen.findByText('10')).parentElement as HTMLElement;
    await user.click(dayCell);

    // No separate quick-view panel here anymore — the homepage pages its own
    // "Latest Session" card to match instead, via this callback.
    expect(onDaySelected).toHaveBeenCalledWith(new Date(2026, 7, 10));

    await user.click(within(dayCell).getByRole('button', { name: 'View session details' }));
    expect(screen.getByTestId('session-modal')).toHaveTextContent('aug-10');
  });

  it('jumps to the month containing highlightDate without opening any modal (unlike the ?date= deep link)', async () => {
    seedSession('sep-02', new Date(2026, 8, 2));

    renderCalendar(undefined, { highlightDate: new Date(2026, 8, 2) });

    // Starts on the current (fake-timer) month, August 2026, then jumps to
    // September once highlightDate is supplied as a prop.
    expect(await screen.findByRole('button', { name: 'September 2026' })).toBeInTheDocument();
    expect(await screen.findByText('2')).toBeInTheDocument();
    expect(screen.queryByTestId('session-modal')).not.toBeInTheDocument();
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
    await user.click(within((await screen.findByText('2')).parentElement as HTMLElement).getByRole('button', { name: 'View session details' }));
    expect(screen.getByTestId('session-modal')).toHaveTextContent('sep-02');

    await user.click(screen.getByRole('button', { name: '<' }));
    expect(await screen.findByRole('button', { name: 'August 2026' })).toBeInTheDocument();
    await user.click(within((await screen.findByText('10')).parentElement as HTMLElement).getByRole('button', { name: 'View session details' }));
    expect(screen.getByTestId('session-modal')).toHaveTextContent('aug-10');
  });

  it('opens a new-session modal immediately when an admin clicks an empty day', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    renderCalendar();

    await screen.findByRole('button', { name: 'August 2026' });
    await user.click((await screen.findByText('11')).parentElement as HTMLElement);

    expect(await screen.findByTestId('session-modal')).toHaveTextContent('new-session');
  });

  it('opens the View details modal straight from the calendar-grid expand button, without selecting the day first', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    seedSession('aug-10', new Date(2026, 7, 10), { location: 'Court A' });

    renderCalendar();

    await screen.findByRole('button', { name: 'August 2026' });
    const dayCell = (await screen.findByText('10')).parentElement as HTMLElement;

    // No prior click on the day — go straight for the expand shortcut.
    await user.click(within(dayCell).getByRole('button', { name: 'View session details' }));

    expect(screen.getByTestId('session-modal')).toHaveTextContent('aug-10');
  });

  it('does not show the expand shortcut on a day with no session', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    renderCalendar();

    await screen.findByRole('button', { name: 'August 2026' });
    const dayCell = (await screen.findByText('11')).parentElement as HTMLElement;

    expect(within(dayCell).queryByRole('button', { name: 'View session details' })).not.toBeInTheDocument();
  });

  it('lets a non-admin select an empty day without launching the admin-only add-session flow', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    const onDaySelected = jest.fn();
    renderWithProviders(<SessionCalendar onDaySelected={onDaySelected} />, {
      preloadedState: {
        club: makeClubState({ currentClubId: TEST_CLUB_ID, role: 'member' }),
        players: makePlayersState([makePlayer('p1', 'Alice', 'Zhang')]),
      },
    });

    await screen.findByRole('button', { name: 'August 2026' });
    await user.click((await screen.findByText('11')).parentElement as HTMLElement);

    expect(onDaySelected).toHaveBeenCalledWith(new Date(2026, 7, 11));
    expect(screen.queryByTestId('session-modal')).not.toBeInTheDocument();
  });

  it('opens the session-details popup directly for a /?date=YYYY-MM-DD deep link, without requiring a click', async () => {
    seedSession('aug-10', new Date(2026, 7, 10), { location: 'Court A' });

    renderCalendar('/?date=2026-08-10');

    expect(await screen.findByTestId('session-modal')).toHaveTextContent('aug-10');
  });

  it('selects the day but does not open a popup for a /?date= deep link with no session that day', async () => {
    const onDaySelected = jest.fn();
    renderCalendar('/?date=2026-08-11', { onDaySelected });

    await screen.findByRole('button', { name: 'August 2026' });
    expect(onDaySelected).not.toHaveBeenCalled();
    expect(screen.queryByTestId('session-modal')).not.toBeInTheDocument();
  });

  it('opens the add-session flow directly for a /?date=...&new=1 deep link with no session that day', async () => {
    renderCalendar('/?date=2026-08-11&new=1');

    expect(await screen.findByTestId('session-modal')).toHaveTextContent('new-session');
  });

  it('shows a court-credit badge on the calendar for the day a batch was purchased', async () => {
    seedClubDoc('courtCredits', 'c1', {
      name: 'Fall block',
      totalCost: 150,
      costPerHour: 15,
      hoursPurchased: 10,
      remainingHours: 10,
      purchaserName: 'Alex',
      purchaseDate: ts(new Date(2026, 7, 5)),
      createdAt: ts(new Date(2026, 7, 5)),
    });

    renderCalendar();

    await screen.findByRole('button', { name: 'August 2026' });
    const dayWithCredit = (await screen.findByText('5')).parentElement as HTMLElement;
    expect(within(dayWithCredit).getByRole('button', { name: /\+10 court credit hours added/ })).toBeInTheDocument();
  });

  it('navigates to the Credits page for that batch when the court-credit badge is clicked', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    seedClubDoc('courtCredits', 'c1', {
      name: 'Fall block',
      totalCost: 150,
      costPerHour: 15,
      hoursPurchased: 10,
      remainingHours: 10,
      purchaserName: 'Alex',
      purchaseDate: ts(new Date(2026, 7, 5)),
      createdAt: ts(new Date(2026, 7, 5)),
    });

    function LocationProbe() {
      const location = useLocation();
      return <div data-testid="location">{location.pathname}{location.search}</div>;
    }

    renderWithProviders(
      <>
        <SessionCalendar />
        <LocationProbe />
      </>,
      {
        preloadedState: {
          club: makeClubState({ currentClubId: TEST_CLUB_ID }),
          players: makePlayersState([]),
        },
      }
    );

    await screen.findByRole('button', { name: 'August 2026' });
    await user.click(await screen.findByRole('button', { name: /\+10 court credit hours added/ }));

    expect(screen.getByTestId('location')).toHaveTextContent('/credits?batchId=c1');
  });
});
