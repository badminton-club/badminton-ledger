import {
  doc,
  setDoc,
  getDocs,
  query,
  where,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore';
import { auth, refs } from './client';
import { serviceCall, toJSDate } from './utils';
import type {
  OwnerPayout,
  OwnerPayoutSummary,
  PayoutLedgerEntry,
} from 'types';

// Balance-ledger reasons shown in the payout ledger. Payments and manual balance
// adjustments are money collected by the club and owed to the owner. Comps are shown
// for record keeping but NOT counted — the player paid the owner directly.
// Manual adjustments made with "Include in owner payout" unchecked are logged as
// 'manual-excluded' and intentionally omitted here, so they never affect the payout.
const LEDGER_REASONS = ['payment', 'manual', 'comp'];

/**
 * Builds the owner-payout summary from money collected from players (payments and
 * manual balance adjustments) and the payouts already cashed out to the owner.
 * Comp entries are included in the ledger for record keeping but excluded from the
 * totals. The pending balance is collected − paid.
 */
export async function fetchOwnerPayoutSummary(): Promise<OwnerPayoutSummary> {
  return serviceCall('fetchOwnerPayoutSummary', async () => {
    const [ledgerSnap, payoutSnap] = await Promise.all([
      getDocs(query(refs.balanceLedger, where('reason', 'in', LEDGER_REASONS))),
      getDocs(refs.payouts),
    ]);

    const collected: PayoutLedgerEntry[] = ledgerSnap.docs.map((d) => {
      const l = d.data() as {
        delta?: number; reason?: string; playerId?: string; note?: string; createdAt?: Timestamp;
      };
      const type = l.reason === 'payment' ? 'payment' : l.reason === 'comp' ? 'comp' : 'adjustment';
      return {
        id: d.id,
        date: toJSDate(l.createdAt) ?? new Date(0),
        type,
        amount: l.delta ?? 0,
        playerId: l.playerId ?? null,
        note: l.note ?? '',
      };
    });

    const payouts: PayoutLedgerEntry[] = payoutSnap.docs.map((d) => {
      const p = d.data() as OwnerPayout;
      return {
        id: d.id,
        date: toJSDate(p.date) ?? toJSDate(p.createdAt) ?? new Date(0),
        type: 'payout' as const,
        amount: p.amount ?? 0,
        playerId: null,
        note: p.note?.trim() ?? '',
      };
    });

    // Comps are for record keeping only — they don't count toward what's owed.
    const totalCollected = collected
      .filter((e) => e.type !== 'comp')
      .reduce((sum, e) => sum + e.amount, 0);
    const totalPaid = payouts.reduce((sum, e) => sum + e.amount, 0);

    const ledger = [...collected, ...payouts].sort(
      (a, b) => b.date.getTime() - a.date.getTime()
    );

    return { totalCollected, totalPaid, pending: totalCollected - totalPaid, ledger };
  });
}

/**
 * Records a cashout to the owner for the current pending balance, bringing it to
 * zero. Recomputes pending at call time so the recorded amount is never stale.
 * Returns the amount paid.
 */
export async function payOwner(note?: string): Promise<number> {
  return serviceCall('payOwner', async () => {
    const { pending } = await fetchOwnerPayoutSummary();
    if (pending <= 0) throw new Error('Nothing to pay out — the balance is already zero.');

    await setDoc(doc(refs.payouts), {
      amount:    pending,
      note:      note?.trim() || null,
      paidByUid: auth.currentUser?.uid ?? null,
      date:      Timestamp.now(),
      createdAt: serverTimestamp(),
    });

    return pending;
  });
}
