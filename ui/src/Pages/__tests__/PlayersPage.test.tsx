import React from 'react';
import { format } from 'date-fns';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PlayersPage from '../PlayersPage';
import { setPlayers } from '../../features/players/playersSlice';
import {
  getClubDocData,
  resetFirebaseTestState,
  seedClubDoc,
  TEST_CLUB_ID,
  ts,
} from '../../test-utils/firebaseTestHelpers';
import { __seedDoc, __getDocData, Timestamp } from '../../test-utils/fakeFirestore';
import {
  makeClubState,
  makePlayersState,
  renderWithProviders,
} from '../../test-utils/renderWithProviders';
import type { Player, SessionPlayer } from '../../types';

function makePlayer(overrides: Partial<Player> = {}): Player {
  return {
    id: 'p1',
    firstName: 'Ada',
    firstNameLower: 'ada',
    lastName: 'Lovelace',
    lastNameLower: 'lovelace',
    email: null,
    balance: 0,
    owed: 0,
    description: '',
    sessionCount: 0,
    createdAt: undefined as never,
    ...overrides,
  };
}

function makeSessionPlayer(overrides: Partial<SessionPlayer> = {}): SessionPlayer {
  return {
    id: 'p1',
    percentage: 100,
    cost: 20,
    paid: false,
    comped: false,
    highlighted: false,
    ...overrides,
  };
}

function seedSession(
  id: string,
  {
    date = ts(new Date()),
    location,
    players = [],
  }: {
    date?: ReturnType<typeof ts>;
    location?: string;
    players?: SessionPlayer[];
  } = {}
) {
  seedClubDoc('sessions', id, {
    id,
    date,
    location,
    durationHours: 2,
    courtCount: 2,
    totalCost: 20,
    totalCourtCost: 20,
    totalBirdieCost: 0,
    totalSessionCost: 20,
    birdieUsage: [],
    courtCreditUsage: [],
    players,
    createdAt: ts(new Date(2026, 0, 1)),
  });
}

function seedLedgerEntry(
  id: string,
  overrides: Record<string, unknown>
) {
  seedClubDoc('balanceLedger', id, {
    playerId: 'p1',
    sessionId: null,
    delta: 0,
    balanceBefore: 0,
    balanceAfter: 0,
    reason: 'manual',
    note: '',
    createdAt: ts(new Date(2026, 0, 1, 12, 0)),
    walletAdjustment: true,
    ...overrides,
  });
}

function renderPage({
  players,
  route = '/',
  role = 'admin',
  disabledTabs = [],
}: {
  players: Player[];
  route?: string;
  role?: 'admin' | 'superAdmin' | 'member';
  disabledTabs?: string[];
}) {
  players.forEach(({ id, ...data }) => {
    seedClubDoc('players', id, data);
  });

  return renderWithProviders(<PlayersPage />, {
    route,
    preloadedState: {
      club: makeClubState({
        currentClubId: TEST_CLUB_ID,
        role,
        clubs: [{ id: TEST_CLUB_ID, name: 'Test Club', role }],
        disabledTabs,
      }),
      players: makePlayersState(players),
    },
  });
}

beforeEach(() => {
  resetFirebaseTestState();
});

