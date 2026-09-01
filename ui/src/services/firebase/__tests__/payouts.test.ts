import {
  fetchOwnerPayoutSummary,
  addCustomPayoutTransaction,
  undoPayoutAdjustment,
  voidOwnerPayout,
  payOwner,
} from '../payouts';
import { refs } from '../client';
import { getDocs } from 'firebase/firestore';
import {
  resetFirebaseTestState,
  seedClubDoc,
  getClubDocData,
  setCurrentUser,
  ts,
  TEST_CLUB_ID,
} from '../../../test-utils/firebaseTestHelpers';
import { __getAllPaths } from '../../../test-utils/fakeFirestore';

beforeEach(() => {
  resetFirebaseTestState();
});

describe('fetchOwnerPayoutSummary', () => {
  it('classifies ledger reasons into payment/comp/balance/adjustment types', async () => {
    seedClubDoc('balanceLedger', 'l1', { reason: 'payment', delta: 20, playerId: 'p1', createdAt: ts('2026-01-01') });
    seedClubDoc('balanceLedger', 'l2', { reason: 'comp', delta: 15, playerId: 'p1', createdAt: ts('2026-01-02') });
    seedClubDoc('balanceLedger', 'l3', { reason: 'session', delta: -10, playerId: 'p1', createdAt: ts('2026-01-03') });
    seedClubDoc('balanceLedger', 'l4', { reason: 'manual', delta: 5, playerId: 'p1', createdAt: ts('2026-01-04') });
    // Not one of the ledger reasons shown in the payout ledger — must be excluded entirely.
    seedClubDoc('balanceLedger', 'l5', { reason: 'manual-excluded', delta: 999, playerId: 'p1', createdAt: ts('2026-01-05') });

    const summary = await fetchOwnerPayoutSummary();
    const byId = Object.fromEntries(summary.ledger.map(e => [e.id, e]));

    expect(byId.l1.type).toBe('payment');
    expect(byId.l2.type).toBe('comp');
    expect(byId.l3.type).toBe('balance');
    expect(byId.l4.type).toBe('adjustment');
    expect(byId.l5).toBeUndefined();
  });

  it('totals only payment/manual entries — comps, balance entries, and voided rows are excluded', async () => {
    seedClubDoc('balanceLedger', 'l1', { reason: 'payment', delta: 20, createdAt: ts('2026-01-01') });
    seedClubDoc('balanceLedger', 'l2', { reason: 'comp', delta: 15, createdAt: ts('2026-01-02') });
    seedClubDoc('balanceLedger', 'l3', { reason: 'session', delta: -10, createdAt: ts('2026-01-03') });
    seedClubDoc('balanceLedger', 'l4', { reason: 'manual', delta: 5, createdAt: ts('2026-01-04') });
    seedClubDoc('balanceLedger', 'l5', { reason: 'manual', delta: 1000, createdAt: ts('2026-01-05'), voided: true });

    const summary = await fetchOwnerPayoutSummary();
    expect(summary.totalCollected).toBe(25); // 20 (payment) + 5 (manual) only
  });

  it('looks up the session date for payment/comp/balance entries tied to a session', async () => {
    seedClubDoc('sessions', 's1', { date: ts('2026-08-13') });
    seedClubDoc('balanceLedger', 'l1', {
      reason: 'session', delta: -10, playerId: 'p1', sessionId: 's1', createdAt: ts('2026-08-13'),
    });

    const summary = await fetchOwnerPayoutSummary();
    const entry = summary.ledger.find(e => e.id === 'l1')!;
    expect(entry.sessionDate?.toISOString().slice(0, 10)).toBe('2026-08-13');
  });

  it('computes pending as totalCollected minus totalPaid, excluding voided payouts', async () => {
    seedClubDoc('balanceLedger', 'l1', { reason: 'payment', delta: 100, createdAt: ts('2026-01-01') });
    seedClubDoc('payouts', 'o1', { amount: 30, createdAt: ts('2026-01-02'), date: ts('2026-01-02') });
    seedClubDoc('payouts', 'o2', { amount: 999, voided: true, createdAt: ts('2026-01-03'), date: ts('2026-01-03') });

    const summary = await fetchOwnerPayoutSummary();
    expect(summary.totalCollected).toBe(100);
    expect(summary.totalPaid).toBe(30); // o2 is voided, excluded
    expect(summary.pending).toBe(70);
  });

  it('sorts the combined ledger (collected + payouts) newest first', async () => {
    seedClubDoc('balanceLedger', 'l1', { reason: 'payment', delta: 10, createdAt: ts('2026-01-01') });
    seedClubDoc('payouts', 'o1', { amount: 5, createdAt: ts('2026-01-15'), date: ts('2026-01-15') });
    seedClubDoc('balanceLedger', 'l2', { reason: 'payment', delta: 20, createdAt: ts('2026-01-10') });

    const summary = await fetchOwnerPayoutSummary();
    expect(summary.ledger.map(e => e.id)).toEqual(['o1', 'l2', 'l1']);
  });

  it('only marks manual, non-voided entries as undoable', async () => {
    seedClubDoc('balanceLedger', 'l1', { reason: 'manual', delta: 10, createdAt: ts('2026-01-01') });
    seedClubDoc('balanceLedger', 'l2', { reason: 'manual', delta: 10, createdAt: ts('2026-01-02'), voided: true });
    seedClubDoc('balanceLedger', 'l3', { reason: 'payment', delta: 10, createdAt: ts('2026-01-03') });

    const summary = await fetchOwnerPayoutSummary();
    const byId = Object.fromEntries(summary.ledger.map(e => [e.id, e]));
    expect(byId.l1.canUndo).toBe(true);
    expect(byId.l2.canUndo).toBe(false);
    expect(byId.l3.canUndo).toBe(false);
  });
});

