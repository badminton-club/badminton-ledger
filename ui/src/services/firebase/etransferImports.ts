import {
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  serverTimestamp,
  runTransaction,
  increment,
  Timestamp,
} from 'firebase/firestore';
import { db, refs, auth } from './client';
import { serviceCall, toJSDate } from './utils';
import { fetchSessions } from './sessions';
import {
  searchEtransferEmails,
  DEFAULT_ETRANSFER_SENDER_ADDRESS,
  DEFAULT_ETRANSFER_SEARCH_AFTER_DATE,
  type ParsedEtransferEmail,
} from './gmail';
import type { EtransferImport, EtransferSenderMapping, Player, SessionPlayer } from 'types';

export interface EtransferBatchApprovalInput {
  importId: string;
  playerId: string;
  amount: number;
  rememberMapping: boolean;
}

export interface EtransferBatchSettlement {
  importId: string;
  sessionId: string;
  sessionDate: Date;
  playerId: string;
  cost: number;
}

export interface EtransferBatchPreview {
  inputs: EtransferBatchApprovalInput[];
  approvals: {
    importId: string;
    senderName: string;
    playerId: string;
    amount: number;
  }[];
  settlements: EtransferBatchSettlement[];
  startingBalances: Record<string, number>;
  startingOwed: Record<string, number>;
  endingBalances: Record<string, number>;
}

export interface EtransferBatchResult {
  approved: number;
  settled: number;
}

/**
 * Converts a dollar amount to whole cents, rounding away any floating-point
 * noise (e.g. 0.07 + 0.01 in IEEE754 doubles). All settlement comparisons and
 * running-balance arithmetic use cents internally so amounts like $0.01 are
 * compared exactly, never through direct dollar-float comparison.
 */
function toCents(amount: number): number {
  return Math.round(amount * 100);
}

/** Converts whole cents back to a dollar amount for display/storage. */
function fromCents(cents: number): number {
  return cents / 100;
}

/** Normalizes a sender identity to the doc id used for its remembered mapping. */
function mappingKeyFor(senderEmail: string | null, senderName: string): string {
  if (senderEmail) return senderEmail.toLowerCase();
  return `name:${senderName.trim().toLowerCase()}`;
}

function nameTokens(name: string): string[] {
  return name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9\u00c0-\u024f\u4e00-\u9fff]+/)
    .filter(Boolean);
}

function tokenCounts(tokens: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1);
  return counts;
}

function containsAllTokens(haystack: string[], needles: string[]): boolean {
  const available = tokenCounts(haystack);
  for (const token of needles) {
    const remaining = available.get(token) ?? 0;
    if (remaining === 0) return false;
    available.set(token, remaining - 1);
  }
  return true;
}

function playerNameMatchScore(senderName: string, player: Player): number {
  const sender = nameTokens(senderName);
  const first = nameTokens(player.firstName);
  const last = nameTokens(player.lastName ?? '');
  const full = [...first, ...last];
  if (sender.length === 0 || first.length === 0) return 0;

  if (sender.join(' ') === full.join(' ')) return 100;
  if (sender.length === full.length && containsAllTokens(sender, full)) return 95;
  if (last.length > 0 && containsAllTokens(sender, full)) return 90;
  if (containsAllTokens(sender, first)) return 50;
  return 0;
}

/** Returns a player only when one candidate has a uniquely strongest name match. */
function findUniqueBestPlayerMatch(senderName: string, players: Player[]): Player | null {
  let bestScore = 0;
  let best: Player[] = [];

  for (const player of players) {
    const score = playerNameMatchScore(senderName, player);
    if (score > bestScore) {
      bestScore = score;
      best = [player];
    } else if (score > 0 && score === bestScore) {
      best.push(player);
    }
  }

  return best.length === 1 ? best[0] : null;
}

async function resolveSenderMatch(
  senderEmail: string | null,
  senderName: string,
  players: Player[]
): Promise<{ playerId: string | null; source: EtransferImport['matchSource'] }> {
  const mappedPlayerId = await lookupSenderMapping(senderEmail, senderName);
  if (mappedPlayerId && players.some((player) => player.id === mappedPlayerId)) {
    return { playerId: mappedPlayerId, source: 'mapping' };
  }

  const candidate = findUniqueBestPlayerMatch(senderName, players);
  return candidate
    ? { playerId: candidate.id, source: 'name-lookup' }
    : { playerId: null, source: null };
}

