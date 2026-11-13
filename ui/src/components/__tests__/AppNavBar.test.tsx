import React from 'react';
import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AppNavBar from '../AppNavBar';
import { renderWithProviders, makeClubState } from '../../test-utils/renderWithProviders';
import { setReady } from '../../features/club/clubSlice';

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-bs-theme');
});

const openAccountMenu = (name = 'Account') => userEvent.click(screen.getByRole('button', { name }));

describe('AppNavBar', () => {
  it('shows a loading indicator instead of partial club tabs until role and settings are ready', () => {
    const { store } = renderWithProviders(<AppNavBar />, {
      preloadedState: { club: makeClubState({ ready: false }) },
    });
    expect(screen.getByRole('status')).toHaveTextContent('Loading club navigation');
    expect(screen.queryByRole('link', { name: 'Attendance' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Settings' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'e-Transfers' })).not.toBeInTheDocument();
    expect(store.getState().club.ready).toBe(false);
    act(() => { store.dispatch(setReady(true)); });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /e-transfer/i })).toBeInTheDocument();
  });

  it('shows home and account access, with attendance and help in the account menu, for non-admin members', async () => {
    renderWithProviders(<AppNavBar />, {
      preloadedState: {
        club: makeClubState({
          role: 'member',
          currentClubId: 'club-a',
          clubs: [{ id: 'club-a', name: 'Alpha Club', role: 'member' }],
        }),
      },
    });

    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/');
    expect(screen.queryByRole('link', { name: 'Attendance' })).not.toBeInTheDocument();
    await openAccountMenu();
    expect(screen.getByRole('link', { name: 'Attendance' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Help & FAQ' })).toHaveAttribute('href', '/faq');
    expect(screen.queryByRole('link', { name: 'Birdies' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Credits' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Players' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Payout' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Settings' })).not.toBeInTheDocument();
  });

  it('shows admin tabs except the ones disabled for the current club', async () => {
    renderWithProviders(<AppNavBar />, {
      preloadedState: {
        club: makeClubState({
          role: 'admin',
          currentClubId: 'club-a',
          disabledTabs: ['credits', 'payout'],
          clubs: [{ id: 'club-a', name: 'Alpha Club', role: 'admin' }],
        }),
      },
    });

    expect(screen.getByRole('link', { name: 'Birdies' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Players' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Credits' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Payout' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Settings' })).not.toBeInTheDocument();
    await openAccountMenu();
    expect(screen.getByRole('link', { name: 'Attendance' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Settings' })).toBeInTheDocument();
  });

  it('lists Account, Settings, Attendance, Help & FAQ in order in the account menu', async () => {
    renderWithProviders(<AppNavBar />, {
      preloadedState: {
        club: makeClubState({
          role: 'admin',
          currentClubId: 'club-a',
          clubs: [{ id: 'club-a', name: 'Alpha Club', role: 'admin' }],
        }),
      },
    });

    await openAccountMenu();
    const linkNames = screen.getAllByRole('link').map((el) => el.textContent);
    const start = linkNames.indexOf('Account');
    expect(start).toBeGreaterThan(-1);
    expect(linkNames.slice(start, start + 4)).toEqual(['Account', 'Settings', 'Attendance', 'Help & FAQ']);
  });

  it('hides Attendance for a non-admin member when disabled for the club', async () => {
    renderWithProviders(<AppNavBar />, {
      preloadedState: {
        club: makeClubState({
          role: 'member',
          currentClubId: 'club-a',
          disabledTabs: ['attendance'],
          clubs: [{ id: 'club-a', name: 'Alpha Club', role: 'member' }],
        }),
      },
    });
    await openAccountMenu();
    expect(screen.queryByRole('link', { name: 'Attendance' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Help & FAQ' })).toBeInTheDocument();
  });

  it('hides Help & FAQ when no club is selected yet', async () => {
    renderWithProviders(<AppNavBar />, {
      preloadedState: {
        club: makeClubState({ currentClubId: null, clubs: [] }),
      },
    });
    await openAccountMenu();
    expect(screen.queryByRole('link', { name: 'Help & FAQ' })).not.toBeInTheDocument();
  });

  it('hides Attendance for an admin when disabled, without a leftover duplicate in the admin tab list', async () => {
    renderWithProviders(<AppNavBar />, {
      preloadedState: {
        club: makeClubState({
          role: 'admin',
          currentClubId: 'club-a',
          disabledTabs: ['attendance'],
          clubs: [{ id: 'club-a', name: 'Alpha Club', role: 'admin' }],
        }),
      },
    });
    await openAccountMenu();
    expect(screen.queryByRole('link', { name: 'Attendance' })).not.toBeInTheDocument();
    // Other admin-only tabs are unaffected.
    expect(screen.getByRole('link', { name: 'Birdies' })).toBeInTheDocument();
  });

  it('places the Account link under the account-name dropdown', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AppNavBar />, {
      preloadedState: {
        club: makeClubState({ accountName: 'Ada Lovelace' }),
      },
    });

    expect(screen.queryByRole('link', { name: 'Account' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Ada Lovelace' }));

    expect(screen.getByRole('link', { name: 'Account' })).toHaveAttribute('href', '/auth');
  });

  it('switches clubs from the dropdown and updates the current title', async () => {
    const user = userEvent.setup();
    const { store } = renderWithProviders(<AppNavBar />, {
      preloadedState: {
        club: makeClubState({
          role: 'admin',
          currentClubId: 'club-a',
          clubs: [
            { id: 'club-a', name: 'Alpha Club', role: 'admin' },
            { id: 'club-b', name: 'Beta Club', role: 'member' },
          ],
        }),
      },
    });

    await user.click(screen.getByRole('button', { name: 'Alpha Club' }));
    await user.click(screen.getByText('Beta Club'));

    expect(store.getState().club.currentClubId).toBe('club-b');
    expect(screen.getByRole('button', { name: 'Beta Club' })).toBeInTheDocument();
  });
});