describe('addCustomPayoutTransaction', () => {
  it('rejects a zero or non-finite amount', async () => {
    await expect(addCustomPayoutTransaction(0, 'note')).rejects.toThrow('non-zero amount');
    await expect(addCustomPayoutTransaction(NaN, 'note')).rejects.toThrow('non-zero amount');
  });

  it('requires a non-empty note', async () => {
    await expect(addCustomPayoutTransaction(10, '   ')).rejects.toThrow('note is required');
  });

  it('records a wallet-neutral manual entry with matching balanceBefore/After when no player is attached', async () => {
    await addCustomPayoutTransaction(25, 'Manager bought birdies from the stash');

    const paths = __getAllPaths().filter(p => p.startsWith(`clubs/${TEST_CLUB_ID}/balanceLedger/`));
    expect(paths).toHaveLength(1);
    const entry = getClubDocData('balanceLedger', paths[0].split('/').pop()!)!;
    expect(entry).toMatchObject({
      playerId: null,
      delta: 25,
      reason: 'manual',
      note: 'Manager bought birdies from the stash',
      walletAdjustment: false,
      balanceBefore: 0,
      balanceAfter: 0,
    });
  });

  it('logs the tagged player\'s current balance for record-keeping without changing it', async () => {
    seedClubDoc('players', 'p1', { balance: 42 });

    await addCustomPayoutTransaction(-5, 'Refunded to manager', 'p1');

    const paths = __getAllPaths().filter(p => p.startsWith(`clubs/${TEST_CLUB_ID}/balanceLedger/`));
    const entry = getClubDocData('balanceLedger', paths[0].split('/').pop()!)!;
    expect(entry.playerId).toBe('p1');
    expect(entry.balanceBefore).toBe(42);
    expect(entry.balanceAfter).toBe(42); // unchanged — record-keeping only
    expect(entry.walletAdjustment).toBe(false);

    // The player's actual balance must be untouched.
    expect(getClubDocData('players', 'p1')?.balance).toBe(42);
  });
});

