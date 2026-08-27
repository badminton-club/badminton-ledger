import React from 'react';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../../../test-utils/renderWithProviders';
import PasteNamesStep from '../PasteNamesStep';
import type { RootState } from '../../../../store';

function makeSessionModalState(
  overrides: Partial<RootState['sessionModal']> = {}
): RootState['sessionModal'] {
  return {
    mode: 'paste',
    playersInput: '',
    resolutionItems: [],
    confirmedPlayers: [],
    errors: {},
    ...overrides,
  };
}

describe('PasteNamesStep', () => {
  it('stores textarea input in Redux and submits the current value', async () => {
    const user = userEvent.setup();
    const onSubmit = jest.fn();
    const { store } = renderWithProviders(
      <PasteNamesStep onSubmit={onSubmit} onCancel={jest.fn()} />,
      {
        preloadedState: {
          sessionModal: makeSessionModalState(),
        },
      }
    );

    await user.type(screen.getByRole('textbox'), '1. Ada Lovelace{enter}2. Grace Hopper');
    await user.click(screen.getByRole('button', { name: 'Next: Confirm Players' }));

    expect(store.getState().sessionModal.playersInput).toBe('1. Ada Lovelace\n2. Grace Hopper');
    expect(onSubmit).toHaveBeenCalledWith('1. Ada Lovelace\n2. Grace Hopper');
  });

  it('shows a validation error and does not submit when the textarea is blank', async () => {
    const user = userEvent.setup();
    const onSubmit = jest.fn();
    renderWithProviders(
      <PasteNamesStep onSubmit={onSubmit} onCancel={jest.fn()} />,
      {
        preloadedState: {
          sessionModal: makeSessionModalState(),
        },
      }
    );

    await user.click(screen.getByRole('button', { name: 'Next: Confirm Players' }));

    expect(await screen.findByText('Player list cannot be empty.')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('calls onCancel when the cancel button is clicked', async () => {
    const user = userEvent.setup();
    const onCancel = jest.fn();
    renderWithProviders(
      <PasteNamesStep onSubmit={jest.fn()} onCancel={onCancel} />,
      {
        preloadedState: {
          sessionModal: makeSessionModalState(),
        },
      }
    );

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
