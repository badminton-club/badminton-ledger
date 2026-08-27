import React from 'react';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test-utils/renderWithProviders';
import AddCourtCreditModal from '../AddCourtCreditModal';

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
const costPerHourInput = () => spinbuttons()[0];
const hoursInput = () => spinbuttons()[1];
const totalCostInput = () => spinbuttons()[2];

describe('AddCourtCreditModal', () => {
  it('auto-calculates total cost until the user manually overrides it', async () => {
    const user = userEvent.setup();

    renderWithProviders(<AddCourtCreditModal show onHide={jest.fn()} onAddBatch={jest.fn()} />);

    await user.type(costPerHourInput(), '20');
    await user.type(hoursInput(), '2.5');
    await waitFor(() => expect(totalCostInput()).toHaveValue(50));

    await user.clear(totalCostInput());
    await user.type(totalCostInput(), '48.75');
    await user.clear(hoursInput());
    await user.type(hoursInput(), '3');

    expect(totalCostInput()).toHaveValue(48.75);
  });

  it('validates required numeric fields before submit', async () => {
    const user = userEvent.setup();
    const onAddBatch = jest.fn();

    renderWithProviders(<AddCourtCreditModal show onHide={jest.fn()} onAddBatch={onAddBatch} />);

    await user.click(screen.getByRole('button', { name: 'Add Credits' }));

    expect(await screen.findByText('Valid cost per hour required.')).toBeInTheDocument();
    expect(onAddBatch).not.toHaveBeenCalled();
  });

  it('submits trimmed data and closes the modal on success', async () => {
    const user = userEvent.setup();
    const onAddBatch = jest.fn().mockResolvedValue(undefined);
    const onHide = jest.fn();

    renderWithProviders(<AddCourtCreditModal show onHide={onHide} onAddBatch={onAddBatch} />);

    await user.type(nameInput(), '  Winter block  ');
    await user.type(costPerHourInput(), '18.5');
    await user.type(hoursInput(), '4');
    await waitFor(() => expect(totalCostInput()).toHaveValue(74));
    await user.type(purchaserInput(), '  Alex  ');
    await user.type(notesInput(), '  Weeknight courts  ');
    await user.click(screen.getByRole('button', { name: 'Add Credits' }));

    await waitFor(() => expect(onAddBatch).toHaveBeenCalledWith({
      purchaseDate: expect.any(Date),
      name: 'Winter block',
      purchaserName: 'Alex',
      costPerHour: 18.5,
      hoursPurchased: 4,
      totalCost: 74,
      notes: 'Weeknight courts',
    }));
    expect(onHide).toHaveBeenCalledTimes(1);
  });

  it('shows async submit errors and resets when reopened', async () => {
    const user = userEvent.setup();
    const { rerender } = renderWithProviders(
      <AddCourtCreditModal
        show
        onHide={jest.fn()}
        onAddBatch={jest.fn().mockRejectedValue(new Error('Save failed'))}
      />
    );

    await user.type(costPerHourInput(), '19');
    await user.type(hoursInput(), '2');
    await user.type(purchaserInput(), 'Pat');
    await user.click(screen.getByRole('button', { name: 'Add Credits' }));

    expect(await screen.findByText('Save failed')).toBeInTheDocument();

    rerender(<AddCourtCreditModal show={false} onHide={jest.fn()} onAddBatch={jest.fn()} />);
    rerender(<AddCourtCreditModal show onHide={jest.fn()} onAddBatch={jest.fn()} />);

    expect(costPerHourInput()).toHaveValue(null);
    expect(hoursInput()).toHaveValue(null);
    expect(purchaserInput()).toHaveValue('');
    expect(screen.queryByText('Save failed')).not.toBeInTheDocument();
  });
});
