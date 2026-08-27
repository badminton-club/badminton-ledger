import React from 'react';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { __getAllPaths } from '../../test-utils/fakeFirestore';
import { renderWithProviders, makeClubState, makePlayersState } from '../../test-utils/renderWithProviders';
import {
  resetFirebaseTestState,
  seedClubDoc,
  getClubDocData,
  setCurrentUser,
  ts,
  TEST_CLUB_ID,
} from '../../test-utils/firebaseTestHelpers';
import {
  fetchOwnerPayoutSummary,
} from '../../services/firebase';
import PayoutPage from '../PayoutPage';
import type { OwnerPayoutSummary, Player, ClubRole } from 'types';

jest.mock('../../services/firebase', () => ({
  ...jest.requireActual('../../services/firebase'),
  fetchOwnerPayoutSummary: jest.fn(jest.requireActual('../../services/firebase').fetchOwnerPayoutSummary),
}));

const realFirebase = jest.requireActual('../../services/firebase') as typeof import('../../services/firebase');
const mockedFetchOwnerPayoutSummary = fetchOwnerPayoutSummary as jest.MockedFunction<typeof fetchOwnerPayoutSummary>;

const currentUser = { uid: 'admin-1', displayName: 'Admin One', email: 'admin@example.com' };

function makePlayer(overrides: Partial<Player> & Pick<Player, 'id' | 'firstName'>): Player {
  const lastName = overrides.lastName ?? 'Player';
  return {
    id: overrides.id,
    firstName: overrides.firstName,
    firstNameLower: overrides.firstName.toLowerCase(),
    lastName,
    lastNameLower: lastName?.toLowerCase() ?? null,
    email: null,
    balance: 0,
    owed: 0,
    description: '',
    sessionCount: 0,
    createdAt: ts('2026-01-01T12:00:00') as never,
    ...overrides,
  };
}

const players = [
  makePlayer({ id: 'p1', firstName: 'Grace', lastName: 'Hopper', balance: 30 }),
  makePlayer({ id: 'p2', firstName: 'Ada', lastName: 'Lovelace', balance: 42 }),
  makePlayer({ id: 'p3', firstName: 'Bob', lastName: 'Martin', balance: 7 }),
  makePlayer({ id: 'p4', firstName: 'Charlie', lastName: 'Brown', balance: 3 }),
];

function renderPage(role: ClubRole = 'admin', visiblePlayers: Player[] = players) {
  return renderWithProviders(<PayoutPage />, {
    preloadedState: {
      club: makeClubState({
        currentClubId: TEST_CLUB_ID,
        role,
        clubs: [{ id: TEST_CLUB_ID, name: 'Test Club', role }],
      }),
      players: makePlayersState(visiblePlayers),
    },
  });
}

function seedPlayerDocs(playerList: Player[] = players) {
  playerList.forEach((player) => {
    seedClubDoc('players', player.id, player);
  });
}

function seedLedgerWithAllTypes() {
  seedPlayerDocs(players.slice(0, 2));
  seedClubDoc('sessions', 's1', { date: ts('2026-01-31T12:00:00') });
  seedClubDoc('sessions', 's2', { date: ts('2026-02-01T12:00:00') });
  seedClubDoc('balanceLedger', 'payment-1', {
    reason: 'payment',
    delta: 100,
    playerId: 'p1',
    sessionId: 's1',
    note: 'Grace e-transfer for Jan 31 session',
    createdAt: ts('2026-02-03T12:30:00'),
  });
  seedClubDoc('balanceLedger', 'manual-1', {
    reason: 'manual',
    delta: 20,
    playerId: 'p2',
    sessionId: null,
    note: 'Sold shuttle tubes to Ada',
    walletAdjustment: false,
    createdAt: ts('2026-02-04T13:15:00'),
  });
  seedClubDoc('balanceLedger', 'comp-1', {
    reason: 'comp',
    delta: 15,
    playerId: 'p1',
    sessionId: 's1',
    note: 'Grace paid owner directly',
    createdAt: ts('2026-02-05T14:00:00'),
  });
  seedClubDoc('balanceLedger', 'balance-1', {
    reason: 'session',
    delta: -10,
    playerId: 'p2',
    sessionId: 's2',
    note: 'Ada used prepaid balance',
    createdAt: ts('2026-02-06T09:00:00'),
  });
  seedClubDoc('payouts', 'payout-1', {
    amount: 40,
    note: 'Weekly cashout',
    date: ts('2026-02-07T10:00:00'),
    createdAt: ts('2026-02-07T10:00:00'),
  });
}

