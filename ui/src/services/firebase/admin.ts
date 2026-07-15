import { getDocs, writeBatch, doc, Timestamp } from 'firebase/firestore';
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
  'balanceLedger',
  'archivedSessions',
  'payouts',
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

// ─── Backup / Restore ─────────────────────────────────────────────────────────

const TIMESTAMP_MARKER = '__ts__';

// Firestore Timestamps aren't JSON-serializable, so tag them for round-tripping.
function serialize(value: unknown): unknown {
  if (value instanceof Timestamp) {
    return { [TIMESTAMP_MARKER]: true, seconds: value.seconds, nanoseconds: value.nanoseconds };
  }
  if (Array.isArray(value)) return value.map(serialize);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = serialize(v);
    return out;
  }
  return value;
}

function deserialize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(deserialize);
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (obj[TIMESTAMP_MARKER]) {
      return new Timestamp(obj.seconds as number, obj.nanoseconds as number);
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) out[k] = deserialize(v);
    return out;
  }
  return value;
}

export interface BackupData {
  version: 1;
  exportedAt: string;
  collections: Record<string, { id: string; data: unknown }[]>;
}

/** Reads every data collection into a JSON-serializable backup object. */
export async function exportAllData(): Promise<BackupData> {
  return serviceCall('exportAllData', async () => {
    const collections: BackupData['collections'] = {};
    for (const name of CLEARABLE_COLLECTIONS) {
      const snapshot = await getDocs(refs[name]);
      collections[name] = snapshot.docs.map(d => ({ id: d.id, data: serialize(d.data()) }));
    }
    return { version: 1, exportedAt: new Date().toISOString(), collections };
  });
}

/**
 * Writes a backup back into Firestore, upserting documents by their original ID.
 * Documents with matching IDs are overwritten; others are left untouched.
 * Returns a per-collection write count.
 */
export async function restoreAllData(backup: BackupData): Promise<ClearSummary> {
  return serviceCall('restoreAllData', async () => {
    if (!backup || backup.version !== 1 || typeof backup.collections !== 'object') {
      throw new Error('Invalid or unsupported backup file.');
    }

    const summary = {} as ClearSummary;
    for (const name of CLEARABLE_COLLECTIONS) {
      const entries = backup.collections[name] ?? [];
      let written = 0;
      let pending = 0;
      let batch = writeBatch(db);

      for (const entry of entries) {
        batch.set(doc(refs[name], entry.id), deserialize(entry.data) as Record<string, unknown>);
        pending += 1;
        written += 1;
        if (pending === BATCH_LIMIT) {
          await batch.commit();
          batch = writeBatch(db);
          pending = 0;
        }
      }

      if (pending > 0) await batch.commit();
      summary[name] = written;
    }

    return summary;
  });
}
