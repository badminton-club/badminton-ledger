import { initializeApp, FirebaseApp } from 'firebase/app';
import { getFirestore, Firestore, collection, doc, CollectionReference, DocumentReference } from 'firebase/firestore';
import { getAuth, Auth } from 'firebase/auth';

const firebaseConfig = {
  apiKey:            process.env.REACT_APP_FIREBASE_API_KEY,
  authDomain:        process.env.REACT_APP_FIREBASE_AUTH_DOMAIN,
  projectId:         process.env.REACT_APP_FIREBASE_PROJECT_ID,
  storageBucket:     process.env.REACT_APP_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID,
  appId:             process.env.REACT_APP_FIREBASE_APP_ID,
  measurementId:     process.env.REACT_APP_FIREBASE_MEASUREMENT_ID,
};

let app: FirebaseApp;
let db: Firestore;
let auth: Auth;

try {
  app = initializeApp(firebaseConfig);
  db  = getFirestore(app);
  auth = getAuth(app);
} catch (error) {
  console.error('Firebase initialization failed:', error);
  throw error; // fail loudly at startup rather than silently producing null refs
}

// ─── Multi-club scoping ─────────────────────────────────────────────────────────
// All app data lives under `clubs/{clubId}/{collection}`. The "current club" is a
// module-level value set when the user selects a club, so the `refs` getters below
// resolve to the active club without threading a clubId through every call site.

export const CLUB_DATA_COLLECTIONS = [
  'sessions',
  'players',
  'birdieInventory',
  'courtCredits',
  'inventoryAdjustments',
  'transactions',
  'balanceLedger',
  'archivedSessions',
  'payouts',
] as const;

export type ClubDataCollection = (typeof CLUB_DATA_COLLECTIONS)[number];

let currentClubId: string | null = null;

export function setCurrentClubId(id: string | null): void {
  currentClubId = id;
}

export function getCurrentClubId(): string | null {
  return currentClubId;
}

function requireClubId(): string {
  if (!currentClubId) {
    throw new Error('No club selected — set a current club before accessing club data.');
  }
  return currentClubId;
}

/** Collection ref for a club-scoped collection (defaults to the current club). */
export function clubCollection(name: ClubDataCollection, clubId: string = requireClubId()): CollectionReference {
  return collection(db, 'clubs', clubId, name) as CollectionReference;
}

// Club-aware data refs. Each access re-resolves against the current club, so switching
// clubs is just `setCurrentClubId(...)` — no refs need to be rebuilt.
export const refs = {
  get sessions()             { return clubCollection('sessions'); },
  get players()              { return clubCollection('players'); },
  get birdieInventory()      { return clubCollection('birdieInventory'); },
  get courtCredits()         { return clubCollection('courtCredits'); },
  get inventoryAdjustments() { return clubCollection('inventoryAdjustments'); },
  get transactions()         { return clubCollection('transactions'); },
  get balanceLedger()        { return clubCollection('balanceLedger'); },
  get archivedSessions()     { return clubCollection('archivedSessions'); },
  get payouts()              { return clubCollection('payouts'); },
};

// ─── Top-level (not club-scoped) refs ──────────────────────────────────────────
export const clubsRef = collection(db, 'clubs') as CollectionReference;
export const usersRef = collection(db, 'users') as CollectionReference;

export function clubDoc(clubId: string): DocumentReference {
  return doc(db, 'clubs', clubId);
}
export function membersRef(clubId: string): CollectionReference {
  return collection(db, 'clubs', clubId, 'members') as CollectionReference;
}
export function memberDoc(clubId: string, uid: string): DocumentReference {
  return doc(db, 'clubs', clubId, 'members', uid);
}
export function linkRequestsRef(clubId: string): CollectionReference {
  return collection(db, 'clubs', clubId, 'linkRequests') as CollectionReference;
}
export function linkRequestDoc(clubId: string, uid: string): DocumentReference {
  return doc(db, 'clubs', clubId, 'linkRequests', uid);
}
export function userDoc(uid: string): DocumentReference {
  return doc(db, 'users', uid);
}

export { db, auth };