function getSummaryValue(label: string) {
  const subtitle = screen.getByText(label);
  return subtitle.parentElement?.querySelector('h3');
}

function ledgerRows(): HTMLTableRowElement[] {
  const table = screen.getByRole('table');
  return Array.from(table.querySelectorAll('tbody tr'));
}

function rowTexts() {
  return ledgerRows().map((row) => row.textContent ?? '');
}

function expectVisibleNotesInOrder(notes: string[]) {
  const visibleNotes = rowTexts().map((rowText) => notes.find((note) => rowText.includes(note)));
  expect(visibleNotes).toEqual(notes);
}

function findGeneratedClubDocPath(collectionName: 'balanceLedger' | 'payouts') {
  const prefix = `clubs/${TEST_CLUB_ID}/${collectionName}/`;
  const path = __getAllPaths().find(
    (candidate) => candidate.startsWith(prefix) && candidate.includes('/auto-id-')
  );
  expect(path).toBeDefined();
  return path!;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  mockedFetchOwnerPayoutSummary.mockReset();
  mockedFetchOwnerPayoutSummary.mockImplementation(realFirebase.fetchOwnerPayoutSummary);
  resetFirebaseTestState();
  setCurrentUser(currentUser);
});

describe('PayoutPage', () => {
  it('shows a warning instead of admin controls for non-admins, without fetching the payout summary', async () => {
    renderPage('member');

    expect(await screen.findByText('You must be an admin to view owner payouts.')).toBeInTheDocument();
    expect(screen.queryByText('Cash out to owner')).not.toBeInTheDocument();
    expect(screen.queryByText('Add custom transaction')).not.toBeInTheDocument();
    expect(screen.queryByText('Payout ledger')).not.toBeInTheDocument();
    expect(mockedFetchOwnerPayoutSummary).not.toHaveBeenCalled();
  });

  it('shows the loading state, then renders the summary cards and default ledger rows', async () => {
    seedLedgerWithAllTypes();
    const pendingSummary = deferred<OwnerPayoutSummary>();
    mockedFetchOwnerPayoutSummary.mockReturnValueOnce(pendingSummary.promise);
    renderPage();

    expect(document.querySelector('.spinner-border')).toBeInTheDocument();

    pendingSummary.resolve(await realFirebase.fetchOwnerPayoutSummary());

    expect(await screen.findByText('Weekly cashout')).toBeInTheDocument();
    expect(getSummaryValue('Collected from players')).toHaveTextContent('$120.00');
    expect(getSummaryValue('Total paid out')).toHaveTextContent('$40.00');
    expect(getSummaryValue('Pending payout')).toHaveTextContent('$80.00');

    expect(screen.getByText('Grace e-transfer for Jan 31 session').closest('tr')).toHaveTextContent('Grace Hopper');
    expect(screen.getByText('Grace e-transfer for Jan 31 session').closest('tr')).toHaveTextContent('Payment');
    expect(screen.getByText('Grace e-transfer for Jan 31 session').closest('tr')).toHaveTextContent('Jan 31, 2026');
    expect(screen.getByText('Sold shuttle tubes to Ada').closest('tr')).toHaveTextContent('Ada Lovelace');
    expect(screen.getByText('Sold shuttle tubes to Ada').closest('tr')).toHaveTextContent('Manual');
    expect(screen.getByText('Weekly cashout').closest('tr')).toHaveTextContent('Payout');
    expect(screen.getByText('Weekly cashout').closest('tr')).toHaveTextContent('- $40.00');
    expect(screen.queryByText('Grace paid owner directly')).not.toBeInTheDocument();
    expect(screen.queryByText('Ada used prepaid balance')).not.toBeInTheDocument();
  });

  it('filters the ledger by type view, including the default hidden comp/balance behavior', async () => {
    const user = userEvent.setup();
    seedLedgerWithAllTypes();
    renderPage();

    await screen.findByText('Weekly cashout');
    const typeFilter = screen.getByDisplayValue('Default (hide comps & balance)');

    expect(screen.queryByText('Grace paid owner directly')).not.toBeInTheDocument();
    expect(screen.queryByText('Ada used prepaid balance')).not.toBeInTheDocument();

    await user.selectOptions(typeFilter, 'all');
    expect(await screen.findByText('Grace paid owner directly')).toBeInTheDocument();
    expect(screen.getByText('Ada used prepaid balance')).toBeInTheDocument();
    expect(screen.getAllByText(/\(not counted\)/)).toHaveLength(2);

    const cases: Array<[string, string, string]> = [
      ['payment', 'Grace e-transfer for Jan 31 session', 'Weekly cashout'],
      ['balance', 'Ada used prepaid balance', 'Sold shuttle tubes to Ada'],
      ['comp', 'Grace paid owner directly', 'Grace e-transfer for Jan 31 session'],
      ['adjustment', 'Sold shuttle tubes to Ada', 'Ada used prepaid balance'],
      ['payout', 'Weekly cashout', 'Grace paid owner directly'],
    ];

    for (const [value, visibleNote, hiddenNote] of cases) {
      await user.selectOptions(typeFilter, value);
      expect(await screen.findByText(visibleNote)).toBeInTheDocument();
      expect(screen.queryByText(hiddenNote)).not.toBeInTheDocument();
    }
  });

  it('sorts the visible ledger rows when a sortable column header is clicked', async () => {
    seedPlayerDocs(players.slice(1, 4));
    seedClubDoc('balanceLedger', 'entry-charlie', {
      reason: 'payment',
      delta: 30,
      playerId: 'p4',
      note: 'Charlie entry',
      createdAt: ts('2026-02-03T12:00:00'),
    });
    seedClubDoc('balanceLedger', 'entry-ada', {
      reason: 'manual',
      delta: 20,
      playerId: 'p2',
      note: 'Ada entry',
      walletAdjustment: false,
      createdAt: ts('2026-02-02T12:00:00'),
    });
    seedClubDoc('balanceLedger', 'entry-bob', {
      reason: 'payment',
      delta: 10,
      playerId: 'p3',
      note: 'Bob entry',
      createdAt: ts('2026-02-01T12:00:00'),
    });
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('Charlie entry');
    expectVisibleNotesInOrder(['Charlie entry', 'Ada entry', 'Bob entry']);

    await user.click(screen.getByRole('button', { name: /Player/ }));
    expectVisibleNotesInOrder(['Ada entry', 'Bob entry', 'Charlie entry']);

    await user.click(screen.getByRole('button', { name: /Player/ }));
    expectVisibleNotesInOrder(['Charlie entry', 'Bob entry', 'Ada entry']);
  });

  it('paginates the ledger when there are more than 100 visible rows', async () => {
    seedPlayerDocs([players[0]]);
    for (let i = 1; i <= 101; i += 1) {
      seedClubDoc('balanceLedger', `payment-${i}`, {
        reason: 'payment',
        delta: i,
        playerId: 'p1',
        note: `Payment ${String(i).padStart(3, '0')}`,
        createdAt: ts(new Date(2026, 0, i, 12, 0, 0)),
      });
    }
    const user = userEvent.setup();
    renderPage('admin', [players[0]]);

    expect(await screen.findByText('Payment 101')).toBeInTheDocument();
    expect(screen.getByText('Showing 1–100 of 101')).toBeInTheDocument();
    expect(screen.getByText('Page 1 of 2')).toBeInTheDocument();
    expect(screen.queryByText('Payment 001')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText('Payment 001')).toBeInTheDocument();
    expect(screen.getByText('Showing 101–101 of 101')).toBeInTheDocument();
    expect(screen.getByText('Page 2 of 2')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Previous' }));
    expect(await screen.findByText('Payment 101')).toBeInTheDocument();
    expect(screen.getByText('Page 1 of 2')).toBeInTheDocument();
  });

  it('records a full payout after confirmation and reloads the summary', async () => {
    const user = userEvent.setup();
    seedClubDoc('balanceLedger', 'payment-1', {
      reason: 'payment',
      delta: 80,
      note: 'Settled by e-transfer',
      createdAt: ts('2026-02-01T12:00:00'),
    });
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true);
    renderPage();

    await screen.findByText('Settled by e-transfer');
    await user.type(screen.getByPlaceholderText('e.g. e-transfer, cash, cheque #123'), '  e-transfer batch 7  ');
    await user.click(screen.getByRole('button', { name: 'Pay full balance $80.00' }));

    expect(confirmSpy).toHaveBeenCalledWith(
      'Record a payout of $80.00 to the owner? This resets the pending balance to zero.'
    );
    expect(await screen.findByText('Paid $80.00 to the owner. Pending balance is now zero.')).toBeInTheDocument();
    expect(getSummaryValue('Total paid out')).toHaveTextContent('$80.00');
    expect(getSummaryValue('Pending payout')).toHaveTextContent('$0.00');

    const payoutPath = findGeneratedClubDocPath('payouts');
    const payoutDoc = getClubDocData('payouts', payoutPath.split('/').pop()!);
    expect(payoutDoc).toMatchObject({ amount: 80, note: 'e-transfer batch 7', paidByUid: 'admin-1' });

    confirmSpy.mockRestore();
  });

  it('validates the custom payout amount client-side and records a partial payout', async () => {
    const user = userEvent.setup();
    seedClubDoc('balanceLedger', 'payment-1', {
      reason: 'payment',
      delta: 90,
      note: 'Session settlement',
      createdAt: ts('2026-02-01T12:00:00'),
    });
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true);
    renderPage();

    await screen.findByText('Session settlement');
    const customAmountInput = screen.getAllByRole('spinbutton')[0];
    const payThisButton = screen.getByRole('button', { name: 'Pay this' });

    await user.clear(customAmountInput);
    await user.type(customAmountInput, '0');
    expect(payThisButton).toBeDisabled();

    await user.clear(customAmountInput);
    await user.type(customAmountInput, '100');
    expect(payThisButton).toBeDisabled();

    await user.clear(customAmountInput);
    await user.type(customAmountInput, '30');
    expect(payThisButton).toBeEnabled();

    await user.click(payThisButton);

    expect(confirmSpy).toHaveBeenCalledWith('Record a payout of $30.00 to the owner?');
    expect(await screen.findByText('Paid $30.00 to the owner. Pending balance is now $60.00.')).toBeInTheDocument();
    expect(getSummaryValue('Total paid out')).toHaveTextContent('$30.00');
    expect(getSummaryValue('Pending payout')).toHaveTextContent('$60.00');

    confirmSpy.mockRestore();
  });

  it('validates required fields when adding a custom transaction', async () => {
    const user = userEvent.setup();
    seedClubDoc('balanceLedger', 'payment-1', {
      reason: 'payment',
      delta: 50,
      note: 'Seed payment',
      createdAt: ts('2026-02-01T12:00:00'),
    });
    renderPage();

    await screen.findByText('Seed payment');
    await user.click(screen.getByRole('button', { name: 'Add transaction' }));
    expect(await screen.findByText('Enter an amount greater than zero.')).toBeInTheDocument();

    await user.type(screen.getAllByRole('spinbutton')[1], '10');
    await user.click(screen.getByRole('button', { name: 'Add transaction' }));
    expect(await screen.findByText('A note is required (e.g. what was sold and to whom).')).toBeInTheDocument();
  });

  it('adds a player-attributed custom deduction and updates the ledger totals', async () => {
    const user = userEvent.setup();
    seedPlayerDocs([players[1]]);
    seedClubDoc('balanceLedger', 'payment-1', {
      reason: 'payment',
      delta: 50,
      playerId: 'p2',
      note: 'Ada paid cash to club',
      createdAt: ts('2026-02-01T12:00:00'),
    });
    renderPage('admin', [players[1]]);

    await screen.findByText('Ada paid cash to club');
    await user.selectOptions(screen.getByDisplayValue('Add to payout (+)'), 'deduct');
    await user.type(screen.getAllByRole('spinbutton')[1], '5');
    await user.selectOptions(screen.getByDisplayValue('— None —'), 'p2');
    await user.type(
      screen.getByPlaceholderText('e.g. Manager bought 2 tubes of birdies from the stash (cash)'),
      'Refunded overpayment to Ada'
    );
    await user.click(screen.getByRole('button', { name: 'Add transaction' }));

    expect(await screen.findByText('Deducted $5.00 from the pending payout.')).toBeInTheDocument();
    expect(getSummaryValue('Collected from players')).toHaveTextContent('$45.00');
    expect(getSummaryValue('Pending payout')).toHaveTextContent('$45.00');
    expect(screen.getByText('Refunded overpayment to Ada').closest('tr')).toHaveTextContent('Ada Lovelace');

    const ledgerPath = findGeneratedClubDocPath('balanceLedger');
    const ledgerDoc = getClubDocData('balanceLedger', ledgerPath.split('/').pop()!);
    expect(ledgerDoc).toMatchObject({
      playerId: 'p2',
      delta: -5,
      note: 'Refunded overpayment to Ada',
      reason: 'manual',
      walletAdjustment: false,
    });
  });

  it('undoes a manual adjustment after a reason is provided and shows it as voided', async () => {
    const user = userEvent.setup();
    seedClubDoc('balanceLedger', 'payment-1', {
      reason: 'payment',
      delta: 100,
      note: 'Club intake',
      createdAt: ts('2026-02-01T12:00:00'),
    });
    seedClubDoc('balanceLedger', 'manual-1', {
      reason: 'manual',
      delta: 20,
      note: 'Birdie sale',
      walletAdjustment: false,
      createdAt: ts('2026-02-02T12:00:00'),
    });
    renderPage();

    await screen.findByText('Birdie sale');
    await user.click(within(screen.getByText('Birdie sale').closest('tr')!).getByRole('button', { name: 'Undo' }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('This $20.00 manual entry will be marked voided and removed from the pending balance.');

    await user.click(within(dialog).getByRole('button', { name: 'Undo' }));
    expect(await within(dialog).findByText('Enter a reason for undoing this.')).toBeInTheDocument();

    await user.type(within(dialog).getByPlaceholderText('e.g. entered by mistake, duplicate transaction'), 'Entered twice');
    await user.click(within(dialog).getByRole('button', { name: 'Undo' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(getSummaryValue('Collected from players')).toHaveTextContent('$100.00');
    expect(getSummaryValue('Pending payout')).toHaveTextContent('$100.00');
    const row = screen.getByText('Birdie sale').closest('tr');
    expect(row).toHaveStyle('text-decoration: line-through');
    expect(within(row!).getByText('Voided')).toBeInTheDocument();
    expect(getClubDocData('balanceLedger', 'manual-1')).toMatchObject({
      voided: true,
      voidedNote: 'Entered twice',
      voidedByUid: 'admin-1',
    });
  });

  it('voids a payout after confirmation in the modal and adds it back to pending', async () => {
    const user = userEvent.setup();
    seedClubDoc('balanceLedger', 'payment-1', {
      reason: 'payment',
      delta: 100,
      note: 'Collected from sessions',
      createdAt: ts('2026-02-01T12:00:00'),
    });
    seedClubDoc('payouts', 'payout-1', {
      amount: 40,
      note: 'Weekly owner payout',
      date: ts('2026-02-02T12:00:00'),
      createdAt: ts('2026-02-02T12:00:00'),
    });
    renderPage();

    await screen.findByText('Weekly owner payout');
    await user.click(within(screen.getByText('Weekly owner payout').closest('tr')!).getByRole('button', { name: 'Undo' }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('This payout of $40.00 will be marked voided and added back to the pending balance.');
    await user.type(within(dialog).getByPlaceholderText('e.g. entered by mistake, duplicate transaction'), 'Wrong payout record');
    await user.click(within(dialog).getByRole('button', { name: 'Undo' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(getSummaryValue('Total paid out')).toHaveTextContent('$0.00');
    expect(getSummaryValue('Pending payout')).toHaveTextContent('$100.00');
    const row = screen.getByText('Weekly owner payout').closest('tr');
    expect(row).toHaveStyle('text-decoration: line-through');
    expect(within(row!).getByText('Voided')).toBeInTheDocument();
    expect(getClubDocData('payouts', 'payout-1')).toMatchObject({
      voided: true,
      voidedNote: 'Wrong payout record',
      voidedByUid: 'admin-1',
    });
  });
});
