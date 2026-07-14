import {
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  type User,
} from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from './client';
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
 * Returns true if the given (or current) user is an admin: their UID exists in
 * the `admins` collection, or `users/{uid}` has `isAdmin: true` / `role: 'admin'`.
 * Never throws — resolves to false on any error so callers can gate UI safely.
 */
export async function checkIfAdmin(uid?: string | null): Promise<boolean> {
  const userId = uid ?? auth.currentUser?.uid ?? null;
  if (!userId) return false;

  try {
    const adminSnap = await getDoc(doc(db, 'admins', userId));
    if (adminSnap.exists()) return true;

    const userSnap = await getDoc(doc(db, 'users', userId));
    if (userSnap.exists()) {
      const data = userSnap.data();
      return data?.isAdmin === true || data?.role === 'admin';
    }
    return false;
  } catch (err) {
    console.error('[checkIfAdmin]', err);
    return false;
  }
}
