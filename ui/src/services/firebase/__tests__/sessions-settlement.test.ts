import {
  deleteSession,
  fetchSessionById,
  fetchSessions,
  setPlayerPaidBy,
  setPlayerSettlement,
  togglePlayerCompStatus,
  togglePlayerHighlightStatus,
  togglePlayerPaidStatus,
} from '../sessions';
import * as firestore from 'firebase/firestore';
import {
  getClubDocData,
  resetFirebaseTestState,
  seedClubDoc,
  TEST_CLUB_ID,
  ts,
} from '../../../test-utils/firebaseTestHelpers';
import { __getAllPaths, Timestamp } from '../../../test-utils/fakeFirestore';

beforeEach(() => {
  resetFirebaseTestState();
});

function collectionDocIds(collectionName: string): string[] {
  return __getAllPaths()
    .filter(path => path.startsWith(`clubs/${TEST_CLUB_ID}/${collectionName}/`))
    .map(path => path.split('/').pop()!);
}

function collectionDocs(collectionName: string): Array<Record<string, unknown>> {
  return collectionDocIds(collectionName).map(id => getClubDocData(collectionName as any, id)!);
}

function balanceLedgerEntries(): Array<Record<string, unknown>> {
  return collectionDocs('balanceLedger');
}

function seedPlayer(id: string, data: Record<string, unknown> = {}): void {
  seedClubDoc('players', id, {
    firstName: id,
    lastName: null,
    balance: 0,
    owed: 0,
    sessionCount: 0,
    createdAt: ts('2026-01-01'),
    ...data,
  });
}

function seedSession(id: string, data: Record<string, unknown> = {}): void {
  seedClubDoc('sessions', id, {
    id,
    date: ts('2026-08-20'),
    location: 'Community Centre',
    durationHours: 2,
    courtCount: 2,
    totalCourtCost: 40,
    totalBirdieCost: 20,
    totalSessionCost: 60,
    birdieUsage: [],
    courtCreditUsage: [],
    players: [],
    createdAt: ts('2026-08-20'),
    ...data,
  });
}

describe('fetchSessions', () => {
  it('returns sessions newest first by default and converts Timestamp dates to Date', async () => {
    seedSession('early', { date: ts('2026-01-10') });
    seedSession('middle', { date: ts('2026-02-10') });
    seedSession('late', { date: ts('2026-03-10') });

    const sessions = await fetchSessions();

    expect(sessions.map(session => session.id)).toEqual(['late', 'middle', 'early']);
    expect(sessions.every(session => session.date instanceof Date)).toBe(true);
    expect(sessions.map(session => session.date.toISOString().slice(0, 10))).toEqual([
      '2026-03-10',
      '2026-02-10',
      '2026-01-10',
    ]);
  });

  it('passes startDate/endDate constraints and honors orderDirection + limitCount', async () => {
    seedSession('jan', { date: ts('2026-01-10') });
    seedSession('feb', { date: ts('2026-02-10') });
    seedSession('mar', { date: ts('2026-03-10') });
    seedSession('apr', { date: ts('2026-04-10') });

    const getDocsSpy = jest.spyOn(firestore, 'getDocs');

    const sessions = await fetchSessions({
      startDate: new Date('2026-02-01'),
      endDate: new Date('2026-04-10'),
      orderDirection: 'desc',
      limitCount: 2,
    });

    expect(sessions.map(session => session.id)).toEqual(['apr', 'mar']);

    const target = getDocsSpy.mock.calls[0][0] as unknown as { constraints: Array<Record<string, unknown>> };
    expect(target.constraints).toEqual([
      expect.objectContaining({
        __type: 'where',
        field: 'date',
        op: '>=',
        value: expect.any(Timestamp),
      }),
      expect.objectContaining({
        __type: 'where',
        field: 'date',
        op: '<=',
        value: expect.any(Timestamp),
      }),
      expect.objectContaining({
        __type: 'orderBy',
        field: 'date',
        direction: 'desc',
      }),
      expect.objectContaining({
        __type: 'limit',
        n: 2,
      }),
    ]);
    expect((target.constraints[0].value as Timestamp).toMillis()).toBe(ts('2026-02-01').toMillis());
    expect((target.constraints[1].value as Timestamp).toMillis()).toBe(ts('2026-04-10').toMillis());
  });
});