async function fetchPlayersForMatching(): Promise<Player[]> {
  const snap = await getDocs(refs.players);
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Player, 'id'>) }));
}

function toEtransferImport(id: string, data: Record<string, unknown>): EtransferImport {
  return {
    id,
    gmailMessageId: (data.gmailMessageId as string) ?? id,
    gmailThreadId: (data.gmailThreadId as string) ?? '',
    subject: (data.subject as string) ?? '',
    senderName: (data.senderName as string) ?? '',
    senderEmail: (data.senderEmail as string | null) ?? null,
    amount: (data.amount as number) ?? 0,
    memo: (data.memo as string | null) ?? null,
    referenceNumber: (data.referenceNumber as string | null) ?? null,
    emailDate: data.emailDate as EtransferImport['emailDate'],
    status: (data.status as EtransferImport['status']) ?? 'pending',
    matchedPlayerId: (data.matchedPlayerId as string | null) ?? null,
    matchSource: (data.matchSource as EtransferImport['matchSource']) ?? null,
    reviewedByUid: (data.reviewedByUid as string | null) ?? null,
    reviewedAt: (data.reviewedAt as EtransferImport['reviewedAt']) ?? null,
    appliedAmount: (data.appliedAmount as number | null) ?? null,
    balanceLedgerEntryId: (data.balanceLedgerEntryId as string | null) ?? null,
    autoSettledSessionIds: (data.autoSettledSessionIds as string[] | undefined) ?? [],
    rejectionReason: (data.rejectionReason as string | null) ?? null,
    undoneByUid: (data.undoneByUid as string | null) ?? null,
    undoneAt: (data.undoneAt as EtransferImport['undoneAt']) ?? null,
    undoneReason: (data.undoneReason as string | null) ?? null,
    createdAt: data.createdAt as EtransferImport['createdAt'],
  };
}

/** Looks up a remembered sender→player mapping, by email first, then by name. */
async function lookupSenderMapping(senderEmail: string | null, senderName: string): Promise<string | null> {
  const key = mappingKeyFor(senderEmail, senderName);
  const snap = await getDoc(doc(refs.etransferSenderMappings, key));
  if (snap.exists()) return (snap.data().playerId as string) ?? null;

  // A mapping saved from an email that had no Reply-To would be keyed by name;
  // an email that does have Reply-To is keyed by email — check the name-keyed
  // form too so either shape of a previously-saved mapping is found.
  if (senderEmail) {
    const nameKey = mappingKeyFor(null, senderName);
    const byName = await getDoc(doc(refs.etransferSenderMappings, nameKey));
    if (byName.exists()) return (byName.data().playerId as string) ?? null;
  }
  return null;
}

/** Saves (or updates) a remembered sender→player mapping. */
export async function saveEtransferSenderMapping(
  senderEmail: string | null,
  senderName: string,
  playerId: string
): Promise<void> {
  return serviceCall('saveEtransferSenderMapping', async () => {
    const key = mappingKeyFor(senderEmail, senderName);
    await setDoc(doc(refs.etransferSenderMappings, key), {
      senderName,
      senderEmail,
      playerId,
      updatedAt: serverTimestamp(),
    });
  });
}

export async function fetchEtransferSenderMappings(): Promise<EtransferSenderMapping[]> {
  return serviceCall('fetchEtransferSenderMappings', async () => {
    const snap = await getDocs(refs.etransferSenderMappings);
    return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<EtransferSenderMapping, 'id'>) }));
  });
}

export async function deleteEtransferSenderMapping(id: string): Promise<void> {
  return serviceCall('deleteEtransferSenderMapping', async () => {
    await deleteDoc(doc(refs.etransferSenderMappings, id));
  });
}

/**
 * Searches Gmail for new Interac e-Transfer autodeposit emails from the given
 * sender address (or the standard Interac address by default) and records each
 * one not already seen as a `pending` import — using the Gmail message id as the
 * Firestore doc id makes this naturally idempotent, so it's always safe to
 * re-run. Each new import is pre-matched to a player, preferring a remembered
 * sender mapping over a plain name lookup, but always left for an admin to
 * confirm or correct before anything touches a balance.
 */
