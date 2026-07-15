import {
  getDocs,
  addDoc,
  query,
  where,
  orderBy,
  serverTimestamp,
} from 'firebase/firestore';
import { db, refs } from './client';
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
