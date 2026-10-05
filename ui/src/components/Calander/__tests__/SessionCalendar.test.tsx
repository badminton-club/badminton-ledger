import React from 'react';
import { screen, within } from '@testing-library/react';
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

// The date header renders as "Weekday" <br/> "Month d" (two lines, no
// comma), so its text is split across sibling text nodes within one <p>.
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

function renderCalendar(route?: string) {
  return renderWithProviders(<SessionCalendar />, {
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

    expect(screen.queryByText('Select a day to see session details')).not.toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'August 2026' })).toBeInTheDocument();

    await user.click((await screen.findByText('10')).parentElement as HTMLElement);

    expect(await screen.findByText(dateHeading('Monday August 10'))).toBeInTheDocument();
    expect(screen.getByText('1 unpaid')).toBeInTheDocument();
    // Compact: no stats grid/cost breakdown/player list here — the homepage
    // already shows that detail in its own "Latest Session" card, so
    // repeating it in the calendar's side panel would just be duplicated.
    expect(screen.queryByText('Total cost')).not.toBeInTheDocument();
    expect(screen.queryByText('Court A')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'View details' }));
    expect(screen.getByTestId('session-modal')).toHaveTextContent('aug-10');
  });

  it('gives the calendar the full width when no day is selected, and reserves room for the quick-view panel once one is', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    seedSession('aug-10', new Date(2026, 7, 10), { location: 'Court A' });

    const { container } = renderCalendar();
    await screen.findByRole('button', { name: 'August 2026' });

    // Only the calendar panel renders — no quick-view placeholder panel is
    // mounted at all, so the calendar panel (flex: 1) can use the full width.
    const outerWrap = container.firstChild as HTMLElement;
    expect(outerWrap.children).toHaveLength(1);

    await user.click((await screen.findByText('10')).parentElement as HTMLElement);
    await screen.findByText(dateHeading('Monday August 10'));

    // The quick-view panel now takes up its own space alongside the calendar.
    expect(outerWrap.children).toHaveLength(2);
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
    expect(await screen.findByText(dateHeading('Wednesday September 2'))).toBeInTheDocument();
    expect(screen.getByText('Fully paid')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '<' }));
    expect(await screen.findByRole('button', { name: 'August 2026' })).toBeInTheDocument();

    await user.click((await screen.findByText('10')).parentElement as HTMLElement);
    expect(await screen.findByText(dateHeading('Monday August 10'))).toBeInTheDocument();
  });

  it('opens a new-session modal immediately when an admin clicks an empty day', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    renderCalendar();

    await screen.findByRole('button', { name: 'August 2026' });
    await user.click((await screen.findByText('11')).parentElement as HTMLElement);

    expect(await screen.findByText(dateHeading('Tuesday August 11'))).toBeInTheDocument();
    expect(screen.getByText('No session this day')).toBeInTheDocument();
    expect(screen.getByTestId('session-modal')).toHaveTextContent('new-session');
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
    renderWithProviders(<SessionCalendar />, {
      preloadedState: {
        club: makeClubState({ currentClubId: TEST_CLUB_ID, role: 'member' }),
        players: makePlayersState([makePlayer('p1', 'Alice', 'Zhang')]),
      },
    });

    await screen.findByRole('button', { name: 'August 2026' });
    await user.click((await screen.findByText('11')).parentElement as HTMLElement);

    expect(await screen.findByText(dateHeading('Tuesday August 11'))).toBeInTheDocument();
    expect(screen.getByText('No session this day')).toBeInTheDocument();
    expect(screen.queryByTestId('session-modal')).not.toBeInTheDocument();
  });

  it('deselects the day when navigating months, so "+ Add Session" cannot silently create a session in the month navigated away from', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    seedSession('aug-10', new Date(2026, 7, 10), { location: 'Court A' });

    renderCalendar();

    await screen.findByRole('button', { name: 'August 2026' });
    await user.click((await screen.findByText('10')).parentElement as HTMLElement);
    expect(await screen.findByText(dateHeading('Monday August 10'))).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '>' }));
    expect(await screen.findByRole('button', { name: 'September 2026' })).toBeInTheDocument();

    // The selected-day panel must go back to its empty state — not keep
    // showing (or silently targeting) August 10 from before navigating. The
    // panel itself is now unmounted entirely (rather than showing a "Select
    // a day…" placeholder) so the calendar can use the freed-up width.
    expect(screen.queryByText('Select a day to see session details')).not.toBeInTheDocument();
    expect(screen.queryByText(dateHeading('Monday August 10'))).not.toBeInTheDocument();
  });

  it('opens the session-details popup directly for a /?date=YYYY-MM-DD deep link, without requiring a click', async () => {
    seedSession('aug-10', new Date(2026, 7, 10), { location: 'Court A' });

    renderCalendar('/?date=2026-08-10');

    expect(await screen.findByTestId('session-modal')).toHaveTextContent('aug-10');
    // The day is also selected in the inline quick-view panel underneath.
    expect(await screen.findByText(dateHeading('Monday August 10'))).toBeInTheDocument();
  });

  it('selects the day but does not open a popup for a /?date= deep link with no session that day', async () => {
    renderCalendar('/?date=2026-08-11');

    expect(await screen.findByText(dateHeading('Tuesday August 11'))).toBeInTheDocument();
    expect(screen.queryByTestId('session-modal')).not.toBeInTheDocument();
  });

  it('opens the add-session flow directly for a /?date=...&new=1 deep link with no session that day', async () => {
    renderCalendar('/?date=2026-08-11&new=1');

    expect(await screen.findByText(dateHeading('Tuesday August 11'))).toBeInTheDocument();
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
    expect(within(dayWithCredit).getByText('💳+10')).toBeInTheDocument();
  });
});
