import React from 'react';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { makeClubState, renderWithProviders } from '../../../test-utils/renderWithProviders';
import { resetFirebaseTestState, seedClubDoc, ts } from '../../../test-utils/firebaseTestHelpers';
import SessionModal from '../SessionModal';
import { setMode } from '../../../features/SessionModal/sessionModalSlice';
import type { Session } from 'types';
import type { RootState } from '../../../store';
import * as playersService from '../../../services/firebase/players';

jest.mock('../steps/ResolveNamesStep', () => ({
  __esModule: true,
  default: function MockResolveNamesStep() {
    const React = require('react');
    return React.createElement('div', { 'data-testid': 'resolve-step' }, 'Resolve step');
  },
}));

jest.mock('../steps/SessionDetailsStep', () => ({
  __esModule: true,
  default: function MockSessionDetailsStep(props: { session?: { id?: string } }) {
    const React = require('react');
    return React.createElement(
      'div',
      { 'data-testid': 'details-step' },
      `Details step for ${props.session?.id ?? 'new session'}`
    );
  },
}));

jest.mock('../steps/ExistingSessionView', () => ({
  __esModule: true,
  default: function MockExistingSessionView(props: { session: { id: string }; onEdit: () => void }) {
    const React = require('react');
    return React.createElement(
      'div',
      { 'data-testid': 'existing-session-view' },
      React.createElement('div', null, `Viewing ${props.session.id}`),
      React.createElement('button', { type: 'button', onClick: props.onEdit }, 'Mock edit')
    );
  },
}));

function makeSessionModalState(
  overrides: Partial<RootState['sessionModal']> = {}
): RootState['sessionModal'] {
  return {
    mode: 'paste',
    playersInput: '',
    resolutionItems: [],
    confirmedPlayers: [],
    errors: {},
    ...overrides,
  };
}

function seedPlayer(id: string, firstName: string, lastName: string | null): void {
  seedClubDoc('players', id, {
    firstName,
    firstNameLower: firstName.toLowerCase(),
    lastName,
    lastNameLower: lastName?.toLowerCase() ?? null,
    email: null,
    balance: 0,
    owed: 0,
    description: '',
    sessionCount: 0,
    createdAt: ts('2026-08-01T00:00:00Z'),
  });
}

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'session-1',
    date: new Date('2026-08-20T00:00:00Z'),
    location: 'Main Gym',
    durationHours: 2,
    courtCount: 4,
    totalCost: 40,
    totalCourtCost: 32,
    totalBirdieCost: 8,
    totalSessionCost: 40,
    birdieUsage: [],
    courtCreditUsage: [],
    players: [
      {
        id: 'player-1',
        percentage: 0.5,
        cost: 20,
        paid: false,
        paidVia: null,
        paidBy: null,
        comped: false,
        highlighted: false,
        settledAt: null,
      },
      {
        id: 'player-2',
        percentage: 0.5,
        cost: 20,
        paid: false,
        paidVia: null,
        paidBy: null,
        comped: false,
        highlighted: false,
        settledAt: null,
      },
    ],
    createdAt: ts('2026-08-20T00:00:00Z') as never,
    ...overrides,
  };
}

function renderSessionModal(
  sessionModal: Partial<RootState['sessionModal']> = {},
  session?: Session
) {
  return renderWithProviders(
    <SessionModal
      show
      onHide={jest.fn()}
      session={session}
      onSessionUpdate={jest.fn()}
      onSaveSession={jest.fn().mockResolvedValue(undefined)}
      onDeleteSession={jest.fn().mockResolvedValue(undefined)}
    />,
    {
      preloadedState: {
        club: makeClubState(),
        sessionModal: makeSessionModalState(sessionModal),
      },
    }
  );
}

