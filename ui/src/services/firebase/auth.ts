import {
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  type User,
} from 'firebase/auth';
import { getDoc } from 'firebase/firestore';
import { auth, memberDoc } from './client';
import { serviceCall } from './utils';

/** Opens the Google sign-in popup and resolves with the signed-in user. */
export async function signInWithGoogle(): Promise<User> {
  return serviceCall('signInWithGoogle', async () => {
    const provider = new GoogleAuthProvider();
    const result = await signInWithPopup(auth, provider);
    return result.user;
  });
}

/** Signs the current user out. */
export async function signOutUser(): Promise<void> {
  return serviceCall('signOutUser', () => signOut(auth));
}

/** Subscribes to auth state changes. Returns an unsubscribe function. */
export function onAuthStateChangedListener(
  callback: (user: User | null) => void
): () => void {
  return onAuthStateChanged(auth, callback);
}

/**
 * Returns true if the given (or current) user is an admin of the given club:
 * `clubs/{clubId}/members/{uid}` exists with `role: 'admin'`. Never throws —
 * resolves to false on any error so callers can gate UI safely.
 */
export async function checkIfAdmin(clubId: string | null, uid?: string | null): Promise<boolean> {
  const userId = uid ?? auth.currentUser?.uid ?? null;
  if (!userId || !clubId) return false;

  try {
    const snap = await getDoc(memberDoc(clubId, userId));
    return snap.exists() && snap.data().role === 'admin';
  } catch (err) {
    console.error('[checkIfAdmin]', err);
    return false;
  }
}
