import {
  addBirdieBatch,
  addCourtCreditBatch,
  fetchBirdieBatchById,
  fetchBirdieInventory,
  fetchBirdieUsageForBatch,
  fetchCourtCreditAdjustments,
  fetchCourtCreditBatchById,
  fetchCourtCreditUsage,
  fetchCourtCredits,
  fetchInventoryAdjustmentsForBatch,
  updateBirdieBatch,
  updateCourtCreditBatch,
} from '../inventory';
import type { BirdieBatch, CourtCreditBatch } from '../../../types';
import {
  getClubDocData,
  resetFirebaseTestState,
  seedClubDoc,
  TEST_CLUB_ID,
  ts,
} from '../../../test-utils/firebaseTestHelpers';
import { __getAllPaths, Timestamp } from '../../../test-utils/fakeFirestore';

beforeEach(() => {
  resetFirebaseTestState();
});

function collectionDocIds(collectionName: string): string[] {
  return __getAllPaths()
    .filter(path => path.startsWith(`clubs/${TEST_CLUB_ID}/${collectionName}/`))
    .map(path => path.split('/').pop()!);
}

describe('birdie inventory service', () => {
  it('fetches birdie inventory sorted by purchase date ascending', async () => {
    seedClubDoc('birdieInventory', 'late', {
      name: 'Late batch',
      costPerTube: 42,
      birdsPerTube: 12,
      tubesPurchased: 10,
      unopenedTubesRemaining: 8,
      birdsInOpenTube: 4,
      purchaserName: 'Wendy',
      purchaseDate: ts('2026-03-10'),
      createdAt: ts('2026-03-10'),
    });
    seedClubDoc('birdieInventory', 'early', {
      name: 'Early batch',
      costPerTube: 40,
      birdsPerTube: 12,
      tubesPurchased: 8,
      unopenedTubesRemaining: 7,
      birdsInOpenTube: 0,
      purchaserName: 'Wendy',
      purchaseDate: ts('2026-01-05'),
      createdAt: ts('2026-01-05'),
    });
    seedClubDoc('birdieInventory', 'middle', {
      name: 'Middle batch',
      costPerTube: 41,
      birdsPerTube: 12,
      tubesPurchased: 9,
      unopenedTubesRemaining: 9,
      birdsInOpenTube: 0,
      purchaserName: 'Wendy',
      purchaseDate: ts('2026-02-01'),
      createdAt: ts('2026-02-01'),
    });

    const batches = await fetchBirdieInventory();

    expect(batches.map(batch => batch.id)).toEqual(['early', 'middle', 'late']);
    expect(batches.every(batch => batch.purchaseDate instanceof Date)).toBe(true);
    expect(batches.map(batch => batch.purchaseDate.toISOString().slice(0, 10))).toEqual([
      '2026-01-05',
      '2026-02-01',
      '2026-03-10',
    ]);
  });

  it('fetches a birdie batch by id and returns null when missing', async () => {
    seedClubDoc('birdieInventory', 'b1', {
      name: 'Yonex AS-30',
      costPerTube: 39,
      birdsPerTube: 12,
      tubesPurchased: 6,
      unopenedTubesRemaining: 5,
      birdsInOpenTube: 6,
      purchaserName: 'Alex',
      purchaseDate: ts('2026-04-03'),
      createdAt: ts('2026-04-03'),
    });

    const batch = await fetchBirdieBatchById('b1');

    expect(batch).toMatchObject({
      id: 'b1',
      name: 'Yonex AS-30',
      unopenedTubesRemaining: 5,
      birdsInOpenTube: 6,
      purchaserName: 'Alex',
    });
    expect(batch?.purchaseDate).toBeInstanceOf(Date);
    await expect(fetchBirdieBatchById('missing')).resolves.toBeNull();
  });

  it('creates a birdie batch with full starting inventory defaults', async () => {
    const id = await addBirdieBatch({
      name: 'Victor Master Ace',
      costPerTube: 44,
      birdsPerTube: 12,
      tubesPurchased: 18,
      purchaserName: 'Pat',
      purchaseDate: new Date('2026-05-01'),
      notes: 'League opener',
    });

    const stored = getClubDocData('birdieInventory', id)!;

    expect(stored).toMatchObject({
      name: 'Victor Master Ace',
      costPerTube: 44,
      birdsPerTube: 12,
      tubesPurchased: 18,
      unopenedTubesRemaining: 18,
      birdsInOpenTube: 0,
      purchaserName: 'Pat',
      notes: 'League opener',
    });
    expect(stored.purchaseDate).toBeInstanceOf(Timestamp);
    expect(stored.createdAt).toBeInstanceOf(Timestamp);
  });

  it('updates a birdie batch and logs a filtered adjustment history entry', async () => {
    seedClubDoc('birdieInventory', 'b1', {
      name: 'AS-20',
      costPerTube: 35,
      birdsPerTube: 12,
      tubesPurchased: 20,
      unopenedTubesRemaining: 20,
      birdsInOpenTube: 0,
      purchaserName: 'Chris',
      purchaseDate: ts('2026-06-01'),
      createdAt: ts('2026-06-01'),
    });

    const original: BirdieBatch = {
      id: 'b1',
      name: 'AS-20',
      costPerTube: 35,
      birdsPerTube: 12,
      tubesPurchased: 20,
      unopenedTubesRemaining: 20,
      birdsInOpenTube: 0,
      purchaserName: 'Chris',
      purchaseDate: new Date('2026-06-01'),
      createdAt: ts('2026-06-01') as any,
    };

    await updateBirdieBatch(
      'b1',
      original,
      {
        name: 'AS-20',
        costPerTube: 37,
        birdsPerTube: 12,
        tubesPurchased: 20,
        unopenedTubesRemaining: 17,
        birdsInOpenTube: 5,
        purchaserName: 'Chris',
        purchaseDate: new Date('2026-06-01'),
        notes: 'Opened for club night',
      },
      'Counted remaining stock after opening a tube',
      'admin-1',
      'Admin One'
    );

    const stored = getClubDocData('birdieInventory', 'b1')!;
    expect(stored).toMatchObject({
      name: 'AS-20',
      costPerTube: 37,
      unopenedTubesRemaining: 17,
      birdsInOpenTube: 5,
      notes: 'Opened for club night',
      lastModifiedBy: 'admin-1',
    });
    expect(stored.purchaseDate).toBeInstanceOf(Timestamp);
    expect(stored.lastModifiedAt).toBeInstanceOf(Timestamp);

    const adjustmentIds = collectionDocIds('inventoryAdjustments');
    expect(adjustmentIds).toHaveLength(1);

    const adjustment = getClubDocData('inventoryAdjustments', adjustmentIds[0])!;
    expect(adjustment).toMatchObject({
      userId: 'admin-1',
      userName: 'Admin One',
      resourceType: 'birdieBatch',
      batchId: 'b1',
      batchNameSnapshot: 'AS-20',
      reason: 'Counted remaining stock after opening a tube',
    });
    expect(adjustment.adjustmentDate).toBeInstanceOf(Timestamp);
    expect(adjustment.changes).toEqual(expect.arrayContaining([
      { field: 'costPerTube', oldValue: 35, newValue: 37 },
      { field: 'unopenedTubesRemaining', oldValue: 20, newValue: 17 },
      { field: 'birdsInOpenTube', oldValue: 0, newValue: 5 },
      { field: 'notes', oldValue: null, newValue: 'Opened for club night' },
    ]));
    expect((adjustment.changes as Array<{ field: string }>).map(change => change.field)).not.toContain('purchaseDate');
  });

  it('treats a same-day birdie edit as a no-op and writes no adjustment row', async () => {
    seedClubDoc('birdieInventory', 'b1', {
      name: 'No change batch',
      costPerTube: 30,
      birdsPerTube: 12,
      tubesPurchased: 4,
      unopenedTubesRemaining: 4,
      birdsInOpenTube: 0,
      purchaserName: 'Taylor',
      purchaseDate: ts('2026-07-01'),
      createdAt: ts('2026-07-01'),
    });

    const original: BirdieBatch = {
      id: 'b1',
      name: 'No change batch',
      costPerTube: 30,
      birdsPerTube: 12,
      tubesPurchased: 4,
      unopenedTubesRemaining: 4,
      birdsInOpenTube: 0,
      purchaserName: 'Taylor',
      purchaseDate: new Date('2026-07-01'),
      createdAt: ts('2026-07-01') as any,
    };

    await updateBirdieBatch(
      'b1',
      original,
      {
        name: 'No change batch',
        costPerTube: 30,
        birdsPerTube: 12,
        tubesPurchased: 4,
        unopenedTubesRemaining: 4,
        birdsInOpenTube: 0,
        purchaserName: 'Taylor',
        purchaseDate: new Date('2026-07-01T12:34:56Z'),
      },
      'No effective change',
      'admin-1',
      'Admin One'
    );

    expect(getClubDocData('birdieInventory', 'b1')).toEqual({
      name: 'No change batch',
      costPerTube: 30,
      birdsPerTube: 12,
      tubesPurchased: 4,
      unopenedTubesRemaining: 4,
      birdsInOpenTube: 0,
      purchaserName: 'Taylor',
      purchaseDate: ts('2026-07-01'),
      createdAt: ts('2026-07-01'),
    });
    expect(collectionDocIds('inventoryAdjustments')).toEqual([]);
  });

  it('fetches birdie adjustment history filtered by batch and sorted newest first', async () => {
    seedClubDoc('inventoryAdjustments', 'adj-old', {
      adjustmentDate: ts('2026-08-01'),
      userId: 'u1',
      userName: 'Admin',
      resourceType: 'birdieBatch',
      batchId: 'b1',
      batchNameSnapshot: 'AS-30',
      reason: 'Old change',
      changes: [{ field: 'notes', oldValue: null, newValue: 'old' }],
    });
    seedClubDoc('inventoryAdjustments', 'adj-new', {
      adjustmentDate: ts('2026-08-03'),
      userId: 'u1',
      userName: 'Admin',
      resourceType: 'birdieBatch',
      batchId: 'b1',
      batchNameSnapshot: 'AS-30',
      reason: 'New change',
      changes: [{ field: 'notes', oldValue: 'old', newValue: 'new' }],
    });
    seedClubDoc('inventoryAdjustments', 'adj-other-batch', {
      adjustmentDate: ts('2026-08-04'),
      userId: 'u1',
      userName: 'Admin',
      resourceType: 'birdieBatch',
      batchId: 'other',
      batchNameSnapshot: 'AS-30',
      reason: 'Wrong batch',
      changes: [],
    });
    seedClubDoc('inventoryAdjustments', 'adj-wrong-type', {
      adjustmentDate: ts('2026-08-05'),
      userId: 'u1',
      userName: 'Admin',
      resourceType: 'courtCreditBatch',
      batchId: 'b1',
      batchNameSnapshot: 'Court pack',
      reason: 'Wrong type',
      changes: [],
    });

    const adjustments = await fetchInventoryAdjustmentsForBatch('b1');

    expect(adjustments.map(adjustment => adjustment.id)).toEqual(['adj-new', 'adj-old']);
    expect(adjustments.map(adjustment => adjustment.reason)).toEqual(['New change', 'Old change']);
  });

  it('fetches birdie usage history filtered by batch and sorted newest first', async () => {
    seedClubDoc('transactions', 'tx-old', {
      resourceType: 'birdie',
      batchId: 'b1',
      quantityUsed: 5,
      cost: 15,
      sessionId: 's1',
      date: ts('2026-08-10'),
      createdAt: ts('2026-08-10'),
    });
    seedClubDoc('transactions', 'tx-new', {
      resourceType: 'birdie',
      batchId: 'b1',
      quantityUsed: 8,
      cost: 24,
      sessionId: 's2',
      date: ts('2026-08-12'),
      createdAt: ts('2026-08-12'),
    });
    seedClubDoc('transactions', 'tx-other-batch', {
      resourceType: 'birdie',
      batchId: 'other',
      quantityUsed: 99,
      cost: 99,
      sessionId: 's3',
      date: ts('2026-08-13'),
      createdAt: ts('2026-08-13'),
    });
    seedClubDoc('transactions', 'tx-wrong-type', {
      resourceType: 'court',
      batchId: 'b1',
      hoursUsed: 2,
      cost: 40,
      sessionId: 's4',
      date: ts('2026-08-14'),
      createdAt: ts('2026-08-14'),
    });

    const usage = await fetchBirdieUsageForBatch('b1');

    expect(usage.map(entry => entry.id)).toEqual(['tx-new', 'tx-old']);
    expect(usage.map(entry => (entry as any).quantityUsed)).toEqual([8, 5]);
  });
});

