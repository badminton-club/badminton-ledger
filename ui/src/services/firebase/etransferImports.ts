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
} from 'firebase/firestore';
import { db, refs, auth } from './client';
import { serviceCall, toJSDate } from './utils';
import {
  searchEtransferEmails,
  labelEtransferEmailProcessed,
  labelEtransferEmailRejected,
  DEFAULT_ETRANSFER_SENDER_ADDRESS,
  DEFAULT_ETRANSFER_SEARCH_AFTER_DATE,
  type ParsedEtransferEmail,
} from './gmail';
import type { EtransferImport, EtransferSenderMapping, Player } from 'types';

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
    const playerSnap = toCreate.length > 0 ? await getDocs(refs.players) : null;
    const players = playerSnap
      ? playerSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Player, 'id'>) }))
      : [];

    for (const email of toCreate) {
      await createPendingImport(email, players);
    }

    return { found: parsed.length, created: toCreate.length };
  });
}

async function createPendingImport(email: ParsedEtransferEmail, players: Player[]): Promise<void> {
  const mappedPlayerId = await lookupSenderMapping(email.senderEmail, email.senderName);
  let matchedPlayerId: string | null = mappedPlayerId;
  let matchSource: EtransferImport['matchSource'] = mappedPlayerId ? 'mapping' : null;

  if (!matchedPlayerId) {
    const candidate = findUniqueBestPlayerMatch(email.senderName, players);
    if (candidate) {
      matchedPlayerId = candidate.id;
      matchSource = 'name-lookup';
    }
  }

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
    matchedPlayerId,
    matchSource,
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
 * Applies a reviewed import: credits the matched player's balance, logs a
 * `balanceLedger` entry (reason `'etransfer-import'`, undoable later), and marks
 * the import `applied`. `playerId`/`amount` are whatever the admin confirmed in
 * the review UI — not necessarily the original match/parsed amount, since both
 * are editable before applying. Best-effort labels the Gmail message
 * "Processed" afterwards; if that call fails the balance change still stands
 * (the label is just to avoid re-finding it on the next search) and the caller
 * gets `labelFailed: true` so it can surface a soft warning.
 */
export async function applyEtransferImport(
  importId: string,
  options: { playerId: string; amount: number; rememberMapping: boolean }
): Promise<{ labelFailed: boolean }> {
  return serviceCall('applyEtransferImport', async () => {
    if (!Number.isFinite(options.amount) || options.amount <= 0) {
      throw new Error('Enter a valid positive amount.');
    }

    const importRef = doc(refs.etransferImports, importId);
    const uid = auth.currentUser?.uid ?? null;

    const { gmailMessageId, senderEmail, senderName } = await runTransaction(db, async (tx) => {
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
        gmailMessageId: (importData.gmailMessageId as string) ?? importId,
        senderEmail: (importData.senderEmail as string | null) ?? null,
        senderName: (importData.senderName as string) ?? '',
      };
    });

    if (options.rememberMapping) {
      await saveEtransferSenderMapping(senderEmail, senderName, options.playerId);
    }

    let labelFailed = false;
    try {
      await labelEtransferEmailProcessed(gmailMessageId);
    } catch (err) {
      console.error('[applyEtransferImport] labeling failed', err);
      labelFailed = true;
    }
    return { labelFailed };
  });
}

/**
 * Rejects a reviewed import (e.g. it's not actually a club payment, or the
 * amount/sender couldn't be resolved) without touching any balance. Labels the
 * Gmail message "Rejected" (distinct from "Processed", which is reserved for
 * applied imports) so it's clear in Gmail itself why it was skipped, and so it
 * isn't found again on the next search.
 */
export async function rejectEtransferImport(importId: string, reason: string): Promise<{ labelFailed: boolean }> {
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

    let labelFailed = false;
    try {
      await labelEtransferEmailRejected((importData.gmailMessageId as string) ?? importId);
    } catch (err) {
      console.error('[rejectEtransferImport] labeling failed', err);
      labelFailed = true;
    }
    return { labelFailed };
  });
}

/**
 * Undoes a previously applied import: reverses the balance with a new offsetting
 * `balanceLedger` entry (the original is never edited/deleted, matching the
 * undo pattern used for payout/balance adjustments elsewhere in the app) and
 * marks the import `undone`. The Gmail message is deliberately left labelled
 * "Processed" — undo corrects the ledger, it doesn't put the email back in the
 * queue to be re-matched and re-applied.
 */
export async function undoEtransferImport(importId: string, reason: string): Promise<void> {
  return serviceCall('undoEtransferImport', async () => {
    if (!reason.trim()) throw new Error('A reason for undoing this is required.');

    const importRef = doc(refs.etransferImports, importId);

    await runTransaction(db, async (tx) => {
      const importSnap = await tx.get(importRef);
      if (!importSnap.exists()) throw new Error('Import record not found.');
      const importData = importSnap.data();
      if (importData.status !== 'applied') {
        throw new Error('Only an applied import can be undone.');
      }

      const playerId = importData.matchedPlayerId as string | null;
      const delta = -((importData.appliedAmount as number) ?? 0);
      const playerRef = playerId ? doc(refs.players, playerId) : null;
      const playerSnap = playerRef ? await tx.get(playerRef) : null;

      tx.update(importRef, {
        status: 'undone',
        undoneByUid: auth.currentUser?.uid ?? null,
        undoneAt: serverTimestamp(),
        undoneReason: reason.trim(),
      });

      if (playerRef && playerSnap?.exists()) {
        const before = (playerSnap.data().balance as number) ?? 0;
        tx.update(playerRef, { balance: increment(delta) });
        tx.set(doc(refs.balanceLedger), {
          playerId,
          sessionId: null,
          delta,
          balanceBefore: before,
          balanceAfter: before + delta,
          reason: 'etransfer-import-undo',
          note: `Reversed — undoing e-Transfer import: ${reason.trim()}`,
          walletAdjustment: true,
          createdAt: serverTimestamp(),
        });
      }
    });
  });
}
