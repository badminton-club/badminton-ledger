import {
  doc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  runTransaction,
  serverTimestamp,
  Timestamp,
  increment,
} from 'firebase/firestore';
import { db, refs } from './client';
import { serviceCall, toJSDate, deductBirds } from './utils';
import type {
  Session,
  SessionPlayer,
  PaidVia,
  BirdieUsage,
  CourtCreditUsage,
} from 'types';

export interface NewSessionData {
  date: Date;
  location?: string;
  durationHours?: number;
  courtCount: number;
  totalCourtCost: number;
  totalBirdieCost: number;
  totalSessionCost: number;
  birdieUsage: BirdieUsage[];
  courtCreditUsage: CourtCreditUsage[];
  players: SessionPlayer[];
}

// ─── Fetch helpers ────────────────────────────────────────────────────────────

export async function fetchSessions(options: {
  startDate?: Date;
  endDate?: Date;
  orderDirection?: 'asc' | 'desc';
  limitCount?: number;
} = {}): Promise<Session[]> {
  return serviceCall('fetchSessions', async () => {
    const constraints: Parameters<typeof query>[1][] = [];
    if (options.startDate) constraints.push(where('date', '>=', Timestamp.fromDate(options.startDate)));
    if (options.endDate)   constraints.push(where('date', '<=', Timestamp.fromDate(options.endDate)));
    constraints.push(orderBy('date', options.orderDirection ?? 'desc'));
    if (options.limitCount) constraints.push(limit(options.limitCount));

    const snap = await getDocs(query(refs.sessions, ...constraints));
    return snap.docs.map(d => {
      const data = d.data();
      return { id: d.id, ...data, date: toJSDate(data.date)! } as Session;
    });
  });
}

export async function fetchSessionById(sessionId: string): Promise<Session> {
  return serviceCall('fetchSessionById', async () => {
    const snap = await getDoc(doc(refs.sessions, sessionId));
    if (!snap.exists()) throw new Error(`Session ${sessionId} not found`);
    const data = snap.data();
    return { id: snap.id, ...data, date: toJSDate(data.date)! } as Session;
  });
}

// ─── Add session ─────────────────────────────────────────────────────────────

/**
 * Atomically:
 *  1. Creates the session document
 *  2. Deducts birds from each birdie batch
 *  3. Deducts hours from each court credit batch
 *  4. Draws the prepaid balance only for players settling via 'balance'
 *  5. Increments each player's sessionCount by 1 (replaces attendedSessionIds push)
 *  6. Logs a transaction record for each resource used
 */
