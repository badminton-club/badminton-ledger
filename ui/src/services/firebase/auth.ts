import {
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  updateProfile,
  sendEmailVerification,
  sendPasswordResetEmail,
  sendSignInLinkToEmail,
  isSignInWithEmailLink,
  signInWithEmailLink,
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

/**
 * Creates a new email/password account. `username` is optional — if given, it
 * sets the display name shown across the app (the same role Google's
 * displayName plays); if left blank, the app falls back to showing the
 * user's email everywhere displayName would normally appear. Also sends a
 * verification email but doesn't block on it — the account is usable
 * immediately; see `EmailVerificationBanner` for the non-blocking reminder
 * shown until the user confirms their address.
 */
export async function signUpWithEmail(email: string, username: string, password: string): Promise<User> {
  return serviceCall('signUpWithEmail', async () => {
    const credential = await createUserWithEmailAndPassword(auth, email, password);
    if (username.trim()) {
      await updateProfile(credential.user, { displayName: username.trim() });
    }
    try {
      await sendEmailVerification(credential.user);
    } catch (err) {
      // Don't fail the whole sign-up over a verification-email hiccup — the
      // "resend" action in the verification banner covers this case.
      console.error('[signUpWithEmail] sendEmailVerification failed', err);
    }
    return credential.user;
  });
}

/** Signs in an existing email/password account. */
export async function signInWithEmail(email: string, password: string): Promise<User> {
  return serviceCall('signInWithEmail', async () => {
    const credential = await signInWithEmailAndPassword(auth, email, password);
    return credential.user;
  });
}

/** Re-sends the verification email to the currently signed-in user. */
export async function resendVerificationEmail(): Promise<void> {
  return serviceCall('resendVerificationEmail', async () => {
    if (!auth.currentUser) throw new Error('You must be signed in.');
    await sendEmailVerification(auth.currentUser);
  });
}

/** Sends a password-reset email for the given address. */
export async function sendPasswordReset(email: string): Promise<void> {
  return serviceCall('sendPasswordReset', async () => {
    await sendPasswordResetEmail(auth, email);
  });
}

/** Emails a passwordless sign-in link that returns to the supplied app URL. */
export async function sendEmailSignInLink(email: string, returnUrl: string): Promise<void> {
  return serviceCall('sendEmailSignInLink', async () => {
    await sendSignInLinkToEmail(auth, email, {
      url: returnUrl,
      handleCodeInApp: true,
    });
  });
}

/** Returns whether the URL is a Firebase passwordless sign-in link. */
export function isEmailSignInLink(link: string): boolean {
  return isSignInWithEmailLink(auth, link);
}

/** Completes passwordless sign-in using the email that requested the link. */
export async function completeEmailSignIn(email: string, link: string): Promise<User> {
  return serviceCall('completeEmailSignIn', async () => {
    const credential = await signInWithEmailLink(auth, email, link);
    return credential.user;
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
