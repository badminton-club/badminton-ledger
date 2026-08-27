import React from 'react';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AuthPage from '../AuthPage';
import { renderWithProviders, makeClubState } from '../../test-utils/renderWithProviders';
import {
  resetFirebaseTestState,
  seedClubMetaDoc,
  seedMemberDoc,
  setCurrentUser,
} from '../../test-utils/firebaseTestHelpers';
import { __getDocData } from '../../test-utils/fakeFirestore';
import { signInWithGoogle } from '../../services/firebase';

jest.mock('../../services/firebase', () => ({
  ...jest.requireActual('../../services/firebase'),
  signInWithGoogle: jest.fn(),
}));

const actualFirebase = jest.requireActual('../../services/firebase') as typeof import('../../services/firebase');

const currentUser = {
  uid: 'user-1',
  displayName: 'Grace Hopper',
  email: 'grace@example.com',
};

function renderPage(clubOverrides: Partial<ReturnType<typeof makeClubState>> = {}) {
  return renderWithProviders(<AuthPage />, {
    preloadedState: {
      club: makeClubState({
        currentClubId: null,
        role: null,
        clubs: [],
        signedIn: false,
        ready: true,
        ...clubOverrides,
      }),
    },
  });
}

beforeEach(() => {
  resetFirebaseTestState();
  jest.mocked(signInWithGoogle).mockReset();
  jest.mocked(signInWithGoogle).mockImplementation(actualFirebase.signInWithGoogle);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('AuthPage', () => {
  it('shows the Google sign-in button and signs the user in when clicked', async () => {
    const user = userEvent.setup();
    jest.mocked(signInWithGoogle).mockImplementationOnce(async () => {
      setCurrentUser(currentUser);
      return currentUser as never;
    });

    renderPage();

    await user.click(screen.getByRole('button', { name: 'Sign in with Google' }));

    expect(await screen.findByText(/Signed in as/)).toHaveTextContent('Grace Hopper');
    expect(screen.getByText(currentUser.uid)).toBeInTheDocument();
  });

  it('lets the user switch which saved club is current', async () => {
    const user = userEvent.setup();
    setCurrentUser(currentUser);
    const { store } = renderPage({
      currentClubId: 'club-a',
      role: 'admin',
      clubs: [
        { id: 'club-a', name: 'Alpha Club', role: 'admin' },
        { id: 'club-b', name: 'Beta Club', role: 'member' },
      ],
      signedIn: true,
    });

    await screen.findByText(/Signed in as/);
    const betaRow = screen.getByText('Beta Club').closest('.list-group-item');
    expect(betaRow).not.toBeNull();

    await user.click(within(betaRow as HTMLElement).getByRole('button', { name: 'Open' }));

    await waitFor(() => expect(store.getState().club.currentClubId).toBe('club-b'));
    expect(within(betaRow as HTMLElement).getByRole('button', { name: 'Current' })).toBeDisabled();
  });

  it('adds a club from a shared link/id and makes it current', async () => {
    const user = userEvent.setup();
    setCurrentUser(currentUser);
    seedClubMetaDoc('join-club', { name: 'Join Club' });
    seedMemberDoc(currentUser.uid, { role: 'member' }, 'join-club');
    const { store } = renderPage({ signedIn: true });

    await screen.findByText(/Signed in as/);
    await user.type(screen.getByPlaceholderText('Club link or id'), 'https://example.com/invite?club=join-club');
    await user.click(screen.getByRole('button', { name: 'Add' }));

    expect(await screen.findByText('Join Club')).toBeInTheDocument();
    await waitFor(() => expect(store.getState().club.currentClubId).toBe('join-club'));
    expect(__getDocData(`users/${currentUser.uid}`)).toMatchObject({
      clubs: ['join-club'],
    });
  });

  it('creates a new club, stores it on the user profile, and makes it current', async () => {
    const user = userEvent.setup();
    setCurrentUser(currentUser);
    const { store } = renderPage({ signedIn: true });

    await screen.findByText(/Signed in as/);
    await user.click(screen.getByRole('button', { name: 'Create new club' }));

    expect(await screen.findByText(`Created "Wed Badminton Club". It's empty and ready to use.`)).toBeInTheDocument();
    expect(__getDocData('clubs/wed-badminton-club')).toMatchObject({
      name: 'Wed Badminton Club',
      ownerUid: currentUser.uid,
    });
    expect(__getDocData(`clubs/wed-badminton-club/members/${currentUser.uid}`)).toMatchObject({
      role: 'superAdmin',
    });
    expect(__getDocData(`users/${currentUser.uid}`)).toMatchObject({
      clubs: ['wed-badminton-club'],
      lastVisitedClub: 'wed-badminton-club',
    });
    expect(store.getState().club.currentClubId).toBe('wed-badminton-club');
  });

  it('shows a validation error when the entered club name cannot produce a usable id', async () => {
    const user = userEvent.setup();
    setCurrentUser(currentUser);
    renderPage({ signedIn: true });

    await screen.findByText(/Signed in as/);
    const textboxes = screen.getAllByRole('textbox');
    const clubNameInput = textboxes[textboxes.length - 1];
    await user.clear(clubNameInput);
    await user.type(clubNameInput, '!!!');
    await user.click(screen.getByRole('button', { name: 'Create new club' }));

    expect(await screen.findByText('Enter a club name.')).toBeInTheDocument();
    expect(__getDocData('clubs/')).toBeUndefined();
  });
});
