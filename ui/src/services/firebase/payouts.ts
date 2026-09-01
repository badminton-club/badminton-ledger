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
// adjustments are money collected by the club and owed to the owner. Comps and
// balance entries are shown for record keeping but NOT counted — a comp means the
// player paid the owner directly, and a balance entry is a prepaid-wallet draw or
// refund tied to a session, money that was already collected when the wallet was
// topped up. Manual adjustments made with "Include in owner payout" unchecked are
// logged as 'manual-excluded' and intentionally omitted here, so they never affect
// the payout.
const LEDGER_REASONS = ['payment', 'manual', 'comp', 'session', 'session-edit', 'session-deleted', 'settlement'];

// Reasons that represent a prepaid-wallet movement tied to a session (paying with,
// or refunding, a player's balance) rather than money owed to/from the owner.
const BALANCE_REASONS = new Set(['session', 'session-edit', 'session-deleted', 'settlement']);

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
        voided?: boolean; voidedNote?: string;
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
      const type = l.reason === 'payment' ? 'payment'
        : l.reason === 'comp' ? 'comp'
        : BALANCE_REASONS.has(l.reason ?? '') ? 'balance'
        : 'adjustment';
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
        voidedNote: l.voidedNote ?? null,
        // Only manual adjustments can be undone here — payments/comps/balance
        // entries are derived from a session's settlement state and are reversed
        // by re-toggling it there, not by editing the ledger directly.
        canUndo: l.reason === 'manual' && !l.voided,
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
        voidedNote: p.voidedNote ?? null,
        canUndo: !p.voided,
      };
    });

    // Comps and balance entries are for record keeping only — they don't count
    // toward what's owed (a comp was paid to the owner directly; a balance entry
    // was already collected when the player's wallet was topped up). A voided
    // adjustment (undone from the ledger) is likewise excluded — it's shown
    // struck-through for the record, but no longer contributes to the total.
    const totalCollected = collected
      .filter((e) => e.type !== 'comp' && e.type !== 'balance' && !e.voided)
      .reduce((sum, e) => sum + e.amount, 0);
    // Same for a voided payout: kept in the ledger for the audit trail, but
    // excluded from what's already been paid out.
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

    // Wallet-neutral (this entry never moves a player's balance), but every other
    // balanceLedger writer always logs a real balanceBefore/balanceAfter — even
    // when unchanged, e.g. the 'payment'/'comp' entries logged elsewhere set both
    // to the same value. Matching that keeps the field non-optional in practice,
    // so per-player ledger views (My Attendance, Balance History) can render a
    // valid balance for this row instead of a broken value when a player is
    // optionally attached for record-keeping.
    let balance = 0;
    if (playerId) {
      const playerSnap = await getDoc(doc(refs.players, playerId));
      balance = (playerSnap.data()?.balance as number) ?? 0;
    }

    await setDoc(doc(refs.balanceLedger), {
      playerId:  playerId ?? null,
      sessionId: null,
      delta:     amount,
      balanceBefore: balance,
      balanceAfter:  balance,
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
 * The original is never deleted: it's marked `voided` (shown struck-through in
 * the ledger, with the given reason attached) and excluded from the payout
 * total. If it had actually moved a player's prepaid balance, that's reversed
 * too, logged as a separate wallet-only entry (reason 'manual-excluded') so it
 * shows accurately in the player's own Balance History without adding a second,
 * confusing row to the payout ledger itself.
 */
export async function undoPayoutAdjustment(entryId: string, reason: string): Promise<void> {
  return serviceCall('undoPayoutAdjustment', async () => {
    if (!reason.trim()) throw new Error('A reason for undoing this is required.');

    const entryRef = doc(refs.balanceLedger, entryId);

    await runTransaction(db, async (tx) => {
      const entrySnap = await tx.get(entryRef);
      if (!entrySnap.exists()) throw new Error('Transaction not found.');
      const entry = entrySnap.data() as {
        reason?: string; delta?: number; playerId?: string | null;
        voided?: boolean; walletAdjustment?: boolean;
      };

      if (entry.reason !== 'manual') {
        throw new Error('Only manual adjustments can be undone here.');
      }
      if (entry.voided) throw new Error('This transaction has already been undone.');

      // Read the player (if any) before any writes — Firestore transactions require
      // all reads to happen first. Needed unless the entry is explicitly marked
      // `walletAdjustment: false` (a custom payout transaction, which never
      // touches the wallet). Older 'manual' entries predate this flag and were
      // always Players-page balance adjustments that *did* move the wallet, so
      // `undefined` must default to "yes, reverse it" — same safe default the
      // Players-page Balance History filter already uses — otherwise undoing a
      // legacy adjustment would silently leave the player's wallet balance wrong.
      const delta = entry.delta ?? 0;
      const playerRef = entry.walletAdjustment !== false && entry.playerId
        ? doc(refs.players, entry.playerId)
        : null;
      const playerSnap = playerRef ? await tx.get(playerRef) : null;

      tx.update(entryRef, {
        voided:      true,
        voidedAt:    serverTimestamp(),
        voidedByUid: auth.currentUser?.uid ?? null,
        voidedNote:  reason.trim(),
      });

      if (playerRef && playerSnap?.exists()) {
        const before = playerSnap.data().balance ?? 0;
        tx.update(playerRef, { balance: increment(-delta) });
        tx.set(doc(refs.balanceLedger), {
          playerId:      entry.playerId,
          sessionId:     null,
          delta:         -delta,
          balanceBefore: before,
          balanceAfter:  before - delta,
          reason:        'manual-excluded',
          note:          `Reversed — undoing adjustment: ${reason.trim()}`,
          walletAdjustment: true,
          createdAt:     serverTimestamp(),
        });
      }
    });
  });
}

/**
 * Undoes a recorded payout to the owner. Unlike an adjustment, a payout has no
 * wallet or session tied to it — it's simply marked `voided` with the given
 * reason attached (kept for the audit trail, shown struck-through in the
 * ledger) and excluded from the total paid, which increases the pending
 * balance back up by the same amount.
 */
export async function voidOwnerPayout(payoutId: string, reason: string): Promise<void> {
  return serviceCall('voidOwnerPayout', async () => {
    if (!reason.trim()) throw new Error('A reason for undoing this is required.');

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
        voidedNote:  reason.trim(),
      });
    });
  });
}

