import * as firestore from 'firebase/firestore';
import { auth } from '../client';
import {
  signInWithGoogle,
  signOutUser,
  onAuthStateChangedListener,
  checkIfAdmin,
  signUpWithEmail,
  signInWithEmail,
  resendVerificationEmail,
  sendPasswordReset,
} from '../auth';
import { resetFirebaseTestState, seedMemberDoc, setCurrentUser, TEST_CLUB_ID } from '../../../test-utils/firebaseTestHelpers';
import {
  __getVerificationEmailsSent,
  __getPasswordResetsSent,
  __registerAccount,
  __markEmailVerified,
} from '../../../test-utils/fakeAuth';

const adminUser = { uid: 'admin-1', displayName: 'Admin One', email: 'admin@example.com' };
const memberUser = { uid: 'member-1', displayName: 'Member One', email: 'member@example.com' };

beforeEach(() => {
  resetFirebaseTestState();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('signInWithGoogle', () => {
  it('resolves with the signed-in user returned by the popup flow', async () => {
    setCurrentUser(adminUser);

    await expect(signInWithGoogle()).resolves.toEqual(adminUser);
  });

  it('surfaces popup failures from the auth provider', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    await expect(signInWithGoogle()).rejects.toThrow('call __setCurrentUser first');
    expect(consoleSpy).toHaveBeenCalledWith('[signInWithGoogle]', expect.any(Error));
  });
});

describe('signOutUser', () => {
  it('signs out the current user', async () => {
    setCurrentUser(adminUser);

    await signOutUser();

    expect(auth.currentUser).toBeNull();
  });
});

describe('onAuthStateChangedListener', () => {
  it('emits the current user asynchronously, then future updates until unsubscribed', async () => {
    setCurrentUser(adminUser);
    const seen: Array<string | null> = [];

    const unsubscribe = onAuthStateChangedListener(user => {
      seen.push(user?.uid ?? null);
    });

    expect(seen).toEqual([]);
    await Promise.resolve();
    expect(seen).toEqual(['admin-1']);

    setCurrentUser(memberUser);
    expect(seen).toEqual(['admin-1', 'member-1']);

    unsubscribe();
    setCurrentUser(null);
    expect(seen).toEqual(['admin-1', 'member-1']);
  });
});

describe('checkIfAdmin', () => {
  it('returns true for an explicit uid or the current signed-in uid when that member is an admin', async () => {
    seedMemberDoc('admin-1', { role: 'admin' });

    await expect(checkIfAdmin(TEST_CLUB_ID, 'admin-1')).resolves.toBe(true);

    setCurrentUser(adminUser);
    await expect(checkIfAdmin(TEST_CLUB_ID)).resolves.toBe(true);
  });

  it('returns false when the club id or user id is missing', async () => {
    await expect(checkIfAdmin(null, 'admin-1')).resolves.toBe(false);
    await expect(checkIfAdmin(TEST_CLUB_ID, null)).resolves.toBe(false);
    await expect(checkIfAdmin(TEST_CLUB_ID)).resolves.toBe(false);
  });

  it('returns false when the member doc is missing or not an admin', async () => {
    seedMemberDoc('member-1', { role: 'member' });

    await expect(checkIfAdmin(TEST_CLUB_ID, 'missing-user')).resolves.toBe(false);
    await expect(checkIfAdmin(TEST_CLUB_ID, 'member-1')).resolves.toBe(false);
  });

  it('swallows Firestore errors and resolves false', async () => {
    const error = new Error('firestore down');
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(firestore, 'getDoc').mockRejectedValueOnce(error);
    setCurrentUser(adminUser);

    await expect(checkIfAdmin(TEST_CLUB_ID)).resolves.toBe(false);
    expect(consoleSpy).toHaveBeenCalledWith('[checkIfAdmin]', error);
  });
});

describe('signUpWithEmail', () => {
  it('creates an account, sets the display name to the given username, and sends a verification email', async () => {
    const user = await signUpWithEmail('jamie@example.com', 'JamieL', 'hunter22');

    expect(user.email).toBe('jamie@example.com');
    expect(user.displayName).toBe('JamieL');
    expect(user.emailVerified).toBe(false);
    expect(auth.currentUser?.uid).toBe(user.uid); // signed in immediately
    expect(__getVerificationEmailsSent()).toEqual(['jamie@example.com']);
  });

  it('leaves displayName unset when no username is given (falls back to email in the UI)', async () => {
    const user = await signUpWithEmail('nodisplay@example.com', '', 'hunter22');

    expect(user.email).toBe('nodisplay@example.com');
    expect(user.displayName).toBeFalsy();
  });

  it('rejects a duplicate email with auth/email-already-in-use', async () => {
    await signUpWithEmail('jamie@example.com', 'JamieL', 'hunter22');
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    await expect(signUpWithEmail('jamie@example.com', 'Someone', 'hunter22'))
      .rejects.toMatchObject({ code: 'auth/email-already-in-use' });
    consoleSpy.mockRestore();
  });

  it('rejects a too-short password with auth/weak-password', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    await expect(signUpWithEmail('jamie@example.com', 'JamieL', '123'))
      .rejects.toMatchObject({ code: 'auth/weak-password' });
    consoleSpy.mockRestore();
  });
});

describe('signInWithEmail', () => {
  it('signs in a registered account with the correct password', async () => {
    __registerAccount('jamie@example.com', 'hunter22', 'JamieL');

    const user = await signInWithEmail('jamie@example.com', 'hunter22');

    expect(user.email).toBe('jamie@example.com');
    expect(auth.currentUser?.uid).toBe(user.uid);
  });

  it('rejects an unregistered email or wrong password with auth/invalid-credential', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    await expect(signInWithEmail('nobody@example.com', 'whatever'))
      .rejects.toMatchObject({ code: 'auth/invalid-credential' });

    __registerAccount('jamie@example.com', 'hunter22');
    await expect(signInWithEmail('jamie@example.com', 'wrong-password'))
      .rejects.toMatchObject({ code: 'auth/invalid-credential' });
    consoleSpy.mockRestore();
  });
});

describe('resendVerificationEmail', () => {
  it('sends another verification email to the signed-in user', async () => {
    await signUpWithEmail('jamie@example.com', 'JamieL', 'hunter22');

    await resendVerificationEmail();

    expect(__getVerificationEmailsSent()).toEqual(['jamie@example.com', 'jamie@example.com']);
  });

  it('throws when no one is signed in', async () => {
    await expect(resendVerificationEmail()).rejects.toThrow('You must be signed in.');
  });
});

describe('sendPasswordReset', () => {
  it('sends a reset email for a registered address', async () => {
    __registerAccount('jamie@example.com', 'hunter22');

    await sendPasswordReset('jamie@example.com');

    expect(__getPasswordResetsSent()).toEqual(['jamie@example.com']);
  });

  it('throws auth/user-not-found for an unregistered address', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    await expect(sendPasswordReset('nobody@example.com')).rejects.toMatchObject({ code: 'auth/user-not-found' });
    consoleSpy.mockRestore();
  });
});

describe('__markEmailVerified (test helper sanity check)', () => {
  it('flips emailVerified on the account and, if currently signed in, on auth.currentUser too', async () => {
    const user = await signUpWithEmail('jamie@example.com', 'JamieL', 'hunter22');
    expect(user.emailVerified).toBe(false);

    __markEmailVerified('jamie@example.com');

    expect(auth.currentUser?.emailVerified).toBe(true);
  });
});
