import React from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders, makeClubState, makePlayersState } from '../../../../test-utils/renderWithProviders';
import { resetFirebaseTestState, seedClubDoc, seedClubMetaDoc, getClubDocData, ts, TEST_CLUB_ID } from '../../../../test-utils/firebaseTestHelpers';
import { __getAllPaths } from '../../../../test-utils/fakeFirestore';
import SessionDetailsStep from '../SessionDetailsStep';
import type { Player, ConfirmedPlayer, Session } from 'types';
import type { RootState } from '../../../../store';

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

function renderStep(
  confirmedPlayers: ConfirmedPlayer[],
  players: Player[],
  props: Partial<{ onSave: jest.Mock; onCancel: jest.Mock }> = {},
  session?: Session
) {
  const onSave = props.onSave ?? jest.fn().mockResolvedValue(undefined);
  const onCancel = props.onCancel ?? jest.fn();
  const result = renderWithProviders(
    <SessionDetailsStep session={session} onSave={onSave} onCancel={onCancel} />,
    {
      preloadedState: {
        sessionModal: { mode: 'details', playersInput: '', resolutionItems: [], confirmedPlayers, errors: {} } as RootState['sessionModal'],
        players: makePlayersState(players),
        club: makeClubState({ currentClubId: TEST_CLUB_ID }),
      },
    }
  );
  return { ...result, onSave, onCancel };
}

