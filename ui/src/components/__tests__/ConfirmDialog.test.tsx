import React from 'react';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test-utils/renderWithProviders';
import ConfirmDialog from '../ConfirmDialog';

describe('ConfirmDialog', () => {
  it('renders nothing interactive when show is false', () => {
    renderWithProviders(
      <ConfirmDialog show={false} title="Delete?" message="Are you sure?" onConfirm={jest.fn()} onCancel={jest.fn()} />
    );
    expect(screen.queryByText('Delete?')).not.toBeInTheDocument();
  });

  it('renders the title, message, and default button labels when shown', () => {
    renderWithProviders(
      <ConfirmDialog show title="Delete session?" message="This cannot be undone." onConfirm={jest.fn()} onCancel={jest.fn()} />
    );
    expect(screen.getByText('Delete session?')).toBeInTheDocument();
    expect(screen.getByText('This cannot be undone.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('calls onConfirm/onCancel when their buttons are clicked', async () => {
    const user = userEvent.setup();
    const onConfirm = jest.fn();
    const onCancel = jest.fn();
    renderWithProviders(
      <ConfirmDialog show title="Delete?" message="Sure?" onConfirm={onConfirm} onCancel={onCancel} />
    );

    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('uses a custom confirm label when given', () => {
    renderWithProviders(
      <ConfirmDialog show title="t" message="m" confirmLabel="Delete forever" onConfirm={jest.fn()} onCancel={jest.fn()} />
    );
    expect(screen.getByRole('button', { name: 'Delete forever' })).toBeInTheDocument();
  });

  it('disables both buttons while isLoading', () => {
    renderWithProviders(
      <ConfirmDialog show title="t" message="m" isLoading onConfirm={jest.fn()} onCancel={jest.fn()} />
    );
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  });
});
