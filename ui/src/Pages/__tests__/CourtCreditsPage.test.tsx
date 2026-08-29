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

jest.mock('../../services/firebase', () => ({
  ...jest.requireActual('../../services/firebase'),
  fetchCourtCreditAdjustments: jest.fn(),
}));
import { fetchCourtCreditAdjustments } from '../../services/firebase';

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
    // Default to the real implementation; individual tests override as needed.
    const actual = jest.requireActual('../../services/firebase');
    jest.mocked(fetchCourtCreditAdjustments).mockImplementation(actual.fetchCourtCreditAdjustments);
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

  it('reverses a manual adjustment\'s own stock change when reconstructing "Remaining" for older history rows', async () => {
    seedClubDoc('courtCredits', 'c2', {
      name: 'Winter block',
      totalCost: 200,
      costPerHour: 20,
      hoursPurchased: 20,
      remainingHours: 10, // current
      purchaserName: 'Sam',
      purchaseDate: ts('2026-02-01T12:00:00Z'),
      createdAt: ts('2026-02-01T12:00:00Z'),
    });
    // Newest: used 2 hrs.
    seedClubDoc('transactions', 'tx-newest', {
      resourceType: 'court', batchId: 'c2', hoursUsed: 2, cost: 40, sessionId: 's-newest',
      date: ts('2026-03-10T12:00:00Z'), createdAt: ts('2026-03-10T12:00:00Z'),
    });
    // Middle: a recount that corrected remainingHours upward by 5 hrs — this
    // itself must be reversed for older rows.
    seedClubDoc('inventoryAdjustments', 'adj-2', {
      adjustmentDate: ts('2026-03-05T12:00:00Z'),
      userId: currentUser.uid, userName: currentUser.displayName,
      resourceType: 'courtCreditBatch', batchId: 'c2', batchNameSnapshot: 'Winter block',
      reason: 'Recount',
      changes: [{ field: 'remainingHours', oldValue: 2, newValue: 7 }],
    });
    // Oldest: used 3 hrs.
    seedClubDoc('transactions', 'tx-oldest', {
      resourceType: 'court', batchId: 'c2', hoursUsed: 3, cost: 60, sessionId: 's-oldest',
      date: ts('2026-03-01T12:00:00Z'), createdAt: ts('2026-03-01T12:00:00Z'),
    });

    const user = userEvent.setup();
    renderPage();

    const batchToggle = await screen.findByRole('button', { name: /Winter block/ });
    await user.click(batchToggle);

    const rows = (await screen.findAllByText(/^\d+(\.\d+)? hrs$/)).map((el) => el.textContent);
    // Newest-first: 10 (current) → undo -2 usage → 12 → undo the adjustment's
    // own +5 → 7 → (oldest row's usage isn't reversed further, nothing older).
    expect(rows).toEqual(['10 hrs', '12 hrs', '7 hrs']);
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

    // Remaining hours can't exceed hours purchased.
    await user.clear(screen.getAllByRole('spinbutton')[0]);
    await user.type(screen.getAllByRole('spinbutton')[0], '10');
    await user.clear(screen.getAllByRole('spinbutton')[2]);
    await user.type(screen.getAllByRole('spinbutton')[2], '15');
    await user.click(screen.getByRole('button', { name: 'Save Changes' }));

    expect(await screen.findByText("Remaining hours can't exceed the 10 hours purchased.")).toBeInTheDocument();
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

  it('recomputes costPerHour when an edit changes totalCost or hoursPurchased so future sessions are not billed at a stale rate', async () => {
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

    // Correcting only the total cost (a data-entry fix) — hours purchased stays 10.
    await user.clear(screen.getAllByRole('spinbutton')[1]);
    await user.type(screen.getAllByRole('spinbutton')[1], '200');
    await user.type(screen.getAllByRole('textbox')[4], 'Corrected purchase price');
    await user.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => expect(getClubDocData('courtCredits', 'c1')).toMatchObject({
      totalCost: 200,
      hoursPurchased: 10,
      costPerHour: 20,
    }));
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

  it('shows the actual error instead of silently claiming no history when loading history fails', async () => {
    const user = userEvent.setup();
    jest.mocked(fetchCourtCreditAdjustments).mockRejectedValue(new Error('offline'));

    seedClubDoc('courtCredits', 'c1', {
      name: 'Richmond block',
      totalCost: 180,
      costPerHour: 20,
      hoursPurchased: 9,
      remainingHours: 4.5,
      purchaserName: 'Pat',
      purchaseDate: ts('2026-02-18T12:00:00Z'),
      createdAt: ts('2026-02-18T12:00:00Z'),
    });

    renderPage();
    await user.click(await screen.findByRole('button', { name: /Richmond block/ }));

    expect(await screen.findByText('Failed to load history.')).toBeInTheDocument();
    expect(screen.queryByText('No usage or adjustments recorded.')).not.toBeInTheDocument();
  });

  it('does not leak an edit-form validation error into a different batch\'s history view', async () => {
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
    seedClubDoc('courtCredits', 'c2', {
      name: 'Fall block',
      totalCost: 120,
      costPerHour: 15,
      hoursPurchased: 8,
      remainingHours: 8,
      purchaserName: 'Alex',
      purchaseDate: ts('2026-01-12T12:00:00Z'),
      createdAt: ts('2026-01-12T12:00:00Z'),
    });

    renderPage();

    // Trigger a validation error while editing the first batch.
    await user.click(await screen.findByRole('button', { name: /Richmond block/ }));
    await user.click(screen.getAllByRole('button', { name: 'Edit Batch Details' })[0]);
    await user.clear(screen.getAllByRole('spinbutton')[0]);
    await user.type(screen.getAllByRole('spinbutton')[0], '0');
    await user.click(screen.getByRole('button', { name: 'Save Changes' }));
    expect(await screen.findByText('Valid hours purchased required.')).toBeInTheDocument();

    // Without cancelling the edit, switch to the second batch's accordion.
    const fallToggle = screen.getByRole('button', { name: /Fall block/ });
    await user.click(fallToggle);
    const fallItem = fallToggle.closest('.accordion-item') as HTMLElement;

    // The stale validation error must not leak into this batch's own history
    // section, and its real history should load normally (not blocked by
    // Richmond block's still-in-progress edit elsewhere on the page).
    expect(within(fallItem).queryByText('Valid hours purchased required.')).not.toBeInTheDocument();
    expect(await within(fallItem).findByText('No usage or adjustments recorded.')).toBeInTheDocument();
  });
});
