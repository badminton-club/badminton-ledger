import React from 'react';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AppNavBar from '../AppNavBar';
import { renderWithProviders, makeClubState } from '../../test-utils/renderWithProviders';

describe('AppNavBar', () => {
  it('shows only attendance and account links for non-admin members', () => {
    renderWithProviders(<AppNavBar />, {
      preloadedState: {
        club: makeClubState({
          role: 'member',
          currentClubId: 'club-a',
          clubs: [{ id: 'club-a', name: 'Alpha Club', role: 'member' }],
        }),
      },
    });

    expect(screen.getByRole('link', { name: 'Attendance' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Account' })).toBeInTheDocument();
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
    expect(screen.getByRole('link', { name: 'Account' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Credits' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Payout' })).not.toBeInTheDocument();
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
