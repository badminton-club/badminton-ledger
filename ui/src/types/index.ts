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
  highlighted: boolean;
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