export async function addSession(data: NewSessionData): Promise<string> {
  return serviceCall('addSession', async () => {
    const sessionRef = doc(refs.sessions); // generate ID before transaction

    await runTransaction(db, async (tx) => {
      // ── 1. Read all affected documents first (Firestore rule: reads before writes) ──
      const [birdieDocs, courtDocs, playerDocs] = await Promise.all([
        Promise.all(
          data.birdieUsage.map(u => tx.get(doc(refs.birdieInventory, u.id)))
        ),
        Promise.all(
          data.courtCreditUsage.map(u => tx.get(doc(refs.courtCredits, u.id)))
        ),
        Promise.all(
          data.players.map(p => tx.get(doc(refs.players, p.id)))
        ),
      ]);

      // ── 2. Validate before any writes ────────────────────────────────────────────
      data.birdieUsage.forEach((usage, i) => {
        const snap = birdieDocs[i];
        if (!snap.exists()) throw new Error(`Birdie batch ${usage.id} not found`);
        const d = snap.data()!;
        const available = d.unopenedTubesRemaining * d.birdsPerTube + d.birdsInOpenTube;
        if (available < usage.quantity)
          throw new Error(`Batch ${d.name}: only ${available} birds available, ${usage.quantity} requested`);
      });

      data.courtCreditUsage.forEach((usage, i) => {
        const snap = courtDocs[i];
        if (!snap.exists()) throw new Error(`Court credit batch ${usage.id} not found`);
        const d = snap.data()!;
        if (d.remainingHours < usage.hoursUsed)
          throw new Error(`Court credit ${usage.id}: only ${d.remainingHours} hrs left`);
      });

      data.players.forEach((player, i) => {
        if (!playerDocs[i].exists()) throw new Error(`Player ${player.id} not found`);
      });

      // A player whose positive (prepaid) balance covers the session cost has
      // effectively paid: the cost is drawn from their balance below, so mark them
      // paid automatically instead of leaving them as owing.
      const resolvedPlayers = data.players.map((player, i) => {
        const before = (playerDocs[i].data()?.balance as number) ?? 0;
        const coveredByBalance = before > 0 && player.cost > 0 && player.cost <= before;
        return coveredByBalance && !player.paid && !player.comped
          ? { ...player, paid: true, paidVia: 'balance' as const }
          : player;
      });

      // ── 3. Write session ──────────────────────────────────────────────────────────
      tx.set(sessionRef, {
        ...data,
        players:   resolvedPlayers,
        id:        sessionRef.id,
        date:      Timestamp.fromDate(data.date),
        createdAt: serverTimestamp(),
      });

      // ── 4. Update birdie inventory + log transactions ─────────────────────────────
      data.birdieUsage.forEach((usage, i) => {
        const snap   = birdieDocs[i];
        const d      = snap.data()!;
        const newCounts = deductBirds(
          d.unopenedTubesRemaining, d.birdsPerTube, d.birdsInOpenTube, usage.quantity
        );
        tx.update(snap.ref, newCounts);

        const cost = (usage.quantity / d.birdsPerTube) * d.costPerTube;
        tx.set(doc(refs.transactions), {
          resourceType: 'birdie',
          batchId:      usage.id,
          quantityUsed: usage.quantity,
          cost,
          sessionId: sessionRef.id,
          date:      Timestamp.fromDate(data.date),
          createdAt: serverTimestamp(),
        });
      });

      // ── 5. Update court credits + log transactions ────────────────────────────────
      data.courtCreditUsage.forEach((usage, i) => {
        const snap = courtDocs[i];
        const d    = snap.data()!;
        tx.update(snap.ref, { remainingHours: d.remainingHours - usage.hoursUsed });

        const cost = usage.hoursUsed * (d.costPerHour ?? 0);
        tx.set(doc(refs.transactions), {
          resourceType: 'court',
          batchId:      usage.id,
          hoursUsed:    usage.hoursUsed,
          cost,
          sessionId: sessionRef.id,
          date:      Timestamp.fromDate(data.date),
          createdAt: serverTimestamp(),
        });
      });

      // ── 6. Update player balances + session counts ────────────────────────────────
      resolvedPlayers.forEach((player, i) => {
        const drawsWallet = player.paidVia === 'balance';
        const owesForSession = !player.paid && !player.comped;
        const before = (playerDocs[i].data()?.balance as number) ?? 0;
        tx.update(playerDocs[i].ref, {
          sessionCount: increment(1),
          ...(drawsWallet ? { balance: increment(-player.cost) } : {}),
          ...(owesForSession ? { owed: increment(player.cost) } : {}),
        });
        if (drawsWallet) {
          tx.set(doc(refs.balanceLedger), {
            playerId:      player.id,
            sessionId:     sessionRef.id,
            delta:         -player.cost,
            balanceBefore: before,
            balanceAfter:  before - player.cost,
            reason:        'session',
            note:          `Session on ${data.date.toLocaleDateString()}`,
            createdAt:     serverTimestamp(),
          });
        }
      });
    });

    return sessionRef.id;
  });
}

// ─── Edit session ─────────────────────────────────────────────────────────────

/**
 * Atomically updates a session and adjusts inventory/player balances
 * to reflect the *delta* between old and new values.
 *
 * Key fixes vs original:
 *  - Reads snapshots inside the transaction (not refs stored outside)
 *  - Player balance delta is: newCost - oldCost (was inverted)
 *  - Court credit reversal is implemented (was commented out)
 */