describe('fetchSessionById', () => {
  it('returns a single session and converts its date to a Date', async () => {
    seedSession('s-1', { date: ts('2026-05-01') });

    const session = await fetchSessionById('s-1');

    expect(session).toMatchObject({ id: 's-1', location: 'Community Centre' });
    expect(session.date).toBeInstanceOf(Date);
    expect(session.date.toISOString().slice(0, 10)).toBe('2026-05-01');
  });

  it('throws when the session does not exist', async () => {
    await expect(fetchSessionById('missing')).rejects.toThrow('Session missing not found');
  });
});

describe('togglePlayerPaidStatus', () => {
  it('toggles unpaid -> paid -> unpaid with net-zero balance over the cycle', async () => {
    seedPlayer('p1', { balance: 10 });
    seedSession('s1', {
      players: [{ id: 'p1', percentage: 100, cost: 20, paid: false, comped: false, highlighted: false }],
    });

    await togglePlayerPaidStatus('s1', 'p1');

    expect(getClubDocData('players', 'p1')?.balance).toBe(30);
    expect(getClubDocData('sessions', 's1')?.players).toEqual([
      expect.objectContaining({ id: 'p1', paid: true, comped: false, paidVia: 'etransfer' }),
    ]);
    expect(balanceLedgerEntries()).toEqual([
      expect.objectContaining({ playerId: 'p1', sessionId: 's1', delta: 20, reason: 'payment', note: 'Marked paid' }),
    ]);

    await togglePlayerPaidStatus('s1', 'p1');

    expect(getClubDocData('players', 'p1')?.balance).toBe(10);
    expect(getClubDocData('sessions', 's1')?.players).toEqual([
      expect.objectContaining({ id: 'p1', paid: false, comped: false, paidVia: null }),
    ]);
    expect(balanceLedgerEntries()).toEqual([
      expect.objectContaining({ delta: 20, reason: 'payment', note: 'Marked paid' }),
      expect.objectContaining({ delta: -20, reason: 'payment', note: 'Marked unpaid' }),
    ]);
  });

  it('infers a legacy comped player and reverses the comp before marking them paid', async () => {
    seedPlayer('p1', { balance: 50 });
    seedSession('s1', {
      players: [{ id: 'p1', percentage: 100, cost: 20, paid: false, comped: true, highlighted: false }],
    });

    await togglePlayerPaidStatus('s1', 'p1');

    expect(getClubDocData('players', 'p1')?.balance).toBe(50);
    expect(getClubDocData('sessions', 's1')?.players).toEqual([
      expect.objectContaining({ id: 'p1', paid: true, comped: false, paidVia: 'etransfer' }),
    ]);
    expect(balanceLedgerEntries()).toEqual([
      expect.objectContaining({ delta: -20, reason: 'comp', note: 'Reversed — marked paid to club' }),
      expect.objectContaining({ delta: 20, reason: 'payment', note: 'Marked paid' }),
    ]);
  });

  it('throws for missing session, missing player, and player not in the session', async () => {
    seedPlayer('p1');
    seedSession('s1', { players: [] });

    await expect(togglePlayerPaidStatus('missing', 'p1')).rejects.toThrow('Session missing not found');
    await expect(togglePlayerPaidStatus('s1', 'missing')).rejects.toThrow('Player missing not found');
    await expect(togglePlayerPaidStatus('s1', 'p1')).rejects.toThrow('Player p1 not in session s1');
  });
});

