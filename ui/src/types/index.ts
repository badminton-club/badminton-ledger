import { Timestamp } from 'firebase/firestore';

// ─── Players ────────────────────────────────────────────────────────────────

export interface Player {
  id: string;
  firstName: string;
  firstNameLower: string;
  lastName: string | null;
  lastNameLower: string | null;
  email: string | null;
  balance: number;
  owed: number; // unsettled session debt (sum of costs for sessions the player hasn't settled)
  description: string;
  sessionCount: number; // replaces attendedSessionIds[] — cheap increment, no unbounded array
  createdAt: Timestamp;
}

export type NewPlayerInput = Pick<Player,
  'firstName' | 'lastName' | 'email' | 'balance' | 'description'
>;

// ─── Sessions ────────────────────────────────────────────────────────────────

export interface Session {
  id: string;
  date: Date;
  location?: string;
  durationHours: number;
  courtCount: number;
  totalCost: number;
  totalCourtCost: number;
  totalBirdieCost: number;
  totalSessionCost: number;
  birdieUsage: BirdieUsage[];
  courtCreditUsage: CourtCreditUsage[];
  players: SessionPlayer[];
  createdAt: Timestamp;
  updatedAt?: Timestamp;
}

// How a player's session cost was settled:
//  'etransfer' — paid the club directly by e-Transfer (owed to the owner, counts in payout)
//  'balance'   — drawn from the player's own prepaid balance at session time
//  'transfer'  — drawn from *another* player's prepaid balance (see SessionPlayer.paidBy)
//  'comp'      — settled directly with the owner (excluded from payout)
//  null        — unpaid / owing
export type PaidVia = 'etransfer' | 'balance' | 'transfer' | 'comp' | null;

// Minimal — names are resolved from the Redux players slice, never stored in sessions
export interface SessionPlayer {
  id: string;
  percentage: number;
  cost: number;
  paid: boolean;
  paidVia?: PaidVia; // how `paid`/`comped` was settled; disambiguates balance accounting
  paidBy?: string | null; // when paidVia === 'transfer', the id of the player whose balance covered this cost
  comped?: boolean; // player settled directly with the owner — excluded from owner payout
  highlighted: boolean;
  settledAt?: Timestamp | null; // when paid/comped status was last changed
  settledByEtransferImportId?: string | null; // automatic batch settlement attribution for safe undo
}

export interface BirdieUsage {
  id: string;
  quantity: number;
}

export interface CourtCreditUsage {
  id: string;
  hoursUsed: number;
}

// ─── Inventory ───────────────────────────────────────────────────────────────

export interface BirdieBatch {
  id: string;
  name: string;
  costPerTube: number;
  birdsPerTube: number;
  tubesPurchased: number;
  unopenedTubesRemaining: number;
  birdsInOpenTube: number;
  purchaserName: string;
  purchaseDate: Date;
  notes?: string;
  createdAt: Timestamp;
}

export interface CourtCreditBatch {
  id: string;
  name?: string;
  location?: string;
  totalCost: number;
  costPerHour: number;
  hoursPurchased: number;  // renamed from 'hours' — clearer intent
  remainingHours: number;
  purchaserName: string;
  purchaseDate: Date;
  notes?: string;
  createdAt: Timestamp;
}

// ─── Transactions (discriminated union — no more ambiguous quantity field) ────

export type Transaction = BirdieTransaction | CourtTransaction;

interface BaseTransaction {
  id: string;
  sessionId: string;
  batchId: string;
  cost: number;
  date: Timestamp;
  createdAt: Timestamp;
  description?: string;
}

export interface BirdieTransaction extends BaseTransaction {
  resourceType: 'birdie';
  quantityUsed: number;
}

export interface CourtTransaction extends BaseTransaction {
  resourceType: 'court';
  hoursUsed: number;
}

// ─── Owner Payouts ─────────────────────────────────────────────────────────────

// A recorded cashout to the owner for the money collected from players.
export interface OwnerPayout {
  id: string;
  amount: number;             // amount paid to the owner in this cashout
  note: string | null;
  paidByUid: string | null;
  date: Timestamp;            // when the payout was made
  createdAt: Timestamp;
  voided?: boolean;           // true if this payout was undone — excluded from totalPaid
  voidedAt?: Timestamp | null;
  voidedByUid?: string | null;
  voidedNote?: string | null; // admin-entered reason for the undo
}