export async function editSession(
  sessionId: string,
  updatedData: NewSessionData
): Promise<void> {
  return serviceCall('editSession', async () => {
    const sessionRef = doc(refs.sessions, sessionId);

    await runTransaction(db, async (tx) => {
      // ── Read phase ────────────────────────────────────────────────────────────────
      const sessionSnap = await tx.get(sessionRef);
      if (!sessionSnap.exists()) throw new Error(`Session ${sessionId} not found`);
      const original = sessionSnap.data() as Session;

      // Collect all batch IDs from both old and new data
      const allBirdieIds = new Set([
        ...original.birdieUsage.map(u => u.id),
        ...updatedData.birdieUsage.map(u => u.id),
      ]);
      const allCourtIds = new Set([
        ...original.courtCreditUsage.map(u => u.id),
        ...updatedData.courtCreditUsage.map(u => u.id),
      ]);
      const allPlayerIds = new Set([
        ...original.players.map(p => p.id),
        ...updatedData.players.map(p => p.id),
      ]);

      const [birdieSnaps, courtSnaps, playerSnaps] = await Promise.all([
        Promise.all([...allBirdieIds].map(id => tx.get(doc(refs.birdieInventory, id)))),
        Promise.all([...allCourtIds].map(id  => tx.get(doc(refs.courtCredits,    id)))),
        Promise.all([...allPlayerIds].map(id => tx.get(doc(refs.players,         id)))),
      ]);

      const birdieMap  = new Map([...allBirdieIds].map((id, i) => [id, birdieSnaps[i]]));
      const courtMap   = new Map([...allCourtIds].map((id, i)  => [id, courtSnaps[i]]));
      const playerMap  = new Map([...allPlayerIds].map((id, i) => [id, playerSnaps[i]]));

      // A player whose positive prepaid balance covers their session cost is
      // auto-settled from that balance, matching addSession.
      const resolvedPlayers = updatedData.players.map((player) => {
        const before = (playerMap.get(player.id)?.data()?.balance as number) ?? 0;
        const coveredByBalance = before > 0 && player.cost > 0 && player.cost <= before;
        return coveredByBalance && !player.paid && !player.comped
          ? { ...player, paid: true, paidVia: 'balance' as const }
          : player;
      });

      // ── Write phase: update session ────────────────────────────────────────────────
      tx.update(sessionRef, {
        ...updatedData,
        players:   resolvedPlayers,
        date:      Timestamp.fromDate(updatedData.date),
        updatedAt: serverTimestamp(),
      });

      // ── Birdie inventory deltas ────────────────────────────────────────────────────
      allBirdieIds.forEach(id => {
        const snap       = birdieMap.get(id)!;
        if (!snap.exists()) return;
        const d          = snap.data()!;
        const oldQty     = original.birdieUsage.find(u => u.id === id)?.quantity ?? 0;
        const newQty     = updatedData.birdieUsage.find(u => u.id === id)?.quantity ?? 0;
        const delta      = newQty - oldQty;   // positive = used more, negative = returned
        if (delta === 0) return;

        const available  = d.unopenedTubesRemaining * d.birdsPerTube + d.birdsInOpenTube;
        if (delta > 0 && available < delta)
          throw new Error(`Batch ${d.name}: insufficient birds for edit`);

        const newCounts  = deductBirds(
          d.unopenedTubesRemaining, d.birdsPerTube, d.birdsInOpenTube, delta
        );
        tx.update(snap.ref, newCounts);

        // Log adjustment transaction
        const cost = (delta / d.birdsPerTube) * d.costPerTube;
        tx.set(doc(refs.transactions), {
          resourceType: 'birdie',
          batchId:      id,
          quantityUsed: delta,
          cost,
          sessionId,
          date:        Timestamp.fromDate(updatedData.date),
          createdAt:   serverTimestamp(),
          description: 'Session Edit Adjustment',
        });
      });

      // ── Court credit deltas ────────────────────────────────────────────────────────
      allCourtIds.forEach(id => {
        const snap       = courtMap.get(id)!;
        if (!snap.exists()) return;
        const d          = snap.data()!;
        const oldHours   = original.courtCreditUsage.find(u => u.id === id)?.hoursUsed ?? 0;
        const newHours   = updatedData.courtCreditUsage.find(u => u.id === id)?.hoursUsed ?? 0;
        const delta      = newHours - oldHours;
        if (delta === 0) return;

        if (delta > 0 && d.remainingHours < delta)
          throw new Error(`Court credit ${id}: insufficient hours for edit`);

        tx.update(snap.ref, { remainingHours: d.remainingHours - delta });

        // Log adjustment transaction
        const cost = delta * (d.costPerHour ?? 0);
        tx.set(doc(refs.transactions), {
          resourceType: 'court',
          batchId:      id,
          hoursUsed:    delta,
          cost,
          sessionId,
          date:        Timestamp.fromDate(updatedData.date),
          createdAt:   serverTimestamp(),
          description: 'Session Edit Adjustment',
        });
      });

      // ── Player balance + membership deltas ─────────────────────────────────────────
      allPlayerIds.forEach(id => {
        const snap      = playerMap.get(id)!;
        if (!snap.exists()) return;
        const oldPlayer = original.players.find(p => p.id === id);
        const newPlayer = resolvedPlayers.find(p => p.id === id);

        const viaOf = (p?: SessionPlayer): PaidVia =>
          p ? (p.paidVia ?? (p.comped ? 'comp' : p.paid ? 'etransfer' : null)) : null;
        const oldVia  = viaOf(oldPlayer);
        const newVia  = viaOf(newPlayer);
        const oldCost = oldPlayer?.cost ?? 0;
        const newCost = newPlayer?.cost ?? 0;

        const walletDelta  = (oldVia === 'balance' ? oldCost : 0) - (newVia === 'balance' ? newCost : 0);
        const owedDelta    = (newPlayer && newVia === null ? newCost : 0) - (oldPlayer && oldVia === null ? oldCost : 0);
        const paymentDelta = (newVia === 'etransfer' ? newCost : 0) - (oldVia === 'etransfer' ? oldCost : 0);
        const compDelta    = (newVia === 'comp' ? newCost : 0) - (oldVia === 'comp' ? oldCost : 0);
        const membershipDelta = (newPlayer ? 1 : 0) - (oldPlayer ? 1 : 0);
        if (walletDelta === 0 && owedDelta === 0 && paymentDelta === 0 && compDelta === 0 && membershipDelta === 0) return;

        const before = (snap.data()?.balance as number) ?? 0;
        tx.update(snap.ref, {
          ...(walletDelta !== 0 ? { balance: increment(walletDelta) } : {}),
          ...(owedDelta !== 0 ? { owed: increment(owedDelta) } : {}),
          ...(membershipDelta !== 0 ? { sessionCount: increment(membershipDelta) } : {}),
        });

        if (walletDelta !== 0) {
          tx.set(doc(refs.balanceLedger), {
            playerId:      id,
            sessionId,
            delta:         walletDelta,
            balanceBefore: before,
            balanceAfter:  before + walletDelta,
            reason:        'session-edit',
            note:          'Session edit',
            createdAt:     serverTimestamp(),
          });
        }
        // Payout adjustments are wallet-neutral: they only re-price the owner payout
        // when a settled player's cost changes during the edit.
        if (paymentDelta !== 0) {
          tx.set(doc(refs.balanceLedger), {
            playerId:      id,
            sessionId,
            delta:         paymentDelta,
            balanceBefore: before,
            balanceAfter:  before,
            reason:        'payment',
            note:          'Session edit adjustment',
            createdAt:     serverTimestamp(),
          });
        }
        if (compDelta !== 0) {
          tx.set(doc(refs.balanceLedger), {
            playerId:      id,
            sessionId,
            delta:         compDelta,
            balanceBefore: before,
            balanceAfter:  before,
            reason:        'comp',
            note:          'Session edit adjustment',
            createdAt:     serverTimestamp(),
          });
        }
      });
    });
  });
}

