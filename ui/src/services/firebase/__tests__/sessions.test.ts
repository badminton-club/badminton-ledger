import { addSession, editSession, fetchSessions } from '../sessions';
import type { NewSessionData } from '../sessions';
import {
  resetFirebaseTestState,
  seedClubDoc,
  getClubDocData,
  ts,
} from '../../../test-utils/firebaseTestHelpers';
import { __getAllPaths } from '../../../test-utils/fakeFirestore';

beforeEach(() => {
  resetFirebaseTestState();
});

function seedBirdieBatch(id: string, overrides: Record<string, unknown> = {}) {
  seedClubDoc('birdieInventory', id, {
    name: 'Batch A',
    costPerTube: 30,
    birdsPerTube: 12,
    unopenedTubesRemaining: 5,
    birdsInOpenTube: 0,
    ...overrides,
  });
}

function seedCourtBatch(id: string, overrides: Record<string, unknown> = {}) {
  seedClubDoc('courtCredits', id, {
    remainingHours: 10,
    costPerHour: 20,
    ...overrides,
  });
}

function seedPlayer(id: string, overrides: Record<string, unknown> = {}) {
  seedClubDoc('players', id, { balance: 0, owed: 0, sessionCount: 0, ...overrides });
}

function baseSessionData(overrides: Partial<NewSessionData> = {}): NewSessionData {
  return {
    date: new Date('2026-08-27T00:00:00.000Z'),
    courtCount: 1,
    totalCourtCost: 20,
    totalBirdieCost: 30,
    totalSessionCost: 50,
    birdieUsage: [],
    courtCreditUsage: [],
    players: [],
    ...overrides,
  };
}

function ledgerEntriesFor(playerId: string) {
  return __getAllPaths()
    .filter(p => p.includes('/balanceLedger/'))
    .map(p => getClubDocData('balanceLedger', p.split('/').pop()!)!)
    .filter(e => e.playerId === playerId);
}