describe('togglePlayerCompStatus', () => {
  it('toggles uncomped -> comped -> uncomped with net-zero balance over the cycle', async () => {
    seedPlayer('p1', { balance: 10 });
    seedSession('s1', {
      players: [{ id: 'p1', percentage: 100, cost: 20, paid: false, comped: false, highlighted: false }],
    });

    await togglePlayerCompStatus('s1', 'p1');

    expect(getClubDocData('players', 'p1')?.balance).toBe(30);
    expect(getClubDocData('sessions', 's1')?.players).toEqual([
      expect.objectContaining({ id: 'p1', paid: false, comped: true, paidVia: 'comp' }),
    ]);
    expect(balanceLedgerEntries()).toEqual([
      expect.objectContaining({
        delta: 20,
        reason: 'comp',
        note: 'Comped — player paid owner directly',
      }),
    ]);

    await togglePlayerCompStatus('s1', 'p1');

    expect(getClubDocData('players', 'p1')?.balance).toBe(10);
    expect(getClubDocData('sessions', 's1')?.players).toEqual([
      expect.objectContaining({ id: 'p1', paid: false, comped: false, paidVia: null }),
    ]);
    expect(balanceLedgerEntries()).toEqual([
      expect.objectContaining({ delta: 20, reason: 'comp', note: 'Comped — player paid owner directly' }),
      expect.objectContaining({ delta: -20, reason: 'comp', note: 'Comp removed' }),
    ]);
  });

  it('infers a legacy paid player and reverses the payment before comping them', async () => {
    seedPlayer('p1', { balance: 50 });
    seedSession('s1', {
      players: [{ id: 'p1', percentage: 100, cost: 20, paid: true, highlighted: false }],
    });

    await togglePlayerCompStatus('s1', 'p1');

    expect(getClubDocData('players', 'p1')?.balance).toBe(50);
    expect(getClubDocData('sessions', 's1')?.players).toEqual([
      expect.objectContaining({ id: 'p1', paid: false, comped: true, paidVia: 'comp' }),
    ]);
    expect(balanceLedgerEntries()).toEqual([
      expect.objectContaining({ delta: -20, reason: 'payment', note: 'Reversed — paid owner directly (comp)' }),
      expect.objectContaining({ delta: 20, reason: 'comp', note: 'Comped — player paid owner directly' }),
    ]);
  });

  it('throws for missing session, missing player, and player not in the session', async () => {
    seedPlayer('p1');
    seedSession('s1', { players: [] });

    await expect(togglePlayerCompStatus('missing', 'p1')).rejects.toThrow('Session missing not found');
    await expect(togglePlayerCompStatus('s1', 'missing')).rejects.toThrow('Player missing not found');
    await expect(togglePlayerCompStatus('s1', 'p1')).rejects.toThrow('Player p1 not in session s1');
  });
});