// ─── Toggle helpers ───────────────────────────────────────────────────────────

export async function togglePlayerPaidStatus(
  sessionId: string,
  playerId: string
): Promise<void> {
  return serviceCall('togglePlayerPaidStatus', async () => {
    const sessionRef = doc(refs.sessions, sessionId);
    const playerRef  = doc(refs.players, playerId);

    await runTransaction(db, async (tx) => {
      const [sessionSnap, playerSnap] = await Promise.all([
        tx.get(sessionRef),
        tx.get(playerRef),
      ]);

      if (!sessionSnap.exists()) throw new Error(`Session ${sessionId} not found`);
      if (!playerSnap.exists()) throw new Error(`Player ${playerId} not found`);

      const players    = sessionSnap.data().players as SessionPlayer[];
      const target     = players.find(p => p.id === playerId);
      if (!target) throw new Error(`Player ${playerId} not in session ${sessionId}`);

      const nowPaid = !target.paid;
      const cost    = target.cost;
      // Current settlement method (inferred for legacy docs written before paidVia).
      const currentVia: PaidVia = target.paidVia ?? (target.comped ? 'comp' : target.paid ? 'etransfer' : null);
      // The manual button always records an e-Transfer settlement with the club.
      const nextVia: PaidVia = nowPaid ? 'etransfer' : null;
      // Paid and comped are mutually exclusive: marking paid clears any comp.
      const updatedPlayers = players.map(p =>
        p.id === playerId
          ? { ...p, paid: nowPaid, paidVia: nextVia, comped: nowPaid ? false : (p.comped ?? false) }
          : p
      );
      tx.update(sessionRef, { players: updatedPlayers });

      let before = (playerSnap.data()?.balance as number) ?? 0;
      const initial = before;
      const log = (delta: number, reason: string, note: string) => {
        tx.set(doc(refs.balanceLedger), {
          playerId, sessionId, delta,
          balanceBefore: before, balanceAfter: before + delta,
          reason, note, createdAt: serverTimestamp(),
        });
        before += delta;
      };

      if (nowPaid) {
        // Reverse a prior comp settlement so the player isn't double-credited.
        if (target.comped) log(-cost, 'comp', 'Reversed — marked paid to club');
        log(cost, 'payment', 'Marked paid');
      } else if (currentVia === 'etransfer') {
        // Only reverse a real e-Transfer payment. A 'balance' settlement was drawn from
        // the player's prepaid balance (no payment entry), so there's nothing to reverse.
        log(-cost, 'payment', 'Marked unpaid');
      }

      const netDelta = before - initial;
      if (netDelta !== 0) tx.update(playerRef, { balance: increment(netDelta) });
    });
  });
}

