import { getDocs, writeBatch } from 'firebase/firestore';
import { db, refs } from './client';
import { serviceCall } from './utils';

/** Data collections that `clearAllData` empties. Auth-related collections are deliberately excluded. */
export const CLEARABLE_COLLECTIONS = [
  'sessions',
  'players',
  'birdieInventory',
  'courtCredits',
  'inventoryAdjustments',
  'transactions',
] as const;

export type ClearableCollection = (typeof CLEARABLE_COLLECTIONS)[number];
export type ClearSummary = Record<ClearableCollection, number>;

const BATCH_LIMIT = 500;

/**
 * Deletes every document from the data collections (not the collections themselves).
 * Batched to respect Firestore's 500-write limit. Returns a per-collection delete count.
 */
export async function clearAllData(): Promise<ClearSummary> {
  return serviceCall('clearAllData', async () => {
    const summary = {} as ClearSummary;

    for (const name of CLEARABLE_COLLECTIONS) {
      const snapshot = await getDocs(refs[name]);
      let deleted = 0;
      let pending = 0;
      let batch = writeBatch(db);

      for (const docSnap of snapshot.docs) {
        batch.delete(docSnap.ref);
        pending += 1;
        deleted += 1;
        if (pending === BATCH_LIMIT) {
          await batch.commit();
          batch = writeBatch(db);
          pending = 0;
        }
      }

      if (pending > 0) await batch.commit();
      summary[name] = deleted;
    }

    return summary;
  });
}
