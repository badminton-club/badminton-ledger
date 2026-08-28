import React from 'react';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AppNavBar from '../AppNavBar';
import { renderWithProviders, makeClubState } from '../../test-utils/renderWithProviders';

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-bs-theme');
});

describe('AppNavBar', () => {
  it('shows home, attendance, and account access for non-admin members', () => {
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
    expect(screen.getByRole('link', { name: 'Attendance' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Account' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Birdies' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Credits' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Players' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Payout' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Settings' })).not.toBeInTheDocument();
  });

  it('shows admin tabs except the ones disabled for the current club', () => {
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

    expect(screen.getByRole('link', { name: 'Attendance' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Birdies' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Players' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Account' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Credits' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Payout' })).not.toBeInTheDocument();
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
    expect(screen.getByRole('button', { name: 'Switch to dark mode' })).toBeInTheDocument();
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

  it('toggles between light and dark mode', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AppNavBar />, {
      preloadedState: { club: makeClubState() },
    });

    expect(document.documentElement.getAttribute('data-bs-theme')).toBe('light');
    const toggle = screen.getByRole('button', { name: 'Switch to dark mode' });

    await user.click(toggle);

    expect(screen.getByRole('button', { name: 'Switch to light mode' })).toBeInTheDocument();
    expect(document.documentElement.getAttribute('data-bs-theme')).toBe('dark');

    await user.click(screen.getByRole('button', { name: 'Switch to light mode' }));

    expect(screen.getByRole('button', { name: 'Switch to dark mode' })).toBeInTheDocument();
    expect(document.documentElement.getAttribute('data-bs-theme')).toBe('light');
  });
});