/**
 * Toggles a player's "comped" status for a session: the player settled directly
 * with the owner. Like paying, this credits the player's balance, but it is logged
 * with reason 'comp' so it is excluded from the owner payout (the owner already has
 * the money). Comped is mutually exclusive with paid.
 */
export async function togglePlayerCompStatus(
  sessionId: string,
  playerId: string
): Promise<void> {
  return serviceCall('togglePlayerCompStatus', async () => {
    const sessionRef = doc(refs.sessions, sessionId);
    const playerRef  = doc(refs.players, playerId);

    await runTransaction(db, async (tx) => {
      const [sessionSnap, playerSnap] = await Promise.all([
        tx.get(sessionRef),
        tx.get(playerRef),
      ]);

      if (!sessionSnap.exists()) throw new Error(`Session ${sessionId} not found`);
      if (!playerSnap.exists()) throw new Error(`Player ${playerId} not found`);

      const players = sessionSnap.data().players as SessionPlayer[];
      const target  = players.find(p => p.id === playerId);
      if (!target) throw new Error(`Player ${playerId} not in session ${sessionId}`);

      const nowComped = !target.comped;
      const cost      = target.cost;
      // Current settlement method (inferred for legacy docs written before paidVia).
      const currentVia: PaidVia = target.paidVia ?? (target.comped ? 'comp' : target.paid ? 'etransfer' : null);
      const updatedPlayers = players.map(p =>
        p.id === playerId
          ? { ...p, comped: nowComped, paid: nowComped ? false : p.paid, paidVia: nowComped ? 'comp' as const : null }
          : p
      );
      tx.update(sessionRef, { players: updatedPlayers });

      let before = (playerSnap.data()?.balance as number) ?? 0;
      const initial = before;
      const log = (delta: number, reason: string, note: string) => {
        tx.set(doc(refs.balanceLedger), {
          playerId, sessionId, delta,
          balanceBefore: before, balanceAfter: before + delta,
          reason, note, createdAt: serverTimestamp(),
        });
        before += delta;
      };

      if (nowComped) {
        // If they'd paid the club by e-Transfer, reverse that payment so it leaves the
        // owner payout. A 'balance' settlement has no payment entry — the comp credit
        // below restores the balance that was drawn at session time.
        if (currentVia === 'etransfer') log(-cost, 'payment', 'Reversed — paid owner directly (comp)');
        log(cost, 'comp', 'Comped — player paid owner directly');
      } else {
        log(-cost, 'comp', 'Comp removed');
      }

      const netDelta = before - initial;
      if (netDelta !== 0) tx.update(playerRef, { balance: increment(netDelta) });
    });
  });
}