export async function importEtransferEmails(
  senderAddress: string = DEFAULT_ETRANSFER_SENDER_ADDRESS,
  searchAfterDate: string = DEFAULT_ETRANSFER_SEARCH_AFTER_DATE
): Promise<{ found: number; created: number }> {
  return serviceCall('importEtransferEmails', async () => {
    const parsed = await searchEtransferEmails(senderAddress, searchAfterDate);
    if (parsed.length === 0) return { found: 0, created: 0 };

    // A club's search results are a handful of emails at a time, so checking
    // each message id individually keeps this simple and avoids Firestore's
    // 30-item cap on `in` queries — no chunking needed.
    const existsChecks = await Promise.all(
      parsed.map((p) => getDoc(doc(refs.etransferImports, p.gmailMessageId)))
    );
    const toCreate = parsed.filter((_, i) => !existsChecks[i].exists());
    const players = toCreate.length > 0 ? await fetchPlayersForMatching() : [];

    for (const email of toCreate) {
      await createPendingImport(email, players);
    }

    return { found: parsed.length, created: toCreate.length };
  });
}

async function createPendingImport(email: ParsedEtransferEmail, players: Player[]): Promise<void> {
  const match = await resolveSenderMatch(email.senderEmail, email.senderName, players);

  await setDoc(doc(refs.etransferImports, email.gmailMessageId), {
    gmailMessageId: email.gmailMessageId,
    gmailThreadId: email.gmailThreadId,
    subject: email.subject,
    senderName: email.senderName,
    senderEmail: email.senderEmail,
    amount: email.amount,
    memo: email.memo,
    referenceNumber: email.referenceNumber,
    emailDate: email.emailDate,
    status: 'pending',
    matchedPlayerId: match.playerId,
    matchSource: match.source,
    createdAt: serverTimestamp(),
  });
}

/** The pending review queue, newest email first. */
export async function fetchPendingEtransferImports(): Promise<EtransferImport[]> {
  return serviceCall('fetchPendingEtransferImports', async () => {
    const snap = await getDocs(query(refs.etransferImports, where('status', '==', 'pending')));
    return snap.docs
      .map((d) => toEtransferImport(d.id, d.data()))
      .sort((a, b) => (toJSDate(b.emailDate)?.getTime() ?? 0) - (toJSDate(a.emailDate)?.getTime() ?? 0));
  });
}

/** Previously reviewed imports (applied, rejected, or undone), newest first. */
export async function fetchEtransferImportHistory(): Promise<EtransferImport[]> {
  return serviceCall('fetchEtransferImportHistory', async () => {
    const snap = await getDocs(
      query(refs.etransferImports, where('status', 'in', ['applied', 'rejected', 'undone']))
    );
    return snap.docs
      .map((d) => toEtransferImport(d.id, d.data()))
      .sort((a, b) => (toJSDate(b.emailDate)?.getTime() ?? 0) - (toJSDate(a.emailDate)?.getTime() ?? 0));
  });
}

/**
 * Builds the human-review preview for a group of pending imports. Credits are
 * pooled per player, then whole unpaid sessions are covered oldest-first. If
 * the oldest remaining session is not affordable, newer sessions are not
 * skipped.
 */
