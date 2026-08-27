import React from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test-utils/renderWithProviders';
import AddPlayerModal from '../AddPlayerModal';
import type { Player } from 'types';

// This app's <Form.Group> elements never set `controlId` (true across all ~108
// usages in the codebase, not just here), so react-bootstrap never wires each
// <Form.Label>'s `for` to its <Form.Control>'s `id` — `getByLabelText` can't
// find anything. Query by role + DOM order instead: firstName/lastName/email/
// description all render as textboxes (in that order); balance is a <input
// type="number"> ("spinbutton" role).
function textboxes() {
  return screen.getAllByRole('textbox');
}
const firstNameInput = () => textboxes()[0];
const lastNameInput  = () => textboxes()[1];
const emailInput     = () => textboxes()[2];

function makePlayer(overrides: Partial<Player> = {}): Player {
  return {
    id: 'p1',
    firstName: 'Ada',
    firstNameLower: 'ada',
    lastName: 'Lovelace',
    lastNameLower: 'lovelace',
    email: null,
    balance: 0,
    owed: 0,
    description: '',
    sessionCount: 0,
    createdAt: undefined as never,
    ...overrides,
  };
}

describe('AddPlayerModal', () => {
  it('requires a first name', async () => {
    const user = userEvent.setup();
    const onAddPlayer = jest.fn();
    renderWithProviders(
      <AddPlayerModal show onHide={jest.fn()} onAddPlayer={onAddPlayer} existingPlayers={[]} />
    );

    await user.click(screen.getByRole('button', { name: 'Add Player' }));

    expect(await screen.findByText('First name is required.')).toBeInTheDocument();
    expect(onAddPlayer).not.toHaveBeenCalled();
  });

  it('validates the email format when one is entered', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <AddPlayerModal show onHide={jest.fn()} onAddPlayer={jest.fn()} existingPlayers={[]} />
    );

    await user.type(firstNameInput(), 'Grace');
    await user.type(emailInput(), 'not-an-email');
    await user.click(screen.getByRole('button', { name: 'Add Player' }));

    expect(await screen.findByText('Please enter a valid email address.')).toBeInTheDocument();
  });

  it('requires a last name to disambiguate a duplicate first name', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <AddPlayerModal show onHide={jest.fn()} onAddPlayer={jest.fn()} existingPlayers={[makePlayer({ firstName: 'Ada', lastName: null })]} />
    );

    await user.type(firstNameInput(), 'Ada');
    await user.click(screen.getByRole('button', { name: 'Add Player' }));

    expect(await screen.findByText(/already exists\. Add a last name/)).toBeInTheDocument();
  });

  it('requires a description to disambiguate an exact first+last name duplicate', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <AddPlayerModal show onHide={jest.fn()} onAddPlayer={jest.fn()} existingPlayers={[makePlayer({ firstName: 'Ada', lastName: 'Lovelace' })]} />
    );

    await user.type(firstNameInput(), 'Ada');
    await user.type(lastNameInput(), 'Lovelace');
    await user.click(screen.getByRole('button', { name: 'Add Player' }));

    expect(await screen.findByText(/already exists\. Add a description/)).toBeInTheDocument();
  });

  it('submits trimmed, normalized data and closes the modal on success', async () => {
    const user = userEvent.setup();
    const onAddPlayer = jest.fn().mockResolvedValue(undefined);
    const onHide = jest.fn();
    renderWithProviders(
      <AddPlayerModal show onHide={onHide} onAddPlayer={onAddPlayer} existingPlayers={[]} />
    );

    await user.type(firstNameInput(), '  Grace  ');
    await user.type(lastNameInput(), '  Hopper  ');
    await user.click(screen.getByRole('button', { name: 'Add Player' }));

    await waitFor(() => expect(onAddPlayer).toHaveBeenCalledWith({
      firstName: 'Grace',
      lastName: 'Hopper',
      email: null,
      balance: 0,
      description: '',
    }));
    expect(onHide).toHaveBeenCalled();
  });

  it('shows the service error message and keeps the modal open when onAddPlayer rejects', async () => {
    const user = userEvent.setup();
    const onAddPlayer = jest.fn().mockRejectedValue(new Error('Network failed'));
    const onHide = jest.fn();
    renderWithProviders(
      <AddPlayerModal show onHide={onHide} onAddPlayer={onAddPlayer} existingPlayers={[]} />
    );

    await user.type(firstNameInput(), 'Grace');
    await user.click(screen.getByRole('button', { name: 'Add Player' }));

    expect(await screen.findByText('Network failed')).toBeInTheDocument();
    expect(onHide).not.toHaveBeenCalled();
  });

  it('resets the form back to defaults each time it is reopened', async () => {
    const user = userEvent.setup();
    const { rerender } = renderWithProviders(
      <AddPlayerModal show onHide={jest.fn()} onAddPlayer={jest.fn()} existingPlayers={[]} />
    );

    await user.type(firstNameInput(), 'Leftover text');
    rerender(<AddPlayerModal show={false} onHide={jest.fn()} onAddPlayer={jest.fn()} existingPlayers={[]} />);
    rerender(<AddPlayerModal show onHide={jest.fn()} onAddPlayer={jest.fn()} existingPlayers={[]} />);

    expect(firstNameInput()).toHaveValue('');
  });
});