describe('setPlayerSettlement', () => {
  it('only moves the wallet for the balance method and nets out correctly when switching methods', async () => {
    seedPlayer('p1', { balance: 100, owed: 20 });
    seedSession('s1', {
      players: [{ id: 'p1', percentage: 100, cost: 20, paid: false, comped: false, highlighted: false }],
    });

    await setPlayerSettlement('s1', 'p1', 'etransfer');
    expect(getClubDocData('players', 'p1')).toMatchObject({ balance: 100, owed: 0 });
    expect(getClubDocData('sessions', 's1')?.players).toEqual([
      expect.objectContaining({ id: 'p1', paid: true, comped: false, paidVia: 'etransfer', paidBy: null }),
    ]);

    await setPlayerSettlement('s1', 'p1', 'balance');
    expect(getClubDocData('players', 'p1')).toMatchObject({ balance: 80, owed: 0 });
    expect(getClubDocData('sessions', 's1')?.players).toEqual([
      expect.objectContaining({ id: 'p1', paid: true, comped: false, paidVia: 'balance', paidBy: null }),
    ]);

    await setPlayerSettlement('s1', 'p1', 'comp');
    expect(getClubDocData('players', 'p1')).toMatchObject({ balance: 100, owed: 0 });
    expect(getClubDocData('sessions', 's1')?.players).toEqual([
      expect.objectContaining({ id: 'p1', paid: false, comped: true, paidVia: 'comp', paidBy: null }),
    ]);

    await setPlayerSettlement('s1', 'p1', null);
    expect(getClubDocData('players', 'p1')).toMatchObject({ balance: 100, owed: 20 });
    expect(getClubDocData('sessions', 's1')?.players).toEqual([
      expect.objectContaining({ id: 'p1', paid: false, comped: false, paidVia: null, paidBy: null }),
    ]);

    expect(balanceLedgerEntries()).toEqual([
      expect.objectContaining({ delta: 20, reason: 'payment', balanceBefore: 100, balanceAfter: 100, note: 'Paid by e-Transfer' }),
      expect.objectContaining({ delta: -20, reason: 'payment', balanceBefore: 100, balanceAfter: 100, note: 'Reversed e-Transfer payment' }),
      expect.objectContaining({ delta: -20, reason: 'settlement', balanceBefore: 100, balanceAfter: 80, note: expect.stringContaining('Settled from prepaid balance') }),
      expect.objectContaining({ delta: 20, reason: 'comp', balanceBefore: 80, balanceAfter: 80, note: 'Comped — player paid owner directly' }),
      expect.objectContaining({ delta: 20, reason: 'settlement', balanceBefore: 80, balanceAfter: 100, note: expect.stringContaining('Refunded prepaid balance') }),
      expect.objectContaining({ delta: -20, reason: 'comp', balanceBefore: 100, balanceAfter: 100, note: 'Reversed comp' }),
    ]);
  });

  it('infers a legacy paid player when switching them to balance settlement', async () => {
    seedPlayer('p1', { balance: 40, owed: 0 });
    seedSession('s1', {
      players: [{ id: 'p1', percentage: 100, cost: 10, paid: true, highlighted: false }],
    });

    await setPlayerSettlement('s1', 'p1', 'balance');

    expect(getClubDocData('players', 'p1')).toMatchObject({ balance: 30, owed: 0 });
    expect(getClubDocData('sessions', 's1')?.players).toEqual([
      expect.objectContaining({ id: 'p1', paid: true, comped: false, paidVia: 'balance', paidBy: null }),
    ]);
    expect(balanceLedgerEntries()).toEqual([
      expect.objectContaining({ delta: -10, reason: 'payment', note: 'Reversed e-Transfer payment' }),
      expect.objectContaining({ delta: -10, reason: 'settlement', note: expect.stringContaining('Settled from prepaid balance') }),
    ]);
  });

  it('refunds a previous transfer payer when changing the payee back to unpaid', async () => {
    seedPlayer('payee', { balance: 5, owed: 0 });
    seedPlayer('payer', { balance: 30, owed: 0 });
    seedSession('s1', {
      players: [{
        id: 'payee',
        percentage: 100,
        cost: 12,
        paid: true,
        paidVia: 'transfer',
        paidBy: 'payer',
        comped: false,
        highlighted: false,
      }],
    });

    await setPlayerSettlement('s1', 'payee', null);

    expect(getClubDocData('players', 'payee')).toMatchObject({ balance: 5, owed: 12 });
    expect(getClubDocData('players', 'payer')).toMatchObject({ balance: 42, owed: 0 });
    expect(getClubDocData('sessions', 's1')?.players).toEqual([
      expect.objectContaining({ id: 'payee', paid: false, comped: false, paidVia: null, paidBy: null }),
    ]);
    expect(balanceLedgerEntries()).toEqual([
      expect.objectContaining({
        playerId: 'payer',
        delta: 12,
        reason: 'settlement',
        note: expect.stringContaining('Refunded — no longer covering another player'),
      }),
    ]);
  });

  it('throws for transfer, missing session, missing player, and player not in the session', async () => {
    seedPlayer('p1');
    seedSession('s1', { players: [] });

    await expect(setPlayerSettlement('s1', 'p1', 'transfer')).rejects.toThrow('Use setPlayerPaidBy');
    await expect(setPlayerSettlement('missing', 'p1', null)).rejects.toThrow('Session missing not found');
    await expect(setPlayerSettlement('s1', 'missing', null)).rejects.toThrow('Player missing not in session s1');

    seedSession('s2', {
      players: [{ id: 'missing-player-doc', percentage: 100, cost: 10, paid: false, comped: false, highlighted: false }],
    });
    await expect(setPlayerSettlement('s2', 'missing-player-doc', 'balance')).rejects.toThrow('Player missing-player-doc not found');
  });
});

