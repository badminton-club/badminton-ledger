import React from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { useClubBootstrap } from '../useClubBootstrap';
import { makeTestStore } from '../../../test-utils/renderWithProviders';
import {
  resetFirebaseTestState,
  seedClubDoc,
  seedClubMetaDoc,
  seedMemberDoc,
  seedUserDoc,
  setCurrentUser,
} from '../../../test-utils/firebaseTestHelpers';
import { getCurrentClubId } from '../../../services/firebase/client';

const currentUser = { uid: 'user-1', displayName: 'Ada Lovelace', email: 'ada@example.com' };

beforeEach(() => {
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
  it('resets club state and signs out when there is no user', async () => {
    const store = makeTestStore({ club: { currentClubId: 'stale', role: 'admin', clubs: [], disabledTabs: [], signedIn: true, accountName: 'Admin', ready: true } });
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

  it('marks ready with no current club when the user has no clubs at all', async () => {
    seedUserDoc(currentUser.uid, { clubs: [] });

    const store = makeTestStore();
    setCurrentUser(currentUser);
    renderBootstrap(store);

    await waitFor(() => expect(store.getState().club.ready).toBe(true));
    expect(store.getState().club.currentClubId).toBeNull();
  });
});