describe('PlayersPage', () => {
  it('renders the player list, owed badges, search results, and selected-player summary', async () => {
    const user = userEvent.setup();
    const players = [
      makePlayer({
        id: 'p1',
        firstName: 'Ada',
        lastName: 'Lovelace',
        balance: 12.5,
        owed: 3.5,
        description: 'League coordinator',
        sessionCount: 4,
      }),
      makePlayer({
        id: 'p2',
        firstName: 'Bea',
        firstNameLower: 'bea',
        lastName: null,
        lastNameLower: null,
        balance: -4,
      }),
    ];

    renderPage({ players });

    expect(screen.getByText('Select a player to view details.')).toBeInTheDocument();
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByText('Bea')).toBeInTheDocument();
    expect(screen.getByText('$3.50 owed')).toBeInTheDocument();
    expect(screen.getByText('Overdrawn $4.00')).toBeInTheDocument();
    expect(screen.queryByText('Overdrawn $12.50')).not.toBeInTheDocument();

    await user.type(screen.getByPlaceholderText(/Search by name/), 'zoe');
    expect(screen.getByText('No players matching "zoe"')).toBeInTheDocument();

    await user.clear(screen.getByPlaceholderText(/Search by name/));
    await user.click(screen.getByText('Ada Lovelace'));

    expect(await screen.findByText('(Prepaid credit)')).toBeInTheDocument();
    expect(await screen.findByText('No balance history yet.')).toBeInTheDocument();
    expect(await screen.findByText('No sessions attended this month.')).toBeInTheDocument();
    expect(screen.getByText('$12.50')).toBeInTheDocument();
    expect(screen.getByText('Total Sessions attended: 4')).toBeInTheDocument();
    expect(screen.getByText('League coordinator')).toBeInTheDocument();
    expect(
      await screen.findByText(new RegExp(`Sessions attended in ${new Date().getFullYear()}: 0`))
    ).toBeInTheDocument();
  });

  it('loads wallet-only balance history and the selected player’s sessions', async () => {
    const now = new Date();
    const currentMonthSession = new Date(now.getFullYear(), now.getMonth(), 14, 19, 30);
    const previousMonthSession = new Date(now.getFullYear(), now.getMonth() - 1, 9, 19, 30);
    const previousYearSession = new Date(now.getFullYear() - 1, now.getMonth(), 5, 19, 30);
    const newestLedgerDate = new Date(now.getFullYear(), now.getMonth(), 20, 18, 45);
    const middleLedgerDate = new Date(now.getFullYear(), now.getMonth(), 19, 17, 15);
    const oldestLedgerDate = new Date(now.getFullYear(), now.getMonth(), 18, 16, 0);

    const players = [
      makePlayer({ id: 'p1', balance: 30, sessionCount: 7 }),
      makePlayer({
        id: 'p2',
        firstName: 'Grace',
        firstNameLower: 'grace',
        lastName: 'Hopper',
        lastNameLower: 'hopper',
        balance: 40,
      }),
    ];

    seedLedgerEntry('l1', {
      playerId: 'p1',
      reason: 'manual-excluded',
      delta: -5,
      balanceBefore: 15,
      balanceAfter: 10,
      note: 'Fix scoring import',
      createdAt: ts(newestLedgerDate),
    });
    seedLedgerEntry('l2', {
      playerId: 'p1',
      reason: 'manual',
      delta: 20,
      balanceBefore: 10,
      balanceAfter: 30,
      note: 'Cash top-up',
      createdAt: ts(middleLedgerDate),
      voided: true,
      voidedNote: 'Entered twice',
    });
    seedLedgerEntry('l3', {
      playerId: 'p1',
      reason: 'settlement',
      delta: -15,
      balanceBefore: 30,
      balanceAfter: 15,
      note: 'Settled from prepaid balance — session on current month date',
      createdAt: ts(oldestLedgerDate),
    });
    seedLedgerEntry('l4', {
      playerId: 'p1',
      reason: 'payment',
      delta: 15,
      balanceBefore: 30,
      balanceAfter: 30,
      note: 'Paid by e-Transfer',
      createdAt: ts(new Date(now.getFullYear(), now.getMonth(), 17, 12, 0)),
    });
    seedLedgerEntry('l5', {
      playerId: 'p1',
      reason: 'manual',
      delta: 9,
      balanceBefore: 30,
      balanceAfter: 30,
      note: 'Owner-only record',
      walletAdjustment: false,
      createdAt: ts(new Date(now.getFullYear(), now.getMonth(), 16, 12, 0)),
    });

    seedSession('s1', {
      date: ts(currentMonthSession),
      location: 'Community Centre',
      players: [makeSessionPlayer({ id: 'p1', cost: 15 })],
    });
    seedSession('s2', {
      date: ts(previousMonthSession),
      players: [makeSessionPlayer({ id: 'p1', cost: 9 })],
    });
    seedSession('s3', {
      date: ts(previousYearSession),
      players: [makeSessionPlayer({ id: 'p1', cost: 11 })],
    });

    renderPage({ players, route: '/?playerId=p1' });

    expect(await screen.findByText('Manual (off payout)')).toBeInTheDocument();
    expect(screen.getByText('Undone')).toBeInTheDocument();
    expect(screen.getByText(format(newestLedgerDate, 'MMM d, yy h:mm a'))).toBeInTheDocument();
    expect(screen.queryByText('Paid by e-Transfer')).not.toBeInTheDocument();
    expect(screen.queryByText('Owner-only record')).not.toBeInTheDocument();

    const table = screen.getByRole('table');
    const rows = within(table).getAllByRole('row').slice(1);
    expect(within(rows[0]).getByText('Fix scoring import')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Cash top-up')).toBeInTheDocument();
    expect(within(rows[2]).getByText('Settled from prepaid balance — session on current month date')).toBeInTheDocument();
    expect(within(rows[2]).getByText('Session')).toBeInTheDocument();

    expect(
      await screen.findByText(new RegExp(`Sessions attended in ${now.getFullYear()}: 2`))
    ).toBeInTheDocument();
    const sessionLink = await screen.findByRole('link', {
      name: format(currentMonthSession, 'MMM d, yyyy'),
    });
    expect(sessionLink).toHaveAttribute('href', `/?date=${format(currentMonthSession, 'yyyy-MM-dd')}`);
    expect(screen.getByText('at Community Centre')).toBeInTheDocument();
    expect(screen.queryByText(format(previousMonthSession, 'MMM d, yyyy'))).not.toBeInTheDocument();
  });

  it('labels a session auto-settled from a Gmail e-Transfer as "Gmail e-Transfer" instead of plain "Balance"', async () => {
    const now = new Date();
    const currentMonthSession = new Date(now.getFullYear(), now.getMonth(), 14, 19, 30);
    const players = [makePlayer({ id: 'p1', balance: 30 })];

    seedSession('s1', {
      date: ts(currentMonthSession),
      players: [makeSessionPlayer({
        id: 'p1', cost: 15, paid: true, paidVia: 'balance', settledByEtransferImportId: 'msg-1',
      })],
    });

    renderPage({ players, route: '/?playerId=p1' });

    expect(await screen.findByRole('button', { name: 'Gmail e-Transfer' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Balance' })).not.toBeInTheDocument();
  });

  it('validates manual balance adjustments before submitting', async () => {
    const user = userEvent.setup();
    const players = [makePlayer({ id: 'p1', balance: 20 })];

    renderPage({ players, route: '/?playerId=p1' });

    const amountInput = screen.getByPlaceholderText('Amount');
    const reasonInput = screen.getByPlaceholderText(/Reason \(e\.g\., Cash Payment\)/);
    expect(await screen.findByText('No balance history yet.')).toBeInTheDocument();

    await user.type(amountInput, '0');
    await user.type(reasonInput, 'Cash top-up');
    await user.click(screen.getByRole('button', { name: 'Update Balance' }));
    expect(await screen.findByText('Enter a valid non-zero amount.')).toBeInTheDocument();

    await user.clear(amountInput);
    await user.type(amountInput, '5');
    await user.clear(reasonInput);
    await user.click(screen.getByRole('button', { name: 'Update Balance' }));
    expect(await screen.findByText('Reason is required.')).toBeInTheDocument();
    expect(getClubDocData('players', 'p1')).toMatchObject({ balance: 20 });
    expect(getClubDocData('balanceLedger', 'auto-id-1')).toBeUndefined();
  });

  it('records an included-in-payout manual credit and resets the form', async () => {
    const user = userEvent.setup();
    const players = [makePlayer({ id: 'p1', balance: 20 })];

    renderPage({ players, route: '/?playerId=p1' });

    const amountInput = screen.getByPlaceholderText('Amount') as HTMLInputElement;
    const reasonInput = screen.getByPlaceholderText(/Reason \(e\.g\., Cash Payment\)/);

    expect(await screen.findByText('No balance history yet.')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Include in owner payout' })).toBeChecked();

    await user.type(amountInput, '7.5');
    await user.type(reasonInput, '  Cash top-up  ');
    await user.click(screen.getByRole('button', { name: 'Update Balance' }));

    await waitFor(() => expect(getClubDocData('players', 'p1')).toMatchObject({ balance: 27.5 }));
    expect(getClubDocData('balanceLedger', 'auto-id-1')).toMatchObject({
      playerId: 'p1',
      sessionId: null,
      delta: 7.5,
      balanceBefore: 20,
      balanceAfter: 27.5,
      reason: 'manual',
      note: 'Cash top-up',
      walletAdjustment: true,
      createdAt: expect.any(Timestamp),
    });
    expect(await screen.findByText('Cash top-up')).toBeInTheDocument();
    expect(reasonInput).toHaveValue('');
    expect(amountInput.value).toBe('');
  });

  it('records an off-payout manual debit when the checkbox is unchecked', async () => {
    const user = userEvent.setup();
    const players = [makePlayer({ id: 'p1', balance: 20 })];

    renderPage({ players, route: '/?playerId=p1' });

    expect(await screen.findByText('No balance history yet.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add (+)' }));
    await user.click(screen.getByText('Deduct from balance (-)'));
    await user.clear(screen.getByPlaceholderText('Amount'));
    await user.type(screen.getByPlaceholderText('Amount'), '5');
    await user.type(screen.getByPlaceholderText(/Reason \(e\.g\., Cash Payment\)/), 'Correction');
    await user.click(screen.getByRole('checkbox', { name: 'Include in owner payout' }));
    await user.click(screen.getByRole('button', { name: 'Update Balance' }));

    await waitFor(() => expect(getClubDocData('players', 'p1')).toMatchObject({ balance: 15 }));
    expect(getClubDocData('balanceLedger', 'auto-id-1')).toMatchObject({
      playerId: 'p1',
      delta: -5,
      balanceBefore: 20,
      balanceAfter: 15,
      reason: 'manual-excluded',
      note: 'Correction',
    });
    expect(await screen.findByText('Manual (off payout)')).toBeInTheDocument();
  });

  it('stacks quick-add clicks (clicking +10 twice gives 20) and switches to credit', async () => {
    const user = userEvent.setup();
    const players = [makePlayer({ id: 'p1', balance: 20 })];

    renderPage({ players, route: '/?playerId=p1' });

    expect(await screen.findByText('No balance history yet.')).toBeInTheDocument();
    const amountInput = screen.getByPlaceholderText('Amount') as HTMLInputElement;

    // Switch to debit first, to prove the quick-add button flips it back to credit
    // and starts fresh rather than subtracting from a deduction.
    await user.click(screen.getByRole('button', { name: 'Add (+)' }));
    await user.click(screen.getByText('Deduct from balance (-)'));

    await user.click(screen.getByRole('button', { name: '+10' }));
    expect(amountInput.value).toBe('10');
    expect(screen.getByRole('button', { name: 'Add (+)' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '+10' }));
    expect(amountInput.value).toBe('20');

    await user.click(screen.getByRole('button', { name: '+50' }));
    expect(amountInput.value).toBe('70');

    await user.type(screen.getByPlaceholderText(/Reason \(e\.g\., Cash Payment\)/), 'Quick top-up');
    await user.click(screen.getByRole('button', { name: 'Update Balance' }));

    await waitFor(() => expect(getClubDocData('players', 'p1')).toMatchObject({ balance: 90 }));
    expect(getClubDocData('balanceLedger', 'auto-id-1')).toMatchObject({ delta: 70 });
  });

  it('hides the payout checkbox when the payout tab is disabled', async () => {
    renderPage({
      players: [makePlayer({ id: 'p1' })],
      route: '/?playerId=p1',
      disabledTabs: ['payout'],
    });

    expect(await screen.findByText('No balance history yet.')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Include in owner payout' })).not.toBeInTheDocument();
  });

  it('adds a player through the modal and shows them once the players slice refreshes', async () => {
    const user = userEvent.setup();
    const existingPlayer = makePlayer({ id: 'p1', balance: 5 });
    const { store } = renderPage({ players: [existingPlayer] });

    await user.click(screen.getByRole('button', { name: /Add New Player/ }));

    const dialog = await screen.findByRole('dialog');
    const modalTextboxes = within(dialog).getAllByRole('textbox');
    const firstNameInput = modalTextboxes[0];
    const lastNameInput = modalTextboxes[1];
    const emailInput = modalTextboxes[2];
    const descriptionInput = modalTextboxes[3];
    const balanceInput = within(dialog).getByRole('spinbutton');

    await user.type(firstNameInput, 'Grace');
    await user.type(lastNameInput, 'Hopper');
    await user.type(emailInput, 'grace@example.com');
    await user.clear(balanceInput);
    await user.type(balanceInput, '12');
    await user.type(descriptionInput, 'Regular guest');
    await user.click(within(dialog).getByRole('button', { name: 'Add Player' }));

    await waitFor(() => expect(getClubDocData('players', 'auto-id-1')).toMatchObject({
      firstName: 'Grace',
      firstNameLower: 'grace',
      lastName: 'Hopper',
      lastNameLower: 'hopper',
      email: 'grace@example.com',
      balance: 12,
      owed: 0,
      description: 'Regular guest',
      sessionCount: 0,
      createdAt: expect.any(Timestamp),
    }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    const createdPlayer = getClubDocData('players', 'auto-id-1');
    expect(createdPlayer).toBeDefined();
    await act(async () => {
      store.dispatch(setPlayers([
        existingPlayer,
        { id: 'auto-id-1', ...(createdPlayer as Omit<Player, 'id'>) } as Player,
      ]));
    });

    expect(await screen.findAllByText('Grace Hopper')).toHaveLength(2);
    expect(await screen.findByText('No balance history yet.')).toBeInTheDocument();
    expect(screen.getByText('Regular guest')).toBeInTheDocument();
  });

  it('removes a player and unlinks any member who was linked to them', async () => {
    const user = userEvent.setup();
    const players = [makePlayer({ id: 'p1', firstName: 'Jamie', lastName: 'Lee' })];
    __seedDoc(`clubs/${TEST_CLUB_ID}/members/member-1`, { role: 'member', playerId: 'p1' });

    renderPage({ players, route: '/?playerId=p1' });
    await screen.findByText('No balance history yet.');

    await user.click(screen.getByRole('button', { name: 'Remove Player' }));
    await user.click(await screen.findByRole('button', { name: 'Remove' }));

    await waitFor(() => expect(getClubDocData('players', 'p1')).toBeUndefined());
    expect(__getDocData(`clubs/${TEST_CLUB_ID}/members/member-1`)).toMatchObject({ role: 'member', playerId: null });
  });

  it('does not itself gate balance-adjustment controls by role (protection lives one level up)', async () => {
    // PlayersPage has no internal admin check — but it's only ever reachable via
    // the "/players" route, which App.tsx wraps in <RequireAdmin> (reactive to
    // role changes), so a non-admin can never actually load this page in the
    // real app. This test documents that intentionally, so a future refactor
    // that removes the route guard without adding an in-page check doesn't
    // silently regress into a real exposure.
    renderPage({
      players: [makePlayer({ id: 'p1' })],
      route: '/?playerId=p1',
      role: 'member',
    });

    expect(await screen.findByText('No balance history yet.')).toBeInTheDocument();
    expect(screen.getByText('Adjust Balance')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Update Balance' })).toBeInTheDocument();
  });
});
