import React from 'react';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders, makeClubState, makePlayersState } from '../../test-utils/renderWithProviders';
import {
  resetFirebaseTestState,
  seedClubDoc,
  seedMemberDoc,
  setCurrentUser,
  TEST_CLUB_ID,
  ts,
} from '../../test-utils/firebaseTestHelpers';
import { fetchPlayerLedger } from '../../services/firebase/attendance';
import { __seedDoc } from '../../test-utils/fakeFirestore';
import AttendancePage from '../AttendancePage';

// Full integration-style test: seeds the fake Firestore/Auth directly and lets
// AttendancePage's real service calls (fetchMemberPlayerId, fetchPlayerLedger,
// fetchSessions, fetchMyLinkRequest, submitLinkRequest) run against them —
// no service mocking needed, exercising the real request/response wiring.
// The one exception is the last test below, which needs a failure that isn't
// reachable through the fake Firestore — that uses a real `jest.mock` (hoisted,
// module-level; a runtime `jest.spyOn` on a frozen ES module export throws
// "Cannot redefine property").
jest.mock('../../services/firebase/attendance', () => ({
  ...jest.requireActual('../../services/firebase/attendance'),
  fetchPlayerLedger: jest.fn(jest.requireActual('../../services/firebase/attendance').fetchPlayerLedger),
}));

const currentUser = { uid: 'user-1', displayName: 'Grace Hopper', email: 'grace@example.com' };

beforeEach(() => {
  jest.mocked(fetchPlayerLedger).mockImplementation(
    jest.requireActual('../../services/firebase/attendance').fetchPlayerLedger
  );
  resetFirebaseTestState();
  setCurrentUser(currentUser);
});

function renderPage() {
  return renderWithProviders(<AttendancePage />, {
    preloadedState: {
      club: makeClubState({ currentClubId: TEST_CLUB_ID }),
      players: makePlayersState([]),
    },
  });
}

describe('AttendancePage', () => {
  it('shows a link-request form when the signed-in user has no linked player, prefilled from their Google profile', async () => {
    renderPage();

    expect(await screen.findByText(/not linked to a player/)).toBeInTheDocument();
    const textboxes = screen.getAllByRole('textbox');
    expect(textboxes[0]).toHaveValue('Grace'); // first name, prefilled from displayName
    expect(textboxes[1]).toHaveValue('Hopper'); // last name
    expect(textboxes[2]).toHaveValue('grace@example.com'); // email
  });

  it('submits a link request and shows the pending-confirmation message', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText(/not linked to a player/);

    await user.click(screen.getByRole('button', { name: 'Send request' }));

    expect(await screen.findByText(/request to be linked was sent/)).toBeInTheDocument();
  });

  it('shows an already-pending message instead of the form if a link request already exists', async () => {
    seedClubDoc('sessions', 'unused', { date: ts('2026-01-01'), players: [], birdieUsage: [], courtCreditUsage: [] });
    __seedDoc(`clubs/${TEST_CLUB_ID}/linkRequests/${currentUser.uid}`, {
      uid: currentUser.uid, firstName: 'Grace', lastName: 'Hopper', email: 'grace@example.com',
    });

    renderPage();

    expect(await screen.findByText(/request to be linked was sent/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send request' })).not.toBeInTheDocument();
  });

  it('shows the ledger and attended sessions for an already-linked player', async () => {
    seedMemberDoc(currentUser.uid, { role: 'member', playerId: 'p1' });
    seedClubDoc('balanceLedger', 'l1', {
      playerId: 'p1', delta: 20, reason: 'payment', note: 'Marked paid',
      balanceBefore: 0, balanceAfter: 0, createdAt: ts('2026-01-05'),
    });
    seedClubDoc('sessions', 's1', {
      date: ts('2026-01-05'), players: [{ id: 'p1', percentage: 100, cost: 20, paid: true, highlighted: false }],
      birdieUsage: [], courtCreditUsage: [],
    });

    renderPage();

    expect(await screen.findByText('Marked paid')).toBeInTheDocument();
    expect(screen.queryByText(/not linked to a player/)).not.toBeInTheDocument();
  });

  it('shows an error message if the initial data load fails', async () => {
    seedMemberDoc(currentUser.uid, { role: 'member', playerId: 'p1' });
    jest.mocked(fetchPlayerLedger).mockRejectedValueOnce(new Error('boom'));

    renderPage();

    expect(await screen.findByText('Failed to load your attendance.')).toBeInTheDocument();
  });
});