export async function previewEtransferApprovalBatch(
  inputs: EtransferBatchApprovalInput[]
): Promise<EtransferBatchPreview> {
  return serviceCall('previewEtransferApprovalBatch', async () => {
    if (inputs.length === 0) throw new Error('Select at least one pending import.');
    if (new Set(inputs.map((input) => input.importId)).size !== inputs.length) {
      throw new Error('The batch contains a duplicate import.');
    }

    const [importSnaps, players, sessions] = await Promise.all([
      Promise.all(inputs.map((input) => getDoc(doc(refs.etransferImports, input.importId)))),
      fetchPlayersForMatching(),
      fetchSessions({ orderDirection: 'asc' }),
    ]);
    const playerById = new Map(players.map((player) => [player.id, player]));
    const approvals = inputs.map((input, index) => {
      const snap = importSnaps[index];
      if (!snap.exists()) throw new Error(`Import ${input.importId} was not found.`);
      if (snap.data().status !== 'pending') {
        throw new Error(`Import ${input.importId} has already been reviewed.`);
      }
      if (!playerById.has(input.playerId)) throw new Error('A selected player no longer exists.');
      if (!Number.isFinite(input.amount) || input.amount <= 0) {
        throw new Error('Every selected import needs a valid positive amount.');
      }
      return {
        importId: input.importId,
        senderName: (snap.data().senderName as string) ?? '',
        playerId: input.playerId,
        amount: input.amount,
      };
    });

    const selectedPlayerIds = [...new Set(inputs.map((input) => input.playerId))];
    const startingBalances: Record<string, number> = {};
    const startingOwed: Record<string, number> = {};
    const endingBalanceCents: Record<string, number> = {};
    for (const playerId of selectedPlayerIds) {
      const player = playerById.get(playerId)!;
      startingBalances[playerId] = player.balance ?? 0;
      startingOwed[playerId] = player.owed ?? 0;
      const creditCents = inputs
        .filter((input) => input.playerId === playerId)
        .reduce((sum, input) => sum + toCents(input.amount), 0);
      endingBalanceCents[playerId] = toCents(startingBalances[playerId]) + creditCents;
    }

    const settlements: EtransferBatchSettlement[] = [];
    for (const playerId of selectedPlayerIds) {
      const playerInputs = inputs.filter((input) => input.playerId === playerId);
      const fundingImportId = playerInputs[playerInputs.length - 1].importId;
      for (const session of sessions) {
        const participant = session.players.find((entry) => entry.id === playerId);
        if (!participant || participant.cost <= 0) continue;
        const paidVia = participant.paidVia
          ?? (participant.comped ? 'comp' : participant.paid ? 'etransfer' : null);
        if (paidVia !== null) continue;
        const costCents = toCents(participant.cost);
        if (costCents > endingBalanceCents[playerId]) break;

        endingBalanceCents[playerId] -= costCents;
        settlements.push({
          importId: fundingImportId,
          sessionId: session.id,
          sessionDate: session.date,
          playerId,
          cost: participant.cost,
        });
      }
    }

    const endingBalances: Record<string, number> = {};
    for (const playerId of selectedPlayerIds) {
      endingBalances[playerId] = fromCents(endingBalanceCents[playerId]);
    }

    return {
      inputs: inputs.map((input) => ({ ...input })),
      approvals,
      settlements,
      startingBalances,
      startingOwed,
      endingBalances,
    };
  });
}

/**
 * Revalidates and applies a reviewed preview. Individual operations remain
 * transactional and auditable; if anything changed since preview, no operation
 * starts until the admin reviews a fresh plan.
 */