describe('SessionModal', () => {
  beforeEach(() => {
    resetFirebaseTestState();
    jest.restoreAllMocks();
  });

  it('changes the modal title for each wizard mode', () => {
    const session = makeSession();
    const { store } = renderSessionModal({ mode: 'view' }, session);

    expect(screen.getByText('Session Details')).toBeInTheDocument();

    act(() => {
      store.dispatch(setMode('paste'));
    });
    expect(screen.getByText('Add Session — Step 1: Players')).toBeInTheDocument();

    act(() => {
      store.dispatch(setMode('resolve'));
    });
    expect(screen.getByText('Add Session — Step 2: Confirm Attendees')).toBeInTheDocument();

    act(() => {
      store.dispatch(setMode('details'));
    });
    expect(screen.getByText('Add Session — Step 3: Details')).toBeInTheDocument();

    act(() => {
      store.dispatch(setMode('edit'));
    });
    expect(screen.getByText('Edit Session')).toBeInTheDocument();
  });

  it('parses numbered names, ignores waitlist entries, and resolves matching players', async () => {
    const user = userEvent.setup();
    const findPlayersByNameSpy = jest.spyOn(playersService, 'findPlayersByName');
    seedPlayer('player-1', 'John', 'Smith');
    seedPlayer('player-2', 'Jane', 'Doe');

    const { store } = renderSessionModal({ mode: 'paste' });

    await user.type(
      screen.getByRole('textbox'),
      '1. John Smith{enter}2. Jane Doe{enter}Waitlist:{enter}3. Ignored Person'
    );
    await user.click(screen.getByRole('button', { name: 'Next: Confirm Players' }));

    expect(screen.getByText('Add Session — Step 2: Confirm Attendees')).toBeInTheDocument();
    expect(screen.getByTestId('resolve-step')).toBeInTheDocument();
    expect(store.getState().sessionModal.mode).toBe('resolve');
    expect(store.getState().sessionModal.resolutionItems.map((item) => item.rawName)).toEqual([
      'John Smith',
      'Jane Doe',
    ]);

    await waitFor(() => {
      expect(findPlayersByNameSpy).toHaveBeenCalledTimes(2);
    });
    expect(findPlayersByNameSpy.mock.calls.map(([name]) => name)).toEqual(['John Smith', 'Jane Doe']);

    await waitFor(() => {
      expect(store.getState().sessionModal.resolutionItems).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            rawName: 'John Smith',
            status: 'matched',
            resolvedPlayerId: 'player-1',
          }),
          expect.objectContaining({
            rawName: 'Jane Doe',
            status: 'matched',
            resolvedPlayerId: 'player-2',
          }),
        ])
      );
    });
  });

  it('shows a form error when no valid numbered names are found', async () => {
    const user = userEvent.setup();
    renderSessionModal({ mode: 'paste' });

    await user.type(screen.getByRole('textbox'), 'Waitlist:{enter}1. Later Person');
    await user.click(screen.getByRole('button', { name: 'Next: Confirm Players' }));

    expect(await screen.findByText('No valid player names found.')).toBeInTheDocument();
    expect(screen.getByText('Add Session — Step 1: Players')).toBeInTheDocument();
    expect(screen.queryByTestId('resolve-step')).not.toBeInTheDocument();
  });

  it('marks a resolution item as failed when player lookup throws', async () => {
    const user = userEvent.setup();
    jest.spyOn(playersService, 'findPlayersByName').mockRejectedValueOnce(new Error('Lookup failed'));

    const { store } = renderSessionModal({ mode: 'paste' });

    await user.type(screen.getByRole('textbox'), '1. Broken Lookup');
    await user.click(screen.getByRole('button', { name: 'Next: Confirm Players' }));

    expect(screen.getByText('Add Session — Step 2: Confirm Attendees')).toBeInTheDocument();

    await waitFor(() => {
      expect(store.getState().sessionModal.resolutionItems[0]).toEqual(
        expect.objectContaining({
          rawName: 'Broken Lookup',
          status: 'failed',
          resolvedPlayerId: null,
        })
      );
    });
  });
});
