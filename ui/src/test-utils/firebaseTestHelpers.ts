/**
 * App-specific glue between the fake Firestore/Auth (`fakeFirestore.ts`,
 * `fakeAuth.ts`) and this app's `services/firebase/client` module — mainly
 * for building the `clubs/{clubId}/{collection}/{docId}` paths its `refs`
 * getters use, so tests can seed/read data without hand-building path
 * strings. Import from test files only.
 */
import { setCurrentClubId } from '../services/firebase/client';
import { auth } from '../services/firebase/client';
import type { ClubDataCollection } from '../services/firebase/client';
import { __resetFirestore, __seedDoc, __getDocData, Timestamp } from './fakeFirestore';
import { __resetAuth } from './fakeAuth';
import type { FakeUser } from './fakeAuth';

export const TEST_CLUB_ID = 'test-club';

/** Resets the fake Firestore store and auth state, and points the current club at TEST_CLUB_ID. Call in `beforeEach`. */
export function resetFirebaseTestState(): void {
  __resetFirestore();
  setCurrentClubId(TEST_CLUB_ID);
  __resetAuth();
}

/** Seeds a document under `clubs/{TEST_CLUB_ID}/{collectionName}/{id}`. Accepts a plain object or a concrete typed shape (e.g. `Player`) — either is fine here since this is a test-only convenience, not a runtime write path. */
export function seedClubDoc<T extends object>(collectionName: ClubDataCollection, id: string, data: T): void {
  __seedDoc(`clubs/${TEST_CLUB_ID}/${collectionName}/${id}`, data as unknown as Record<string, unknown>);
}

/** Reads the current raw data for a previously-seeded (or since-written) club-scoped doc. */
export function getClubDocData(collectionName: ClubDataCollection, id: string): Record<string, unknown> | undefined {
  return __getDocData(`clubs/${TEST_CLUB_ID}/${collectionName}/${id}`);
}

/** Seeds `users/{uid}`. */
export function seedUserDoc<T extends object>(uid: string, data: T): void {
  __seedDoc(`users/${uid}`, data as unknown as Record<string, unknown>);
}

/** Seeds `clubs/{clubId}` (the top-level club doc, not a club-data subcollection). */
export function seedClubMetaDoc<T extends object>(clubId: string, data: T): void {
  __seedDoc(`clubs/${clubId}`, data as unknown as Record<string, unknown>);
}

/** Seeds `clubs/{clubId}/members/{uid}`. */
export function seedMemberDoc<T extends object>(uid: string, data: T, clubId: string = TEST_CLUB_ID): void {
  __seedDoc(`clubs/${clubId}/members/${uid}`, data as unknown as Record<string, unknown>);
}

/** Sets the signed-in fake user (`auth.currentUser`). Pass `null` to sign out. */
export function setCurrentUser(user: FakeUser | null): void {
  (auth as unknown as { __setCurrentUser: (u: FakeUser | null) => void }).__setCurrentUser(user);
}

/** Builds a fake Firestore Timestamp for a given date — handy for seeded doc fields. */
export function ts(date: Date | string): Timestamp {
  return Timestamp.fromDate(typeof date === 'string' ? new Date(date) : date);
}
