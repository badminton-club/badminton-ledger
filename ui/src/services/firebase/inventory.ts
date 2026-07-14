import {
  doc,
  getDoc,
  getDocs,
  addDoc,
  query,
  orderBy,
  where,
  writeBatch,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore';
import { refs } from './client';
import { serviceCall, toJSDate, toTimestamp } from './utils';
import type { BirdieBatch, CourtCreditBatch, InventoryAdjustment, FieldChange } from 'types';

// ─── Birdie Inventory ─────────────────────────────────────────────────────────

export async function fetchBirdieInventory(): Promise<BirdieBatch[]> {
  return serviceCall('fetchBirdieInventory', async () => {
    const snap = await getDocs(query(refs.birdieInventory, orderBy('purchaseDate', 'asc')));
    return snap.docs.map(d => ({
      id: d.id,
      ...d.data(),
      purchaseDate: toJSDate(d.data().purchaseDate)!,
    })) as BirdieBatch[];
  });
}

export async function fetchBirdieBatchById(batchId: string): Promise<BirdieBatch | null> {
  return serviceCall('fetchBirdieBatchById', async () => {
    const snap = await getDoc(doc(refs.birdieInventory, batchId));
    if (!snap.exists()) return null;
    const d = snap.data();
    return { id: snap.id, ...d, purchaseDate: toJSDate(d.purchaseDate)! } as BirdieBatch;
  });
}

export async function addBirdieBatch(
  data: Omit<BirdieBatch, 'id' | 'createdAt'>
): Promise<string> {
  return serviceCall('addBirdieBatch', async () => {
    const ref = await addDoc(refs.birdieInventory, {
      ...data,
      purchaseDate: toTimestamp(data.purchaseDate),
      createdAt:    serverTimestamp(),
    });
    return ref.id;
  });
}

export async function updateBirdieBatch(
  batchId: string,
  original: BirdieBatch,
  updated: Partial<BirdieBatch>,
  reason: string,
  userId: string,
  userName: string
): Promise<void> {
  return serviceCall('updateBirdieBatch', async () => {
    // @ts-ignore
    const changes = diffFields(original, updated, [
      'name', 'purchaseDate', 'purchaserName', 'costPerTube',
      'tubesPurchased', 'birdsPerTube', 'unopenedTubesRemaining', 'birdsInOpenTube',
    ]);
    if (changes.length === 0) return;

    const batch = writeBatch(refs.birdieInventory.firestore);
    batch.update(doc(refs.birdieInventory, batchId), {
      ...updated,
      purchaseDate:     toTimestamp(updated.purchaseDate ?? original.purchaseDate),
      lastModifiedAt:   serverTimestamp(),
      lastModifiedBy:   userId,
    });
    batch.set(doc(refs.inventoryAdjustments), {
      adjustmentDate:   serverTimestamp(),
      userId,
      userName,
      resourceType:     'birdieBatch',
      batchId,
      batchNameSnapshot: original.name,
      reason,
      changes,
    });
    await batch.commit();
  });
}

export async function fetchInventoryAdjustmentsForBatch(
  batchId: string
): Promise<InventoryAdjustment[]> {
  return serviceCall('fetchInventoryAdjustmentsForBatch', async () => {
    const q = query(
      refs.inventoryAdjustments,
      where('batchId',      '==', batchId),
      where('resourceType', '==', 'birdieBatch'),
      orderBy('adjustmentDate', 'desc')
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() })) as InventoryAdjustment[];
  });
}

export async function fetchBirdieUsageForBatch(batchId: string) {
  return serviceCall('fetchBirdieUsageForBatch', async () => {
    const q = query(
      refs.transactions,
      where('resourceType', '==', 'birdie'),
      where('batchId',      '==', batchId),
      orderBy('date', 'desc')
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  });
}

// ─── Court Credits ────────────────────────────────────────────────────────────

export async function fetchCourtCredits(): Promise<CourtCreditBatch[]> {
  return serviceCall('fetchCourtCredits', async () => {
    const snap = await getDocs(query(refs.courtCredits, orderBy('purchaseDate', 'asc')));
    return snap.docs.map(d => ({
      id: d.id,
      ...d.data(),
      purchaseDate: toJSDate(d.data().purchaseDate)!,
    })) as CourtCreditBatch[];
  });
}

export async function fetchCourtCreditBatchById(batchId: string): Promise<CourtCreditBatch | null> {
  return serviceCall('fetchCourtCreditBatchById', async () => {
    const snap = await getDoc(doc(refs.courtCredits, batchId));
    if (!snap.exists()) return null;
    const d = snap.data();
    return { id: snap.id, ...d, purchaseDate: toJSDate(d.purchaseDate)! } as CourtCreditBatch;
  });
}

export async function addCourtCreditBatch(
  data: Omit<CourtCreditBatch, 'id' | 'createdAt' | 'remainingHours'>
): Promise<string> {
  return serviceCall('addCourtCreditBatch', async () => {
    const ref = await addDoc(refs.courtCredits, {
      ...data,
      remainingHours: data.hoursPurchased,  // initially full
      purchaseDate:   toTimestamp(data.purchaseDate),
      createdAt:      serverTimestamp(),
    });
    return ref.id;
  });
}

export async function updateCourtCreditBatch(
  batchId: string,
  original: CourtCreditBatch,
  updated: Partial<CourtCreditBatch>,
  reason: string,
  userId: string,
  userName: string
): Promise<void> {
  return serviceCall('updateCourtCreditBatch', async () => {
    //@ts-ignore
    const changes = diffFields(original, updated, [
      'purchaseDate', 'purchaserName', 'hoursPurchased',
      'totalCost', 'remainingHours', 'notes',
    ]);
    if (changes.length === 0) return;

    const batch = writeBatch(refs.courtCredits.firestore);
    batch.update(doc(refs.courtCredits, batchId), {
      ...updated,
      purchaseDate:       toTimestamp(updated.purchaseDate ?? original.purchaseDate),
      lastModifiedAt:     serverTimestamp(),
      lastModifiedBy:     userId,
      lastModifiedByName: userName,
    });
    batch.set(doc(refs.inventoryAdjustments), {
      adjustmentDate: serverTimestamp(),
      userId,
      userName,
      resourceType:   'courtCreditBatch',
      batchId,
      reason,
      changes,
    });
    await batch.commit();
  });
}

export async function fetchCourtCreditAdjustments(
  batchId: string
): Promise<InventoryAdjustment[]> {
  return serviceCall('fetchCourtCreditAdjustments', async () => {
    const q = query(
      refs.inventoryAdjustments,
      where('batchId',      '==', batchId),
      where('resourceType', '==', 'courtCreditBatch'),
      orderBy('adjustmentDate', 'desc')
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() })) as InventoryAdjustment[];
  });
}

export async function fetchCourtCreditUsage(batchId: string) {
  return serviceCall('fetchCourtCreditUsage', async () => {
    const q = query(
      refs.transactions,
      where('resourceType', '==', 'court'),
      where('batchId',      '==', batchId),
      orderBy('date', 'desc')
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  });
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function diffFields<T extends Record<string, unknown>>(
  original: T,
  updated: Partial<T>,
  fields: (keyof T)[]
): FieldChange[] {
  return fields.reduce<FieldChange[]>((acc, field) => {
    const oldVal = original[field];
    const newVal = updated[field];

    // Normalise dates for comparison
    const normalise = (v: unknown) =>
      v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? '');

    if (normalise(oldVal) !== normalise(newVal)) {
      acc.push({ field: String(field), oldValue: oldVal, newValue: newVal });
    }
    return acc;
  }, []);
}