export async function applyEtransferApprovalBatch(
  reviewed: EtransferBatchPreview
): Promise<EtransferBatchResult> {
  return serviceCall('applyEtransferApprovalBatch', async () => {
    const fresh = await previewEtransferApprovalBatch(reviewed.inputs);
    const signature = (preview: EtransferBatchPreview) => JSON.stringify({
      approvals: preview.approvals,
      settlements: preview.settlements.map((item) => ({
        importId: item.importId,
        sessionId: item.sessionId,
        playerId: item.playerId,
        cost: item.cost,
      })),
      startingBalances: preview.startingBalances,
      startingOwed: preview.startingOwed,
      endingBalances: preview.endingBalances,
    });
    if (signature(fresh) !== signature(reviewed)) {
      throw new Error('The batch changed since it was reviewed. Review it again before approving.');
    }

    const importRefs = fresh.inputs.map((input) => doc(refs.etransferImports, input.importId));
    const playerIds = [...new Set(fresh.inputs.map((input) => input.playerId))];
    const playerRefs = playerIds.map((playerId) => doc(refs.players, playerId));
    const allSessionRefs = (await getDocs(refs.sessions)).docs.map((snap) => snap.ref);
    const estimatedWrites = fresh.inputs.length * 3 + fresh.settlements.length * 2 + playerIds.length;
    if (estimatedWrites > 450) throw new Error('This batch is too large. Select fewer imports and review again.');

    await runTransaction(db, async (tx) => {
      const [importSnaps, playerSnaps, sessionSnaps] = await Promise.all([
        Promise.all(importRefs.map((ref) => tx.get(ref))),
        Promise.all(playerRefs.map((ref) => tx.get(ref))),
        Promise.all(allSessionRefs.map((ref) => tx.get(ref))),
      ]);
      const playerSnapById = new Map(playerSnaps.map((snap) => [snap.id, snap]));
      const sessionSnapById = new Map(sessionSnaps.map((snap) => [snap.id, snap]));

      fresh.inputs.forEach((input, index) => {
        const snap = importSnaps[index];
        if (!snap.exists() || snap.data().status !== 'pending') {
          throw new Error('A selected import changed. Review the batch again.');
        }
      });
      for (const playerId of playerIds) {
        const snap = playerSnapById.get(playerId);
        if (!snap?.exists()) throw new Error('A selected player no longer exists.');
        if (((snap.data().balance as number) ?? 0) !== fresh.startingBalances[playerId]) {
          throw new Error('A player balance changed. Review the batch again.');
        }
        if (((snap.data().owed as number) ?? 0) !== fresh.startingOwed[playerId]) {
          throw new Error('A player debt changed. Review the batch again.');
        }
      }
      const orderedSessionSnaps = [...sessionSnaps].sort(
        (a, b) => (toJSDate(a.data().date)?.getTime() ?? 0) - (toJSDate(b.data().date)?.getTime() ?? 0)
      );
      const transactionSettlements: { sessionId: string; playerId: string; cost: number }[] = [];
      for (const playerId of playerIds) {
        let availableCents = toCents(((playerSnapById.get(playerId)!.data().balance as number) ?? 0))
          + fresh.inputs
            .filter((input) => input.playerId === playerId)
            .reduce((sum, input) => sum + toCents(input.amount), 0);
        for (const sessionSnap of orderedSessionSnaps) {
          const participant = (sessionSnap.data().players as SessionPlayer[])
            .find((entry) => entry.id === playerId);
          if (!participant || participant.cost <= 0) continue;
          const paidVia = participant.paidVia
            ?? (participant.comped ? 'comp' : participant.paid ? 'etransfer' : null);
          if (paidVia !== null) continue;
          const costCents = toCents(participant.cost);
          if (costCents > availableCents) break;
          availableCents -= costCents;
          transactionSettlements.push({
            sessionId: sessionSnap.id,
            playerId,
            cost: participant.cost,
          });
        }
      }
      const reviewedSettlements = fresh.settlements.map(({ sessionId, playerId, cost }) => ({
        sessionId,
        playerId,
        cost,
      }));
      if (JSON.stringify(transactionSettlements) !== JSON.stringify(reviewedSettlements)) {
        throw new Error('An owed session changed. Review the batch again.');
      }

      const runningBalanceCents: Record<string, number> = {};
      for (const playerId of playerIds) runningBalanceCents[playerId] = toCents(fresh.startingBalances[playerId]);
      const reviewedByUid = auth.currentUser?.uid ?? null;
      fresh.inputs.forEach((input, index) => {
        const importData = importSnaps[index].data();
        const ledgerRef = doc(refs.balanceLedger);
        const beforeCents = runningBalanceCents[input.playerId];
        runningBalanceCents[input.playerId] += toCents(input.amount);
        const settledSessionIds = fresh.settlements
          .filter((settlement) => settlement.importId === input.importId)
          .map((settlement) => settlement.sessionId);

        tx.set(ledgerRef, {
          playerId: input.playerId,
          sessionId: null,
          delta: input.amount,
          balanceBefore: fromCents(beforeCents),
          balanceAfter: fromCents(runningBalanceCents[input.playerId]),
          reason: 'etransfer-import',
          note: `Gmail e-Transfer from ${(importData.senderName as string) ?? 'unknown sender'}`,
          walletAdjustment: true,
          createdAt: serverTimestamp(),
        });
        tx.update(importRefs[index], {
          status: 'applied',
          matchedPlayerId: input.playerId,
          appliedAmount: input.amount,
          balanceLedgerEntryId: ledgerRef.id,
          autoSettledSessionIds: settledSessionIds,
          reviewedByUid,
          reviewedAt: serverTimestamp(),
        });
        if (input.rememberMapping) {
          const senderName = (importData.senderName as string) ?? '';
          const senderEmail = (importData.senderEmail as string | null) ?? null;
          tx.set(doc(refs.etransferSenderMappings, mappingKeyFor(senderEmail, senderName)), {
            senderName,
            senderEmail,
            playerId: input.playerId,
            updatedAt: serverTimestamp(),
          });
        }
      });

      const updatedSessionPlayers = new Map<string, SessionPlayer[]>();
      for (const settlement of fresh.settlements) {
        const snap = sessionSnapById.get(settlement.sessionId)!;
        const players = updatedSessionPlayers.get(settlement.sessionId)
          ?? (snap.data().players as SessionPlayer[]);
        updatedSessionPlayers.set(
          settlement.sessionId,
          players.map((entry) => entry.id === settlement.playerId
            ? {
                ...entry,
                paid: true,
                comped: false,
                paidVia: 'balance',
                paidBy: null,
                settledAt: Timestamp.now(),
                settledByEtransferImportId: settlement.importId,
              }
            : entry)
        );

        const beforeCents = runningBalanceCents[settlement.playerId];
        runningBalanceCents[settlement.playerId] -= toCents(settlement.cost);
        tx.set(doc(refs.balanceLedger), {
          playerId: settlement.playerId,
          sessionId: settlement.sessionId,
          delta: -settlement.cost,
          balanceBefore: fromCents(beforeCents),
          balanceAfter: fromCents(runningBalanceCents[settlement.playerId]),
          reason: 'settlement',
          note: `Settled from prepaid balance — session on ${settlement.sessionDate.toLocaleDateString()}`,
          walletAdjustment: true,
          createdAt: serverTimestamp(),
        });
      }
      updatedSessionPlayers.forEach((players, sessionId) => {
        tx.update(doc(refs.sessions, sessionId), { players });
      });
      for (const playerId of playerIds) {
        const settledCostCents = fresh.settlements
          .filter((settlement) => settlement.playerId === playerId)
          .reduce((sum, settlement) => sum + toCents(settlement.cost), 0);
        tx.update(doc(refs.players, playerId), {
          balance: fromCents(runningBalanceCents[playerId]),
          ...(settledCostCents > 0 ? { owed: increment(-fromCents(settledCostCents)) } : {}),
        });
      }
    });

    return {
      approved: fresh.inputs.length,
      settled: fresh.settlements.length,
    };
  });
}

