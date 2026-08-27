import React from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders, makePlayersState } from '../../../../test-utils/renderWithProviders';
import { resetFirebaseTestState, seedClubDoc, ts } from '../../../../test-utils/firebaseTestHelpers';
import SessionDetailsStep from '../SessionDetailsStep';
import type { Player, ConfirmedPlayer } from 'types';
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

function renderStep(confirmedPlayers: ConfirmedPlayer[], players: Player[], props: Partial<{ onSave: jest.Mock; onCancel: jest.Mock }> = {}) {
  const onSave = props.onSave ?? jest.fn().mockResolvedValue(undefined);
  const onCancel = props.onCancel ?? jest.fn();
  const result = renderWithProviders(
    <SessionDetailsStep onSave={onSave} onCancel={onCancel} />,
    {
      preloadedState: {
        sessionModal: { mode: 'details', playersInput: '', resolutionItems: [], confirmedPlayers, errors: {} } as RootState['sessionModal'],
        players: makePlayersState(players),
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
    const { onSave } = renderStep([{ id: 'p1', percentage: 1 }], [makePlayer()]);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save Session' })).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Save Session' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      courtCount: 4,
      players: expect.arrayContaining([expect.objectContaining({ id: 'p1' })]),
    })));
  });
});