// One row in the payout ledger: money collected from players (a payment or a manual
// balance adjustment) that is owed to the owner, or a payout that reduces the balance.
// 'balance' entries (prepaid-wallet draws/refunds tied to a session) are shown for
// record keeping, like comps, but never count toward the total — that money was
// already collected from the player whenever they topped up their balance.
export interface PayoutLedgerEntry {
  id: string;
  date: Date;
  type: 'payment' | 'adjustment' | 'comp' | 'payout' | 'balance';
  amount: number;
  playerId: string | null;
  sessionId: string | null;
  sessionDate: Date | null; // date of the session this entry is settling, if any
  note: string;
  voided: boolean;            // true if this entry has been undone (shown struck-through, excluded from totals)
  voidedNote: string | null;  // admin-entered reason for the undo, when voided
  canUndo: boolean;           // true if the Undo action applies to this row
}

export interface OwnerPayoutSummary {
  totalCollected: number;        // sum of player payments + balance adjustments
  totalPaid: number;             // sum of all recorded payouts
  pending: number;               // totalCollected - totalPaid
  ledger: PayoutLedgerEntry[];   // collected entries + payouts, newest first
}

// ─── Inventory Adjustments ───────────────────────────────────────────────────

export interface FieldChange {
  field: string;
  oldValue: unknown;
  newValue: unknown;
}

export interface InventoryAdjustment {
  id: string;
  adjustmentDate: Timestamp;
  userId: string;
  userName: string;
  resourceType: 'birdieBatch' | 'courtCreditBatch';
  batchId: string;
  batchNameSnapshot: string;
  reason: string;
  changes: FieldChange[];  // was typed as string — now correct
}

// ─── Session Modal ────────────────────────────────────────────────────────────

export type ResolutionStatus =
  | 'pending'
  | 'matched'      // exactly 1 result, auto-selected
  | 'conflict'    // 2+ results, user must pick
  | 'unmatched'    // 0 results
  | 'failed';      // network/query error

export interface NameResolutionItem {
  id: string;                    // stable uuid for React key
  rawName: string;               // original text from paste
  editableName: string;          // user may retype
  isEditing: boolean;
  status: ResolutionStatus;
  candidates: Player[];
  resolvedPlayerId: string | null;
}

// Player that has been confirmed through the resolution step
export interface ConfirmedPlayer {
  id: string;
  percentage: number;
}

export type ModalMode = 'view' | 'paste' | 'resolve' | 'details' | 'edit';

// ─── Clubs (multi-tenant) ──────────────────────────────────────────────────────

export type ClubRole = 'superAdmin' | 'admin' | 'member';

// clubs/{clubId}
export interface Club {
  id: string;
  name: string;
  disabledTabs?: string[];    // tab keys hidden for this club (see features/club/tabs.ts)
  // Sender address searched for Interac e-Transfer autodeposit notifications (see
  // services/firebase/gmail.ts). Configurable since some banks/regions may use a
  // different notification address than the Canadian default.
  etransferSenderAddress?: string;
  // ISO calendar date used as the lower bound for Gmail e-Transfer searches —
  // a one-off custom cutoff. Ignored once etransferSearchWindowDays is set,
  // since a rolling window stays fresh automatically and doesn't need this.
  etransferSearchAfterDate?: string | null;
  // Rolling window (in days) searched back from today, recomputed on every
  // search so it never goes stale — e.g. 7 for "always search the last week".
  // Preferred over etransferSearchAfterDate once set.
  etransferSearchWindowDays?: number | null;
  createdAt?: Timestamp;
}

// clubs/{clubId}/members/{uid}
export interface ClubMembership {
  role: ClubRole;
  playerId?: string | null;   // the player record this user is linked to (set by an admin)
  addedAt?: Timestamp;
}

// A club member as presented to admins (member doc + its uid).
export interface ClubMember {
  uid: string;
  role: ClubRole;
  playerId: string | null;
}

