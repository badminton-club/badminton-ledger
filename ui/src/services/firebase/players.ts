import {
  getDocs,
  addDoc,
  updateDoc,
  doc,
  query,
  where,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore';
import { db, refs, getCurrentClubId, membersRef, profileEditRequestsRef } from './client';
import { serviceCall } from './utils';
import type { Player, NewPlayerInput } from 'types';

/**
 * Searches players by name.
 * Tries full name first (firstName + lastName), falls back to firstName only.
 */
export async function findPlayersByName(parsedName: string): Promise<Player[]> {
  return serviceCall('findPlayersByName', async () => {
    const trimmed = parsedName.trim().toLowerCase();
    if (!trimmed) return [];

    const parts = trimmed.split(/\s+/).filter(Boolean);
    if (parts.length === 0) return [];

    const seen = new Set<string>();
    const results: Player[] = [];

    const addUnique = (snap: { id: string; data: () => Record<string, unknown> }) => {
      if (!seen.has(snap.id)) {
        results.push({ id: snap.id, ...snap.data() } as Player);
        seen.add(snap.id);
      }
    };

    // Try full name match first
    if (parts.length >= 2) {
      const q = query(
        refs.players,
        where('firstNameLower', '==', parts[0]),
        where('lastNameLower',  '==', parts.slice(1).join(' '))
      );
      const snap = await getDocs(q);
      snap.forEach(addUnique);
    }

    // Fall back to first-name-only if nothing found
    if (results.length === 0) {
      const q = query(refs.players, where('firstNameLower', '==', parts[0]));
      const snap = await getDocs(q);
      snap.forEach(addUnique);
    }

    return results;
  });
}

/**
 * Adds a new player. Automatically adds lowercase search fields and
 * initialises sessionCount to 0 (replaces attendedSessionIds[]).
 */
export async function addPlayer(input: NewPlayerInput): Promise<string> {
  return serviceCall('addPlayer', async () => {
    const docRef = await addDoc(refs.players, {
      firstName:      input.firstName,
      firstNameLower: input.firstName.toLowerCase(),
      lastName:       input.lastName ?? null,
      lastNameLower:  input.lastName ? input.lastName.toLowerCase() : null,
      email:          input.email ?? null,
      balance:        input.balance ?? 0,
      owed:           0,
      description:    input.description ?? '',
      sessionCount:   0,
      createdAt:      serverTimestamp(),
    });
    return docRef.id;
  });
}

/** Returns a display name string for a player. */
export function formatPlayerName(player: Pick<Player, 'firstName' | 'lastName'>): string {
  return [player.firstName, player.lastName].filter(Boolean).join(' ');
}

/** Updates a player's name and email (keeps the lowercase search fields in sync). */
export async function updatePlayerProfile(
  playerId: string,
  input: { firstName: string; lastName: string | null; email: string | null }
): Promise<void> {
  return serviceCall('updatePlayerProfile', async () => {
    await updateDoc(doc(refs.players, playerId), {
      firstName:      input.firstName,
      firstNameLower: input.firstName.toLowerCase(),
      lastName:       input.lastName ?? null,
      lastNameLower:  input.lastName ? input.lastName.toLowerCase() : null,
      email:          input.email ?? null,
    });
  });
}

/**
 * Deletes a player and cleans up everything that might otherwise dangle:
 *  - any member(s) linked to this player are unlinked (playerId -> null),
 *    so a member never ends up pointing at a deleted player (which would
 *    make later actions like approving a pending profile-edit request fail
 *    with a raw "No document to update" error)
 *  - any pending profile-edit request for this player is removed, since
 *    there's nothing left to apply it to
 */
export async function deletePlayer(playerId: string): Promise<void> {
  return serviceCall('deletePlayer', async () => {
    const clubId = getCurrentClubId();
    if (!clubId) throw new Error('No club selected — set a current club before deleting a player.');

    const [memberSnap, editRequestSnap] = await Promise.all([
      getDocs(query(membersRef(clubId), where('playerId', '==', playerId))),
      getDocs(query(profileEditRequestsRef(clubId), where('playerId', '==', playerId))),
    ]);

    const batch = writeBatch(db);
    memberSnap.docs.forEach((d) => batch.update(d.ref, { playerId: null }));
    editRequestSnap.docs.forEach((d) => batch.delete(d.ref));
    batch.delete(doc(refs.players, playerId));
    await batch.commit();
  });
}