/**
 * Sets how a player's session cost was settled. The prepaid wallet is only touched
 * by the 'balance' method; the others owe/settle with the owner directly:
 *   - 'etransfer' → wallet unchanged; logs a wallet-neutral 'payment' (owed to owner)
 *   - 'comp'      → wallet unchanged; logs a wallet-neutral 'comp' (off the payout)
 *   - 'balance'   → draws −cost from prepaid credit (may go negative; caller warns)
 *   - null        → unpaid; wallet unchanged, the player owes the cost
 * Switching into 'balance' draws the cost; switching out of it refunds the cost.
 */
export async function setPlayerSettlement(
  sessionId: string,
  playerId: string,
  method: PaidVia
): Promise<void> {
  return serviceCall('setPlayerSettlement', async () => {
    const sessionRef = doc(refs.sessions, sessionId);
    const playerRef  = doc(refs.players, playerId);

    await runTransaction(db, async (tx) => {
      const [sessionSnap, playerSnap] = await Promise.all([
        tx.get(sessionRef),
        tx.get(playerRef),
      ]);

      if (!sessionSnap.exists()) throw new Error(`Session ${sessionId} not found`);
      if (!playerSnap.exists()) throw new Error(`Player ${playerId} not found`);

      const players = sessionSnap.data().players as SessionPlayer[];
      const target  = players.find(p => p.id === playerId);
      if (!target) throw new Error(`Player ${playerId} not in session ${sessionId}`);

      const cost = target.cost;
      const currentVia: PaidVia =
        target.paidVia ?? (target.comped ? 'comp' : target.paid ? 'etransfer' : null);
      if (currentVia === method) return; // no change

      let before = (playerSnap.data()?.balance as number) ?? 0;
      const initial = before;
      const logWallet = (delta: number, reason: string, note: string) => {
        tx.set(doc(refs.balanceLedger), {
          playerId, sessionId, delta,
          balanceBefore: before, balanceAfter: before + delta,
          reason, note, createdAt: serverTimestamp(),
        });
        before += delta;
      };
      const logPayout = (delta: number, reason: string, note: string) => {
        tx.set(doc(refs.balanceLedger), {
          playerId, sessionId, delta,
          balanceBefore: before, balanceAfter: before,
          reason, note, createdAt: serverTimestamp(),
        });
      };

      // Reverse the old payout signal, then record the new one (wallet-neutral).
      if (currentVia === 'etransfer') logPayout(-cost, 'payment', 'Reversed e-Transfer payment');
      else if (currentVia === 'comp')  logPayout(-cost, 'comp', 'Reversed comp');
      if (method === 'etransfer') logPayout(cost, 'payment', 'Paid by e-Transfer');
      else if (method === 'comp')  logPayout(cost, 'comp', 'Comped — player paid owner directly');

      // The prepaid wallet only moves for the 'balance' method.
      if (currentVia === 'balance') logWallet(cost, 'settlement', 'Refunded prepaid balance');
      if (method === 'balance')     logWallet(-cost, 'settlement', 'Settled from prepaid balance');

      // Session debt is owed only while unsettled (paidVia === null).
      const owedDelta = (method === null ? cost : 0) - (currentVia === null ? cost : 0);

      const updatedPlayers = players.map(p =>
        p.id === playerId
          ? {
              ...p,
              paid:    method === 'etransfer' || method === 'balance',
              comped:  method === 'comp',
              paidVia: method,
            }
          : p
      );
      tx.update(sessionRef, { players: updatedPlayers });

      const netDelta = before - initial;
      const playerUpdate: Record<string, ReturnType<typeof increment>> = {};
      if (netDelta !== 0)  playerUpdate.balance = increment(netDelta);
      if (owedDelta !== 0) playerUpdate.owed = increment(owedDelta);
      if (Object.keys(playerUpdate).length) tx.update(playerRef, playerUpdate);
    });
  });
}

