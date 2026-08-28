import React from 'react';
import { screen } from '@testing-library/react';
import { renderWithProviders } from './test-utils/renderWithProviders';
import {
  resetFirebaseTestState,
  seedUserDoc,
  seedClubMetaDoc,
  seedMemberDoc,
  setCurrentUser,
} from './test-utils/firebaseTestHelpers';
import App from './App';

// Replaces the original CRA boilerplate test (which checked for "learn react"
// text this app never renders, and crashed anyway since <App/> needs a Redux
// Provider + Router that only the real entry point — src/index.tsx — supplies).
// Now that the app is wrapped the same way in tests via renderWithProviders,
// and Firebase is faked globally, this can exercise the real app shell,
// including the live useClubBootstrap() auth/club-loading flow.

const currentUser = { uid: 'user-1', displayName: 'Ada Lovelace', email: 'ada@example.com' };

beforeEach(() => {
  resetFirebaseTestState();
});

describe('App', () => {
  it('renders the nav bar and redirects a signed-out visitor to sign in', async () => {
    renderWithProviders(<App />);

    expect(screen.getByText('Badminton Ledger')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Sign in with Google' })).toBeInTheDocument();
  });

  it('bootstraps a signed-in admin into their club and renders the calendar home page', async () => {
    seedUserDoc(currentUser.uid, { clubs: ['club-a'], lastVisitedClub: 'club-a' });
    seedClubMetaDoc('club-a', { name: 'Smashers Club' });
    seedMemberDoc(currentUser.uid, { role: 'admin' }, 'club-a');
    setCurrentUser(currentUser);

    renderWithProviders(<App />);

    // The club name appears in the nav's club-switcher once bootstrap resolves,
    // confirming useClubBootstrap picked the right club and the app rendered
    // past the sign-in gate into the real calendar page (not just the shell).
    expect(await screen.findByText('Smashers Club')).toBeInTheDocument();
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign in with Google' })).not.toBeInTheDocument();
  });
});