describe('SessionDetailsStep', () => {
  it('renders a row for each confirmed player with an equal-split cost', async () => {
    const players = [makePlayer({ id: 'p1', firstName: 'Ada' }), makePlayer({ id: 'p2', firstName: 'Grace', firstNameLower: 'grace' })];
    renderStep([{ id: 'p1', percentage: 1 }, { id: 'p2', percentage: 1 }], players);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Save Session' })).toBeInTheDocument());
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByText('Grace Lovelace')).toBeInTheDocument();
  });

  it('adds an existing player via the dropdown', async () => {
    const user = userEvent.setup();
    const players = [makePlayer({ id: 'p1', firstName: 'Ada' }), makePlayer({ id: 'p2', firstName: 'Grace', firstNameLower: 'grace' })];
    const { store } = renderStep([{ id: 'p1', percentage: 1 }], players);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save Session' })).toBeInTheDocument());

    const dropdown = screen.getAllByRole('combobox')[0]; // "+ Add existing player…" select (birdie batch selects come after)
    await user.selectOptions(dropdown, 'p2');
    await user.click(screen.getByRole('button', { name: 'Add' }));

    expect(store.getState().sessionModal.confirmedPlayers.map(p => p.id)).toEqual(['p1', 'p2']);
  });

  it('creates a guest player via the "+ New player" modal and adds them to the session', async () => {
    const user = userEvent.setup();
    const players = [makePlayer({ id: 'p1', firstName: 'Ada' })];
    const { store } = renderStep([{ id: 'p1', percentage: 1 }], players);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save Session' })).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: '+ New player' }));
    await user.type(screen.getByLabelText(/First Name/), 'Random');
    await user.type(screen.getByLabelText(/Last Name/), 'Guest');
    await user.click(screen.getByRole('checkbox', { name: /Guest \(one-time attendee/ }));
    await user.click(screen.getByRole('button', { name: 'Add Player' }));

    await waitFor(() => {
      expect(store.getState().sessionModal.confirmedPlayers.map(p => p.id)).toEqual(['p1', expect.any(String)]);
    });
    const newPlayerPath = __getAllPaths().find((path) => path.includes('/players/') && !path.includes('p1'));
    expect(newPlayerPath).toBeDefined();
    expect(getClubDocData('players', newPlayerPath!.split('/').pop()!)).toMatchObject({
      firstName: 'Random',
      lastName: 'Guest',
      isGuest: true,
    });
  });

  it('removes a player from the session', async () => {
    const user = userEvent.setup();
    const players = [makePlayer({ id: 'p1', firstName: 'Ada' }), makePlayer({ id: 'p2', firstName: 'Grace', firstNameLower: 'grace' })];
    const { store } = renderStep([{ id: 'p1', percentage: 1 }, { id: 'p2', percentage: 1 }], players);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save Session' })).toBeInTheDocument());

    const removeButtons = screen.getAllByRole('button', { name: '✕' });
    await user.click(removeButtons[0]);

    expect(store.getState().sessionModal.confirmedPlayers.map(p => p.id)).toEqual(['p2']);
  });

  it('lists available birdie batches loaded from the fake Firestore', async () => {
    seedClubDoc('birdieInventory', 'b1', {
      name: 'Yonex AS-50', purchaseDate: ts('2026-01-01'), costPerTube: 30,
      birdsPerTube: 12, unopenedTubesRemaining: 5, birdsInOpenTube: 0, purchaserName: 'Admin',
    });
    renderStep([{ id: 'p1', percentage: 1 }], [makePlayer()]);

    expect(await screen.findByRole('option', { name: /Yonex AS-50/ })).toBeInTheDocument();
  });

  it('keeps the over-allocation error visible instead of clearing it immediately', async () => {
    const user = userEvent.setup();
    seedClubDoc('birdieInventory', 'b1', {
      name: 'Yonex AS-50', purchaseDate: ts('2026-01-01'), costPerTube: 30,
      birdsPerTube: 12, unopenedTubesRemaining: 0, birdsInOpenTube: 3, purchaserName: 'Admin',
    });
    renderStep([{ id: 'p1', percentage: 1 }], [makePlayer()]);
    await screen.findByRole('option', { name: /Yonex AS-50/ });

    // The birdie batch select comes after the "+ Add existing player…" combobox.
    const batchSelect = screen.getAllByRole('combobox')[1];
    await user.selectOptions(batchSelect, 'b1');
    const qtyInput = screen.getByPlaceholderText('# birds');
    await user.type(qtyInput, '5'); // only 3 available

    expect(await screen.findByText('Only 3 birds remain in this batch.')).toBeInTheDocument();
  });

  it('calls onCancel when Cancel is clicked', async () => {
    const user = userEvent.setup();
    const { onCancel } = renderStep([{ id: 'p1', percentage: 1 }], [makePlayer()]);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalled();
  });

  it('submits with the expected session shape on save', async () => {
    const user = userEvent.setup();
    seedClubDoc('courtCredits', 'c1', {
      name: 'Main gym', totalCost: 80, costPerHour: 10, hoursPurchased: 20, remainingHours: 20,
    });
    const { onSave } = renderStep([{ id: 'p1', percentage: 1 }], [makePlayer()]);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save Session' })).toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save Session' })).toBeEnabled());

    await user.click(screen.getByRole('button', { name: 'Save Session' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      courtCount: 4,
      players: expect.arrayContaining([expect.objectContaining({ id: 'p1' })]),
    })));
  });

  it('uses the club default court count for a new session', async () => {
    seedClubMetaDoc(TEST_CLUB_ID, { name: 'Test Club', defaultCourtCount: 6 });
    renderStep([{ id: 'p1', percentage: 1 }], [makePlayer()]);

    expect(await screen.findByDisplayValue('6')).toBeInTheDocument();
  });

  it('defaults a new session player to transfer payment from their configured payer', async () => {
    const user = userEvent.setup();
    seedClubDoc('courtCredits', 'c1', {
      name: 'Main gym', totalCost: 80, costPerHour: 10, hoursPurchased: 20, remainingHours: 20,
    });
    const player = makePlayer({ id: 'p1', defaultPayerId: 'p2' });
    const payer = makePlayer({
      id: 'p2',
      firstName: 'Grace',
      firstNameLower: 'grace',
      lastName: 'Hopper',
      lastNameLower: 'hopper',
      balance: 100,
    });
    const { onSave } = renderStep([{ id: 'p1', percentage: 1 }], [player, payer]);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Save Session' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Save Session' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      players: [expect.objectContaining({
        id: 'p1',
        paid: true,
        paidVia: 'transfer',
        paidBy: 'p2',
      })],
    })));
  });

  it('does not retroactively apply a default payer when editing an unpaid session', async () => {
    const user = userEvent.setup();
    const player = makePlayer({ id: 'p1', defaultPayerId: 'p2' });
    const payer = makePlayer({
      id: 'p2',
      firstName: 'Grace',
      firstNameLower: 'grace',
      lastName: 'Hopper',
      lastNameLower: 'hopper',
    });
    const session: Session = {
      id: 's1',
      date: new Date('2026-02-01'),
      durationHours: 2,
      courtCount: 1,
      totalCost: 20,
      totalCourtCost: 20,
      totalBirdieCost: 0,
      totalSessionCost: 20,
      birdieUsage: [],
      courtCreditUsage: [],
      players: [{
        id: 'p1',
        percentage: 1,
        cost: 20,
        paid: false,
        paidVia: null,
        paidBy: null,
        highlighted: false,
      }],
      createdAt: undefined as never,
    };
    const { onSave } = renderStep([{ id: 'p1', percentage: 1 }], [player, payer], {}, session);

    await user.click(screen.getByRole('button', { name: 'Save Session' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      players: [expect.objectContaining({
        id: 'p1',
        paid: false,
        paidVia: null,
        paidBy: null,
      })],
    })));
  });

  it('preserves manual court cost and count when editing a session that did not use court credits', async () => {
    const session: Session = {
      id: 's1',
      date: new Date('2026-02-01'),
      durationHours: 2,
      courtCount: 3,
      totalCost: 45,
      totalCourtCost: 45,
      totalBirdieCost: 0,
      totalSessionCost: 45,
      birdieUsage: [],
      courtCreditUsage: [],
      players: [{ id: 'p1', percentage: 1, cost: 45, paid: false, highlighted: false }],
      createdAt: undefined as never,
    };
    const { onSave } = renderStep([{ id: 'p1', percentage: 1 }], [makePlayer()], {}, session);

    expect(screen.getByDisplayValue('3')).toBeInTheDocument(); // courtCount preserved
    // Switching to credits is off by default; the manual-cost field carries the
    // original per-court rate ($45 / 3 courts = $15/court).
    expect(screen.getByDisplayValue('15')).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Save Session' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      courtCount: 3,
      totalCourtCost: 45,
      courtCreditUsage: [],
    })));
  });

  it('disables Save when the requested courts exceed available court credits', async () => {
    renderStep([{ id: 'p1', percentage: 1 }], [makePlayer()]);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save Session' })).toBeInTheDocument());

    // Default courtCount is 4 (8 hours) with no court credits seeded — unaffordable.
    expect(screen.getByText(/Not enough court credits/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save Session' })).toBeDisabled();
  });

  it('disables Save and Cancel while a submission is in flight, preventing a double-submit', async () => {
    const user = userEvent.setup();
    let resolveSave: (() => void) | undefined;
    const onSave = jest.fn(() => new Promise<void>((resolve) => { resolveSave = resolve; }));
    seedClubDoc('courtCredits', 'c1', {
      name: 'Main gym', totalCost: 80, costPerHour: 10, hoursPurchased: 20, remainingHours: 20,
    });
    renderStep([{ id: 'p1', percentage: 1 }], [makePlayer()], { onSave });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save Session' })).toBeEnabled());

    await user.click(screen.getByRole('button', { name: 'Save Session' }));

    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(onSave).toHaveBeenCalledTimes(1);

    resolveSave?.();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save Session' })).toBeEnabled());
  });
});
