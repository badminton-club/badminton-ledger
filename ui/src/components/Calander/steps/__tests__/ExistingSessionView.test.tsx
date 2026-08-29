import React from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders, makePlayersState, makeClubState } from '../../../../test-utils/renderWithProviders';
import { resetFirebaseTestState, seedClubDoc, getClubDocData } from '../../../../test-utils/firebaseTestHelpers';
import { __getAllPaths } from '../../../../test-utils/fakeFirestore';
import ExistingSessionView from '../ExistingSessionView';
import type { Player, Session, SessionPlayer } from 'types';

beforeEach(() => {
  resetFirebaseTestState();
});

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
  return { id: 'p1', percentage: 100, cost: 20, paid: false, highlighted: false, ...overrides };
}

function makeSession(players: SessionPlayer[]): Session {
  return {
    id: 's1',
    date: new Date('2026-02-15'),
    durationHours: 2,
    courtCount: 2,
    totalCost: 45,
    totalCourtCost: 30,
    totalBirdieCost: 15,
    totalSessionCost: 45,
    birdieUsage: [],
    courtCreditUsage: [],
    players,
    createdAt: undefined as never,
  };
}

function renderView(
  players: Player[],
  sessionPlayers: SessionPlayer[],
  { isAdmin = true, ...propOverrides }: { isAdmin?: boolean; onEdit?: jest.Mock; onDelete?: jest.Mock; onSessionUpdate?: jest.Mock } = {}
) {
  const onSessionUpdate = propOverrides.onSessionUpdate ?? jest.fn();
  const onEdit = propOverrides.onEdit ?? jest.fn();
  const onDelete = propOverrides.onDelete ?? jest.fn().mockResolvedValue(undefined);
  const result = renderWithProviders(
    <ExistingSessionView
      session={makeSession(sessionPlayers)}
      onSessionUpdate={onSessionUpdate}
      onEdit={onEdit}
      onDelete={onDelete}
    />,
    {
      preloadedState: {
        players: makePlayersState(players),
        club: makeClubState({ role: isAdmin ? 'admin' : 'member' }),
      },
    }
  );
  return { ...result, onSessionUpdate, onEdit, onDelete };
}

describe('ExistingSessionView', () => {
  it('renders the session date, players, and cost summary', () => {
    const players = [makePlayer({ id: 'p1', firstName: 'Ada' })];
    renderView(players, [makeSessionPlayer({ id: 'p1', cost: 20, paid: true })]);

    expect(screen.getByText(/Session Date:/)).toBeInTheDocument();
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByText('Total Session Cost')).toBeInTheDocument();
    expect(screen.getByText('$45.00')).toBeInTheDocument(); // totalSessionCost
  });

  it('shows Edit/Delete controls and settlement buttons for admins', () => {
    const players = [makePlayer({ id: 'p1' })];
    renderView(players, [makeSessionPlayer()], { isAdmin: true });

    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'e-Transfer' })).toBeInTheDocument();
  });

  it('hides admin-only controls for non-admins', () => {
    const players = [makePlayer({ id: 'p1' })];
    renderView(players, [makeSessionPlayer()], { isAdmin: false });

    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'e-Transfer' })).not.toBeInTheDocument();
  });

  it('calls onEdit when Edit is clicked', async () => {
    const user = userEvent.setup();
    const { onEdit } = renderView([makePlayer({ id: 'p1' })], [makeSessionPlayer()]);
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    expect(onEdit).toHaveBeenCalled();
  });

  it('requires typing DELETE before the permanent-delete button is enabled', async () => {
    const user = userEvent.setup();
    const { onDelete } = renderView([makePlayer({ id: 'p1' })], [makeSessionPlayer()]);

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    const confirmButton = screen.getByRole('button', { name: /Delete permanently/ });
    expect(confirmButton).toBeDisabled();

    await user.type(screen.getByPlaceholderText('DELETE'), 'DELETE');
    expect(confirmButton).toBeEnabled();

    await user.click(confirmButton);
    expect(onDelete).toHaveBeenCalledWith('s1');
  });

  it('marking a player e-Transfer paid updates the real balanceLedger and calls onSessionUpdate', async () => {
    const user = userEvent.setup();
    const sessionPlayers = [makeSessionPlayer({ id: 'p1', cost: 20, paid: false })];
    seedClubDoc('players', 'p1', makePlayer({ id: 'p1', balance: 0 }));
    // setPlayerSettlement reads/writes this doc directly — must mirror the `session` prop.
    seedClubDoc('sessions', 's1', { players: sessionPlayers });

    const { onSessionUpdate } = renderView([makePlayer({ id: 'p1' })], sessionPlayers);

    await user.click(screen.getByRole('button', { name: 'e-Transfer' }));

    await waitFor(() => expect(onSessionUpdate).toHaveBeenCalledWith('s1'));

    const updatedSession = getClubDocData('sessions', 's1')!;
    expect((updatedSession.players as SessionPlayer[])[0]).toMatchObject({ paid: true, paidVia: 'etransfer' });

    const ledgerPaths = __getAllPaths().filter(p => p.includes('/balanceLedger/'));
    expect(ledgerPaths).toHaveLength(1);
    const ledgerEntry = getClubDocData('balanceLedger', ledgerPaths[0].split('/').pop()!)!;
    expect(ledgerEntry).toMatchObject({ reason: 'payment', delta: 20 });
  });

  it('labels a balance settlement auto-applied from a Gmail e-Transfer distinctly from a manual balance draw', () => {
    const players = [makePlayer({ id: 'p1' })];
    const sessionPlayers = [makeSessionPlayer({
      id: 'p1', cost: 20, paid: true, paidVia: 'balance', settledByEtransferImportId: 'msg-1',
    })];

    renderView(players, sessionPlayers, { isAdmin: true });
    expect(screen.getByRole('button', { name: 'Gmail e-Transfer' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Balance' })).not.toBeInTheDocument();
  });

  it('shows a plain Balance label for a manually-chosen balance draw (not from a Gmail e-Transfer)', () => {
    const players = [makePlayer({ id: 'p1' })];
    const sessionPlayers = [makeSessionPlayer({ id: 'p1', cost: 20, paid: true, paidVia: 'balance' })];

    renderView(players, sessionPlayers, { isAdmin: true });
    expect(screen.getByRole('button', { name: 'Balance' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Gmail e-Transfer' })).not.toBeInTheDocument();
  });

  it('shows the Gmail e-Transfer badge (not Balance) to non-admins for an auto-settled session', () => {
    const players = [makePlayer({ id: 'p1' })];
    const sessionPlayers = [makeSessionPlayer({
      id: 'p1', cost: 20, paid: true, paidVia: 'balance', settledByEtransferImportId: 'msg-1',
    })];

    renderView(players, sessionPlayers, { isAdmin: false });
    expect(screen.getByText('Gmail e-Transfer')).toBeInTheDocument();
  });
});
