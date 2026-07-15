import { initializeApp, FirebaseApp } from 'firebase/app';
import { getFirestore, Firestore, collection, CollectionReference } from 'firebase/firestore';
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

// Named exports — typos are caught at import time by TypeScript
export const refs = {
  sessions:             collection(db, 'sessions')             as CollectionReference,
  players:              collection(db, 'players')              as CollectionReference,
  birdieInventory:      collection(db, 'birdieInventory')      as CollectionReference,
  courtCredits:         collection(db, 'courtCredits')         as CollectionReference,
  inventoryAdjustments: collection(db, 'inventoryAdjustments') as CollectionReference,
  transactions:         collection(db, 'transactions'),        // was "transcations" — fixed
  balanceLedger:        collection(db, 'balanceLedger')        as CollectionReference,
  archivedSessions:     collection(db, 'archivedSessions')     as CollectionReference,
};

export { db, auth };