describe('addSession', () => {
  it('creates the session document and deducts birdie/court inventory', async () => {
    seedBirdieBatch('b1');
    seedCourtBatch('c1');

    const sessionId = await addSession(baseSessionData({
      birdieUsage: [{ id: 'b1', quantity: 24 }],
      courtCreditUsage: [{ id: 'c1', hoursUsed: 3 }],
    }));

    const session = getClubDocData('sessions', sessionId)!;
    expect(session.courtCount).toBe(1);

    const birdie = getClubDocData('birdieInventory', 'b1')!;
    expect(birdie.unopenedTubesRemaining).toBe(3); // 5 tubes (60 birds) - 24 used = 36 -> 3 tubes
    expect(birdie.birdsInOpenTube).toBe(0);

    const court = getClubDocData('courtCredits', 'c1')!;
    expect(court.remainingHours).toBe(7);
  });

  it('logs a transaction record for each resource used', async () => {
    seedBirdieBatch('b1');
    seedCourtBatch('c1');

    await addSession(baseSessionData({
      birdieUsage: [{ id: 'b1', quantity: 12 }],
      courtCreditUsage: [{ id: 'c1', hoursUsed: 2 }],
    }));

    const txns = __getAllPaths()
      .filter(p => p.includes('/transactions/'))
      .map(p => getClubDocData('transactions', p.split('/').pop()!)!);
    expect(txns).toHaveLength(2);
    const birdieTxn = txns.find(t => t.resourceType === 'birdie')!;
    expect(birdieTxn.cost).toBe(30); // 12/12 tubes * $30
    const courtTxn = txns.find(t => t.resourceType === 'court')!;
    expect(courtTxn.cost).toBe(40); // 2 hrs * $20
  });

  it('throws when requesting more birds than available, without writing anything', async () => {
    seedBirdieBatch('b1', { unopenedTubesRemaining: 1, birdsPerTube: 12, birdsInOpenTube: 0 });

    await expect(addSession(baseSessionData({
      birdieUsage: [{ id: 'b1', quantity: 100 }],
    }))).rejects.toThrow('only 12 birds available');

    expect(getClubDocData('birdieInventory', 'b1')?.unopenedTubesRemaining).toBe(1); // untouched
  });

  it('throws when requesting more court hours than available', async () => {
    seedCourtBatch('c1', { remainingHours: 2 });
    await expect(addSession(baseSessionData({
      courtCreditUsage: [{ id: 'c1', hoursUsed: 5 }],
    }))).rejects.toThrow('only 2 hrs left');
  });

  it('auto-settles a player from a sufficient positive prepaid balance', async () => {
    seedPlayer('p1', { balance: 50 });

    const sessionId = await addSession(baseSessionData({
      players: [{ id: 'p1', percentage: 100, cost: 20, paid: false, highlighted: false }],
    }));

    const session = getClubDocData('sessions', sessionId)!;
    const player = (session.players as any[])[0];
    expect(player.paid).toBe(true);
    expect(player.paidVia).toBe('balance');

    expect(getClubDocData('players', 'p1')?.balance).toBe(30); // 50 - 20
    expect(getClubDocData('players', 'p1')?.sessionCount).toBe(1);

    const ledger = ledgerEntriesFor('p1');
    expect(ledger).toHaveLength(1);
    expect(ledger[0].delta).toBe(-20);
    expect(ledger[0].reason).toBe('session');
  });

  it('does not auto-settle from balance when the player is already paid/comped', async () => {
    seedPlayer('p1', { balance: 50 });

    await addSession(baseSessionData({
      players: [{ id: 'p1', percentage: 100, cost: 20, paid: true, paidVia: 'etransfer', highlighted: false }],
    }));

    // Balance must be untouched — this player already settled by e-transfer, not balance.
    expect(getClubDocData('players', 'p1')?.balance).toBe(50);
    expect(ledgerEntriesFor('p1')).toHaveLength(0);
  });

  it('leaves an unpaid player owing the session cost', async () => {
    seedPlayer('p1', { balance: 0 });

    const sessionId = await addSession(baseSessionData({
      players: [{ id: 'p1', percentage: 100, cost: 15, paid: false, highlighted: false }],
    }));

    const session = getClubDocData('sessions', sessionId)!;
    expect((session.players as any[])[0].paid).toBe(false);
    expect(getClubDocData('players', 'p1')?.owed).toBe(15);
  });

  it('draws from a payer\'s balance for a "transfer" settlement covering another player', async () => {
    seedPlayer('payer', { balance: 100 });
    seedPlayer('payee', { balance: 0 });

    await addSession(baseSessionData({
      players: [
        { id: 'payee', percentage: 100, cost: 25, paid: true, paidVia: 'transfer', paidBy: 'payer', highlighted: false },
      ],
    }));

    expect(getClubDocData('players', 'payer')?.balance).toBe(75);
    expect(getClubDocData('players', 'payee')?.balance).toBe(0); // payee's own balance untouched
    expect(getClubDocData('players', 'payee')?.owed).toBe(0); // not owing — covered

    const payerLedger = ledgerEntriesFor('payer');
    expect(payerLedger).toHaveLength(1);
    expect(payerLedger[0].delta).toBe(-25);
    expect(payerLedger[0].note).toMatch(/Covered a player's dues/);
  });

  it('throws when a payer cannot cover what is drawn from their balance via transfer', async () => {
    seedPlayer('payer', { balance: 5 });
    seedPlayer('payee', { balance: 0 });

    await expect(addSession(baseSessionData({
      players: [
        { id: 'payee', percentage: 100, cost: 25, paid: true, paidVia: 'transfer', paidBy: 'payer', highlighted: false },
      ],
    }))).rejects.toThrow(/has \$5.00 but \$25.00 was drawn/);
  });

  it('throws if a referenced player does not exist', async () => {
    await expect(addSession(baseSessionData({
      players: [{ id: 'ghost', percentage: 100, cost: 10, paid: false, highlighted: false }],
    }))).rejects.toThrow('Player ghost not found');
  });
});

describe('editSession', () => {
  it('throws if the session does not exist', async () => {
    await expect(editSession('missing', baseSessionData())).rejects.toThrow('Session missing not found');
  });

  it('adjusts birdie inventory by the delta between old and new usage', async () => {
    seedBirdieBatch('b1', { unopenedTubesRemaining: 5, birdsPerTube: 12, birdsInOpenTube: 0 }); // 60 available
    const sessionId = await addSession(baseSessionData({ birdieUsage: [{ id: 'b1', quantity: 12 }] }));
    // After creation: 60 - 12 = 48 -> 4 tubes, 0 open.
    expect(getClubDocData('birdieInventory', 'b1')?.unopenedTubesRemaining).toBe(4);

    await editSession(sessionId, baseSessionData({ birdieUsage: [{ id: 'b1', quantity: 24 }] }));
    // Delta is +12 more used: 48 - 12 = 36 -> 3 tubes.
    expect(getClubDocData('birdieInventory', 'b1')?.unopenedTubesRemaining).toBe(3);
  });

  it('refunds birdies when usage decreases on edit', async () => {
    seedBirdieBatch('b1', { unopenedTubesRemaining: 5, birdsPerTube: 12, birdsInOpenTube: 0 });
    const sessionId = await addSession(baseSessionData({ birdieUsage: [{ id: 'b1', quantity: 24 }] }));
    expect(getClubDocData('birdieInventory', 'b1')?.unopenedTubesRemaining).toBe(3); // 60-24=36 -> 3 tubes

    await editSession(sessionId, baseSessionData({ birdieUsage: [{ id: 'b1', quantity: 12 }] }));
    // Delta -12: 36+12=48 -> 4 tubes
    expect(getClubDocData('birdieInventory', 'b1')?.unopenedTubesRemaining).toBe(4);
  });

  it('throws when an edit would require more birds than remain', async () => {
    seedBirdieBatch('b1', { unopenedTubesRemaining: 1, birdsPerTube: 12, birdsInOpenTube: 0 }); // 12 available
    const sessionId = await addSession(baseSessionData({ birdieUsage: [{ id: 'b1', quantity: 12 }] }));
    // Inventory now at 0.
    await expect(editSession(sessionId, baseSessionData({
      birdieUsage: [{ id: 'b1', quantity: 24 }],
    }))).rejects.toThrow('insufficient birds for edit');
  });

  it('adjusts court credit hours by the delta and logs an adjustment transaction', async () => {
    seedCourtBatch('c1', { remainingHours: 10 });
    const sessionId = await addSession(baseSessionData({ courtCreditUsage: [{ id: 'c1', hoursUsed: 2 }] }));
    expect(getClubDocData('courtCredits', 'c1')?.remainingHours).toBe(8);

    await editSession(sessionId, baseSessionData({ courtCreditUsage: [{ id: 'c1', hoursUsed: 5 }] }));
    expect(getClubDocData('courtCredits', 'c1')?.remainingHours).toBe(5); // 8 - (5-2)

    const adjustmentTxns = __getAllPaths()
      .filter(p => p.includes('/transactions/'))
      .map(p => getClubDocData('transactions', p.split('/').pop()!)!)
      .filter(t => t.description === 'Session Edit Adjustment' && t.resourceType === 'court');
    expect(adjustmentTxns).toHaveLength(1);
    expect(adjustmentTxns[0].hoursUsed).toBe(3);
  });

  it('adjusts a player\'s wallet/owed when their settlement method changes between edits', async () => {
    // Seeded with 0 balance so addSession doesn't auto-settle them from balance —
    // the point here is exercising editSession's owed->balance transition, not
    // addSession's auto-settle behavior (already covered above).
    seedPlayer('p1', { balance: 0, owed: 0 });
    const sessionId = await addSession(baseSessionData({
      players: [{ id: 'p1', percentage: 100, cost: 20, paid: false, highlighted: false }],
    }));
    expect(getClubDocData('players', 'p1')?.owed).toBe(20);
    expect(getClubDocData('players', 'p1')?.balance).toBe(0);

    // Simulates the player topping up their wallet after the session was created.
    seedPlayer('p1', { balance: 100, owed: 20 });

    // Edit: now settle via balance instead of owing.
    await editSession(sessionId, baseSessionData({
      players: [{ id: 'p1', percentage: 100, cost: 20, paid: true, paidVia: 'balance', highlighted: false }],
    }));

    expect(getClubDocData('players', 'p1')?.balance).toBe(80); // drawn once
    expect(getClubDocData('players', 'p1')?.owed).toBe(0); // no longer owing
  });

  it('logs a wallet-neutral payment-delta entry when a settled e-transfer cost changes', async () => {
    seedPlayer('p1', { balance: 0 });
    const sessionId = await addSession(baseSessionData({
      players: [{ id: 'p1', percentage: 100, cost: 20, paid: true, paidVia: 'etransfer', highlighted: false }],
    }));

    await editSession(sessionId, baseSessionData({
      players: [{ id: 'p1', percentage: 100, cost: 35, paid: true, paidVia: 'etransfer', highlighted: false }],
    }));

    // Balance must remain untouched — e-transfer never draws the wallet.
    expect(getClubDocData('players', 'p1')?.balance).toBe(0);

    const ledger = ledgerEntriesFor('p1');
    const paymentDeltaEntry = ledger.find(e => e.reason === 'payment' && e.note === 'Session edit adjustment');
    expect(paymentDeltaEntry?.delta).toBe(15); // 35 - 20
    expect(paymentDeltaEntry?.balanceBefore).toBe(paymentDeltaEntry?.balanceAfter); // wallet-neutral
  });

  it('throws if increasing a balance draw would exceed what the player has available', async () => {
    seedPlayer('p1', { balance: 20 });
    const sessionId = await addSession(baseSessionData({
      players: [{ id: 'p1', percentage: 100, cost: 20, paid: true, paidVia: 'balance', highlighted: false }],
    }));
    expect(getClubDocData('players', 'p1')?.balance).toBe(0);

    // Available = 0 (current) + 20 (refund of the old draw) = 20; new draw of 25 exceeds it.
    await expect(editSession(sessionId, baseSessionData({
      players: [{ id: 'p1', percentage: 100, cost: 25, paid: true, paidVia: 'balance', highlighted: false }],
    }))).rejects.toThrow(/available but \$25.00 was drawn/);
  });

  it('bumps sessionCount only for players newly added to the session on edit', async () => {
    seedPlayer('p1', { sessionCount: 1 });
    seedPlayer('p2', { sessionCount: 0 });
    const sessionId = await addSession(baseSessionData({
      players: [{ id: 'p1', percentage: 100, cost: 10, paid: false, highlighted: false }],
    }));
    expect(getClubDocData('players', 'p1')?.sessionCount).toBe(2);

    await editSession(sessionId, baseSessionData({
      players: [
        { id: 'p1', percentage: 50, cost: 10, paid: false, highlighted: false },
        { id: 'p2', percentage: 50, cost: 10, paid: false, highlighted: false },
      ],
    }));

    expect(getClubDocData('players', 'p2')?.sessionCount).toBe(1); // newly added
    expect(getClubDocData('players', 'p1')?.sessionCount).toBe(2); // unchanged — still a member
  });
});

describe('fetchSessions', () => {
  it('returns sessions converted to JS Date, sorted by the requested order', async () => {
    seedClubDoc('sessions', 's1', { date: ts('2026-01-01'), players: [], birdieUsage: [], courtCreditUsage: [] });
    seedClubDoc('sessions', 's2', { date: ts('2026-06-01'), players: [], birdieUsage: [], courtCreditUsage: [] });

    const desc = await fetchSessions({ orderDirection: 'desc' });
    expect(desc.map(s => s.id)).toEqual(['s2', 's1']);
    expect(desc[0].date).toBeInstanceOf(Date);

    const asc = await fetchSessions({ orderDirection: 'asc' });
    expect(asc.map(s => s.id)).toEqual(['s1', 's2']);
  });

  it('respects limitCount', async () => {
    seedClubDoc('sessions', 's1', { date: ts('2026-01-01'), players: [], birdieUsage: [], courtCreditUsage: [] });
    seedClubDoc('sessions', 's2', { date: ts('2026-06-01'), players: [], birdieUsage: [], courtCreditUsage: [] });

    const result = await fetchSessions({ orderDirection: 'desc', limitCount: 1 });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('s2');
  });

  it('filters by startDate/endDate range (inclusive)', async () => {
    seedClubDoc('sessions', 's1', { date: ts('2026-01-01'), players: [], birdieUsage: [], courtCreditUsage: [] });
    seedClubDoc('sessions', 's2', { date: ts('2026-06-01'), players: [], birdieUsage: [], courtCreditUsage: [] });
    seedClubDoc('sessions', 's3', { date: ts('2026-12-01'), players: [], birdieUsage: [], courtCreditUsage: [] });

    const inRange = await fetchSessions({
      startDate: new Date('2026-02-01'),
      endDate: new Date('2026-07-01'),
      orderDirection: 'asc',
    });
    expect(inRange.map(s => s.id)).toEqual(['s2']);

    // Boundaries are inclusive.
    const boundary = await fetchSessions({
      startDate: new Date('2026-01-01'),
      endDate: new Date('2026-01-01'),
    });
    expect(boundary.map(s => s.id)).toEqual(['s1']);
  });
});