/**
 * Records a cashout to the owner. When `amount` is omitted, the full pending
 * balance is paid out; otherwise the given custom amount is recorded.
 *
 * Two admins clicking "Pay Owner" at almost the same moment could otherwise
 * both read the same pending balance and both record a payout against it,
 * double-counting the same collected money (the UI already disables the
 * button while a payout is in flight, which covers an accidental
 * double-click from the same admin — this guards the separate case of two
 * different admin sessions). To close that gap without a full counter-doc
 * redesign, every *existing* payout is re-read fresh inside a transaction
 * immediately before writing the new one: Firestore transactions
 * automatically retry if any of those re-read documents changes before this
 * one commits, so a payout that wins the race is guaranteed to be reflected
 * here. (This narrows, but can't fully close, the race — a brand-new payout
 * doc created in the brief window between the outer read below and the
 * transaction's re-reads isn't part of that read set; closing that
 * completely would need a maintained running-total document updated
 * transactionally by every payment/adjustment/payout write across the app.)
 */
export async function payOwner(note?: string, amount?: number): Promise<number> {
  return serviceCall('payOwner', async () => {
    const [{ totalCollected }, payoutSnap] = await Promise.all([
      fetchOwnerPayoutSummary(),
      getDocs(refs.payouts),
    ]);
    const payoutRefs = payoutSnap.docs.map((d) => d.ref);
    const newPayoutRef = doc(refs.payouts);

    return runTransaction(db, async (tx) => {
      const freshPayoutDocs = await Promise.all(payoutRefs.map((ref) => tx.get(ref)));
      const totalPaid = freshPayoutDocs.reduce((sum, snap) => {
        if (!snap.exists()) return sum;
        const data = snap.data() as { amount?: number; voided?: boolean };
        return data.voided ? sum : sum + (data.amount ?? 0);
      }, 0);
      const pendingNow = totalCollected - totalPaid;
      if (pendingNow <= 0) throw new Error('Nothing to pay out — the balance is already zero.');

      let payoutAmount = pendingNow;
      if (amount !== undefined) {
        if (!Number.isFinite(amount) || amount <= 0) {
          throw new Error('Enter a payout amount greater than zero.');
        }
        if (amount > pendingNow) {
          throw new Error(`Amount can't exceed the pending balance of $${pendingNow.toFixed(2)}.`);
        }
        payoutAmount = amount;
      }

      tx.set(newPayoutRef, {
        amount:    payoutAmount,
        note:      note?.trim() || null,
        paidByUid: auth.currentUser?.uid ?? null,
        date:      Timestamp.now(),
        createdAt: serverTimestamp(),
      });

      return payoutAmount;
    });
  });
}
