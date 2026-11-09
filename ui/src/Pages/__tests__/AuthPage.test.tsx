import React from 'react';
import { act, screen, waitFor, within } from '@testing-library/react';
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
import { confirmGmailConnection, searchEtransferEmails } from '../../services/firebase/gmail';

jest.mock('../../services/firebase/gmail', () => ({
  ...jest.requireActual('../../services/firebase/gmail'),
  confirmGmailConnection: jest.fn(),
  searchEtransferEmails: jest.fn(),
}));

jest.mock('../../services/firebase', () => ({
  ...jest.requireActual('../../services/firebase'),
  signInWithGoogle: jest.fn(),
}));

const actualFirebase = jest.requireActual('../../services/firebase') as typeof import('../../services/firebase');

const currentUser = {
  uid: 'user-1',
  displayName: 'Grace Hopper',
  email: 'grace@example.com',
  providerData: [{ providerId: 'google.com' }],
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
  jest.mocked(confirmGmailConnection).mockReset().mockResolvedValue(undefined);
  jest.mocked(searchEtransferEmails).mockReset();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('AuthPage', () => {
  it('keeps a browser handoff pending through app login and only confirms on an explicit click', async () => {
    const user = userEvent.setup();
    window.history.replaceState({}, '', '/auth?gmailHandoff=browser-only-ticket&gmailClub=destination-club');
    jest.mocked(signInWithGoogle).mockImplementationOnce(async () => {
      setCurrentUser(currentUser);
      return currentUser as never;
    });
    renderPage();
    expect(screen.getByText(/Sign in below with the app account that started/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm Gmail connection' })).toBeDisabled();
    expect(confirmGmailConnection).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Sign in with Google' }));
    const account = await screen.findByText(/Confirming as app account/);
    expect(account).toHaveTextContent('grace@example.com');
    expect(screen.getByText('Club ID: destination-club')).toBeInTheDocument();
    expect(screen.getByText(/Only confirm if you started/)).toHaveTextContent('Do not confirm a link sent by someone else');
    expect(confirmGmailConnection).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Confirm Gmail connection' }));
    expect(confirmGmailConnection).toHaveBeenCalledTimes(1);
    expect(confirmGmailConnection).toHaveBeenCalledWith('browser-only-ticket', 'destination-club');
    expect(await screen.findByText(/Gmail connection confirmed/)).toHaveTextContent('No payments have been imported');
    expect(screen.getByText(/Gmail connection confirmed/)).toHaveTextContent('select Scan connected Gmail when ready');
    expect(window.location.search).toBe('');
    expect(searchEtransferEmails).not.toHaveBeenCalled();
  });

  it('shows the destination independently of the selected club and does not auto-confirm for an existing app login', async () => {
    setCurrentUser(currentUser);
    window.history.replaceState({}, '', '/auth?invite=keep&gmailHandoff=ticket&gmailClub=destination-club');
    const user = userEvent.setup();
    const { store } = renderPage({
      currentClubId: 'other-club', signedIn: true,
      clubs: [{ id: 'destination-club', name: 'Destination Club', role: 'admin' }],
    });
    await screen.findByText(/Confirming as app account/);
    expect(screen.getByText('Destination Club', { selector: 'strong' })).toBeInTheDocument();
    expect(confirmGmailConnection).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Confirm Gmail connection' }));
    await screen.findByText(/Gmail connection confirmed/);
    expect(confirmGmailConnection).toHaveBeenCalledWith('ticket', 'destination-club');
    expect(store.getState().club.currentClubId).toBe('other-club');
    expect(window.location.search).toBe('?invite=keep');
    expect(searchEtransferEmails).not.toHaveBeenCalled();
  });

  it('does not confirm incomplete handoffs or trigger searches', async () => {
    setCurrentUser(currentUser);
    window.history.replaceState({}, '', '/auth?gmailHandoff=ticket');
    renderPage({ signedIn: true });
    await screen.findByText(/Confirming as app account/);
    expect(screen.getByRole('button', { name: 'Confirm Gmail connection' })).toBeDisabled();
    expect(confirmGmailConnection).not.toHaveBeenCalled();
    expect(searchEtransferEmails).not.toHaveBeenCalled();
  });

  it('preserves the ticket and explains a wrong-owner rejection without attaching or importing anything', async () => {
    const user = userEvent.setup();
    setCurrentUser(currentUser);
    window.history.replaceState({}, '', '/auth?gmailHandoff=forwarded-ticket&gmailClub=attacker-club');
    jest.mocked(confirmGmailConnection).mockRejectedValue(new Error('Sign in with the same app account that started this Gmail connection.'));
    renderPage({ signedIn: true });
    await screen.findByText(/Confirming as app account/);
    await user.click(screen.getByRole('button', { name: 'Confirm Gmail connection' }));
    expect(await screen.findByText('Sign in with the same app account that started this Gmail connection.')).toBeInTheDocument();
    expect(window.location.search).toContain('gmailHandoff=forwarded-ticket');
    expect(screen.queryByText(/Gmail connection confirmed/)).not.toBeInTheDocument();
    expect(searchEtransferEmails).not.toHaveBeenCalled();
  });

  it('disables confirmation while pending and ignores completion if the app account changes', async () => {
    const user = userEvent.setup();
    let resolve!: () => void;
    setCurrentUser(currentUser);
    window.history.replaceState({}, '', '/auth?gmailHandoff=ticket&gmailClub=destination-club');
    jest.mocked(confirmGmailConnection).mockReturnValue(new Promise((done) => { resolve = done; }));
    renderPage({ signedIn: true });
    await screen.findByText(/Confirming as app account/);
    await user.click(screen.getByRole('button', { name: 'Confirm Gmail connection' }));
    expect(screen.getByRole('button', { name: 'Confirming Gmail connection…' })).toBeDisabled();
    await act(async () => {
      setCurrentUser({ uid: 'different-user', displayName: null, email: 'other@example.com' });
    });
    await act(async () => { resolve(); });
    expect(screen.queryByText(/Gmail connection confirmed/)).not.toBeInTheDocument();
    expect(window.location.search).toContain('gmailHandoff=ticket');
    expect(screen.getByText(/Confirming as app account/)).toHaveTextContent('other@example.com');
    expect(searchEtransferEmails).not.toHaveBeenCalled();
  });

  it('shows the Google sign-in button and signs the user in when clicked', async () => {
    const user = userEvent.setup();
    jest.mocked(signInWithGoogle).mockImplementationOnce(async () => {
      setCurrentUser(currentUser);
      return currentUser as never;
    });

    renderPage();

    await user.click(screen.getByRole('button', { name: 'Sign in with Google' }));

    expect(await screen.findByText(/Signed in as/)).toHaveTextContent('grace@example.com');
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
    const clubId = store.getState().club.currentClubId;
    expect(clubId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(__getDocData(`clubs/${clubId}`)).toMatchObject({
      name: 'Wed Badminton Club',
      ownerUid: currentUser.uid,
    });
    expect(__getDocData(`clubs/${clubId}/members/${currentUser.uid}`)).toMatchObject({
      role: 'superAdmin',
    });
    expect(__getDocData(`users/${currentUser.uid}`)).toMatchObject({
      clubs: [clubId],
      lastVisitedClub: clubId,
    });
    expect(screen.queryByText('Club id: wed-badminton-club')).not.toBeInTheDocument();
  });

  it('keeps creation disabled for a whitespace-only name', async () => {
    const user = userEvent.setup();
    setCurrentUser(currentUser);
    renderPage({ signedIn: true });

    await screen.findByText(/Signed in as/);
    const textboxes = screen.getAllByRole('textbox');
    const clubNameInput = textboxes[textboxes.length - 1];
    await user.clear(clubNameInput);
    await user.type(clubNameInput, '   ');

    expect(screen.getByRole('button', { name: 'Create new club' })).toBeDisabled();
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

  it('preserves a validated Gmail confirmation ticket and destination through email-link login without confirming', async () => {
    const user = userEvent.setup();
    const ticket = 'a'.repeat(43);
    window.history.replaceState({}, '', `/auth?invite=invite-1&gmailHandoff=${ticket}&gmailClub=destination-club`);
    renderPage();
    await user.type(screen.getByLabelText('Email'), 'jamie@example.com');
    await user.click(screen.getByRole('button', { name: 'Email me a sign-in link' }));
    expect(await screen.findByText('A sign-in link has been sent to jamie@example.com.')).toBeInTheDocument();
    expect(__getEmailSignInLinksSent()).toEqual([{
      email: 'jamie@example.com',
      returnUrl: `http://localhost/auth?invite=invite-1&gmailHandoff=${ticket}&gmailClub=destination-club`,
    }]);
    expect(confirmGmailConnection).not.toHaveBeenCalled();
    expect(searchEtransferEmails).not.toHaveBeenCalled();
  });

  it.each([
    ['short-ticket', 'destination-club'],
    ['a'.repeat(43), '../other-club'],
    ['a'.repeat(43), ''],
  ])('does not forward malformed Gmail handoff fields through email-link login (%s, %s)', async (ticket, clubId) => {
    const user = userEvent.setup();
    window.history.replaceState({}, '', `/auth?gmailHandoff=${encodeURIComponent(ticket)}&gmailClub=${encodeURIComponent(clubId)}`);
    renderPage();
    await user.type(screen.getByLabelText('Email'), 'jamie@example.com');
    await user.click(screen.getByRole('button', { name: 'Email me a sign-in link' }));
    expect(await screen.findByText('A sign-in link has been sent to jamie@example.com.')).toBeInTheDocument();
    expect(__getEmailSignInLinksSent()).toEqual([{ email: 'jamie@example.com', returnUrl: 'http://localhost/auth' }]);
    expect(confirmGmailConnection).not.toHaveBeenCalled();
  });

  it('retains Gmail confirmation after automatic email-link sign-in but still requires an explicit confirm click', async () => {
    const user = userEvent.setup();
    const ticket = 'b'.repeat(43);
    __registerAccount('jamie@example.com', 'hunter22');
    localStorage.setItem('emailForSignIn', 'jamie@example.com');
    window.history.replaceState({}, '', `/auth?mode=signIn&oobCode=valid-code&gmailHandoff=${ticket}&gmailClub=destination-club`);
    renderPage();
    expect(await screen.findByText(/Confirming as app account/)).toHaveTextContent('jamie@example.com');
    expect(new URL(window.location.href).searchParams.get('gmailHandoff')).toBe(ticket);
    expect(new URL(window.location.href).searchParams.has('oobCode')).toBe(false);
    expect(confirmGmailConnection).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Confirm Gmail connection' }));
    await screen.findByText(/Gmail connection confirmed/);
    expect(confirmGmailConnection).toHaveBeenCalledWith(ticket, 'destination-club');
    expect(window.location.search).toBe('');
    expect(searchEtransferEmails).not.toHaveBeenCalled();
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
