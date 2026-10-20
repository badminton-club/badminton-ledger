import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { useClubBootstrap } from '../useClubBootstrap';
import { makeClubState, makeTestStore } from '../../../test-utils/renderWithProviders';
import * as clubService from '../../../services/firebase/clubs';
import { setCurrentClub } from '../clubSlice';
import {
  resetFirebaseTestState,
  seedClubDoc,
  seedClubMetaDoc,
  seedMemberDoc,
  seedUserDoc,
  setCurrentUser,
} from '../../../test-utils/firebaseTestHelpers';
import { getCurrentClubId } from '../../../services/firebase/client';
import { __getDocData, __seedDoc } from '../../../test-utils/fakeFirestore';

const currentUser = {
  uid: 'user-1',
  displayName: 'Ada Lovelace',
  email: 'ada@example.com',
  emailVerified: true,
  providerData: [{ providerId: 'google.com' }],
};

beforeEach(() => {
  jest.restoreAllMocks();
  resetFirebaseTestState();
  localStorage.clear();
});

function renderBootstrap(store: ReturnType<typeof makeTestStore>, route = '/') {
  return renderHook(() => useClubBootstrap(), {
    wrapper: ({ children }) => (
      <Provider store={store}>
        <MemoryRouter initialEntries={[route]}>{children}</MemoryRouter>
      </Provider>
    ),
  });
}