/**
 * Applies a reviewed import: credits the matched player's balance, logs a
 * `balanceLedger` entry (reason `'etransfer-import'`, undoable later), and marks
 * the import `applied`. `playerId`/`amount` are whatever the admin confirmed in
 * the review UI — not necessarily the original match/parsed amount, since both
 * are editable before applying. Note: unlike `applyEtransferApprovalBatch`,
 * this single-import path does not auto-settle owed sessions from the new
 * balance; it exists for direct/API use and isn't wired into the review UI.
 */
export async function applyEtransferImport(
  importId: string,
  options: { playerId: string; amount: number; rememberMapping: boolean }
): Promise<void> {
  return serviceCall('applyEtransferImport', async () => {
    if (!Number.isFinite(options.amount) || options.amount <= 0) {
      throw new Error('Enter a valid positive amount.');
    }

    const importRef = doc(refs.etransferImports, importId);
    const uid = auth.currentUser?.uid ?? null;

    const { senderEmail, senderName } = await runTransaction(db, async (tx) => {
      const importSnap = await tx.get(importRef);
      if (!importSnap.exists()) throw new Error('Import record not found.');
      const importData = importSnap.data();
      if (importData.status !== 'pending') {
        throw new Error('This import has already been reviewed.');
      }

      const playerRef = doc(refs.players, options.playerId);
      const playerSnap = await tx.get(playerRef);
      if (!playerSnap.exists()) throw new Error('Selected player not found.');

      const before = (playerSnap.data().balance as number) ?? 0;
      const ledgerRef = doc(refs.balanceLedger);
      tx.update(playerRef, { balance: increment(options.amount) });
      tx.set(ledgerRef, {
        playerId: options.playerId,
        sessionId: null,
        delta: options.amount,
        balanceBefore: before,
        balanceAfter: before + options.amount,
        reason: 'etransfer-import',
        note: `Gmail e-Transfer from ${importData.senderName}` + (importData.memo ? ` — ${importData.memo}` : ''),
        walletAdjustment: true,
        createdAt: serverTimestamp(),
      });
      tx.update(importRef, {
        status: 'applied',
        matchedPlayerId: options.playerId,
        appliedAmount: options.amount,
        balanceLedgerEntryId: ledgerRef.id,
        reviewedByUid: uid,
        reviewedAt: serverTimestamp(),
      });

      return {
        senderEmail: (importData.senderEmail as string | null) ?? null,
        senderName: (importData.senderName as string) ?? '',
      };
    });

    if (options.rememberMapping) {
      await saveEtransferSenderMapping(senderEmail, senderName, options.playerId);
    }
  });
}