describe('undoPayoutAdjustment', () => {
  it('requires a non-empty reason', async () => {
    seedClubDoc('balanceLedger', 'l1', { reason: 'manual', delta: 10 });
    await expect(undoPayoutAdjustment('l1', '  ')).rejects.toThrow('reason for undoing this is required');
  });

  it('throws if the entry does not exist', async () => {
    await expect(undoPayoutAdjustment('missing', 'oops')).rejects.toThrow('Transaction not found');
  });

  it('only allows undoing entries with reason "manual"', async () => {
    seedClubDoc('balanceLedger', 'l1', { reason: 'payment', delta: 10 });
    await expect(undoPayoutAdjustment('l1', 'oops')).rejects.toThrow('Only manual adjustments can be undone here');
  });

  it('throws if already voided', async () => {
    seedClubDoc('balanceLedger', 'l1', { reason: 'manual', delta: 10, voided: true });
    await expect(undoPayoutAdjustment('l1', 'oops')).rejects.toThrow('already been undone');
  });

  it('marks the entry voided with the given reason, and defaults undefined walletAdjustment to reversing the wallet', async () => {
    // Simulates a legacy 'manual' entry predating the walletAdjustment field.
    seedClubDoc('players', 'p1', { balance: 100 });
    seedClubDoc('balanceLedger', 'l1', { reason: 'manual', delta: 30, playerId: 'p1' });
    setCurrentUser({ uid: 'admin-1', displayName: 'Admin One', email: 'a@example.com' });

    await undoPayoutAdjustment('l1', 'Entered by mistake');

    const voided = getClubDocData('balanceLedger', 'l1')!;
    expect(voided.voided).toBe(true);
    expect(voided.voidedNote).toBe('Entered by mistake');
    expect(voided.voidedByUid).toBe('admin-1');

    // Wallet must be reversed: balance was bumped by +30 originally, so undoing subtracts 30 back.
    expect(getClubDocData('players', 'p1')?.balance).toBe(70);

    // A wallet-only reversal row must be logged too (not a second payout-ledger row).
    const reversalPaths = __getAllPaths().filter(p =>
      p.startsWith(`clubs/${TEST_CLUB_ID}/balanceLedger/`) && !p.endsWith('/l1')
    );
    expect(reversalPaths).toHaveLength(1);
    const reversal = getClubDocData('balanceLedger', reversalPaths[0].split('/').pop()!)!;
    expect(reversal.reason).toBe('manual-excluded');
    expect(reversal.delta).toBe(-30);
    expect(reversal.balanceBefore).toBe(100);
    expect(reversal.balanceAfter).toBe(70);
  });

  it('does not touch the wallet when walletAdjustment is explicitly false (a custom payout transaction)', async () => {
    seedClubDoc('players', 'p1', { balance: 100 });
    seedClubDoc('balanceLedger', 'l1', {
      reason: 'manual', delta: 30, playerId: 'p1', walletAdjustment: false,
    });

    await undoPayoutAdjustment('l1', 'Mistaken entry');

    expect(getClubDocData('players', 'p1')?.balance).toBe(100); // untouched
    const reversalPaths = __getAllPaths().filter(p =>
      p.startsWith(`clubs/${TEST_CLUB_ID}/balanceLedger/`) && !p.endsWith('/l1')
    );
    expect(reversalPaths).toHaveLength(0); // no wallet-reversal row logged
  });
});

describe('voidOwnerPayout', () => {
  it('requires a non-empty reason', async () => {
    seedClubDoc('payouts', 'o1', { amount: 50 });
    await expect(voidOwnerPayout('o1', '')).rejects.toThrow('reason for undoing this is required');
  });

  it('throws if the payout does not exist', async () => {
    await expect(voidOwnerPayout('missing', 'oops')).rejects.toThrow('Payout not found');
  });

  it('throws if already voided', async () => {
    seedClubDoc('payouts', 'o1', { amount: 50, voided: true });
    await expect(voidOwnerPayout('o1', 'oops')).rejects.toThrow('already been undone');
  });

  it('marks the payout voided with the given reason', async () => {
    seedClubDoc('payouts', 'o1', { amount: 50 });
    setCurrentUser({ uid: 'admin-2', displayName: 'Admin Two', email: null });

    await voidOwnerPayout('o1', 'Paid twice by mistake');

    const voided = getClubDocData('payouts', 'o1')!;
    expect(voided.voided).toBe(true);
    expect(voided.voidedNote).toBe('Paid twice by mistake');
    expect(voided.voidedByUid).toBe('admin-2');
  });
});

