import React from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ResolveNamesStep from '../ResolveNamesStep';
import { renderWithProviders, makeClubState, makePlayersState } from '../../../../test-utils/renderWithProviders';
import { resetFirebaseTestState, seedClubDoc, getClubDocData, ts, TEST_CLUB_ID } from '../../../../test-utils/firebaseTestHelpers';
import type { NameResolutionItem, Player } from 'types';

function makePlayer(overrides: Partial<Player> = {}): Player {
  return {
    id: 'p1',
    firstName: 'Alice',
    firstNameLower: 'alice',
    lastName: 'Anderson',
    lastNameLower: 'anderson',
    email: null,
    balance: 0,
    owed: 0,
    description: '',
    sessionCount: 0,
    createdAt: ts('2026-02-01'),
    ...overrides,
  };
}

function makeItem(overrides: Partial<NameResolutionItem> = {}): NameResolutionItem {
  return {
    id: '1',
    rawName: 'Alice Anderson',
    editableName: 'Alice Anderson',
    isEditing: false,
    status: 'matched',
    candidates: [makePlayer()],
    resolvedPlayerId: 'p1',
    ...overrides,
  };
}

function renderStep({
  items,
  players = [],
  formError,
  onComplete = jest.fn(),
  onBack = jest.fn(),
}: {
  items: NameResolutionItem[];
  players?: Player[];
  formError?: string;
  onComplete?: jest.Mock;
  onBack?: jest.Mock;
}) {
  return {
    onComplete,
    onBack,
    ...renderWithProviders(<ResolveNamesStep onComplete={onComplete} onBack={onBack} />, {
      preloadedState: {
        club: makeClubState({ currentClubId: TEST_CLUB_ID }),
        players: makePlayersState(players),
        sessionModal: {
          mode: 'resolve',
          playersInput: '',
          resolutionItems: items,
          confirmedPlayers: [],
          errors: formError ? { form: formError } : {},
        } as any,
      },
    }),
  };
}

beforeEach(() => {
  resetFirebaseTestState();
});

describe('ResolveNamesStep', () => {
  it('shows pending progress and lets the user go back', async () => {
    const user = userEvent.setup();
    const pending = makeItem({ id: 'pending', rawName: 'Bob', editableName: 'Bob', status: 'pending', candidates: [], resolvedPlayerId: null });
    const { onBack } = renderStep({ items: [pending] });

    expect(screen.getByText('Matching 1 name…')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '← Back' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('lets the user resolve a conflict and complete once all names are confirmed', async () => {
    const user = userEvent.setup();
    const alice = makePlayer();
    const alex1 = makePlayer({ id: 'p2', firstName: 'Alex', firstNameLower: 'alex', lastName: 'Kim', lastNameLower: 'kim' });
    const alex2 = makePlayer({ id: 'p3', firstName: 'Alex', firstNameLower: 'alex', lastName: 'Lee', lastNameLower: 'lee' });
    const { onComplete } = renderStep({
      players: [alice, alex1, alex2],
      items: [
        makeItem({ id: 'alice', candidates: [alice], resolvedPlayerId: alice.id }),
        makeItem({
          id: 'alex',
          rawName: 'Alex',
          editableName: 'Alex',
          status: 'conflict',
          candidates: [alex1, alex2],
          resolvedPlayerId: null,
        }),
      ],
    });

    await user.selectOptions(screen.getByRole('combobox'), alex2.id);
    await user.click(screen.getByRole('button', { name: 'Confirm & Add Details →' }));

    expect(onComplete).toHaveBeenCalledWith([
      expect.objectContaining({ resolvedPlayerId: 'p1' }),
      expect.objectContaining({ resolvedPlayerId: 'p3', status: 'matched' }),
    ]);
  });

  it('supports editing and rematching an unmatched name using the real player lookup service', async () => {
    const user = userEvent.setup();
    const grace = makePlayer({ id: 'p9', firstName: 'Grace', firstNameLower: 'grace', lastName: 'Hopper', lastNameLower: 'hopper' });
    seedClubDoc('players', grace.id, grace);
    const { onComplete } = renderStep({
      players: [grace],
      items: [makeItem({ id: 'bad', rawName: 'Grce', editableName: 'Grce', status: 'unmatched', candidates: [], resolvedPlayerId: null })],
    });

    await user.click(screen.getByRole('button', { name: 'edit' }));
    const textbox = screen.getByDisplayValue('Grce');
    await user.clear(textbox);
    await user.type(textbox, 'Grace Hopper');
    await user.click(screen.getByRole('button', { name: 'Search' }));

    expect(await screen.findByText('Grace Hopper')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirm & Add Details →' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Confirm & Add Details →' }));

    expect(onComplete).toHaveBeenCalledWith([
      expect.objectContaining({ resolvedPlayerId: grace.id, status: 'matched' }),
    ]);
  });

  it('creates a new player inline for an unmatched name and stores it in fake firestore', async () => {
    const user = userEvent.setup();
    const { onComplete } = renderStep({
      items: [makeItem({ id: 'new', rawName: 'New Person', editableName: 'New Person', status: 'unmatched', candidates: [], resolvedPlayerId: null })],
    });

    await user.click(screen.getByRole('button', { name: '+ Add player' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('button', { name: 'clear' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirm & Add Details →' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Confirm & Add Details →' }));

    const created = onComplete.mock.calls[0][0][0];
    const savedDoc = getClubDocData('players', created.resolvedPlayerId);
    expect(savedDoc).toEqual(expect.objectContaining({ firstName: 'New', lastName: 'Person' }));
  });

  it('disables completion when duplicate player resolutions are present', () => {
    const alice = makePlayer();
    renderStep({
      players: [alice],
      items: [
        makeItem({ id: '1', resolvedPlayerId: alice.id }),
        makeItem({ id: '2', rawName: 'Also Alice', editableName: 'Also Alice', resolvedPlayerId: alice.id }),
      ],
    });

    expect(screen.getByRole('button', { name: 'Confirm & Add Details →' })).toBeDisabled();
  });
});
