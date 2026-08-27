import React from 'react';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test-utils/renderWithProviders';
import AddBirdieBatchModal from '../AddBirdieBatchModal';

function dialog() {
  return screen.getByRole('dialog');
}

function textboxes() {
  return within(dialog()).getAllByRole('textbox');
}

function spinbuttons() {
  return within(dialog()).getAllByRole('spinbutton');
}

const nameInput = () => textboxes()[0];
const purchaserInput = () => textboxes()[2];
const notesInput = () => textboxes()[3];
const costInput = () => spinbuttons()[0];
const tubesInput = () => spinbuttons()[1];
const birdsInput = () => spinbuttons()[2];

describe('AddBirdieBatchModal', () => {
  it('requires a birdie name before submitting', async () => {
    const user = userEvent.setup();
    const onAddBatch = jest.fn();

    renderWithProviders(<AddBirdieBatchModal show onHide={jest.fn()} onAddBatch={onAddBatch} />);

    await user.click(screen.getByRole('button', { name: 'Add Batch' }));

    expect(await screen.findByText('Birdie name is required.')).toBeInTheDocument();
    expect(onAddBatch).not.toHaveBeenCalled();
  });

  it('requires positive numeric inventory values', async () => {
    const user = userEvent.setup();

    renderWithProviders(<AddBirdieBatchModal show onHide={jest.fn()} onAddBatch={jest.fn()} />);

    await user.type(nameInput(), 'Yonex AS-30');
    await user.type(purchaserInput(), 'Grace');
    await user.click(screen.getByRole('button', { name: 'Add Batch' }));

    expect(await screen.findByText('Cost per tube must be greater than 0.')).toBeInTheDocument();
  });

  it('submits trimmed data and closes the modal on success', async () => {
    const user = userEvent.setup();
    const onAddBatch = jest.fn().mockResolvedValue(undefined);
    const onHide = jest.fn();

    renderWithProviders(<AddBirdieBatchModal show onHide={onHide} onAddBatch={onAddBatch} />);

    await user.type(nameInput(), '  Victor Master Ace  ');
    await user.clear(costInput());
    await user.type(costInput(), '38.5');
    await user.clear(tubesInput());
    await user.type(tubesInput(), '4');
    await user.clear(birdsInput());
    await user.type(birdsInput(), '12');
    await user.type(purchaserInput(), '  Wendy  ');
    await user.type(notesInput(), '  League opener  ');
    await user.click(screen.getByRole('button', { name: 'Add Batch' }));

    await waitFor(() => expect(onAddBatch).toHaveBeenCalledWith({
      name: 'Victor Master Ace',
      purchaserName: 'Wendy',
      purchaseDate: expect.any(Date),
      costPerTube: 38.5,
      tubesPurchased: 4,
      birdsPerTube: 12,
      notes: 'League opener',
    }));
    expect(onHide).toHaveBeenCalledTimes(1);
  });

  it('shows the service error and keeps the modal open when submit fails', async () => {
    const user = userEvent.setup();
    const onHide = jest.fn();

    renderWithProviders(
      <AddBirdieBatchModal
        show
        onHide={onHide}
        onAddBatch={jest.fn().mockRejectedValue(new Error('Write failed'))}
      />
    );

    await user.type(nameInput(), 'Feather 90');
    await user.clear(costInput());
    await user.type(costInput(), '35');
    await user.clear(tubesInput());
    await user.type(tubesInput(), '2');
    await user.clear(birdsInput());
    await user.type(birdsInput(), '12');
    await user.type(purchaserInput(), 'Pat');
    await user.click(screen.getByRole('button', { name: 'Add Batch' }));

    expect(await screen.findByText('Write failed')).toBeInTheDocument();
    expect(onHide).not.toHaveBeenCalled();
  });

  it('resets the form when the modal is reopened', async () => {
    const user = userEvent.setup();
    const { rerender } = renderWithProviders(
      <AddBirdieBatchModal show onHide={jest.fn()} onAddBatch={jest.fn()} />
    );

    await user.type(nameInput(), 'Leftover batch');
    await user.type(purchaserInput(), 'Leftover purchaser');

    rerender(<AddBirdieBatchModal show={false} onHide={jest.fn()} onAddBatch={jest.fn()} />);
    rerender(<AddBirdieBatchModal show onHide={jest.fn()} onAddBatch={jest.fn()} />);

    expect(nameInput()).toHaveValue('');
    expect(purchaserInput()).toHaveValue('');
    expect(costInput()).toHaveValue(null);
    expect(screen.queryByText('Birdie name is required.')).not.toBeInTheDocument();
  });
});
