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
import BirdiesPage from '../BirdiesPage';

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
  return renderWithProviders(<BirdiesPage />, { route: '/birdies' });
}

describe('BirdiesPage', () => {
  beforeEach(() => {
    resetFirebaseTestState();
    setCurrentUser(currentUser);
  });

  it('renders inventory rows and shows a selected batch detail/history view', async () => {
    const user = userEvent.setup();

    seedClubDoc('birdieInventory', 'older', {
      name: 'Training birds',
      costPerTube: 28,
      birdsPerTube: 12,
      tubesPurchased: 3,
      unopenedTubesRemaining: 3,
      birdsInOpenTube: 0,
      purchaserName: 'Alex',
      purchaseDate: ts('2026-01-15T12:00:00Z'),
      createdAt: ts('2026-01-15T12:00:00Z'),
    });
    seedClubDoc('birdieInventory', 'b1', {
      name: 'Club 30',
      costPerTube: 33,
      birdsPerTube: 12,
      tubesPurchased: 5,
      unopenedTubesRemaining: 2,
      birdsInOpenTube: 4,
      purchaserName: 'Pat',
      purchaseDate: ts('2026-02-10T12:00:00Z'),
      createdAt: ts('2026-02-10T12:00:00Z'),
      notes: 'Opened for club night',
    });
    seedClubDoc('inventoryAdjustments', 'adj-1', {
      adjustmentDate: ts('2026-03-03T12:00:00Z'),
      userId: currentUser.uid,
      userName: currentUser.displayName,
      resourceType: 'birdieBatch',
      batchId: 'b1',
      batchNameSnapshot: 'Club 30',
      reason: 'Manual recount',
      changes: [{ field: 'birdsInOpenTube', oldValue: 0, newValue: 4 }],
    });
    seedClubDoc('transactions', 'tx-1', {
      resourceType: 'birdie',
      batchId: 'b1',
      quantityUsed: 8,
      cost: 22,
      sessionId: 's1',
      date: ts('2026-03-04T12:00:00Z'),
      createdAt: ts('2026-03-04T12:00:00Z'),
    });

    renderPage();

    expect(await screen.findByText('Club 30')).toBeInTheDocument();
    const batchRow = screen.getByText('Club 30').closest('tr');
    expect(batchRow).not.toBeNull();
    expect(within(batchRow!).getByText('2')).toBeInTheDocument();

    await user.click(batchRow!);

    expect(await screen.findByText((_, node) => node?.textContent === 'Total Remaining: 28')).toBeInTheDocument();
    expect(await screen.findByText('Used: 8 birds')).toBeInTheDocument();
    expect(screen.getByText(/Reason: Manual recount/)).toBeInTheDocument();
    expect(screen.getByText('Grace Hopper')).toBeInTheDocument();
    expect(screen.getByText('28 birds')).toBeInTheDocument();
    expect(screen.getByText('36 birds')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View on calendar' })).toHaveAttribute('href', '/?date=2026-03-04');
  });

  it('labels a negative session-usage transaction (a session-edit return) as Returned, not a negative Used', async () => {
    seedClubDoc('birdieInventory', 'b1', {
      name: 'Club 30',
      costPerTube: 33,
      birdsPerTube: 12,
      tubesPurchased: 5,
      unopenedTubesRemaining: 2,
      birdsInOpenTube: 4,
      purchaserName: 'Pat',
      purchaseDate: ts('2026-02-10T12:00:00Z'),
      createdAt: ts('2026-02-10T12:00:00Z'),
    });
    seedClubDoc('transactions', 'tx-1', {
      resourceType: 'birdie',
      batchId: 'b1',
      quantityUsed: -3,
      cost: -8.25,
      sessionId: 's1',
      date: ts('2026-03-04T12:00:00Z'),
      createdAt: ts('2026-03-04T12:00:00Z'),
    });

    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByText('Club 30')).toBeInTheDocument();
    await user.click(screen.getByText('Club 30').closest('tr')!);

    expect(await screen.findByText('Returned: 3 birds')).toBeInTheDocument();
    expect(screen.queryByText('Used: -3 birds')).not.toBeInTheDocument();
  });

  it('validates edits, saves them, logs an adjustment, and keeps the batch selected after reload', async () => {
    const user = userEvent.setup();

    seedClubDoc('birdieInventory', 'b1', {
      name: 'AS-30',
      costPerTube: 35,
      birdsPerTube: 12,
      tubesPurchased: 4,
      unopenedTubesRemaining: 2,
      birdsInOpenTube: 1,
      purchaserName: 'Pat',
      purchaseDate: ts('2026-04-01T12:00:00Z'),
      createdAt: ts('2026-04-01T12:00:00Z'),
    });

    renderPage();

    const batchRow = (await screen.findByText('AS-30')).closest('tr');
    expect(batchRow).not.toBeNull();
    await user.click(batchRow!);
    await user.click(screen.getByRole('button', { name: 'Edit Batch' }));

    await user.clear(screen.getAllByRole('spinbutton')[4]);
    await user.type(screen.getAllByRole('spinbutton')[4], '13');
    await user.click(screen.getByRole('button', { name: 'Save Changes' }));

    expect(await screen.findByText('Birds in open tube must be 0–12.')).toBeInTheDocument();
    expect(adjustmentDocIds()).toEqual([]);

    // Unopened tubes remaining can't exceed what was ever purchased (4).
    await user.clear(screen.getAllByRole('spinbutton')[4]);
    await user.type(screen.getAllByRole('spinbutton')[4], '0');
    await user.clear(screen.getAllByRole('spinbutton')[3]);
    await user.type(screen.getAllByRole('spinbutton')[3], '5');
    await user.click(screen.getByRole('button', { name: 'Save Changes' }));

    expect(await screen.findByText("Unopened tubes can't exceed the 4 tubes purchased.")).toBeInTheDocument();
    expect(adjustmentDocIds()).toEqual([]);

    await user.clear(screen.getAllByRole('textbox')[0]);
    await user.type(screen.getAllByRole('textbox')[0], 'AS-30 Updated');
    await user.clear(screen.getAllByRole('spinbutton')[3]);
    await user.type(screen.getAllByRole('spinbutton')[3], '1');
    await user.clear(screen.getAllByRole('spinbutton')[4]);
    await user.type(screen.getAllByRole('spinbutton')[4], '6');
    await user.type(screen.getAllByRole('textbox')[3], 'Counted after club night');
    await user.type(screen.getAllByRole('textbox')[4], 'Inventory recount');
    await user.click(screen.getByRole('button', { name: 'Save Changes' }));

    expect(await screen.findByRole('button', { name: 'Edit Batch' })).toBeInTheDocument();
    expect(await screen.findByText(/Reason: Inventory recount/)).toBeInTheDocument();
    expect(screen.getByText((_, node) => node?.textContent === 'Unopened Tubes: 1')).toBeInTheDocument();
    expect(screen.getByText((_, node) => node?.textContent === 'Birds in Open Tube: 6')).toBeInTheDocument();

    const stored = getClubDocData('birdieInventory', 'b1');
    expect(stored).toMatchObject({
      name: 'AS-30 Updated',
      unopenedTubesRemaining: 1,
      birdsInOpenTube: 6,
      notes: 'Counted after club night',
      lastModifiedBy: currentUser.uid,
    });

    const [adjustmentId] = adjustmentDocIds();
    expect(adjustmentId).toBeDefined();
    const adjustment = getClubDocData('inventoryAdjustments', adjustmentId!);
    expect(adjustment).toMatchObject({
      userId: currentUser.uid,
      userName: currentUser.displayName,
      resourceType: 'birdieBatch',
      batchId: 'b1',
      reason: 'Inventory recount',
    });
    expect(adjustment?.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'name', oldValue: 'AS-30', newValue: 'AS-30 Updated' }),
      expect.objectContaining({ field: 'unopenedTubesRemaining', oldValue: 2, newValue: 1 }),
      expect.objectContaining({ field: 'birdsInOpenTube', oldValue: 1, newValue: 6 }),
      expect.objectContaining({ field: 'notes', oldValue: null, newValue: 'Counted after club night' }),
    ]));
  });

  it('creates a new batch from the add modal and selects it after reloading inventory', async () => {
    const user = userEvent.setup();

    renderPage();

    await user.click(screen.getByRole('button', { name: '+ Add New Batch' }));
    const modal = screen.getByRole('dialog');

    await user.click(within(modal).getByRole('button', { name: 'Add Batch' }));
    expect(await screen.findByText('Birdie name is required.')).toBeInTheDocument();

    const modalTextboxes = within(modal).getAllByRole('textbox');
    const modalSpinbuttons = within(modal).getAllByRole('spinbutton');
    await user.type(modalTextboxes[0], '  Premium Geese  ');
    await user.clear(modalSpinbuttons[0]);
    await user.type(modalSpinbuttons[0], '32.5');
    await user.clear(modalSpinbuttons[1]);
    await user.type(modalSpinbuttons[1], '2');
    await user.clear(modalSpinbuttons[2]);
    await user.type(modalSpinbuttons[2], '12');
    await user.type(modalTextboxes[2], '  Wendy  ');
    await user.type(modalTextboxes[3], '  Fresh case  ');
    await user.click(within(modal).getByRole('button', { name: 'Add Batch' }));

    await waitFor(() => expect(screen.queryByText('Add New Birdie Batch')).not.toBeInTheDocument());
    expect(await screen.findByText((_, node) => node?.textContent === 'Total Remaining: 24')).toBeInTheDocument();

    const stored = getClubDocData('birdieInventory', 'auto-id-1');
    expect(stored).toMatchObject({
      name: 'Premium Geese',
      purchaserName: 'Wendy',
      costPerTube: 32.5,
      tubesPurchased: 2,
      birdsPerTube: 12,
      unopenedTubesRemaining: 2,
      birdsInOpenTube: 0,
      notes: 'Fresh case',
    });
  });
});
