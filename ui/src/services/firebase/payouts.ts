import {
  doc,
  getDoc,
  setDoc,
  getDocs,
  query,
  where,
  serverTimestamp,
  runTransaction,
  increment,
  Timestamp,
} from 'firebase/firestore';
import { auth, refs, db } from './client';
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
        voided?: boolean; isReversal?: boolean;
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
        voided: !!l.voided,
        // Only manual adjustments can be undone here — payments/comps are derived
        // from a session's settlement state and are reversed by re-toggling it
        // there, not by editing the ledger directly. A reversal entry can't itself
        // be undone (that would just recreate the original).
        canUndo: l.reason === 'manual' && !l.voided && !l.isReversal,
        isReversal: !!l.isReversal,
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
        voided: !!p.voided,
        canUndo: !p.voided,
        isReversal: false,
      };
    });

    // Comps are for record keeping only — they don't count toward what's owed.
    // Voided entries aren't specially excluded here: an undone adjustment keeps its
    // original (still-counted) amount, offset by its own reversal row, so the two
    // net to zero automatically — same pattern the session-settlement toggles use.
    const totalCollected = collected
      .filter((e) => e.type !== 'comp')
      .reduce((sum, e) => sum + e.amount, 0);
    // Voided payouts, on the other hand, are simply excluded — there's no
    // "reversal payout" concept, so a void just removes it from the total owed.
    const totalPaid = payouts
      .filter((e) => !e.voided)
      .reduce((sum, e) => sum + e.amount, 0);

    const ledger = [...collected, ...payouts].sort(
      (a, b) => b.date.getTime() - a.date.getTime()
    );

    return { totalCollected, totalPaid, pending: totalCollected - totalPaid, ledger };
  });
}

/**
 * Records a one-off transaction the club collected that isn't a session payment
 * or a player's prepaid-balance top-up — e.g. a manager buying birdies from the
 * shared stash and paying cash on the spot. Logged with reason 'manual' so it
 * counts toward the owner payout like any other manual adjustment, but (unlike
 * the per-player balance adjustment on the Players page) it never touches a
 * player's prepaid balance — it's purely a payout-ledger entry.
 */
export async function addCustomPayoutTransaction(
  amount: number,
  note: string,
  playerId?: string | null
): Promise<void> {
  return serviceCall('addCustomPayoutTransaction', async () => {
    if (!Number.isFinite(amount) || amount === 0) {
      throw new Error('Enter a non-zero amount.');
    }
    if (!note.trim()) {
      throw new Error('A note is required.');
    }

    await setDoc(doc(refs.balanceLedger), {
      playerId:  playerId ?? null,
      sessionId: null,
      delta:     amount,
      reason:    'manual',
      note:      note.trim(),
      walletAdjustment: false, // record-keeping only — never moves a player's balance
      createdAt: serverTimestamp(),
    });
  });
}

/**
 * Undoes a manual payout-ledger adjustment (reason 'manual') — e.g. a custom
 * transaction or a Players-page balance adjustment marked "include in payout".
 * Rather than deleting the original (financial records are never destroyed here),
 * this marks it `voided` for display and writes a new equal-and-opposite reversal
 * entry, mirroring how session-settlement changes elsewhere in the app log a
 * reversal instead of rewriting history. The original's (now-offset) amount and
 * the reversal's amount net to zero in the payout total automatically. If the
 * original actually moved a player's prepaid balance, the reversal moves it back.
 */
export async function undoPayoutAdjustment(entryId: string): Promise<void> {
  return serviceCall('undoPayoutAdjustment', async () => {
    const entryRef = doc(refs.balanceLedger, entryId);

    await runTransaction(db, async (tx) => {
      const entrySnap = await tx.get(entryRef);
      if (!entrySnap.exists()) throw new Error('Transaction not found.');
      const entry = entrySnap.data() as {
        reason?: string; delta?: number; playerId?: string | null; note?: string;
        voided?: boolean; isReversal?: boolean; walletAdjustment?: boolean;
        createdAt?: Timestamp;
      };

      if (entry.reason !== 'manual') {
        throw new Error('Only manual adjustments can be undone here.');
      }
      if (entry.voided) throw new Error('This transaction has already been undone.');
      if (entry.isReversal) throw new Error("A reversal entry can't itself be undone.");

      // Read the player (if any) before any writes — Firestore transactions require
      // all reads to happen first. Used both to enrich the reversal note with the
      // player's name and, if the original moved their balance, to reverse it.
      const playerRef = entry.playerId ? doc(refs.players, entry.playerId) : null;
      const playerSnap = playerRef ? await tx.get(playerRef) : null;
      const playerName = playerSnap?.exists()
        ? [playerSnap.data().firstName, playerSnap.data().lastName].filter(Boolean).join(' ')
        : null;

      const delta = entry.delta ?? 0;
      const originalDate = toJSDate(entry.createdAt);
      const dateStr = originalDate
        ? originalDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
        : null;
      const subject = playerName ? ` for ${playerName}` : '';
      const originalNote = entry.note?.trim();
      const summary = `Undo of $${Math.abs(delta).toFixed(2)} adjustment${subject}${dateStr ? ` from ${dateStr}` : ''}`;
      const reversalNote = originalNote ? `${summary}: "${originalNote}"` : summary;

      const reversalRef = doc(refs.balanceLedger);
      const reversalData: Record<string, unknown> = {
        playerId:  entry.playerId ?? null,
        sessionId: null,
        delta:     -delta,
        reason:    'manual',
        note:      reversalNote,
        walletAdjustment: false,
        isReversal: true,
        createdAt: serverTimestamp(),
      };

      // Only reverse the player's prepaid balance if the original entry actually
      // moved it (a Players-page balance adjustment) — a custom payout
      // transaction never touched the wallet, so there's nothing to reverse there.
      if (entry.walletAdjustment && playerRef && playerSnap?.exists()) {
        const before = playerSnap.data().balance ?? 0;
        tx.update(playerRef, { balance: increment(-delta) });
        reversalData.balanceBefore = before;
        reversalData.balanceAfter = before - delta;
        reversalData.walletAdjustment = true;
      }

      tx.set(reversalRef, reversalData);
      tx.update(entryRef, {
        voided:      true,
        voidedAt:    serverTimestamp(),
        voidedByUid: auth.currentUser?.uid ?? null,
      });
    });
  });
}

/**
 * Undoes a recorded payout to the owner. Unlike an adjustment, a payout has no
 * natural "reversal" entry — it's simply marked `voided` (kept for the audit
 * trail, shown struck-through) and excluded from the total paid, which increases
 * the pending balance back up by the same amount.
 */
export async function voidOwnerPayout(payoutId: string): Promise<void> {
  return serviceCall('voidOwnerPayout', async () => {
    const payoutRef = doc(refs.payouts, payoutId);
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(payoutRef);
      if (!snap.exists()) throw new Error('Payout not found.');
      const data = snap.data() as OwnerPayout;
      if (data.voided) throw new Error('This payout has already been undone.');

      tx.update(payoutRef, {
        voided:      true,
        voidedAt:    serverTimestamp(),
        voidedByUid: auth.currentUser?.uid ?? null,
      });
    });
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
