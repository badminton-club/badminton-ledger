import { getDocs, writeBatch, doc, collection, setDoc, serverTimestamp, arrayUnion, Timestamp } from 'firebase/firestore';
import { db, clubDoc, memberDoc, userDoc, clubCollection, getCurrentClubId, CLUB_DATA_COLLECTIONS } from './client';
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
  'etransferImports',
  'etransferSenderMappings',
] as const;

export type ClearableCollection = (typeof CLEARABLE_COLLECTIONS)[number];
export type ClearSummary = Record<ClearableCollection, number>;

const BATCH_LIMIT = 500;

/**
 * Snapshots the current club id once, for functions that loop with multiple
 * `await`s — without this, `refs[name]` re-resolving the mutable "current
 * club" on every access would let a mid-operation club switch (via the navbar)
 * mix data from two different clubs into one clear/export/restore.
 */
function requireCurrentClubId(): string {
  const clubId = getCurrentClubId();
  if (!clubId) throw new Error('No club selected — set a current club before accessing club data.');
  return clubId;
}

/**
 * Deletes every document from the data collections (not the collections themselves).
 * Batched to respect Firestore's 500-write limit. Returns a per-collection delete count.
 */
export async function clearAllData(): Promise<ClearSummary> {
  return serviceCall('clearAllData', async () => {
    // Snapshot the club once up front — refs[name] re-resolves against the
    // mutable "current club" on every access, so without this, switching clubs
    // via the navbar mid-operation (the loop awaits between collections and
    // batch commits) could silently clear/export/restore a mix of two clubs.
    const clubId = requireCurrentClubId();
    const summary = {} as ClearSummary;

    for (const name of CLEARABLE_COLLECTIONS) {
      const snapshot = await getDocs(clubCollection(name, clubId));
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
    const clubId = requireCurrentClubId();
    const collections: BackupData['collections'] = {};
    for (const name of CLEARABLE_COLLECTIONS) {
      const snapshot = await getDocs(clubCollection(name, clubId));
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
    // `typeof null === 'object'` in JS, so this must be checked separately from
    // the typeof check below — otherwise a backup with `collections: null` slips
    // past this guard and throws a raw TypeError instead of the intended message.
    if (!backup || backup.version !== 1 || !backup.collections || typeof backup.collections !== 'object') {
      throw new Error('Invalid or unsupported backup file.');
    }

    const clubId = requireCurrentClubId();
    const summary = {} as ClearSummary;
    for (const name of CLEARABLE_COLLECTIONS) {
      const entries = backup.collections[name] ?? [];
      let written = 0;
      let pending = 0;
      let batch = writeBatch(db);

      for (const entry of entries) {
        batch.set(doc(clubCollection(name, clubId), entry.id), deserialize(entry.data) as Record<string, unknown>);
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

// ─── Club setup / migration ─────────────────────────────────────────────────────

export type MigrationSummary = Record<ClearableCollection, number>;

/**
 * One-time setup for multi-club: creates the club, makes the given user its
 * superAdmin, and copies the existing top-level (pre-club) data into
 * `clubs/{clubId}/...`. The original flat collections are left in place, so
 * this is non-destructive and can be re-run.
 *
 * NOTE: this is a legacy, manually-invoked utility from before firestore.rules
 * locked reads/writes to `clubs/**`/`users/**` only — it isn't wired into any
 * page, and step 3's reads of the old top-level collections will themselves
 * be denied by the current rules. Kept for reference/one-off manual use (e.g.
 * temporarily relaxing the rules to run it once), not routine operation.
 * Returns a per-collection copied-doc count.
 */
export async function setUpClubFromExistingData(
  clubId: string,
  clubName: string,
  adminUid: string
): Promise<MigrationSummary> {
  return serviceCall('setUpClubFromExistingData', async () => {
    // 1. Club + superAdmin membership — matching createClub's bootstrap role,
    //    so a migrated club has the same governance capabilities (granting
    //    other admins, deleting the club, etc.) as a freshly created one.
    //    ownerUid lets Firestore rules bootstrap the first admin (no one is
    //    an admin of a brand-new club yet).
    await setDoc(clubDoc(clubId), { name: clubName, ownerUid: adminUid, createdAt: serverTimestamp() }, { merge: true });
    await setDoc(memberDoc(clubId, adminUid), { role: 'superAdmin', addedAt: serverTimestamp() }, { merge: true });

    // 2. Save the club onto the admin's profile and make it their default
    await setDoc(
      userDoc(adminUid),
      { clubs: arrayUnion(clubId), lastVisitedClub: clubId },
      { merge: true }
    );

    // 3. Copy each flat collection into the club subcollection (batched)
    const summary = {} as MigrationSummary;
    for (const name of CLUB_DATA_COLLECTIONS) {
      const flatSnap = await getDocs(collection(db, name)); // old top-level data
      const target = clubCollection(name, clubId);
      let copied = 0;
      let pending = 0;
      let batch = writeBatch(db);

      for (const docSnap of flatSnap.docs) {
        batch.set(doc(target, docSnap.id), docSnap.data());
        pending += 1;
        copied += 1;
        if (pending === BATCH_LIMIT) {
          await batch.commit();
          batch = writeBatch(db);
          pending = 0;
        }
      }

      if (pending > 0) await batch.commit();
      summary[name] = copied;
    }

    return summary;
  });
}
