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
import {
  __registerAccount,
  __getVerificationEmailsSent,
  __getPasswordResetsSent,
  __getEmailSignInLinksSent,
} from '../../test-utils/fakeAuth';
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
  localStorage.clear();
  window.history.replaceState({}, '', '/');
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

  it('disables the Google sign-in button while a sign-in is in flight, so a double-click cannot fire twice', async () => {
    const user = userEvent.setup();
    let resolveSignIn: () => void = () => {};
    jest.mocked(signInWithGoogle).mockImplementation(() => new Promise((resolve) => {
      resolveSignIn = () => resolve(currentUser as never);
    }));

    renderPage();
    const button = screen.getByRole('button', { name: 'Sign in with Google' });

    await user.click(button);
    await user.click(button); // second click while still in flight

    expect(signInWithGoogle).toHaveBeenCalledTimes(1);
    expect(button).toBeDisabled();

    resolveSignIn();
    await waitFor(() => expect(button).not.toBeDisabled());
  });

  it('quietly clears the busy state without an error banner when the Google popup is closed by the user', async () => {
    const user = userEvent.setup();
    const { FirebaseError } = jest.requireActual('firebase/app') as typeof import('firebase/app');
    jest.mocked(signInWithGoogle).mockRejectedValueOnce(
      new FirebaseError('auth/popup-closed-by-user', 'The popup has been closed by the user before finalizing the operation.')
    );

    renderPage();
    await user.click(screen.getByRole('button', { name: 'Sign in with Google' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Sign in with Google' })).not.toBeDisabled());
    expect(screen.queryByText(/failed/i)).not.toBeInTheDocument();
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
    await user.click(screen.getByRole('button', { name: 'Join' }));

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
    const createClubCard = screen.getByText('Create a new club').closest('.card') as HTMLElement;
    await user.type(within(createClubCard).getByRole('textbox', { name: 'Club name' }), 'Wed Badminton Club');
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

  it('signs up with email/username/password, showing the emailVerified reminder banner afterward', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Need an account? Sign up' }));
    await user.type(screen.getByLabelText('Display name (optional)'), 'JamieL');
    await user.type(screen.getByLabelText('Email'), 'jamie@example.com');
    await user.type(screen.getByLabelText('Password'), 'hunter22');
    await user.type(screen.getByLabelText('Confirm password'), 'hunter22');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByText(/Signed in as/)).toHaveTextContent('JamieL');
    expect(__getVerificationEmailsSent()).toEqual(['jamie@example.com']);
    expect(await screen.findByText(/Please verify your email address/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Resend verification email' }));
    expect(await screen.findByText('Sent!')).toBeInTheDocument();
    expect(__getVerificationEmailsSent()).toHaveLength(2);
  });

  it('signs up without a display name, falling back to showing the email', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Need an account? Sign up' }));
    await user.type(screen.getByLabelText('Email'), 'nodisplay@example.com');
    await user.type(screen.getByLabelText('Password'), 'hunter22');
    await user.type(screen.getByLabelText('Confirm password'), 'hunter22');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByText(/Signed in as/)).toHaveTextContent('nodisplay@example.com');
  });

  it('shows a validation error when sign-up passwords do not match', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Need an account? Sign up' }));
    await user.type(screen.getByLabelText('Display name (optional)'), 'JamieL');
    await user.type(screen.getByLabelText('Email'), 'jamie@example.com');
    await user.type(screen.getByLabelText('Password'), 'hunter22');
    await user.type(screen.getByLabelText('Confirm password'), 'different');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByText('Passwords do not match.')).toBeInTheDocument();
  });

  it('rejects signing up with an email that already has an account', async () => {
    const user = userEvent.setup();
    __registerAccount('jamie@example.com', 'hunter22');
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Need an account? Sign up' }));
    await user.type(screen.getByLabelText('Display name (optional)'), 'JamieL');
    await user.type(screen.getByLabelText('Email'), 'jamie@example.com');
    await user.type(screen.getByLabelText('Password'), 'hunter22');
    await user.type(screen.getByLabelText('Confirm password'), 'hunter22');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByText(/already has an account/)).toBeInTheDocument();
  });

  it('signs in with an existing email/password account', async () => {
    const user = userEvent.setup();
    __registerAccount('jamie@example.com', 'hunter22', 'JamieL');
    renderPage();

    await user.type(screen.getByLabelText('Email'), 'jamie@example.com');
    await user.type(screen.getByLabelText('Password'), 'hunter22');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText(/Signed in as/)).toHaveTextContent('JamieL');
  });

  it('shows an error for an incorrect email/password combination', async () => {
    const user = userEvent.setup();
    __registerAccount('jamie@example.com', 'hunter22');
    renderPage();

    await user.type(screen.getByLabelText('Email'), 'jamie@example.com');
    await user.type(screen.getByLabelText('Password'), 'wrong-password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('Incorrect email or password.')).toBeInTheDocument();
  });

  it('sends a password-reset email via "Forgot password?", with an enumeration-safe message either way', async () => {
    const user = userEvent.setup();
    __registerAccount('jamie@example.com', 'hunter22');
    renderPage();

    await user.type(screen.getByLabelText('Email'), 'jamie@example.com');
    await user.click(screen.getByRole('button', { name: 'Forgot password?' }));

    expect(await screen.findByText(/password reset link has been sent/)).toBeInTheDocument();
    expect(__getPasswordResetsSent()).toEqual(['jamie@example.com']);

    // An unregistered email shows the exact same message — doesn't reveal whether the account exists.
    await user.clear(screen.getByLabelText('Email'));
    await user.type(screen.getByLabelText('Email'), 'nobody@example.com');
    await user.click(screen.getByRole('button', { name: 'Forgot password?' }));

    expect(await screen.findByText(/password reset link has been sent/)).toBeInTheDocument();
    expect(__getPasswordResetsSent()).toEqual(['jamie@example.com']); // unchanged — nothing actually sent
  });

  it('sends a passwordless sign-in link and preserves a pending club invitation', async () => {
    const user = userEvent.setup();
    window.history.replaceState({}, '', '/auth?invite=invite-1');
    renderPage();

    await user.type(screen.getByLabelText('Email'), 'jamie@example.com');
    await user.click(screen.getByRole('button', { name: 'Email me a sign-in link' }));

    expect(await screen.findByText('A sign-in link has been sent to jamie@example.com.')).toBeInTheDocument();
    expect(__getEmailSignInLinksSent()).toEqual([{
      email: 'jamie@example.com',
      returnUrl: 'http://localhost/auth?invite=invite-1',
    }]);
    expect(localStorage.getItem('emailForSignIn')).toBe('jamie@example.com');
  });

  it('automatically completes a same-device passwordless sign-in link', async () => {
    __registerAccount('jamie@example.com', 'hunter22');
    localStorage.setItem('emailForSignIn', 'jamie@example.com');
    window.history.replaceState({}, '', '/auth?mode=signIn&oobCode=valid-code');

    renderPage();

    expect(await screen.findByText(/Signed in as/)).toHaveTextContent('jamie@example.com');
    expect(localStorage.getItem('emailForSignIn')).toBeNull();
    expect(window.location.search).toBe('');
  });

  it('asks for the email when a sign-in link is opened on another device', async () => {
    const user = userEvent.setup();
    __registerAccount('jamie@example.com', 'hunter22');
    window.history.replaceState({}, '', '/auth?mode=signIn&oobCode=valid-code');
    renderPage();

    expect(screen.getByText(/Enter the email address that received this link/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();

    await user.type(screen.getByLabelText('Email'), 'jamie@example.com');
    await user.click(screen.getByRole('button', { name: 'Complete sign-in' }));

    expect(await screen.findByText(/Signed in as/)).toHaveTextContent('jamie@example.com');
  });
});
