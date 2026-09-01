import reducer, {
  setCurrentClub,
  setRole,
  setClubs,
  setDisabledTabs,
  setSignedIn,
  setReady,
  resetClub,
  selectCurrentClubId,
  selectClubRole,
  selectUserClubs,
  selectDisabledTabs,
  selectSignedIn,
  selectClubReady,
  selectIsClubAdmin,
  selectIsClubSuperAdmin,
  selectCurrentClub,
} from '../clubSlice';
import type { RootState } from '../../../store';

const initialState = reducer(undefined, { type: '@@INIT' });

describe('clubSlice reducer', () => {
  it('has the expected initial state', () => {
    expect(initialState).toEqual({
      currentClubId: null,
      role: null,
      clubs: [],
      disabledTabs: [],
      signedIn: false,
      accountName: null,
      ready: false,
    });
  });

  it('setCurrentClub sets the current club id', () => {
    const state = reducer(initialState, setCurrentClub('club-1'));
    expect(state.currentClubId).toBe('club-1');
  });

  it('setRole sets the role', () => {
    const state = reducer(initialState, setRole('admin'));
    expect(state.role).toBe('admin');
  });

  it('setClubs replaces the clubs list', () => {
    const clubs = [{ id: 'c1', name: 'Club One', role: 'admin' as const }];
    const state = reducer(initialState, setClubs(clubs));
    expect(state.clubs).toEqual(clubs);
  });

  it('setDisabledTabs replaces the disabled tabs list', () => {
    const state = reducer(initialState, setDisabledTabs(['payouts']));
    expect(state.disabledTabs).toEqual(['payouts']);
  });

  it('setSignedIn toggles signedIn', () => {
    expect(reducer(initialState, setSignedIn(true)).signedIn).toBe(true);
  });

  it('setReady toggles ready', () => {
    expect(reducer(initialState, setReady(true)).ready).toBe(true);
  });

  it('resetClub restores initial state but keeps ready true (bootstrap already ran once)', () => {
    const populated = reducer(
      initialState,
      setClubs([{ id: 'c1', name: 'Club One', role: 'admin' }])
    );
    const withRole = reducer(populated, setRole('admin'));
    const reset = reducer(withRole, resetClub());
    expect(reset).toEqual({
      currentClubId: null,
      role: null,
      clubs: [],
      disabledTabs: [],
      signedIn: false,
      accountName: null,
      ready: true,
    });
  });
});

describe('clubSlice selectors', () => {
  function makeRootState(club: ReturnType<typeof reducer>): RootState {
    return { club } as RootState;
  }

  it('selectCurrentClubId / selectClubRole / selectUserClubs / selectDisabledTabs / selectSignedIn / selectClubReady read their fields', () => {
    const club = {
      currentClubId: 'club-1',
      role: 'admin' as const,
      clubs: [{ id: 'club-1', name: 'Club One', role: 'admin' as const }],
      disabledTabs: ['payouts'],
      signedIn: true,
      accountName: 'Admin',
      ready: true,
    };
    const state = makeRootState(club);
    expect(selectCurrentClubId(state)).toBe('club-1');
    expect(selectClubRole(state)).toBe('admin');
    expect(selectUserClubs(state)).toEqual(club.clubs);
    expect(selectDisabledTabs(state)).toEqual(['payouts']);
    expect(selectSignedIn(state)).toBe(true);
    expect(selectClubReady(state)).toBe(true);
  });

  it('selectIsClubAdmin is true for both "admin" and "superAdmin"', () => {
    expect(selectIsClubAdmin(makeRootState({ ...initialState, role: 'admin' }))).toBe(true);
    expect(selectIsClubAdmin(makeRootState({ ...initialState, role: 'superAdmin' }))).toBe(true);
    expect(selectIsClubAdmin(makeRootState({ ...initialState, role: null }))).toBe(false);
  });

  it('selectIsClubSuperAdmin is true only for "superAdmin"', () => {
    expect(selectIsClubSuperAdmin(makeRootState({ ...initialState, role: 'superAdmin' }))).toBe(true);
    expect(selectIsClubSuperAdmin(makeRootState({ ...initialState, role: 'admin' }))).toBe(false);
  });

  it('selectCurrentClub finds the club matching currentClubId, or null if none matches', () => {
    const club = {
      ...initialState,
      currentClubId: 'club-2',
      clubs: [
        { id: 'club-1', name: 'Club One', role: 'admin' as const },
        { id: 'club-2', name: 'Club Two', role: 'member' as const },
      ],
    };
    expect(selectCurrentClub(makeRootState(club))).toEqual({ id: 'club-2', name: 'Club Two', role: 'member' });
    expect(selectCurrentClub(makeRootState({ ...club, currentClubId: 'missing' }))).toBeNull();
  });
});
