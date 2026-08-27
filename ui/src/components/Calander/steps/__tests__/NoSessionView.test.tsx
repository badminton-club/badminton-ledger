import React from 'react';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../../../test-utils/renderWithProviders';
import NoSessionView from '../NoSessionView';

describe('NoSessionView', () => {
  it('renders the empty-state message and add-session button', () => {
    renderWithProviders(<NoSessionView onAddSession={jest.fn()} />);

    expect(screen.getByText('No session recorded for this day.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add New Session' })).toBeInTheDocument();
  });

  it('calls onAddSession when the button is clicked', async () => {
    const user = userEvent.setup();
    const onAddSession = jest.fn();
    renderWithProviders(<NoSessionView onAddSession={onAddSession} />);

    await user.click(screen.getByRole('button', { name: 'Add New Session' }));

    expect(onAddSession).toHaveBeenCalledTimes(1);
  });
});
