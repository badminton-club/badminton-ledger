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
import { __seedDoc, __getDocData } from '../../test-utils/fakeFirestore';
import AttendancePage from '../AttendancePage';
import type { Player } from 'types';

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

function makePlayer(overrides: Partial<Player> = {}): Player {
  return {
    id: 'p1',
    firstName: 'Grace',
    firstNameLower: 'grace',
    lastName: 'Hopper',
    lastNameLower: 'hopper',
    email: 'grace@example.com',
    balance: 0,
    owed: 0,
    description: '',
    sessionCount: 0,
    createdAt: undefined as never,
    ...overrides,
  };
}

beforeEach(() => {
  jest.mocked(fetchPlayerLedger).mockImplementation(
    jest.requireActual('../../services/firebase/attendance').fetchPlayerLedger
  );
  resetFirebaseTestState();
  setCurrentUser(currentUser);
});

function renderPage(
  players: Parameters<typeof makePlayersState>[0] = [],
  role: 'member' | 'admin' = 'member'
) {
  return renderWithProviders(<AttendancePage />, {
    preloadedState: {
      club: makeClubState({ currentClubId: TEST_CLUB_ID, role }),
      players: makePlayersState(players),
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

  it('lets an admin select any player and view that player\'s attendance', async () => {
    const user = userEvent.setup();
    const grace = makePlayer();
    const ada = makePlayer({
      id: 'p2',
      firstName: 'Ada',
      firstNameLower: 'ada',
      lastName: 'Lovelace',
      lastNameLower: 'lovelace',
      email: 'ada@example.com',
    });
    seedMemberDoc(currentUser.uid, { role: 'admin', playerId: 'p1' });
    seedClubDoc('sessions', 'grace-session', {
      date: ts('2026-01-05'),
      players: [{ id: 'p1', percentage: 100, cost: 20, paid: true, highlighted: false }],
      birdieUsage: [], courtCreditUsage: [],
    });
    seedClubDoc('sessions', 'ada-session', {
      date: ts('2026-02-10T12:00:00'),
      players: [{ id: 'p2', percentage: 100, cost: 15, paid: false, highlighted: false }],
      birdieUsage: [], courtCreditUsage: [],
    });
    seedClubDoc('balanceLedger', 'ada-ledger', {
      playerId: 'p2', delta: -15, reason: 'session', note: 'Ada session charge',
      balanceBefore: 20, balanceAfter: 5, createdAt: ts('2026-02-10T12:00:00'),
    });

    // Ada appears first, but the signed-in admin is linked to Grace.
    renderPage([ada, grace], 'admin');

    const selector = await screen.findByRole('combobox', { name: 'View attendance for' });
    expect(selector).toHaveValue('p1');
    await user.selectOptions(selector, 'p2');

    expect(await screen.findByText('Ada session charge')).toBeInTheDocument();
    expect(screen.getByText('Feb 10, 2026')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit details' })).not.toBeInTheDocument();
  });

  it('lets an already-linked member submit a details-edit request for admin approval', async () => {
    const user = userEvent.setup();
    seedMemberDoc(currentUser.uid, { role: 'member', playerId: 'p1' });
    const player = makePlayer({ firstName: 'Grace', lastName: 'Hopper', email: 'grace@old.com' });

    renderPage([player]);
    await screen.findByText('Grace Hopper');

    await user.click(screen.getByRole('button', { name: 'Edit details' }));
    const textboxes = screen.getAllByRole('textbox');
    expect(textboxes[0]).toHaveValue('Grace'); // prefilled from the current player record
    expect(textboxes[1]).toHaveValue('Hopper');
    expect(textboxes[2]).toHaveValue('grace@old.com');

    await user.clear(textboxes[2]);
    await user.type(textboxes[2], 'grace@new.com');
    await user.click(screen.getByRole('button', { name: 'Submit for approval' }));

    expect(await screen.findByText(/awaiting admin approval/)).toBeInTheDocument();
    // The player record itself must be untouched — only a pending request was written.
    expect(__getDocData(`clubs/${TEST_CLUB_ID}/profileEditRequests/${currentUser.uid}`)).toMatchObject({
      playerId: 'p1', firstName: 'Grace', lastName: 'Hopper', email: 'grace@new.com',
    });
  });

  it('shows the pending-approval banner (instead of the edit button) when a request is already pending', async () => {
    seedMemberDoc(currentUser.uid, { role: 'member', playerId: 'p1' });
    __seedDoc(`clubs/${TEST_CLUB_ID}/profileEditRequests/${currentUser.uid}`, {
      uid: currentUser.uid, playerId: 'p1', firstName: 'Grace', lastName: 'H.', email: 'grace@example.com',
    });

    renderPage([makePlayer()]);

    expect(await screen.findByText(/awaiting admin approval/)).toBeInTheDocument();
  });

  it('prefills "Edit details" from the pending request, not the stale live player record, and blocks resubmitting it unchanged', async () => {
    const user = userEvent.setup();
    seedMemberDoc(currentUser.uid, { role: 'member', playerId: 'p1' });
    const player = makePlayer({ firstName: 'Grace', lastName: 'Hopper', email: 'grace@old.com' });
    __seedDoc(`clubs/${TEST_CLUB_ID}/profileEditRequests/${currentUser.uid}`, {
      uid: currentUser.uid, playerId: 'p1', firstName: 'Grace', lastName: 'Hopper-Smith', email: 'grace@new.com',
    });

    renderPage([player]);
    await screen.findByText(/awaiting admin approval/);

    await user.click(screen.getByRole('button', { name: 'Edit details' }));
    const textboxes = screen.getAllByRole('textbox');
    // Prefilled from the PENDING proposal, not the live player record above.
    expect(textboxes[0]).toHaveValue('Grace');
    expect(textboxes[1]).toHaveValue('Hopper-Smith');
    expect(textboxes[2]).toHaveValue('grace@new.com');

    // Resubmitting the exact same (already-pending) proposal is a no-op —
    // must be blocked rather than silently rewriting the pending request.
    await user.click(screen.getByRole('button', { name: 'Submit for approval' }));
    expect(await screen.findByText('Nothing has changed from your pending request.')).toBeInTheDocument();
  });

  it('blocks submitting a details-edit request with nothing actually changed from the live player record', async () => {
    const user = userEvent.setup();
    seedMemberDoc(currentUser.uid, { role: 'member', playerId: 'p1' });
    const player = makePlayer({ firstName: 'Grace', lastName: 'Hopper', email: 'grace@old.com' });

    renderPage([player]);
    await screen.findByText('Grace Hopper');

    await user.click(screen.getByRole('button', { name: 'Edit details' }));
    await user.click(screen.getByRole('button', { name: 'Submit for approval' }));

    expect(await screen.findByText('Nothing has changed from your current details.')).toBeInTheDocument();
    expect(__getDocData(`clubs/${TEST_CLUB_ID}/profileEditRequests/${currentUser.uid}`)).toBeUndefined();
  });

  it('shows an error message if the initial data load fails', async () => {
    seedMemberDoc(currentUser.uid, { role: 'member', playerId: 'p1' });
    jest.mocked(fetchPlayerLedger).mockRejectedValueOnce(new Error('boom'));

    renderPage();

    expect(await screen.findByText('Failed to load your attendance.')).toBeInTheDocument();
  });
});
