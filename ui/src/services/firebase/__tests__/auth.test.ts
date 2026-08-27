import * as firestore from 'firebase/firestore';
import { auth } from '../client';
import { signInWithGoogle, signOutUser, onAuthStateChangedListener, checkIfAdmin } from '../auth';
import { resetFirebaseTestState, seedMemberDoc, setCurrentUser, TEST_CLUB_ID } from '../../../test-utils/firebaseTestHelpers';

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
