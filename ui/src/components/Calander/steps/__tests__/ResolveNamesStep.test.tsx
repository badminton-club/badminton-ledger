import React from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders, makePlayersState } from '../../../../test-utils/renderWithProviders';
import {
  getClubDocData,
  resetFirebaseTestState,
  seedClubDoc,
} from '../../../../test-utils/firebaseTestHelpers';
import { __getAllPaths } from '../../../../test-utils/fakeFirestore';
import ResolveNamesStep from '../ResolveNamesStep';
import type { NameResolutionItem, Player } from 'types';
import type { RootState } from '../../../../store';

beforeEach(() => {
  resetFirebaseTestState();
});

function makeItem(overrides: Partial<NameResolutionItem> = {}): NameResolutionItem {
  return {
    id: 'item-1',
    rawName: 'John Smith',
    editableName: 'John Smith',
    isEditing: false,
    status: 'pending',
    candidates: [],
    resolvedPlayerId: null,
    ...overrides,
  };
}

function makePlayer(overrides: Partial<Player> = {}): Player {
  return {
    id: 'p1',
    firstName: 'John',
    firstNameLower: 'john',
    lastName: 'Smith',
    lastNameLower: 'smith',
    email: null,
    balance: 0,
    owed: 0,
    description: '',
    sessionCount: 0,
    createdAt: undefined as never,
    ...overrides,
  };
}

function renderStep(items: NameResolutionItem[], players: Player[] = []) {
  const sessionModal: Partial<RootState['sessionModal']> = {
    mode: 'resolve',
    playersInput: '',
    resolutionItems: items,
    confirmedPlayers: [],
    errors: {},
  };
  return renderWithProviders(
    <ResolveNamesStep onComplete={jest.fn()} onBack={jest.fn()} />,
    { preloadedState: { sessionModal: sessionModal as RootState['sessionModal'], players: makePlayersState(players) } }
  );
}

