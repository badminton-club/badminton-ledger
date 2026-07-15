import { getDocs, query, where } from 'firebase/firestore';
import { refs } from './client';
import { serviceCall, toJSDate } from './utils';
import type { BalanceLedgerEntry } from 'types';

/**
 * Reads a player's balance-ledger entries (their transactions) for the current club,
 * newest first. Members may read only their own linked player's entries (enforced by
 * Firestore rules); admins may read any.
 */
export async function fetchPlayerLedger(playerId: string): Promise<BalanceLedgerEntry[]> {
  return serviceCall('fetchPlayerLedger', async () => {
    const snap = await getDocs(query(refs.balanceLedger, where('playerId', '==', playerId)));
    const entries = snap.docs.map(
      (d) => ({ id: d.id, ...(d.data() as Omit<BalanceLedgerEntry, 'id'>) })
    );
    // Client-side sort avoids needing a composite (playerId + createdAt) index.
    entries.sort(
      (a, b) => (toJSDate(b.createdAt)?.getTime() ?? 0) - (toJSDate(a.createdAt)?.getTime() ?? 0)
    );
    return entries;
  });
}
