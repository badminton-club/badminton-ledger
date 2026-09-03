/**
 * RTL render helper that wraps a component the way the real app does — Redux
 * `<Provider>` + `<MemoryRouter>` — with an optional partial preloaded Redux
 * state and starting route. Use this instead of RTL's bare `render` for any
 * component that reads from the store or uses react-router (most pages).
 */
import React from 'react';
import { render, type RenderOptions } from '@testing-library/react';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import playersReducer from '../features/players/playersSlice';
import sessionModalReducer from '../features/SessionModal/sessionModalSlice';
import clubReducer from '../features/club/clubSlice';
import type { RootState } from '../store';
import type { Player, ClubRole, UserClub } from 'types';

export function makeTestStore(preloadedState?: Partial<RootState>) {
  return configureStore({
    reducer: {
      players:      playersReducer,
      sessionModal: sessionModalReducer,
      club:         clubReducer,
    },
    middleware: getDefault => getDefault({ serializableCheck: false }),
    // RTK's exact PreloadedState<S> type requires every slice (incl. RTK-generated
    // sub-shapes like the players entity adapter's) to be spelled out even for a
    // partial override — cast through `unknown` so tests can pass just the slices
    // they care about (e.g. `{ club: { ...} }`) without fighting that inference.
    preloadedState: preloadedState as unknown as RootState,
  });
}

/**
 * Builds a preloaded `players` slice state from a plain array — the slice uses
 * an RTK entity adapter internally (`{ ids: [], entities: {} }` normalized
 * shape, not a plain array), which is easy to get subtly wrong by hand. Pass
 * the result as `preloadedState.players` to `renderWithProviders`.
 */
export function makePlayersState(players: Player[]): RootState['players'] {
  return {
    ids: players.map(p => p.id),
    entities: Object.fromEntries(players.map(p => [p.id, p])),
    status: 'succeeded',
    error: null,
    isListening: false,
  } as unknown as RootState['players'];
}

/** Builds a preloaded `club` slice state — pass as `preloadedState.club`. Defaults to a signed-in admin of one club. */
export function makeClubState(overrides: Partial<RootState['club']> = {}): RootState['club'] {
  const currentClubId = 'test-club';
  const role: ClubRole = 'admin';
  const clubs: UserClub[] = [{ id: currentClubId, name: 'Test Club', role }];
  return {
    currentClubId,
    role,
    clubs,
    disabledTabs: [],
    signedIn: true,
    accountName: null,
    invitationError: null,
    ready: true,
    ...overrides,
  };
}

interface ExtraRenderOptions extends Omit<RenderOptions, 'wrapper'> {
  preloadedState?: Partial<RootState>;
  route?: string;
  store?: ReturnType<typeof makeTestStore>;
}

export function renderWithProviders(
  ui: React.ReactElement,
  { preloadedState, route = '/', store = makeTestStore(preloadedState), ...renderOptions }: ExtraRenderOptions = {}
) {
  function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <Provider store={store}>
        <MemoryRouter initialEntries={[route]}>{children}</MemoryRouter>
      </Provider>
    );
  }
  return { store, ...render(ui, { wrapper: Wrapper, ...renderOptions }) };
}