describe('setPlayerPaidBy', () => {
  it('moves coverage between payers and refunds the old payer exactly once', async () => {
    seedPlayer('payee', { firstName: 'Payee', lastName: 'Player', balance: 0, owed: 18 });
    seedPlayer('payer-1', { firstName: 'Payer', lastName: 'One', balance: 50 });
    seedPlayer('payer-2', { firstName: 'Payer', lastName: 'Two', balance: 40 });
    seedSession('s1', {
      players: [{ id: 'payee', percentage: 100, cost: 18, paid: false, comped: false, highlighted: false }],
    });

    await setPlayerPaidBy('s1', 'payee', 'payer-1');

    expect(getClubDocData('players', 'payee')).toMatchObject({ owed: 0, balance: 0 });
    expect(getClubDocData('players', 'payer-1')).toMatchObject({ balance: 32 });
    expect(getClubDocData('sessions', 's1')?.players).toEqual([
      expect.objectContaining({ id: 'payee', paid: true, comped: false, paidVia: 'transfer', paidBy: 'payer-1' }),
    ]);

    await setPlayerPaidBy('s1', 'payee', 'payer-2');

    expect(getClubDocData('players', 'payer-1')).toMatchObject({ balance: 50 });
    expect(getClubDocData('players', 'payer-2')).toMatchObject({ balance: 22 });
    expect(getClubDocData('sessions', 's1')?.players).toEqual([
      expect.objectContaining({ id: 'payee', paidVia: 'transfer', paidBy: 'payer-2' }),
    ]);

    await setPlayerPaidBy('s1', 'payee', 'payer-1');

    expect(getClubDocData('players', 'payer-1')).toMatchObject({ balance: 32 });
    expect(getClubDocData('players', 'payer-2')).toMatchObject({ balance: 40 });
    expect(getClubDocData('sessions', 's1')?.players).toEqual([
      expect.objectContaining({ id: 'payee', paidVia: 'transfer', paidBy: 'payer-1' }),
    ]);
    expect(balanceLedgerEntries()).toEqual([
      expect.objectContaining({ playerId: 'payer-1', delta: -18, reason: 'session', note: expect.stringContaining("Covered Payee Player's dues") }),
      expect.objectContaining({ playerId: 'payer-1', delta: 18, reason: 'settlement', note: expect.stringContaining('Refunded — no longer covering another player') }),
      expect.objectContaining({ playerId: 'payer-2', delta: -18, reason: 'session', note: expect.stringContaining("Covered Payee Player's dues") }),
      expect.objectContaining({ playerId: 'payer-2', delta: 18, reason: 'settlement', note: expect.stringContaining('Refunded — no longer covering another player') }),
      expect.objectContaining({ playerId: 'payer-1', delta: -18, reason: 'session', note: expect.stringContaining("Covered Payee Player's dues") }),
    ]);
  });

  it('infers a legacy paid player and reverses the old payment before charging the new payer', async () => {
    seedPlayer('payee', { firstName: 'Sam', lastName: 'Lee', balance: 10, owed: 0 });
    seedPlayer('payer', { balance: 25 });
    seedSession('s1', {
      players: [{ id: 'payee', percentage: 100, cost: 10, paid: true, highlighted: false }],
    });

    await setPlayerPaidBy('s1', 'payee', 'payer');

    expect(getClubDocData('players', 'payee')).toMatchObject({ balance: 10, owed: 0 });
    expect(getClubDocData('players', 'payer')).toMatchObject({ balance: 15 });
    expect(getClubDocData('sessions', 's1')?.players).toEqual([
      expect.objectContaining({ id: 'payee', paidVia: 'transfer', paidBy: 'payer', paid: true, comped: false }),
    ]);
    expect(balanceLedgerEntries()).toEqual([
      expect.objectContaining({ playerId: 'payee', delta: -10, reason: 'payment', note: 'Reversed e-Transfer payment', balanceBefore: 0, balanceAfter: 0 }),
      expect.objectContaining({ playerId: 'payer', delta: -10, reason: 'session', note: expect.stringContaining("Covered Sam Lee's dues") }),
    ]);
  });

  it('throws for self-payment, missing session, missing payee, missing payer, and payee not in the session', async () => {
    seedPlayer('payee');
    seedPlayer('payer');
    seedSession('s1', { players: [] });

    await expect(setPlayerPaidBy('s1', 'payee', 'payee')).rejects.toThrow('cannot cover their own dues');
    await expect(setPlayerPaidBy('missing', 'payee', 'payer')).rejects.toThrow('Session missing not found');
    await expect(setPlayerPaidBy('s1', 'missing', 'payer')).rejects.toThrow('Player missing not in session s1');

    seedSession('s2', {
      players: [{ id: 'payee', percentage: 100, cost: 10, paid: false, comped: false, highlighted: false }],
    });
    await expect(setPlayerPaidBy('s2', 'payee', 'missing')).rejects.toThrow('Paying player missing not found');

    seedSession('s3', {
      players: [{ id: 'missing-player-doc', percentage: 100, cost: 10, paid: false, comped: false, highlighted: false }],
    });
    await expect(setPlayerPaidBy('s3', 'missing-player-doc', 'payer')).rejects.toThrow('Player missing-player-doc not found');
  });
});