describe('court credit inventory service', () => {
  it('fetches court credit batches sorted by purchase date ascending', async () => {
    seedClubDoc('courtCredits', 'late', {
      name: 'Late hours',
      totalCost: 180,
      costPerHour: 18,
      hoursPurchased: 10,
      remainingHours: 6,
      purchaserName: 'Wendy',
      purchaseDate: ts('2026-03-15'),
      createdAt: ts('2026-03-15'),
    });
    seedClubDoc('courtCredits', 'early', {
      name: 'Early hours',
      totalCost: 120,
      costPerHour: 15,
      hoursPurchased: 8,
      remainingHours: 8,
      purchaserName: 'Wendy',
      purchaseDate: ts('2026-01-12'),
      createdAt: ts('2026-01-12'),
    });
    seedClubDoc('courtCredits', 'middle', {
      name: 'Middle hours',
      totalCost: 150,
      costPerHour: 15,
      hoursPurchased: 10,
      remainingHours: 9,
      purchaserName: 'Wendy',
      purchaseDate: ts('2026-02-18'),
      createdAt: ts('2026-02-18'),
    });

    const batches = await fetchCourtCredits();

    expect(batches.map(batch => batch.id)).toEqual(['early', 'middle', 'late']);
    expect(batches.every(batch => batch.purchaseDate instanceof Date)).toBe(true);
  });

  it('fetches a court credit batch by id and returns null when missing', async () => {
    seedClubDoc('courtCredits', 'c1', {
      name: 'Richmond block',
      totalCost: 240,
      costPerHour: 20,
      hoursPurchased: 12,
      remainingHours: 7,
      purchaserName: 'Jordan',
      purchaseDate: ts('2026-04-18'),
      createdAt: ts('2026-04-18'),
    });

    const batch = await fetchCourtCreditBatchById('c1');

    expect(batch).toMatchObject({
      id: 'c1',
      name: 'Richmond block',
      remainingHours: 7,
      purchaserName: 'Jordan',
    });
    expect(batch?.purchaseDate).toBeInstanceOf(Date);
    await expect(fetchCourtCreditBatchById('missing')).resolves.toBeNull();
  });

  it('creates a court credit batch with remaining hours defaulted to the full purchase', async () => {
    const id = await addCourtCreditBatch({
      name: 'Community centre pack',
      totalCost: 250,
      costPerHour: 25,
      hoursPurchased: 10,
      purchaserName: 'Morgan',
      purchaseDate: new Date('2026-05-22'),
      notes: 'Prime-time courts',
    });

    const stored = getClubDocData('courtCredits', id)!;

    expect(stored).toMatchObject({
      name: 'Community centre pack',
      totalCost: 250,
      costPerHour: 25,
      hoursPurchased: 10,
      remainingHours: 10,
      purchaserName: 'Morgan',
      notes: 'Prime-time courts',
    });
    expect(stored.purchaseDate).toBeInstanceOf(Timestamp);
    expect(stored.createdAt).toBeInstanceOf(Timestamp);
  });

  it('updates a court credit batch and logs an adjustment entry', async () => {
    seedClubDoc('courtCredits', 'c1', {
      totalCost: 180,
      costPerHour: 18,
      hoursPurchased: 10,
      remainingHours: 6,
      purchaserName: 'Dana',
      purchaseDate: ts('2026-06-11'),
      createdAt: ts('2026-06-11'),
    });

    const original: CourtCreditBatch = {
      id: 'c1',
      totalCost: 180,
      costPerHour: 18,
      hoursPurchased: 10,
      remainingHours: 6,
      purchaserName: 'Dana',
      purchaseDate: new Date('2026-06-11'),
      createdAt: ts('2026-06-11') as any,
    };

    await updateCourtCreditBatch(
      'c1',
      original,
      {
        name: 'Wednesday pack',
        totalCost: 220,
        costPerHour: 18,
        hoursPurchased: 12,
        remainingHours: 7,
        purchaserName: 'Dana',
        purchaseDate: new Date('2026-06-11'),
        notes: 'Added two bonus hours',
      },
      'Reconciled receipt and unused hours',
      'admin-2',
      'Admin Two'
    );

    const stored = getClubDocData('courtCredits', 'c1')!;
    expect(stored).toMatchObject({
      name: 'Wednesday pack',
      totalCost: 220,
      hoursPurchased: 12,
      remainingHours: 7,
      notes: 'Added two bonus hours',
      lastModifiedBy: 'admin-2',
      lastModifiedByName: 'Admin Two',
    });
    expect(stored.purchaseDate).toBeInstanceOf(Timestamp);
    expect(stored.lastModifiedAt).toBeInstanceOf(Timestamp);

    const adjustmentIds = collectionDocIds('inventoryAdjustments');
    expect(adjustmentIds).toHaveLength(1);

    const adjustment = getClubDocData('inventoryAdjustments', adjustmentIds[0])!;
    expect(adjustment).toMatchObject({
      userId: 'admin-2',
      userName: 'Admin Two',
      resourceType: 'courtCreditBatch',
      batchId: 'c1',
      batchNameSnapshot: '', // original batch had no name set
      reason: 'Reconciled receipt and unused hours',
    });
    expect(adjustment.adjustmentDate).toBeInstanceOf(Timestamp);
    expect(adjustment.changes).toEqual(expect.arrayContaining([
      { field: 'name', oldValue: null, newValue: 'Wednesday pack' },
      { field: 'hoursPurchased', oldValue: 10, newValue: 12 },
      { field: 'totalCost', oldValue: 180, newValue: 220 },
      { field: 'remainingHours', oldValue: 6, newValue: 7 },
      { field: 'notes', oldValue: null, newValue: 'Added two bonus hours' },
    ]));
  });

  it('snapshots the original batch name on the adjustment log even when only other fields change', async () => {
    seedClubDoc('courtCredits', 'c1', {
      name: 'Tuesday pack',
      totalCost: 100, costPerHour: 20, hoursPurchased: 5, remainingHours: 5,
      purchaserName: 'Dana', purchaseDate: ts('2026-06-11'), createdAt: ts('2026-06-11'),
    });
    const original: CourtCreditBatch = {
      id: 'c1', name: 'Tuesday pack',
      totalCost: 100, costPerHour: 20, hoursPurchased: 5, remainingHours: 5,
      purchaserName: 'Dana', purchaseDate: new Date('2026-06-11'), createdAt: ts('2026-06-11') as any,
    };

    await updateCourtCreditBatch(
      'c1', original,
      { ...original, remainingHours: 3 },
      'Used 2 hours off-book', 'admin-2', 'Admin Two'
    );

    const adjustmentIds = collectionDocIds('inventoryAdjustments');
    expect(getClubDocData('inventoryAdjustments', adjustmentIds[0])).toMatchObject({
      batchNameSnapshot: 'Tuesday pack',
    });
  });

  it('treats a same-day court credit edit as a no-op and writes no adjustment row', async () => {
    seedClubDoc('courtCredits', 'c1', {
      name: 'No change hours',
      totalCost: 160,
      costPerHour: 20,
      hoursPurchased: 8,
      remainingHours: 8,
      purchaserName: 'Taylor',
      purchaseDate: ts('2026-07-09'),
      createdAt: ts('2026-07-09'),
    });

    const original: CourtCreditBatch = {
      id: 'c1',
      name: 'No change hours',
      totalCost: 160,
      costPerHour: 20,
      hoursPurchased: 8,
      remainingHours: 8,
      purchaserName: 'Taylor',
      purchaseDate: new Date('2026-07-09'),
      createdAt: ts('2026-07-09') as any,
    };

    await updateCourtCreditBatch(
      'c1',
      original,
      {
        name: 'No change hours',
        totalCost: 160,
        costPerHour: 20,
        hoursPurchased: 8,
        remainingHours: 8,
        purchaserName: 'Taylor',
        purchaseDate: new Date('2026-07-09T18:30:00Z'),
      },
      'No effective change',
      'admin-2',
      'Admin Two'
    );

    expect(getClubDocData('courtCredits', 'c1')).toEqual({
      name: 'No change hours',
      totalCost: 160,
      costPerHour: 20,
      hoursPurchased: 8,
      remainingHours: 8,
      purchaserName: 'Taylor',
      purchaseDate: ts('2026-07-09'),
      createdAt: ts('2026-07-09'),
    });
    expect(collectionDocIds('inventoryAdjustments')).toEqual([]);
  });

  it('fetches court credit adjustment history filtered by batch and sorted newest first', async () => {
    seedClubDoc('inventoryAdjustments', 'adj-old', {
      adjustmentDate: ts('2026-08-01'),
      userId: 'u2',
      userName: 'Admin',
      resourceType: 'courtCreditBatch',
      batchId: 'c1',
      batchNameSnapshot: 'Old pack',
      reason: 'Old change',
      changes: [{ field: 'hoursPurchased', oldValue: 8, newValue: 9 }],
    });
    seedClubDoc('inventoryAdjustments', 'adj-new', {
      adjustmentDate: ts('2026-08-04'),
      userId: 'u2',
      userName: 'Admin',
      resourceType: 'courtCreditBatch',
      batchId: 'c1',
      batchNameSnapshot: 'New pack',
      reason: 'New change',
      changes: [{ field: 'remainingHours', oldValue: 6, newValue: 5 }],
    });
    seedClubDoc('inventoryAdjustments', 'adj-other-batch', {
      adjustmentDate: ts('2026-08-05'),
      userId: 'u2',
      userName: 'Admin',
      resourceType: 'courtCreditBatch',
      batchId: 'other',
      batchNameSnapshot: 'Other pack',
      reason: 'Wrong batch',
      changes: [],
    });
    seedClubDoc('inventoryAdjustments', 'adj-wrong-type', {
      adjustmentDate: ts('2026-08-06'),
      userId: 'u2',
      userName: 'Admin',
      resourceType: 'birdieBatch',
      batchId: 'c1',
      batchNameSnapshot: 'Birdies',
      reason: 'Wrong type',
      changes: [],
    });

    const adjustments = await fetchCourtCreditAdjustments('c1');

    expect(adjustments.map(adjustment => adjustment.id)).toEqual(['adj-new', 'adj-old']);
    expect(adjustments.map(adjustment => adjustment.reason)).toEqual(['New change', 'Old change']);
  });

  it('fetches court credit usage history filtered by batch and sorted newest first', async () => {
    seedClubDoc('transactions', 'tx-old', {
      resourceType: 'court',
      batchId: 'c1',
      hoursUsed: 2,
      cost: 40,
      sessionId: 's1',
      date: ts('2026-08-09'),
      createdAt: ts('2026-08-09'),
    });
    seedClubDoc('transactions', 'tx-new', {
      resourceType: 'court',
      batchId: 'c1',
      hoursUsed: 3,
      cost: 60,
      sessionId: 's2',
      date: ts('2026-08-12'),
      createdAt: ts('2026-08-12'),
    });
    seedClubDoc('transactions', 'tx-other-batch', {
      resourceType: 'court',
      batchId: 'other',
      hoursUsed: 99,
      cost: 99,
      sessionId: 's3',
      date: ts('2026-08-13'),
      createdAt: ts('2026-08-13'),
    });
    seedClubDoc('transactions', 'tx-wrong-type', {
      resourceType: 'birdie',
      batchId: 'c1',
      quantityUsed: 6,
      cost: 18,
      sessionId: 's4',
      date: ts('2026-08-14'),
      createdAt: ts('2026-08-14'),
    });

    const usage = await fetchCourtCreditUsage('c1');

    expect(usage.map(entry => entry.id)).toEqual(['tx-new', 'tx-old']);
    expect(usage.map(entry => (entry as any).hoursUsed)).toEqual([3, 2]);
  });
});