describe('payOwner', () => {
  it('throws when there is nothing to pay out', async () => {
    await expect(payOwner()).rejects.toThrow('Nothing to pay out');
  });

  it('pays out the full pending balance when no amount is given', async () => {
    seedClubDoc('balanceLedger', 'l1', { reason: 'payment', delta: 80, createdAt: ts('2026-01-01') });

    const paid = await payOwner('Weekly payout');
    expect(paid).toBe(80);

    const summary = await fetchOwnerPayoutSummary();
    expect(summary.totalPaid).toBe(80);
    expect(summary.pending).toBe(0);
  });

  it('rejects a custom amount of zero or less', async () => {
    seedClubDoc('balanceLedger', 'l1', { reason: 'payment', delta: 80, createdAt: ts('2026-01-01') });
    await expect(payOwner(undefined, 0)).rejects.toThrow('greater than zero');
    await expect(payOwner(undefined, -5)).rejects.toThrow('greater than zero');
  });

  it("rejects a custom amount exceeding the pending balance", async () => {
    seedClubDoc('balanceLedger', 'l1', { reason: 'payment', delta: 80, createdAt: ts('2026-01-01') });
    await expect(payOwner(undefined, 100)).rejects.toThrow("can't exceed the pending balance");
  });

  it('accepts a valid custom amount, reducing pending by that amount', async () => {
    seedClubDoc('balanceLedger', 'l1', { reason: 'payment', delta: 80, createdAt: ts('2026-01-01') });

    const paid = await payOwner(undefined, 30);
    expect(paid).toBe(30);

    const summary = await fetchOwnerPayoutSummary();
    expect(summary.pending).toBe(50);
  });

  it('recomputes the pending balance from fresh data inside the transaction, not the stale snapshot read before it', async () => {
    // $100 collected, one existing $30 payout already recorded (pending = $70
    // from the outer, non-transactional read used to size the request).
    seedClubDoc('balanceLedger', 'l1', { reason: 'payment', delta: 100, createdAt: ts('2026-01-01') });
    seedClubDoc('payouts', 'o1', { amount: 30 });

    const firestore = require('firebase/firestore');
    const originalGetDocs = firestore.getDocs;
    let triggered = false;
    const getDocsSpy = jest.spyOn(firestore, 'getDocs').mockImplementation(async (...args: unknown[]) => {
      // Set synchronously, before any await, so it fires on only the very
      // first of the several concurrent getDocs calls payOwner kicks off.
      const shouldTrigger = !triggered;
      triggered = true;
      const result = await originalGetDocs(...args);
      if (shouldTrigger) {
        // Simulate a concurrent admin voiding the existing payout —
        // reopening that $30 — in the gap right after payOwner's outer
        // reads but before its transaction re-reads the same payout doc.
        await voidOwnerPayout('o1', 'recorded by mistake');
      }
      return result;
    });

    const paid = await payOwner(); // no custom amount — pays "the full balance"
    getDocsSpy.mockRestore();

    // Must reflect the FRESH pending ($100, since the $30 payout is now
    // voided) rather than the stale $70 read before the concurrent void.
    expect(paid).toBe(100);
    const summary = await fetchOwnerPayoutSummary();
    expect(summary.pending).toBe(0);
  });
});

// Sanity check that the fake Firestore module is actually being used (not the real SDK).
describe('fake Firestore wiring', () => {
  it('refs.balanceLedger resolves under clubs/{TEST_CLUB_ID}/balanceLedger', () => {
    expect(refs.balanceLedger.path).toBe(`clubs/${TEST_CLUB_ID}/balanceLedger`);
  });

  it('getDocs is the fake implementation', async () => {
    const snap = await getDocs(refs.balanceLedger);
    expect(snap.empty).toBe(true);
  });
});
