/**
 * Minimal fake of `firebase/auth`, wired in for all tests via the
 * `moduleNameMapper` override in package.json's "jest" config. See
 * `fakeFirestore.ts` for the overall approach.
 */

export interface FakeUser {
  uid: string;
  displayName: string | null;
  email: string | null;
  emailVerified?: boolean;
  providerData?: Array<{ providerId: string }>;
}

export class GoogleAuthProvider {
  private scopes: string[] = [];
  private customParameters: Record<string, string> = {};

  addScope(scope: string): void {
    this.scopes.push(scope);
  }
  setCustomParameters(params: Record<string, string>): void {
    this.customParameters = params;
  }
  getScopes(): string[] {
    return this.scopes;
  }
  getCustomParameters(): Record<string, string> {
    return this.customParameters;
  }

  /**
   * Real Firebase reads the OAuth credential (incl. access token) back off a
   * sign-in/reauth result via this static method. Our fake just looks for a
   * `__credential` field on whatever the queued `reauthenticateWithPopup`/
   * `signInWithPopup` implementation resolved with — see
   * `__setReauthImplementation` below.
   */
  static credentialFromResult(result: unknown): { accessToken: string } | null {
    return (result as { __credential?: { accessToken: string } } | undefined)?.__credential ?? null;
  }
}

export class FakeAuth {
  currentUser: FakeUser | null = null;
  private listeners: Array<(user: FakeUser | null) => void> = [];

  __setCurrentUser(user: FakeUser | null): void {
    this.currentUser = user;
    this.listeners.forEach(cb => cb(user));
  }

  __addListener(cb: (user: FakeUser | null) => void): () => void {
    this.listeners.push(cb);
    return () => {
      this.listeners = this.listeners.filter(l => l !== cb);
    };
  }
}

const AUTH_INSTANCE = new FakeAuth();

export function getAuth(): FakeAuth {
  return AUTH_INSTANCE;
}

export async function signInWithPopup(auth: FakeAuth, _provider: GoogleAuthProvider): Promise<{ user: FakeUser }> {
  if (!auth.currentUser) {
    throw new Error('[fakeAuth] signInWithPopup called with no user queued — call __setCurrentUser first.');
  }
  return { user: auth.currentUser };
}

export async function reauthenticateWithPopup(user: FakeUser, provider: GoogleAuthProvider): Promise<{ user: FakeUser }> {
  if (!reauthImpl) {
    throw new Error(
      '[fakeAuth] reauthenticateWithPopup called with no implementation queued — call __setReauthImplementation first.'
    );
  }
  return reauthImpl(user, provider);
}

type ReauthResult = { user: FakeUser; __credential?: { accessToken: string } };
type ReauthImplementation = (user: FakeUser, provider: GoogleAuthProvider) => Promise<ReauthResult>;
let reauthImpl: ReauthImplementation | null = null;

/**
 * Test-only control for `reauthenticateWithPopup` (used by drive.ts to get a
 * scoped Drive access token). Queue either a resolved result — include
 * `__credential: { accessToken }` so `GoogleAuthProvider.credentialFromResult`
 * can read it back — or a rejection to simulate a cancelled/failed popup.
 *
 * Example:
 *   __setReauthImplementation(async (user) => ({ user, __credential: { accessToken: 'tok' } }));
 *   __setReauthImplementation(async () => { throw new FirebaseError('auth/popup-closed-by-user', '...'); });
 */
export function __setReauthImplementation(fn: ReauthImplementation | null): void {
  reauthImpl = fn;
}

export async function signOut(auth: FakeAuth): Promise<void> {
  auth.__setCurrentUser(null);
}

export function onAuthStateChanged(
  auth: FakeAuth,
  callback: (user: FakeUser | null) => void
): () => void {
  const unsubscribe = auth.__addListener(callback);
  Promise.resolve().then(() => callback(auth.currentUser));
  return unsubscribe;
}

/** Test-only control: resets the shared fake auth instance's user to signed-out. */
export function __resetAuth(): void {
  AUTH_INSTANCE.__setCurrentUser(null);
  reauthImpl = null;
  registeredAccounts.clear();
  verificationEmailsSent.length = 0;
  passwordResetsSent.length = 0;
  uidCounter = 0;
}

// ─── Email/password auth ────────────────────────────────────────────────────
// A tiny in-memory "user directory" keyed by lowercased email, so sign-up/
// sign-in/duplicate-email/wrong-password behave realistically without a real
// Firebase project. Mirrors the real SDK's error `.code`s (auth/*) so the
// app's own error-message mapping can be tested the same way it runs in prod.

