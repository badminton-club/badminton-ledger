import reducer, {
  subscribeToPlayers,
  setLoading,
  setPlayers,
  setError,
  setListenerInactive,
  selectAllPlayers,
  selectPlayerById,
  selectPlayerIds,
  selectPlayersStatus,
  selectPlayersError,
  selectIsPlayerListening,
} from '../playersSlice';
import { configureStore } from '@reduxjs/toolkit';
import type { RootState } from '../../../store';
import type { Player } from 'types';
import {
  resetFirebaseTestState,
  seedClubDoc,
} from '../../../test-utils/firebaseTestHelpers';

const initialState = reducer(undefined, { type: '@@INIT' });

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

describe('playersSlice reducer', () => {
  it('has the expected initial state', () => {
    expect(initialState.status).toBe('idle');
    expect(initialState.error).toBeNull();
    expect(initialState.isListening).toBe(false);
    expect(selectAllPlayers({ players: initialState } as RootState)).toEqual([]);
  });

  it('setLoading marks loading + listening', () => {
    const state = reducer(initialState, setLoading());
    expect(state.status).toBe('loading');
    expect(state.isListening).toBe(true);
  });

  it('setPlayers stores all players (via the entity adapter) and marks succeeded', () => {
    const players = [makePlayer({ id: 'p1' }), makePlayer({ id: 'p2', firstName: 'Grace' })];
    const state = reducer(initialState, setPlayers(players));
    expect(state.status).toBe('succeeded');
    expect(state.error).toBeNull();
    expect(selectAllPlayers({ players: state } as RootState)).toHaveLength(2);
    expect(selectPlayerById({ players: state } as RootState, 'p2')?.firstName).toBe('Grace');
    expect(selectPlayerIds({ players: state } as RootState)).toEqual(['p1', 'p2']);
  });

  it('setPlayers replaces (not merges) the previous set', () => {
    const first = reducer(initialState, setPlayers([makePlayer({ id: 'p1' })]));
    const second = reducer(first, setPlayers([makePlayer({ id: 'p2' })]));
    expect(selectPlayerIds({ players: second } as RootState)).toEqual(['p2']);
  });

  it('setError marks failed and stops listening', () => {
    const state = reducer(initialState, setError('boom'));
    expect(state.status).toBe('failed');
    expect(state.error).toBe('boom');
    expect(state.isListening).toBe(false);
  });

  it('setListenerInactive resets to idle and stops listening', () => {
    const loading = reducer(initialState, setLoading());
    const state = reducer(loading, setListenerInactive());
    expect(state.status).toBe('idle');
    expect(state.isListening).toBe(false);
  });
});

describe('playersSlice selectors', () => {
  it('selectPlayersStatus / selectPlayersError / selectIsPlayerListening read their fields', () => {
    const state = { ...initialState, status: 'failed' as const, error: 'oops', isListening: false };
    const root = { players: state } as RootState;
    expect(selectPlayersStatus(root)).toBe('failed');
    expect(selectPlayersError(root)).toBe('oops');
    expect(selectIsPlayerListening(root)).toBe(false);
  });
});

describe('subscribeToPlayers thunk', () => {
  beforeEach(() => {
    resetFirebaseTestState();
  });

  function makeTestStore() {
    return configureStore({
      reducer: { players: reducer },
      middleware: getDefault => getDefault({ serializableCheck: false }),
    });
  }

  it('attaches a listener, loads players sorted by first/last name, and marks succeeded', async () => {
    seedClubDoc('players', 'p1', makePlayer({ id: 'p1', firstName: 'Zed', firstNameLower: 'zed' }));
    seedClubDoc('players', 'p2', makePlayer({ id: 'p2', firstName: 'Ada', firstNameLower: 'ada' }));

    const store = makeTestStore();
    expect(store.getState().players.status).toBe('idle');

    const promise = store.dispatch(subscribeToPlayers());
    // Synchronous "pending" dispatch happens before the listener resolves.
    expect(store.getState().players.status).toBe('loading');
    expect(store.getState().players.isListening).toBe(true);

    await promise;

    const state = store.getState().players;
    expect(state.status).toBe('succeeded');
    expect(selectAllPlayers({ players: state } as RootState).map(p => p.id)).toEqual(['p2', 'p1']);
  });

  it('unsubscribing (aborting) marks the listener inactive again', async () => {
    const store = makeTestStore();
    const dispatched = store.dispatch(subscribeToPlayers());
    dispatched.abort();
    await dispatched;
    expect(store.getState().players.isListening).toBe(false);
  });
});