export async function togglePlayerHighlightStatus(
  sessionId: string,
  playerId: string
): Promise<void> {
  return serviceCall('togglePlayerHighlightStatus', async () => {
    const sessionRef = doc(refs.sessions, sessionId);

    await runTransaction(db, async (tx) => {
      const snap = await tx.get(sessionRef);
      if (!snap.exists()) throw new Error(`Session ${sessionId} not found`);

      const players = (snap.data().players as SessionPlayer[]).map(p =>
        p.id === playerId ? { ...p, highlighted: !p.highlighted } : p
      );
      tx.update(sessionRef, { players });
    });
  });
}

// ─── Delete session ───────────────────────────────────────────────────────────

/**
 * Reverses a session's effects (refunds birds, court hours and player balances,
 * and decrements session counts), archives a copy to `archivedSessions`, then
 * deletes the session document — all in one transaction.
 */
export async function deleteSession(sessionId: string): Promise<void> {
  return serviceCall('deleteSession', async () => {
    const sessionRef = doc(refs.sessions, sessionId);

    await runTransaction(db, async (tx) => {
      const sessionSnap = await tx.get(sessionRef);
      if (!sessionSnap.exists()) throw new Error(`Session ${sessionId} not found`);
      const session = sessionSnap.data() as Session;

      const birdieUsage = session.birdieUsage ?? [];
      const courtUsage  = session.courtCreditUsage ?? [];
      const players     = session.players ?? [];

      const [birdieSnaps, courtSnaps, playerSnaps] = await Promise.all([
        Promise.all(birdieUsage.map(u => tx.get(doc(refs.birdieInventory, u.id)))),
        Promise.all(courtUsage.map(u  => tx.get(doc(refs.courtCredits, u.id)))),
        Promise.all(players.map(p     => tx.get(doc(refs.players, p.id)))),
      ]);

      // Refund birds to each batch.
      birdieUsage.forEach((u, i) => {
        const snap = birdieSnaps[i];
        if (!snap.exists()) return;
        const d = snap.data()!;
        const perTube = d.birdsPerTube || 1;
        const total = d.unopenedTubesRemaining * perTube + d.birdsInOpenTube + u.quantity;
        tx.update(snap.ref, {
          unopenedTubesRemaining: Math.floor(total / perTube),
          birdsInOpenTube:        total % perTube,
        });
      });

      // Refund court hours.
      courtUsage.forEach((u, i) => {
        const snap = courtSnaps[i];
        if (!snap.exists()) return;
        const d = snap.data()!;
        tx.update(snap.ref, { remainingHours: d.remainingHours + u.hoursUsed });
      });

      // Refund player balances, decrement session counts, log the reversal.
      players.forEach((p, i) => {
        const snap = playerSnaps[i];
        if (!snap.exists()) return;
        const via: PaidVia = p.paidVia ?? (p.comped ? 'comp' : p.paid ? 'etransfer' : null);
        const before = (snap.data()?.balance as number) ?? 0;

        if (via === 'etransfer' || via === 'comp') {
          tx.set(doc(refs.balanceLedger), {
            playerId:      p.id,
            sessionId,
            delta:         -p.cost,
            balanceBefore: before,
            balanceAfter:  before,
            reason:        via === 'etransfer' ? 'payment' : 'comp',
            note:          'Reversed — session deleted',
            createdAt:     serverTimestamp(),
          });
        }

        const walletRefund = via === 'balance' ? p.cost : 0;
        const owedForSession = via === null ? p.cost : 0;
        tx.update(snap.ref, {
          sessionCount: increment(-1),
          ...(walletRefund !== 0 ? { balance: increment(walletRefund) } : {}),
          ...(owedForSession !== 0 ? { owed: increment(-owedForSession) } : {}),
        });
        if (walletRefund !== 0) {
          tx.set(doc(refs.balanceLedger), {
            playerId:      p.id,
            sessionId,
            delta:         walletRefund,
            balanceBefore: before,
            balanceAfter:  before + walletRefund,
            reason:        'session-deleted',
            note:          'Session deleted',
            createdAt:     serverTimestamp(),
          });
        }
      });

      // Archive a copy, then delete the original.
      tx.set(doc(refs.archivedSessions, sessionId), {
        ...session,
        archivedAt: serverTimestamp(),
      });
      tx.delete(sessionRef);
    });
  });
}