// clubs/{clubId}/linkRequests/{uid} — a user's request for an admin to link them to a player.
export interface LinkRequest {
  uid: string;
  firstName: string;
  lastName: string | null;
  email: string;
  createdAt?: Timestamp;
}

// clubs/{clubId}/profileEditRequests/{uid} — a linked member's proposed change to
// their own player's name/email, pending an admin's approval.
export interface ProfileEditRequest {
  uid: string;
  playerId: string;
  firstName: string;
  lastName: string | null;
  email: string | null;
  createdAt?: Timestamp;
}

// clubs/{clubId}/balanceLedger/{id} — one balance change for a player.
export interface BalanceLedgerEntry {
  id: string;
  playerId: string;
  sessionId: string | null;
  delta: number;
  balanceBefore: number;
  balanceAfter: number;
  reason: string;
  note?: string;
  createdAt?: Timestamp;
  // true when this entry actually moved the player's prepaid balance (e.g. the
  // Players-page balance adjustment); false/absent for entries that only affect
  // the owner payout total (e.g. a custom payout transaction) — those are
  // excluded from the wallet-only Balance History view.
  walletAdjustment?: boolean;
  voided?: boolean;      // true if this entry was undone (kept for audit, shown de-emphasized)
  voidedNote?: string;   // admin-entered reason for the undo, when voided
}

// ─── Gmail e-Transfer autodeposit import ────────────────────────────────────────

export type EtransferImportStatus = 'pending' | 'applied' | 'rejected' | 'undone';

// clubs/{clubId}/etransferImports/{id} — one Interac autodeposit notification email
// found in Gmail, its parsed details, and (once reviewed) what was done about it.
// The Firestore doc ID is always the Gmail message ID, so re-running the Gmail
// search is naturally idempotent — an email already recorded here is never
// re-created. Nothing is ever deleted: applying, rejecting, and undoing all just
// move `status` forward, so every email's history stays fully auditable.
export interface EtransferImport {
  id: string;               // == gmailMessageId
  gmailMessageId: string;
  gmailThreadId: string;
  subject: string;
  senderName: string;       // display name from the "Sent From" field / From header
  senderEmail: string | null; // the sender's own email, from the Reply-To header
  amount: number;            // amount parsed from the email
  memo: string | null;       // the optional "Message" the sender attached
  referenceNumber: string | null;
  emailDate: Timestamp;
  status: EtransferImportStatus;
  // Best-guess player match shown for review — from a saved sender mapping first,
  // then a name lookup; always editable by the admin before applying.
  matchedPlayerId: string | null;
  matchSource: 'mapping' | 'name-lookup' | null;
  // Set once reviewed (applied/rejected); undone imports keep these from the
  // original apply and add the undo fields below.
  reviewedByUid?: string | null;
  reviewedAt?: Timestamp | null;
  appliedAmount?: number | null;         // amount actually credited (may differ if edited)
  balanceLedgerEntryId?: string | null;  // the balanceLedger entry this created, for undo
  autoSettledSessionIds?: string[];       // sessions automatically paid from this import's credited balance
  rejectionReason?: string | null;
  undoneByUid?: string | null;
  undoneAt?: Timestamp | null;
  undoneReason?: string | null;
  createdAt?: Timestamp;
}

// clubs/{clubId}/etransferSenderMappings/{id} — a remembered "this Gmail sender
// is this player" mapping, saved (optionally) when an import is applied so future
// emails from a sender whose e-Transfer name differs from their app name are
// pre-matched automatically. Keyed by the sender's email when known (stable),
// falling back to their normalized display name otherwise.
export interface EtransferSenderMapping {
  id: string;              // normalized sender email, or "name:<lowercased name>"
  senderName: string;      // last-seen display name, for display in the mappings list
  senderEmail: string | null;
  playerId: string;
  updatedAt?: Timestamp;
}

// users/{uid} — the signed-in user's global profile (their saved club list + default)
export interface UserProfile {
  clubs: string[];            // club ids the user has saved
  lastVisitedClub: string | null;
}

// A club as presented in the UI: the club plus this user's role in it.
export interface UserClub {
  id: string;
  name: string;
  role: ClubRole | null;      // null = saved but membership not (yet) granted
}
