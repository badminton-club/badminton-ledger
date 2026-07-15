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
 *  4. Decrements each player's balance by their cost
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

      // ── 3. Write session ──────────────────────────────────────────────────────────
      tx.set(sessionRef, {
        ...data,
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
      data.players.forEach((player, i) => {
        const before = (playerDocs[i].data()?.balance as number) ?? 0;
        tx.update(playerDocs[i].ref, {
          balance:      increment(-player.cost),  // debit the cost
          sessionCount: increment(1),             // replaces pushing to attendedSessionIds
        });
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

      // ── Write phase: update session ────────────────────────────────────────────────
      tx.update(sessionRef, {
        ...updatedData,
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
      });

      // ── Player balance + membership deltas ─────────────────────────────────────────
      // Every player is debited their cost at creation, so any cost change (including
      // players added to or removed from the session) must adjust the balance, and the
      // sessionCount must track membership — regardless of paid state.
      allPlayerIds.forEach(id => {
        const snap      = playerMap.get(id)!;
        if (!snap.exists()) return;
        const oldPlayer = original.players.find(p => p.id === id);
        const newPlayer = updatedData.players.find(p => p.id === id);

        const oldCost   = oldPlayer?.cost ?? 0;
        const newCost   = newPlayer?.cost ?? 0;
        const costDelta = newCost - oldCost;
        const membershipDelta = (newPlayer ? 1 : 0) - (oldPlayer ? 1 : 0);
        if (costDelta === 0 && membershipDelta === 0) return;

        const before = (snap.data()?.balance as number) ?? 0;
        tx.update(snap.ref, {
          balance: increment(-costDelta),
          ...(membershipDelta !== 0 ? { sessionCount: increment(membershipDelta) } : {}),
        });

        if (costDelta !== 0) {
          tx.set(doc(refs.balanceLedger), {
            playerId:      id,
            sessionId,
            delta:         -costDelta,
            balanceBefore: before,
            balanceAfter:  before - costDelta,
            reason:        'session-edit',
            note:          `Session edit (${oldCost.toFixed(2)} → ${newCost.toFixed(2)})`,
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

      const nowPaid    = !target.paid;
      const updatedPlayers = players.map(p =>
        p.id === playerId ? { ...p, paid: nowPaid } : p
      );
      const before = (playerSnap.data()?.balance as number) ?? 0;
      const delta  = nowPaid ? target.cost : -target.cost;

      tx.update(sessionRef, { players: updatedPlayers });
      // Marking paid increases their balance back (they've settled up); unpaying reverses it
      tx.update(playerRef, { balance: increment(delta) });
      tx.set(doc(refs.balanceLedger), {
        playerId:      playerId,
        sessionId:     sessionId,
        delta,
        balanceBefore: before,
        balanceAfter:  before + delta,
        reason:        'payment',
        note:          nowPaid ? 'Marked paid' : 'Marked unpaid',
        createdAt:     serverTimestamp(),
      });
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