describe('useClubBootstrap', () => {
  it('makes admin tabs ready before a slow linked-player name finishes', async () => {
    seedUserDoc(currentUser.uid, { clubs: ['club-a'] });
    seedClubMetaDoc('club-a', { name: 'Club A', disabledTabs: ['payout'] });
    seedMemberDoc(currentUser.uid, { role: 'admin' }, 'club-a');
    let resolveName!: (value: string) => void;
    jest.spyOn(clubService, 'fetchMemberDisplayName').mockReturnValueOnce(
      new Promise((done) => { resolveName = done; })
    );
    const store = makeTestStore();
    setCurrentUser(currentUser);
    renderBootstrap(store);
    await waitFor(() => expect(store.getState().club.ready).toBe(true));
    expect(store.getState().club.role).toBe('admin');
    expect(store.getState().club.disabledTabs).toEqual(['payout']);
    expect(store.getState().club.accountName).toBe(currentUser.email);
    await act(async () => { resolveName('Linked Player'); });
    expect(store.getState().club.accountName).toBe('Linked Player');
  });

  it('loads navigation before stale-club cleanup writes finish', async () => {
    seedUserDoc(currentUser.uid, { clubs: ['dead-club', 'club-a'] });
    seedClubMetaDoc('club-a', { name: 'Club A' });
    seedMemberDoc(currentUser.uid, { role: 'admin' }, 'club-a');
    let finishCleanup!: () => void;
    jest.spyOn(clubService, 'removeClubFromUser').mockReturnValueOnce(
      new Promise((done) => { finishCleanup = done; })
    );
    const store = makeTestStore();
    setCurrentUser(currentUser);
    renderBootstrap(store);
    await waitFor(() => expect(store.getState().club.ready).toBe(true));
    expect(store.getState().club.currentClubId).toBe('club-a');
    expect(store.getState().club.role).toBe('admin');
    expect(store.getState().club.clubs.map((club) => club.id)).toEqual(['club-a']);
    await act(async () => { finishCleanup(); });
  });

  it('ignores a slow linked name from a previously selected club', async () => {
    seedUserDoc(currentUser.uid, { clubs: ['club-a', 'club-b'] });
    for (const id of ['club-a', 'club-b']) {
      seedClubMetaDoc(id, { name: id });
      seedMemberDoc(currentUser.uid, { role: 'admin' }, id);
    }
    let resolveOldName!: (value: string) => void;
    jest.spyOn(clubService, 'fetchMemberDisplayName')
      .mockReturnValueOnce(new Promise((done) => { resolveOldName = done; }))
      .mockResolvedValueOnce('Current Player');
    const store = makeTestStore();
    setCurrentUser(currentUser);
    renderBootstrap(store);
    await waitFor(() => expect(store.getState().club.ready).toBe(true));
    act(() => { store.dispatch(setCurrentClub('club-b')); });
    await waitFor(() => expect(store.getState().club.accountName).toBe('Current Player'));
    await act(async () => { resolveOldName('Old Player'); });
    expect(store.getState().club.accountName).toBe('Current Player');
  });

  it('resets club state and signs out when there is no user', async () => {
    const store = makeTestStore({ club: makeClubState({ currentClubId: 'stale', role: 'admin', clubs: [], signedIn: true, accountName: 'Admin' }) });
    renderBootstrap(store);

    await waitFor(() => expect(store.getState().club.signedIn).toBe(false));
    expect(store.getState().club.currentClubId).toBeNull();
    expect(store.getState().club.ready).toBe(true); // resetClub() sets ready: true
  });

  it('picks the first club when the user has no saved preference', async () => {
    seedUserDoc(currentUser.uid, { clubs: ['club-a', 'club-b'] });
    seedClubMetaDoc('club-a', { name: 'Club A' });
    seedMemberDoc(currentUser.uid, { role: 'admin' }, 'club-a');
    seedClubMetaDoc('club-b', { name: 'Club B' });
    seedMemberDoc(currentUser.uid, { role: 'member' }, 'club-b');

    const store = makeTestStore();
    setCurrentUser(currentUser);
    renderBootstrap(store);

    await waitFor(() => expect(store.getState().club.currentClubId).toBe('club-a'));
    await waitFor(() => expect(store.getState().club.role).toBe('admin'));
    expect(store.getState().club.ready).toBe(true);
  });

  it('reloads role and tabs when switching users in the same club', async () => {
    const otherUser = { ...currentUser, uid: 'user-2' };
    for (const user of [currentUser, otherUser]) {
      seedUserDoc(user.uid, { clubs: ['club-a'] });
    }
    seedClubMetaDoc('club-a', { name: 'Club A', disabledTabs: ['payout'] });
    seedMemberDoc(currentUser.uid, { role: 'member' }, 'club-a');
    seedMemberDoc(otherUser.uid, { role: 'admin' }, 'club-a');
    const store = makeTestStore();
    setCurrentUser(currentUser);
    renderBootstrap(store);
    await waitFor(() => expect(store.getState().club.ready).toBe(true));
    expect(store.getState().club.role).toBe('member');
    seedClubMetaDoc('club-a', { name: 'Club A', disabledTabs: [] });
    act(() => { setCurrentUser(otherUser); });
    await waitFor(() => expect(store.getState().club.role).toBe('admin'));
    expect(store.getState().club.ready).toBe(true);
    expect(store.getState().club.disabledTabs).toEqual([]);
  });

  it('rejects an old user role response after a same-club account switch', async () => {
    const otherUser = { ...currentUser, uid: 'user-2' };
    for (const user of [currentUser, otherUser]) {
      seedUserDoc(user.uid, { clubs: ['club-a'] });
      seedMemberDoc(user.uid, { role: user.uid === currentUser.uid ? 'admin' : 'member' }, 'club-a');
    }
    seedClubMetaDoc('club-a', { name: 'Club A' });
    const original = clubService.fetchMemberRole;
    let resolve!: (value: 'admin') => void;
    let reads = 0;
    jest.spyOn(clubService, 'fetchMemberRole').mockImplementation((clubId, uid) => {
      if (uid === currentUser.uid && ++reads === 1) {
        return new Promise((done) => { resolve = done; });
      }
      return original(clubId, uid);
    });
    const store = makeTestStore();
    setCurrentUser(currentUser);
    renderBootstrap(store);
    await waitFor(() => expect(resolve).toBeDefined());
    expect(store.getState().club.ready).toBe(false);
    act(() => { setCurrentUser(otherUser); });
    await waitFor(() => expect(store.getState().club.ready).toBe(true));
    expect(store.getState().club.role).toBe('member');
    await act(async () => { resolve('admin'); });
    expect(store.getState().club.role).toBe('member');
  });

  it('surfaces club settings failures instead of declaring incomplete navigation ready', async () => {
    seedUserDoc(currentUser.uid, { clubs: ['club-a', 'club-b'] });
    for (const id of ['club-a', 'club-b']) {
      seedClubMetaDoc(id, { name: id });
      seedMemberDoc(currentUser.uid, { role: 'admin' }, id);
    }
    const store = makeTestStore();
    setCurrentUser(currentUser);
    const { result } = renderBootstrap(store);
    await waitFor(() => expect(store.getState().club.ready).toBe(true));
    const log = jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(clubService, 'fetchClub').mockRejectedValueOnce(new Error('Network unavailable'));
    act(() => { store.dispatch(setCurrentClub('club-b')); });
    await waitFor(() => expect(result.current).toContain('Unable to load your club permissions'));
    expect(store.getState().club.ready).toBe(false);
    expect(store.getState().club.role).toBeNull();
    expect(log).toHaveBeenCalled();
  });

  it('reports a failed club-list load without removing saved club membership', async () => {
    seedUserDoc(currentUser.uid, { clubs: ['club-a'] });
    jest.spyOn(clubService, 'fetchUserClubs').mockRejectedValueOnce(new Error('Network unavailable'));
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const store = makeTestStore();
    setCurrentUser(currentUser);
    const { result } = renderBootstrap(store);
    await waitFor(() => expect(result.current).toContain('Unable to load your clubs'));
    expect(store.getState().club.ready).toBe(false);
    expect(__getDocData(`users/${currentUser.uid}`)).toMatchObject({ clubs: ['club-a'] });
  });

  it("prefers the user's lastVisitedClub over the first club", async () => {
    seedUserDoc(currentUser.uid, { clubs: ['club-a', 'club-b'], lastVisitedClub: 'club-b' });
    seedClubMetaDoc('club-a', { name: 'Club A' });
    seedMemberDoc(currentUser.uid, { role: 'admin' }, 'club-a');
    seedClubMetaDoc('club-b', { name: 'Club B' });
    seedMemberDoc(currentUser.uid, { role: 'member' }, 'club-b');

    const store = makeTestStore();
    setCurrentUser(currentUser);
    renderBootstrap(store);

    await waitFor(() => expect(store.getState().club.currentClubId).toBe('club-b'));
    await waitFor(() => expect(store.getState().club.role).toBe('member'));
  });

  it('a ?club= deep link takes top priority and is added to the user\'s club list', async () => {
    seedUserDoc(currentUser.uid, { clubs: ['club-a'], lastVisitedClub: 'club-a' });
    seedClubMetaDoc('club-a', { name: 'Club A' });
    seedMemberDoc(currentUser.uid, { role: 'admin' }, 'club-a');
    seedClubMetaDoc('club-c', { name: 'Club C' });
    seedMemberDoc(currentUser.uid, { role: 'member' }, 'club-c');

    const store = makeTestStore();
    setCurrentUser(currentUser);
    renderBootstrap(store, '/?club=club-c');

    await waitFor(() => expect(store.getState().club.currentClubId).toBe('club-c'));
  });

  it('accepts an email invitation, opens its club, and keeps the pre-linked player', async () => {
    seedUserDoc(currentUser.uid, { clubs: [] });
    seedClubMetaDoc('club-c', { name: 'Club C' });
    __seedDoc('clubInvitations/invite-1', {
      clubId: 'club-c',
      email: currentUser.email,
      role: 'member',
      playerId: 'player-1',
      createdBy: 'admin-1',
    });
    __seedDoc('clubs/club-c/players/player-1', {
      firstName: 'Grace',
      lastName: 'Hopper',
    });

    const store = makeTestStore();
    setCurrentUser(currentUser);
    renderBootstrap(store, '/auth?invite=invite-1');

    await waitFor(() => expect(store.getState().club.currentClubId).toBe('club-c'));
    expect(store.getState().club.invitationError).toBeNull();
    expect(__getDocData(`clubs/club-c/members/${currentUser.uid}`)).toMatchObject({
      role: 'member',
      playerId: 'player-1',
    });
    await waitFor(() => expect(store.getState().club.accountName).toBe('Grace Hopper'));
    expect(__getDocData('clubInvitations/invite-1')).toBeUndefined();
  });

  it('surfaces an invitation email mismatch without granting access', async () => {
    seedUserDoc(currentUser.uid, { clubs: [] });
    __seedDoc('clubInvitations/invite-1', {
      clubId: 'club-c',
      email: 'someone-else@example.com',
      role: 'member',
      playerId: null,
      createdBy: 'admin-1',
    });

    const store = makeTestStore();
    setCurrentUser(currentUser);
    renderBootstrap(store, '/auth?invite=invite-1');

    await waitFor(() => expect(store.getState().club.invitationError).toContain('someone-else@example.com'));
    expect(store.getState().club.currentClubId).toBeNull();
    expect(__getDocData(`clubs/club-c/members/${currentUser.uid}`)).toBeUndefined();
  });

  it('falls back to localStorage when there is no lastVisitedClub match', async () => {
    localStorage.setItem('currentClubId', 'club-b');
    seedUserDoc(currentUser.uid, { clubs: ['club-a', 'club-b'] });
    seedClubMetaDoc('club-a', { name: 'Club A' });
    seedMemberDoc(currentUser.uid, { role: 'admin' }, 'club-a');
    seedClubMetaDoc('club-b', { name: 'Club B' });
    seedMemberDoc(currentUser.uid, { role: 'member' }, 'club-b');

    const store = makeTestStore();
    setCurrentUser(currentUser);
    renderBootstrap(store);

    await waitFor(() => expect(store.getState().club.currentClubId).toBe('club-b'));
  });

  it('loads disabledTabs from the picked club and syncs the client-scoped current club id', async () => {
    seedUserDoc(currentUser.uid, { clubs: ['club-a'] });
    seedClubMetaDoc('club-a', { name: 'Club A', disabledTabs: ['payout'] });
    seedMemberDoc(currentUser.uid, { role: 'admin' }, 'club-a');

    const store = makeTestStore();
    setCurrentUser(currentUser);
    renderBootstrap(store);

    await waitFor(() => expect(store.getState().club.disabledTabs).toEqual(['payout']));
    expect(getCurrentClubId()).toBe('club-a');
  });

  it('self-heals a stale club reference — one whose membership no longer exists (removed member, or a deleted club) — instead of showing or auto-selecting it', async () => {
    // 'dead-club' is saved on the profile, but there's no member doc for the
    // user there (as if they were removed, or the club itself was deleted),
    // so fetchMemberRole/fetchClub will both resolve to null/denied for it.
    seedUserDoc(currentUser.uid, { clubs: ['dead-club', 'club-a'], lastVisitedClub: 'dead-club' });
    seedClubMetaDoc('club-a', { name: 'Club A' });
    seedMemberDoc(currentUser.uid, { role: 'admin' }, 'club-a');

    const store = makeTestStore();
    setCurrentUser(currentUser);
    renderBootstrap(store);

    // Falls through past the (now-invalid) lastVisitedClub straight to the
    // one real club, rather than getting stuck on/selecting the dead one.
    await waitFor(() => expect(store.getState().club.currentClubId).toBe('club-a'));
    expect(store.getState().club.clubs.map((c) => c.id)).toEqual(['club-a']);

    // The dead reference is scrubbed from the user's own saved profile too,
    // so it doesn't linger forever and keep reappearing on future sign-ins.
    await waitFor(() => expect(__getDocData(`users/${currentUser.uid}`)).toMatchObject({
      clubs: ['club-a'],
    }));
  });

  it('marks ready with no current club when the user has no clubs at all', async () => {
    seedUserDoc(currentUser.uid, { clubs: [] });

    const store = makeTestStore();
    setCurrentUser(currentUser);
    renderBootstrap(store);

    await waitFor(() => expect(store.getState().club.ready).toBe(true));
    expect(store.getState().club.currentClubId).toBeNull();
  });

  it('does not let a slower first user\'s club load overwrite a faster account switch', async () => {
    const userA = { uid: 'user-a', displayName: 'User A', email: 'a@example.com' };
    const userB = { uid: 'user-b', displayName: 'User B', email: 'b@example.com' };
    seedUserDoc(userA.uid, { clubs: ['club-a'] });
    seedClubMetaDoc('club-a', { name: 'Club A' });
    seedMemberDoc(userA.uid, { role: 'admin' }, 'club-a');
    seedUserDoc(userB.uid, { clubs: ['club-b'] });
    seedClubMetaDoc('club-b', { name: 'Club B' });
    seedMemberDoc(userB.uid, { role: 'member' }, 'club-b');

    const store = makeTestStore();
    renderBootstrap(store);
    // Both switches fire before either's async club/profile load resolves —
    // without the stale-result guard, A's slower-to-settle promise chain could
    // still overwrite B's state once it eventually resolves.
    setCurrentUser(userA);
    setCurrentUser(userB);

    await waitFor(() => expect(store.getState().club.currentClubId).toBe('club-b'));
    await waitFor(() => expect(store.getState().club.role).toBe('member'));
    // Give any stale A-related dispatches a chance to land before asserting
    // the final state is still B's, not overwritten back to A's.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(store.getState().club.currentClubId).toBe('club-b');
    expect(store.getState().club.role).toBe('member');
    expect(store.getState().club.clubs.map((c) => c.id)).toEqual(['club-b']);
  });
});