describe('ResolveNamesStep', () => {
  it('shows a spinner and matching count while items are pending', () => {
    renderStep([makeItem({ status: 'pending' }), makeItem({ id: 'item-2', status: 'pending' })]);
    expect(screen.getByText(/Matching 2 names/)).toBeInTheDocument();
  });

  it('shows the resolved player name for a matched item', () => {
    const player = makePlayer();
    renderStep([makeItem({ rawName: 'J. Smith', status: 'matched', candidates: [player], resolvedPlayerId: 'p1' })]);
    expect(screen.getByText('John Smith')).toBeInTheDocument(); // the resolved player's formatted name
    expect(screen.getByText('J. Smith')).toBeInTheDocument(); // the original raw pasted name, kept alongside it
    expect(screen.getByRole('button', { name: 'clear' })).toBeInTheDocument();
  });

  it('shows a select dropdown listing every candidate for a conflict', () => {
    const candidates = [makePlayer({ id: 'p1', firstName: 'John' }), makePlayer({ id: 'p2', firstName: 'Jon' })];
    renderStep([makeItem({ status: 'conflict', candidates, resolvedPlayerId: null })]);
    const select = screen.getByRole('combobox');
    expect(select).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'John Smith' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Jon Smith' })).toBeInTheDocument();
  });

  it('shows email addresses for candidates with duplicate names', () => {
    const candidates = [
      makePlayer({ id: 'p1', email: 'john.one@example.com' }),
      makePlayer({ id: 'p2', email: 'john.two@example.com' }),
      makePlayer({ id: 'p3', firstName: 'Jon', email: 'jon@example.com' }),
    ];
    renderStep([makeItem({ status: 'conflict', candidates, resolvedPlayerId: null })]);

    expect(screen.getByRole('option', { name: 'John Smith (john.one@example.com)' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'John Smith (john.two@example.com)' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Jon Smith' })).toBeInTheDocument();
  });

  it('shows "no match found" with an add-player action for an unmatched item', () => {
    renderStep([makeItem({ status: 'unmatched' })]);
    expect(screen.getByText('No match found')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ Add player' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save All' })).toBeInTheDocument();
  });

  it('saves every unmatched name as a new player and resolves all rows', async () => {
    const user = userEvent.setup();
    const { store } = renderStep([
      makeItem({ id: 'a', rawName: 'Ada Lovelace', editableName: 'Ada Lovelace', status: 'unmatched' }),
      makeItem({ id: 'b', rawName: 'Grace Hopper', editableName: 'Grace Hopper', status: 'unmatched' }),
    ]);

    await user.click(screen.getByRole('button', { name: 'Save All' }));

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Save All' })).not.toBeInTheDocument());
    expect(screen.getAllByText('Ada Lovelace')).toHaveLength(2);
    expect(screen.getAllByText('Grace Hopper')).toHaveLength(2);
    expect(screen.getByRole('button', { name: /Confirm & Add Details/ })).toBeEnabled();

    const resolved = store.getState().sessionModal.resolutionItems;
    expect(resolved.every((item) => item.status === 'matched' && item.resolvedPlayerId)).toBe(true);

    const playerIds = __getAllPaths()
      .filter((path) => path.includes('/players/'))
      .map((path) => path.split('/').pop()!);
    expect(playerIds).toHaveLength(2);
    expect(playerIds.map((id) => getClubDocData('players', id)?.firstName)).toEqual(['Ada', 'Grace']);
  });

  it('Save All uses first and last names typed into open new-player forms', async () => {
    const user = userEvent.setup();
    const { store } = renderStep([
      makeItem({ id: 'a', rawName: 'asd', editableName: 'asd', status: 'unmatched' }),
      makeItem({ id: 'b', rawName: 'asd', editableName: 'asd', status: 'unmatched' }),
    ]);

    for (const button of screen.getAllByRole('button', { name: '+ Add player' })) {
      await user.click(button);
    }
    const lastNameInputs = screen.getAllByPlaceholderText('Last name');
    await user.type(lastNameInputs[0], 'dsa');
    await user.type(lastNameInputs[1], 'nbv');
    await user.click(screen.getByRole('button', { name: 'Save All' }));

    await waitFor(() => {
      expect(store.getState().sessionModal.resolutionItems.every(
        (item) => item.status === 'matched' && item.resolvedPlayerId
      )).toBe(true);
    });
    expect(screen.queryByText(/already exists/)).not.toBeInTheDocument();

    const players = __getAllPaths()
      .filter((path) => path.includes('/players/'))
      .map((path) => getClubDocData('players', path.split('/').pop()!));
    expect(players).toEqual(expect.arrayContaining([
      expect.objectContaining({ firstName: 'asd', lastName: 'dsa' }),
      expect.objectContaining({ firstName: 'asd', lastName: 'nbv' }),
    ]));
  });

  it('creates a guest player when the guest checkbox is checked, and Save All persists the flag', async () => {
    const user = userEvent.setup();
    const { store } = renderStep([
      makeItem({ id: 'a', rawName: 'Random Guest', editableName: 'Random Guest', status: 'unmatched' }),
    ]);

    await user.click(screen.getByRole('button', { name: '+ Add player' }));
    await user.click(screen.getByRole('checkbox', { name: /Guest \(one-time attendee/ }));
    await user.click(screen.getByRole('button', { name: 'Save All' }));

    await waitFor(() => {
      expect(store.getState().sessionModal.resolutionItems[0].status).toBe('matched');
    });

    const playerPath = __getAllPaths().find((path) => path.includes('/players/'));
    expect(playerPath).toBeDefined();
    expect(getClubDocData('players', playerPath!.split('/').pop()!)).toMatchObject({
      firstName: 'Random',
      lastName: 'Guest',
      isGuest: true,
    });
  });

  it('validates all unmatched names before Save All creates any players', async () => {
    const user = userEvent.setup();
    const existing = makePlayer({ id: 'p1', firstName: 'John', lastName: null });
    renderStep([
      makeItem({ id: 'a', rawName: 'Ada Lovelace', editableName: 'Ada Lovelace', status: 'unmatched' }),
      makeItem({ id: 'b', rawName: 'John', editableName: 'John', status: 'unmatched' }),
    ], [existing]);

    await user.click(screen.getByRole('button', { name: 'Save All' }));

    expect(await screen.findByText(/"John" already exists/)).toBeInTheDocument();
    expect(__getAllPaths().filter((path) => path.includes('/players/'))).toHaveLength(0);
  });

  it('Save All creates and selects a new full name entered while editing a matched row', async () => {
    const user = userEvent.setup();
    const existing = makePlayer({ id: 'p1', firstName: 'John', lastName: 'Smith' });
    const { store } = renderStep([
      makeItem({
        rawName: 'John',
        editableName: 'John',
        status: 'matched',
        candidates: [existing],
        resolvedPlayerId: existing.id,
      }),
    ], [existing]);

    await user.click(screen.getByRole('button', { name: 'edit' }));
    await user.clear(screen.getByRole('textbox'));
    await user.type(screen.getByRole('textbox'), 'John Doe');
    await user.click(screen.getByRole('button', { name: 'Save All' }));

    await waitFor(() => {
      const [item] = store.getState().sessionModal.resolutionItems;
      expect(item.status).toBe('matched');
      expect(item.isEditing).toBe(false);
      expect(item.resolvedPlayerId).not.toBe(existing.id);
    });

    const newPlayerPath = __getAllPaths().find((path) => path.includes('/players/'));
    expect(newPlayerPath).toBeDefined();
    expect(getClubDocData('players', newPlayerPath!.split('/').pop()!)).toMatchObject({
      firstName: 'John',
      lastName: 'Doe',
    });
  });

  it('shows a failure message for a failed match', () => {
    renderStep([makeItem({ status: 'failed' })]);
    expect(screen.getByText(/Match failed/)).toBeInTheDocument();
  });

  it('flags duplicate selections when two items resolve to the same player', async () => {
    const user = userEvent.setup();
    const player = makePlayer();
    renderStep([
      makeItem({ id: 'a', status: 'matched', candidates: [player], resolvedPlayerId: 'p1' }),
      makeItem({ id: 'b', rawName: 'J. Smith', status: 'matched', candidates: [player], resolvedPlayerId: 'p1' }),
    ]);
    // Duplicate rows are marked with a warning-colored "edit" link...
    const editLinks = screen.getAllByRole('button', { name: 'edit' });
    expect(editLinks.some(link => link.className.includes('text-warning'))).toBe(true);
    // ...and the confirm button is disabled with a tooltip explaining why (shown on hover).
    const confirmButton = screen.getByRole('button', { name: /Confirm & Add Details/ });
    expect(confirmButton).toBeDisabled();
    await user.hover(confirmButton.parentElement!);
    expect(await screen.findByText(/Duplicate names found/)).toBeInTheDocument();
  });

  it('disables "Confirm & Add Details" until every item is resolved', () => {
    renderStep([makeItem({ status: 'unmatched', resolvedPlayerId: null })]);
    expect(screen.getByRole('button', { name: /Confirm & Add Details/ })).toBeDisabled();
  });

  it('removes an entire row (not just its match) when its remove button is clicked', async () => {
    const user = userEvent.setup();
    const player = makePlayer();
    renderStep([
      makeItem({ id: 'a', rawName: 'John Smith', status: 'matched', candidates: [player], resolvedPlayerId: 'p1' }),
      makeItem({ id: 'b', rawName: 'Jane Doe', status: 'unmatched' }),
    ]);

    expect(screen.getByRole('button', { name: 'Remove John Smith' })).toBeInTheDocument();
    expect(screen.getByText('Jane Doe')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Remove John Smith' }));

    expect(screen.queryByRole('button', { name: 'Remove John Smith' })).not.toBeInTheDocument();
    expect(screen.getByText('Jane Doe')).toBeInTheDocument();
    // With the unresolved row still remaining, confirm must stay disabled...
    expect(screen.getByRole('button', { name: /Confirm & Add Details/ })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Remove Jane Doe' }));
    expect(screen.queryByText('Jane Doe')).not.toBeInTheDocument();
    // ...but selectAllResolved requires at least one item, so with zero rows
    // left, confirm still stays disabled rather than "trivially" enabling.
    expect(screen.getByRole('button', { name: /Confirm & Add Details/ })).toBeDisabled();
  });

  it('enables and calls onComplete with the resolved items once everything is resolved', async () => {
    const user = userEvent.setup();
    const onComplete = jest.fn();
    const player = makePlayer();
    const items = [makeItem({ status: 'matched', candidates: [player], resolvedPlayerId: 'p1' })];
    renderWithProviders(<ResolveNamesStep onComplete={onComplete} onBack={jest.fn()} />, {
      preloadedState: {
        sessionModal: { mode: 'resolve', playersInput: '', resolutionItems: items, confirmedPlayers: [], errors: {} } as RootState['sessionModal'],
        players: makePlayersState([player]),
      },
    });

    const confirmButton = screen.getByRole('button', { name: /Confirm & Add Details/ });
    expect(confirmButton).toBeEnabled();
    await user.click(confirmButton);
    expect(onComplete).toHaveBeenCalledWith(items);
  });

  it('calls onBack when the Back button is clicked', async () => {
    const user = userEvent.setup();
    const onBack = jest.fn();
    renderWithProviders(<ResolveNamesStep onComplete={jest.fn()} onBack={onBack} />, {
      preloadedState: {
        sessionModal: { mode: 'resolve', playersInput: '', resolutionItems: [], confirmedPlayers: [], errors: {} } as RootState['sessionModal'],
        players: makePlayersState([]),
      },
    });
    await user.click(screen.getByRole('button', { name: /Back/ }));
    expect(onBack).toHaveBeenCalled();
  });

  it('re-matches a name against seeded players when edited and searched', async () => {
    const user = userEvent.setup();
    seedClubDoc('players', 'p1', makePlayer({ id: 'p1', firstName: 'Ada', firstNameLower: 'ada', lastName: 'Lovelace', lastNameLower: 'lovelace' }));
    renderStep([makeItem({ status: 'unmatched', editableName: 'Wrong Name', resolvedPlayerId: null })]);

    await user.click(screen.getByRole('button', { name: 'edit' }));
    const input = screen.getByRole('textbox');
    await user.clear(input);
    await user.type(input, 'Ada Lovelace');
    await user.click(screen.getByRole('button', { name: 'Search' }));

    expect(await screen.findByText('Ada Lovelace')).toBeInTheDocument();
  });
});