describe('togglePlayerHighlightStatus', () => {
  it('toggles the highlighted flag without affecting settlement data', async () => {
    seedSession('s1', {
      players: [
        { id: 'p1', percentage: 50, cost: 10, paid: true, paidVia: 'etransfer', highlighted: false },
        { id: 'p2', percentage: 50, cost: 10, paid: false, comped: false, highlighted: true },
      ],
    });

    await togglePlayerHighlightStatus('s1', 'p1');
    expect(getClubDocData('sessions', 's1')?.players).toEqual([
      expect.objectContaining({ id: 'p1', highlighted: true, paidVia: 'etransfer', paid: true }),
      expect.objectContaining({ id: 'p2', highlighted: true, paid: false }),
    ]);

    await togglePlayerHighlightStatus('s1', 'p1');
    expect(getClubDocData('sessions', 's1')?.players).toEqual([
      expect.objectContaining({ id: 'p1', highlighted: false, paidVia: 'etransfer', paid: true }),
      expect.objectContaining({ id: 'p2', highlighted: true, paid: false }),
    ]);
    expect(balanceLedgerEntries()).toEqual([]);
  });

  it('throws when the session does not exist', async () => {
    await expect(togglePlayerHighlightStatus('missing', 'p1')).rejects.toThrow('Session missing not found');
  });

  it('leaves the session unchanged when the player is not present', async () => {
    seedSession('s1', {
      players: [{ id: 'p1', percentage: 100, cost: 10, paid: false, comped: false, highlighted: false }],
    });

    await togglePlayerHighlightStatus('s1', 'missing');

    expect(getClubDocData('sessions', 's1')?.players).toEqual([
      expect.objectContaining({ id: 'p1', highlighted: false }),
    ]);
  });
});

