import { fetchPlayerLedger } from '../attendance';
import { resetFirebaseTestState, seedClubDoc, ts } from '../../../test-utils/firebaseTestHelpers';

beforeEach(() => {
  resetFirebaseTestState();
});

describe('fetchPlayerLedger', () => {
  it('returns only the requested player entries, sorted newest first', async () => {
    seedClubDoc('balanceLedger', 'l1', {
      playerId: 'p1',
      sessionId: 's1',
      delta: 10,
      balanceBefore: 0,
      balanceAfter: 10,
      reason: 'payment',
      note: 'oldest',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    seedClubDoc('balanceLedger', 'l2', {
      playerId: 'p1',
      sessionId: 's2',
      delta: -5,
      balanceBefore: 10,
      balanceAfter: 5,
      reason: 'session',
      note: 'middle',
      createdAt: ts('2026-01-02'),
    });
    seedClubDoc('balanceLedger', 'l3', {
      playerId: 'p1',
      sessionId: null,
      delta: 20,
      balanceBefore: 5,
      balanceAfter: 25,
      reason: 'manual',
      note: 'newest',
      createdAt: new Date('2026-01-03T00:00:00.000Z'),
    });
    seedClubDoc('balanceLedger', 'l4', {
      playerId: 'p2',
      sessionId: null,
      delta: 999,
      balanceBefore: 0,
      balanceAfter: 999,
      reason: 'payment',
      note: 'other player',
      createdAt: ts('2026-01-04'),
    });
    seedClubDoc('balanceLedger', 'l5', {
      playerId: 'p1',
      sessionId: null,
      delta: 1,
      balanceBefore: 25,
      balanceAfter: 26,
      reason: 'manual',
      note: 'missing timestamp',
    });

    const ledger = await fetchPlayerLedger('p1');

    expect(ledger.map((entry) => entry.id)).toEqual(['l3', 'l2', 'l1', 'l5']);
    expect(ledger).toEqual([
      expect.objectContaining({ id: 'l3', playerId: 'p1', delta: 20, reason: 'manual', note: 'newest' }),
      expect.objectContaining({ id: 'l2', playerId: 'p1', delta: -5, reason: 'session', note: 'middle' }),
      expect.objectContaining({ id: 'l1', playerId: 'p1', delta: 10, reason: 'payment', note: 'oldest' }),
      expect.objectContaining({ id: 'l5', playerId: 'p1', delta: 1, reason: 'manual', note: 'missing timestamp' }),
    ]);
  });

  it('returns an empty array when the player has no ledger entries', async () => {
    seedClubDoc('balanceLedger', 'l1', {
      playerId: 'other-player',
      sessionId: null,
      delta: 10,
      balanceBefore: 0,
      balanceAfter: 10,
      reason: 'payment',
      createdAt: ts('2026-01-01'),
    });

    await expect(fetchPlayerLedger('p1')).resolves.toEqual([]);
  });
});