export class FirebaseAuthError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'FirebaseError';
  }
}

interface RegisteredAccount {
  uid: string;
  email: string;
  password: string;
  displayName: string | null;
  emailVerified: boolean;
}

const registeredAccounts = new Map<string, RegisteredAccount>();
const verificationEmailsSent: string[] = [];
const passwordResetsSent: string[] = [];
let uidCounter = 0;

function toFakeUser(account: RegisteredAccount): FakeUser {
  return {
    uid: account.uid,
    email: account.email,
    displayName: account.displayName,
    emailVerified: account.emailVerified,
    providerData: [{ providerId: 'password' }],
  };
}

export async function createUserWithEmailAndPassword(
  authInstance: FakeAuth,
  email: string,
  password: string
): Promise<{ user: FakeUser }> {
  const key = email.toLowerCase();
  if (registeredAccounts.has(key)) {
    throw new FirebaseAuthError('auth/email-already-in-use', 'The email address is already in use by another account.');
  }
  if (password.length < 6) {
    throw new FirebaseAuthError('auth/weak-password', 'Password should be at least 6 characters.');
  }
  uidCounter += 1;
  const account: RegisteredAccount = {
    uid: `email-user-${uidCounter}`,
    email,
    password,
    displayName: null,
    emailVerified: false,
  };
  registeredAccounts.set(key, account);
  const user = toFakeUser(account);
  authInstance.__setCurrentUser(user);
  return { user };
}

export async function signInWithEmailAndPassword(
  authInstance: FakeAuth,
  email: string,
  password: string
): Promise<{ user: FakeUser }> {
  const account = registeredAccounts.get(email.toLowerCase());
  if (!account) {
    throw new FirebaseAuthError('auth/invalid-credential', 'Invalid email or password.');
  }
  if (account.password !== password) {
    throw new FirebaseAuthError('auth/invalid-credential', 'Invalid email or password.');
  }
  const user = toFakeUser(account);
  authInstance.__setCurrentUser(user);
  return { user };
}

/** Updates the given (fake) user's profile fields — only `displayName` is used by this app. */
export async function updateProfile(user: FakeUser, updates: { displayName?: string | null }): Promise<void> {
  if (updates.displayName === undefined) return;
  user.displayName = updates.displayName;
  const account = [...registeredAccounts.values()].find((a) => a.uid === user.uid);
  if (account) account.displayName = updates.displayName;
}

/** Records that a verification email was "sent" to the given user — assert via `__getVerificationEmailsSent()`. */
export async function sendEmailVerification(user: FakeUser): Promise<void> {
  if (!user.email) throw new FirebaseAuthError('auth/invalid-user', 'User has no email.');
  verificationEmailsSent.push(user.email);
}

/** Records that a password-reset email was "sent" — throws auth/user-not-found for an unregistered address, like real Firebase. */
export async function sendPasswordResetEmail(_authInstance: FakeAuth, email: string): Promise<void> {
  if (!registeredAccounts.has(email.toLowerCase())) {
    throw new FirebaseAuthError('auth/user-not-found', 'There is no account with that email address.');
  }
  passwordResetsSent.push(email);
}

/** Test-only: marks a registered account's email as verified (simulating the user clicking the emailed link). */
export function __markEmailVerified(email: string): void {
  const account = registeredAccounts.get(email.toLowerCase());
  if (account) {
    account.emailVerified = true;
    if (AUTH_INSTANCE.currentUser?.uid === account.uid) {
      AUTH_INSTANCE.__setCurrentUser(toFakeUser(account));
    }
  }
}

/** Test-only: pre-registers an account directly (skipping sign-up), e.g. to test sign-in against an existing user. */
export function __registerAccount(email: string, password: string, displayName: string | null = null): FakeUser {
  uidCounter += 1;
  const account: RegisteredAccount = { uid: `email-user-${uidCounter}`, email, password, displayName, emailVerified: false };
  registeredAccounts.set(email.toLowerCase(), account);
  return toFakeUser(account);
}

/** Test-only: the list of email addresses a verification email was "sent" to, in order. */
export function __getVerificationEmailsSent(): string[] {
  return [...verificationEmailsSent];
}

/** Test-only: the list of email addresses a password-reset email was "sent" to, in order. */
export function __getPasswordResetsSent(): string[] {
  return [...passwordResetsSent];
}
