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

// Minimal — names are resolved from the Redux players slice, never stored in sessions
export interface SessionPlayer {
  id: string;
  percentage: number;
  cost: number;
  paid: boolean;
  comped?: boolean; // player settled directly with the owner — excluded from owner payout
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
}

// One row in the payout ledger: money collected from players (a payment or a manual
// balance adjustment) that is owed to the owner, or a payout that reduces the balance.
export interface PayoutLedgerEntry {
  id: string;
  date: Date;
  type: 'payment' | 'adjustment' | 'comp' | 'payout';
  amount: number;
  playerId: string | null;
  note: string;
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