/**
 * Rejects a reviewed import (e.g. it's not actually a club payment, or the
 * amount/sender couldn't be resolved) without touching any balance. Already
 * rejected (or otherwise reviewed) imports are excluded from future searches
 * purely because their Gmail message id is already recorded in Firestore.
 */
export async function rejectEtransferImport(importId: string, reason: string): Promise<void> {
  return serviceCall('rejectEtransferImport', async () => {
    if (!reason.trim()) throw new Error('A reason is required.');

    const importRef = doc(refs.etransferImports, importId);
    const importSnap = await getDoc(importRef);
    if (!importSnap.exists()) throw new Error('Import record not found.');
    const importData = importSnap.data();
    if (importData.status !== 'pending') throw new Error('This import has already been reviewed.');

    await updateDoc(importRef, {
      status: 'rejected',
      rejectionReason: reason.trim(),
      reviewedByUid: auth.currentUser?.uid ?? null,
      reviewedAt: serverTimestamp(),
    });
  });
}

/**
 * Reopens an applied, rejected, or legacy-undone import for review. Applied
 * imports first reverse the balance with a new offsetting ledger entry; rejected
 * and already-undone imports do not touch balances. Audit fields and original
 * ledger entries are retained.
 */
export async function undoEtransferImport(importId: string, reason: string): Promise<void> {
  return serviceCall('undoEtransferImport', async () => {
    if (!reason.trim()) throw new Error('A reason for undoing this is required.');

    const importRef = doc(refs.etransferImports, importId);
    const importBeforeUndo = await getDoc(importRef);
    if (!importBeforeUndo.exists()) throw new Error('Import record not found.');
    const beforeData = importBeforeUndo.data();
    const [playersForMatching, sessionsBeforeUndo] = await Promise.all([
      fetchPlayersForMatching(),
      beforeData.status === 'applied'
        ? fetchSessions({ orderDirection: 'asc' })
        : Promise.resolve([]),
    ]);
    const rematch = await resolveSenderMatch(
      (beforeData.senderEmail as string | null) ?? null,
      (beforeData.senderName as string) ?? '',
      playersForMatching
    );
    const matchedPlayerBeforeUndo = playersForMatching.find(
      (player) => player.id === beforeData.matchedPlayerId
    );
    const automaticSessionIds = sessionsBeforeUndo
      .filter((session) => session.players.some((entry) => (
        entry.id === beforeData.matchedPlayerId
        && entry.paidVia === 'balance'
        && !!entry.settledByEtransferImportId
      )))
      .map((session) => session.id);

    await runTransaction(db, async (tx) => {
      const importSnap = await tx.get(importRef);
      if (!importSnap.exists()) throw new Error('Import record not found.');
      const importData = importSnap.data();
      const previousStatus = importData.status as EtransferImport['status'];
      if (!['applied', 'rejected', 'undone'].includes(previousStatus)) {
        throw new Error('Only a reviewed import can be undone.');
      }

      const playerId = previousStatus === 'applied'
        ? importData.matchedPlayerId as string | null
        : null;
      const appliedAmount = previousStatus === 'applied'
        ? importData.appliedAmount as number | undefined
        : undefined;
      if (previousStatus === 'applied' && (!Number.isFinite(appliedAmount) || (appliedAmount ?? 0) <= 0)) {
        throw new Error('This applied import has no valid amount to reverse.');
      }
      const delta = previousStatus === 'applied' ? -(appliedAmount as number) : 0;
      const playerRef = playerId ? doc(refs.players, playerId) : null;
      const sessionIdsToInspect = previousStatus === 'applied' ? automaticSessionIds : [];
      const [playerSnap, settledSessionSnaps] = await Promise.all([
        playerRef ? tx.get(playerRef) : Promise.resolve(null),
        Promise.all(sessionIdsToInspect.map((sessionId) => tx.get(doc(refs.sessions, sessionId)))),
      ]);
      if (previousStatus === 'applied' && (!playerRef || !playerSnap?.exists())) {
        throw new Error('The credited player no longer exists, so this import cannot be safely undone.');
      }
      if (
        previousStatus === 'applied'
        && (
          ((playerSnap!.data().balance as number) ?? 0) !== matchedPlayerBeforeUndo?.balance
          || ((playerSnap!.data().owed as number) ?? 0) !== matchedPlayerBeforeUndo?.owed
        )
      ) {
        throw new Error('The player balance or debt changed. Try undo again with the latest data.');
      }

      const reversibleSessions: {
        ref: ReturnType<typeof doc>;
        players: SessionPlayer[];
        cost: number;
      }[] = [];
      if (playerId) {
        for (const sessionSnap of settledSessionSnaps) {
          if (!sessionSnap.exists()) continue;
          const players = sessionSnap.data().players as SessionPlayer[];
          const participant = players.find((entry) => entry.id === playerId);
          if (
            !participant
            || participant.paidVia !== 'balance'
            || !participant.settledByEtransferImportId
          ) {
            continue;
          }
          reversibleSessions.push({
            ref: sessionSnap.ref,
            cost: participant.cost,
            players: players.map((entry) => entry.id === playerId
              ? {
                  ...entry,
                  paid: false,
                  comped: false,
                  paidVia: null,
                  paidBy: null,
                  settledAt: Timestamp.now(),
                  settledByEtransferImportId: null,
                }
              : entry),
          });
        }
      }
      const playerBalance = playerSnap?.exists() ? ((playerSnap.data().balance as number) ?? 0) : 0;
      const sessionsToReopen: typeof reversibleSessions = [];
      let settlementRefundCents = 0;
      let balanceAfterUndoCents = toCents(playerBalance) + toCents(delta);
      if (balanceAfterUndoCents < 0) {
        for (const sessionId of [...sessionIdsToInspect].reverse()) {
          const session = reversibleSessions.find((candidate) => candidate.ref.id === sessionId);
          if (!session) continue;
          sessionsToReopen.push(session);
          settlementRefundCents += toCents(session.cost);
          balanceAfterUndoCents += toCents(session.cost);
          if (balanceAfterUndoCents >= 0) break;
        }
      }

      tx.update(importRef, {
        status: 'pending',
        undoneByUid: auth.currentUser?.uid ?? null,
        undoneAt: serverTimestamp(),
        undoneReason: reason.trim(),
        matchedPlayerId: rematch.playerId,
        matchSource: rematch.source,
        autoSettledSessionIds: [],
      });

      if (playerRef && playerSnap?.exists()) {
        const before = (playerSnap.data().balance as number) ?? 0;
        let runningBalanceCents = toCents(before);
        for (const session of sessionsToReopen) {
          tx.update(session.ref, { players: session.players });
          tx.set(doc(refs.balanceLedger), {
            playerId,
            sessionId: session.ref.id,
            delta: session.cost,
            balanceBefore: fromCents(runningBalanceCents),
            balanceAfter: fromCents(runningBalanceCents + toCents(session.cost)),
            reason: 'settlement-undo',
            note: `Refunded automatic settlement — undoing e-Transfer import: ${reason.trim()}`,
            walletAdjustment: true,
            createdAt: serverTimestamp(),
          });
          runningBalanceCents += toCents(session.cost);
        }
        const netDelta = fromCents(toCents(delta) + settlementRefundCents);
        tx.update(playerRef, {
          balance: increment(netDelta),
          ...(settlementRefundCents > 0 ? { owed: increment(fromCents(settlementRefundCents)) } : {}),
        });
        tx.set(doc(refs.balanceLedger), {
          playerId,
          sessionId: null,
          delta,
          balanceBefore: fromCents(runningBalanceCents),
          balanceAfter: fromCents(runningBalanceCents + toCents(delta)),
          reason: 'etransfer-import-undo',
          note: `Reversed — undoing e-Transfer import: ${reason.trim()}`,
          walletAdjustment: true,
          createdAt: serverTimestamp(),
        });
      }
    });
  });
}
