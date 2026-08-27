/**
 * Minimal fake of `firebase/auth`, wired in for all tests via the
 * `moduleNameMapper` override in package.json's "jest" config. See
 * `fakeFirestore.ts` for the overall approach.
 */

export interface FakeUser {
  uid: string;
  displayName: string | null;
  email: string | null;
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
}
