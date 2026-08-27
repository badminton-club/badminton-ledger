import React from 'react';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test-utils/renderWithProviders';
import {
  getClubDocData,
  resetFirebaseTestState,
  seedClubDoc,
  setCurrentUser,
  TEST_CLUB_ID,
  ts,
} from '../../test-utils/firebaseTestHelpers';
import { __getAllPaths } from '../../test-utils/fakeFirestore';
import CourtCreditsPage from '../CourtCreditsPage';

const currentUser = {
  uid: 'admin-1',
  displayName: 'Grace Hopper',
  email: 'grace@example.com',
};

function adjustmentDocIds() {
  return __getAllPaths()
    .filter(path => path.startsWith(`clubs/${TEST_CLUB_ID}/inventoryAdjustments/`))
    .map(path => path.split('/').pop()!);
}

function renderPage() {
  return renderWithProviders(<CourtCreditsPage />, { route: '/credits' });
}

describe('CourtCreditsPage', () => {
  beforeEach(() => {
    resetFirebaseTestState();
    setCurrentUser(currentUser);
  });

  it('renders court credit batches and shows detail/history for the opened accordion item', async () => {
    const user = userEvent.setup();

    seedClubDoc('courtCredits', 'older', {
      name: 'Fall block',
      totalCost: 120,
      costPerHour: 15,
      hoursPurchased: 8,
      remainingHours: 8,
      purchaserName: 'Alex',
      purchaseDate: ts('2026-01-12T12:00:00Z'),
      createdAt: ts('2026-01-12T12:00:00Z'),
    });
    seedClubDoc('courtCredits', 'c1', {
      name: 'Richmond block',
      totalCost: 180,
      costPerHour: 20,
      hoursPurchased: 9,
      remainingHours: 4.5,
      purchaserName: 'Pat',
      purchaseDate: ts('2026-02-18T12:00:00Z'),
      createdAt: ts('2026-02-18T12:00:00Z'),
      notes: 'Weeknight courts',
    });
    seedClubDoc('inventoryAdjustments', 'adj-1', {
      adjustmentDate: ts('2026-03-01T12:00:00Z'),
      userId: currentUser.uid,
      userName: currentUser.displayName,
      resourceType: 'courtCreditBatch',
      batchId: 'c1',
      batchNameSnapshot: 'Richmond block',
      reason: 'Manual correction',
      changes: [{ field: 'remainingHours', oldValue: 6.5, newValue: 4.5 }],
    });
    seedClubDoc('transactions', 'tx-1', {
      resourceType: 'court',
      batchId: 'c1',
      hoursUsed: 2,
      cost: 40,
      sessionId: 's1',
      date: ts('2026-03-03T12:00:00Z'),
      createdAt: ts('2026-03-03T12:00:00Z'),
    });

    renderPage();

    const batchToggle = await screen.findByRole('button', { name: /Richmond block/ });
    expect(batchToggle).toHaveTextContent('Richmond block');
    expect(batchToggle).toHaveTextContent('4.5');

    await user.click(batchToggle);

    expect(await screen.findByText((_, node) => node?.textContent === 'Remaining Hours: 4.5')).toBeInTheDocument();
    expect(await screen.findByText('Used: 2 hrs')).toBeInTheDocument();
    expect(screen.getByText(/Reason: Manual correction/)).toBeInTheDocument();
    expect(screen.getByText('Grace Hopper')).toBeInTheDocument();
    expect(screen.getByText('4.5 hrs')).toBeInTheDocument();
    expect(screen.getByText('6.5 hrs')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View on calendar' })).toHaveAttribute('href', '/?date=2026-03-03');
  });

  it('validates edits, saves them, logs an adjustment, and keeps the batch open after reload', async () => {
    const user = userEvent.setup();

    seedClubDoc('courtCredits', 'c1', {
      name: 'Richmond block',
      totalCost: 180,
      costPerHour: 18,
      hoursPurchased: 10,
      remainingHours: 5,
      purchaserName: 'Pat',
      purchaseDate: ts('2026-04-10T12:00:00Z'),
      createdAt: ts('2026-04-10T12:00:00Z'),
    });

    renderPage();

    await user.click(await screen.findByRole('button', { name: /Richmond block/ }));
    await user.click(screen.getByRole('button', { name: 'Edit Batch Details' }));

    await user.clear(screen.getAllByRole('spinbutton')[0]);
    await user.type(screen.getAllByRole('spinbutton')[0], '0');
    await user.click(screen.getByRole('button', { name: 'Save Changes' }));

    expect(await screen.findByText('Valid hours purchased required.')).toBeInTheDocument();
    expect(adjustmentDocIds()).toEqual([]);

    await user.clear(screen.getAllByRole('textbox')[0]);
    await user.type(screen.getAllByRole('textbox')[0], '  Richmond Winter Block  ');
    await user.clear(screen.getAllByRole('spinbutton')[0]);
    await user.type(screen.getAllByRole('spinbutton')[0], '12');
    await user.clear(screen.getAllByRole('spinbutton')[1]);
    await user.type(screen.getAllByRole('spinbutton')[1], '216');
    await user.clear(screen.getAllByRole('spinbutton')[2]);
    await user.type(screen.getAllByRole('spinbutton')[2], '7.25');
    await user.type(screen.getAllByRole('textbox')[3], 'Corrected remaining hours');
    await user.type(screen.getAllByRole('textbox')[4], 'Manual recount');
    await user.click(screen.getByRole('button', { name: 'Save Changes' }));

    expect(await screen.findByRole('button', { name: 'Edit Batch Details' })).toBeInTheDocument();
    expect(await screen.findByText(/Reason: Manual recount/)).toBeInTheDocument();
    expect(screen.getByText((_, node) => node?.textContent === 'Remaining Hours: 7.25')).toBeInTheDocument();

    const stored = getClubDocData('courtCredits', 'c1');
    expect(stored).toMatchObject({
      name: 'Richmond Winter Block',
      hoursPurchased: 12,
      totalCost: 216,
      remainingHours: 7.25,
      notes: 'Corrected remaining hours',
      lastModifiedBy: currentUser.uid,
      lastModifiedByName: currentUser.displayName,
    });

    const [adjustmentId] = adjustmentDocIds();
    expect(adjustmentId).toBeDefined();
    const adjustment = getClubDocData('inventoryAdjustments', adjustmentId!);
    expect(adjustment).toMatchObject({
      userId: currentUser.uid,
      userName: currentUser.displayName,
      resourceType: 'courtCreditBatch',
      batchId: 'c1',
      reason: 'Manual recount',
    });
    expect(adjustment?.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'name', oldValue: 'Richmond block', newValue: 'Richmond Winter Block' }),
      expect.objectContaining({ field: 'hoursPurchased', oldValue: 10, newValue: 12 }),
      expect.objectContaining({ field: 'totalCost', oldValue: 180, newValue: 216 }),
      expect.objectContaining({ field: 'remainingHours', oldValue: 5, newValue: 7.25 }),
    ]));
  });

  it('creates a new credit batch from the add modal and opens it after reloading', async () => {
    const user = userEvent.setup();

    renderPage();

    await user.click(await screen.findByRole('button', { name: '+ Add Credit Batch' }));
    const modal = screen.getByRole('dialog');

    await user.click(within(modal).getByRole('button', { name: 'Add Credits' }));
    expect(await screen.findByText('Valid cost per hour required.')).toBeInTheDocument();

    const modalTextboxes = within(modal).getAllByRole('textbox');
    const modalSpinbuttons = within(modal).getAllByRole('spinbutton');
    await user.type(modalTextboxes[0], '  Winter block  ');
    await user.type(modalSpinbuttons[0], '18');
    await user.type(modalSpinbuttons[1], '4');
    await waitFor(() => expect(modalSpinbuttons[2]).toHaveValue(72));
    await user.type(modalTextboxes[2], '  Wendy  ');
    await user.type(modalTextboxes[3], '  Evening courts  ');
    await user.click(within(modal).getByRole('button', { name: 'Add Credits' }));

    await waitFor(() => expect(screen.queryByText('Add New Court Credits')).not.toBeInTheDocument());
    expect(await screen.findByText((_, node) => node?.textContent === 'Remaining Hours: 4')).toBeInTheDocument();

    const stored = getClubDocData('courtCredits', 'auto-id-1');
    expect(stored).toMatchObject({
      name: 'Winter block',
      purchaserName: 'Wendy',
      costPerHour: 18,
      hoursPurchased: 4,
      totalCost: 72,
      remainingHours: 4,
      notes: 'Evening courts',
    });
  });
});
