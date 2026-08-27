import {
  doc,
  getDoc,
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

    const rawLedger = ledgerSnap.docs.map((d) => ({
      id: d.id,
      ...(d.data() as {
        delta?: number; reason?: string; playerId?: string; note?: string;
        createdAt?: Timestamp; sessionId?: string | null;
      }),
    }));

    // Payments/comps are tied to a session — fetch each referenced session once so
    // the ledger can show which session date the entry is settling.
    const sessionIds = [...new Set(
      rawLedger.map((l) => l.sessionId).filter((id): id is string => !!id)
    )];
    const sessionDocs = await Promise.all(
      sessionIds.map((id) => getDoc(doc(refs.sessions, id)))
    );
    const sessionDateById = new Map<string, Date>();
    sessionDocs.forEach((snap, i) => {
      if (!snap.exists()) return;
      const sessionDate = toJSDate(snap.data().date);
      if (sessionDate) sessionDateById.set(sessionIds[i], sessionDate);
    });

    const collected: PayoutLedgerEntry[] = rawLedger.map((l) => {
      const type = l.reason === 'payment' ? 'payment' : l.reason === 'comp' ? 'comp' : 'adjustment';
      return {
        id: l.id,
        date: toJSDate(l.createdAt) ?? new Date(0),
        type,
        amount: l.delta ?? 0,
        playerId: l.playerId ?? null,
        sessionId: l.sessionId ?? null,
        sessionDate: l.sessionId ? sessionDateById.get(l.sessionId) ?? null : null,
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
        sessionId: null,
        sessionDate: null,
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
 * Records a cashout to the owner. When `amount` is omitted, the full pending
 * balance is paid out; otherwise the given custom amount is recorded. Recomputes
 * pending at call time so a full payout is never stale and a custom payout can't
 * exceed what's owed. Returns the amount paid.
 */
export async function payOwner(note?: string, amount?: number): Promise<number> {
  return serviceCall('payOwner', async () => {
    const { pending } = await fetchOwnerPayoutSummary();
    if (pending <= 0) throw new Error('Nothing to pay out — the balance is already zero.');

    let payoutAmount = pending;
    if (amount !== undefined) {
      if (!Number.isFinite(amount) || amount <= 0) {
        throw new Error('Enter a payout amount greater than zero.');
      }
      if (amount > pending) {
        throw new Error(`Amount can't exceed the pending balance of $${pending.toFixed(2)}.`);
      }
      payoutAmount = amount;
    }

    await setDoc(doc(refs.payouts), {
      amount:    payoutAmount,
      note:      note?.trim() || null,
      paidByUid: auth.currentUser?.uid ?? null,
      date:      Timestamp.now(),
      createdAt: serverTimestamp(),
    });

    return payoutAmount;
  });
}