describe('deleteSession', () => {
  it('reverses inventory and settlement effects, archives the session, and deletes the original', async () => {
    seedClubDoc('birdieInventory', 'birds-1', {
      name: 'Batch 1',
      birdsPerTube: 12,
      unopenedTubesRemaining: 0,
      birdsInOpenTube: 10,
      costPerTube: 36,
      createdAt: ts('2026-01-01'),
    });
    seedClubDoc('courtCredits', 'courts-1', {
      remainingHours: 3,
      costPerHour: 16,
      createdAt: ts('2026-01-01'),
    });

    seedPlayer('paid-legacy', { balance: 100, sessionCount: 5 });
    seedPlayer('comp-legacy', { balance: 70, sessionCount: 2 });
    seedPlayer('balance-player', { balance: 20, sessionCount: 3 });
    seedPlayer('owed-player', { balance: 15, owed: 7, sessionCount: 4 });
    seedPlayer('transfer-payee', { balance: 8, sessionCount: 1 });
    seedPlayer('payer-external', { balance: 50, sessionCount: 9 });

    seedSession('s1', {
      date: ts('2026-08-13'),
      birdieUsage: [{ id: 'birds-1', quantity: 5 }],
      courtCreditUsage: [{ id: 'courts-1', hoursUsed: 2 }],
      players: [
        { id: 'paid-legacy', percentage: 20, cost: 10, paid: true, highlighted: false },
        { id: 'comp-legacy', percentage: 20, cost: 8, paid: false, comped: true, highlighted: false },
        { id: 'balance-player', percentage: 20, cost: 12, paid: true, paidVia: 'balance', comped: false, highlighted: false },
        { id: 'owed-player', percentage: 20, cost: 7, paid: false, comped: false, highlighted: false },
        { id: 'transfer-payee', percentage: 20, cost: 9, paid: true, paidVia: 'transfer', paidBy: 'payer-external', comped: false, highlighted: false },
      ],
    });

    await deleteSession('s1');

    expect(getClubDocData('birdieInventory', 'birds-1')).toMatchObject({
      unopenedTubesRemaining: 1,
      birdsInOpenTube: 3,
    });
    expect(getClubDocData('courtCredits', 'courts-1')).toMatchObject({ remainingHours: 5 });

    expect(getClubDocData('players', 'paid-legacy')).toMatchObject({ balance: 100, sessionCount: 4 });
    expect(getClubDocData('players', 'comp-legacy')).toMatchObject({ balance: 70, sessionCount: 1 });
    expect(getClubDocData('players', 'balance-player')).toMatchObject({ balance: 32, sessionCount: 2 });
    expect(getClubDocData('players', 'owed-player')).toMatchObject({ balance: 15, owed: 0, sessionCount: 3 });
    expect(getClubDocData('players', 'transfer-payee')).toMatchObject({ balance: 8, sessionCount: 0 });
    expect(getClubDocData('players', 'payer-external')).toMatchObject({ balance: 59, sessionCount: 9 });

    expect(balanceLedgerEntries()).toEqual([
      expect.objectContaining({ playerId: 'paid-legacy', delta: -10, reason: 'payment', note: 'Reversed — session deleted', balanceBefore: 100, balanceAfter: 100 }),
      expect.objectContaining({ playerId: 'comp-legacy', delta: -8, reason: 'comp', note: 'Reversed — session deleted', balanceBefore: 70, balanceAfter: 70 }),
      expect.objectContaining({ playerId: 'balance-player', delta: 12, reason: 'session-deleted', note: 'Session deleted', balanceBefore: 20, balanceAfter: 32 }),
      expect.objectContaining({ playerId: 'payer-external', delta: 9, reason: 'session-deleted', note: 'Session deleted — refunded covered dues', balanceBefore: 50, balanceAfter: 59 }),
    ]);

    const archived = getClubDocData('archivedSessions', 's1')!;
    expect(archived.players).toHaveLength(5);
    expect(archived.archivedAt).toBeInstanceOf(Timestamp);
    expect(archived.date).toBeInstanceOf(Timestamp);
    expect(getClubDocData('sessions', 's1')).toBeUndefined();
  });

  it('throws when the session does not exist', async () => {
    await expect(deleteSession('missing')).rejects.toThrow('Session missing not found');
  });
});
