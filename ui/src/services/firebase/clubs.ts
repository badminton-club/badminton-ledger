import {
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  writeBatch,
  arrayUnion,
  arrayRemove,
  serverTimestamp,
} from 'firebase/firestore';
import {
  db,
  userDoc,
  clubDoc,
  memberDoc,
  membersRef,
  linkRequestsRef,
  linkRequestDoc,
  profileEditRequestsRef,
  profileEditRequestDoc,
  clubCollection,
  CLUB_DATA_COLLECTIONS,
} from './client';
import { serviceCall } from './utils';
import type { UserProfile, Club, ClubRole, ClubMember, LinkRequest, ProfileEditRequest, UserClub } from 'types';

const EMPTY_PROFILE: UserProfile = { clubs: [], lastVisitedClub: null };

/**
 * Creates a brand-new, empty club: the club doc, the creator's admin membership,
 * and saves it to their profile as the current club. No data is imported.
 * `ownerUid` lets the Firestore rules bootstrap the first admin.
 */
export async function createClub(clubId: string, name: string, uid: string): Promise<void> {
  return serviceCall('createClub', async () => {
    await setDoc(clubDoc(clubId), { name, ownerUid: uid, createdAt: serverTimestamp() }, { merge: true });
    await setDoc(memberDoc(clubId, uid), { role: 'superAdmin', addedAt: serverTimestamp() }, { merge: true });
    await setDoc(userDoc(uid), { clubs: arrayUnion(clubId), lastVisitedClub: clubId }, { merge: true });
  });
}


/** Reads the user's global profile, creating an empty one on first sign-in. */
export async function fetchUserProfile(uid: string): Promise<UserProfile> {
  return serviceCall('fetchUserProfile', async () => {
    const snap = await getDoc(userDoc(uid));
    if (!snap.exists()) {
      await setDoc(userDoc(uid), { ...EMPTY_PROFILE, createdAt: serverTimestamp() });
      return { ...EMPTY_PROFILE };
    }
    const data = snap.data();
    return {
      clubs: Array.isArray(data.clubs) ? (data.clubs as string[]) : [],
      lastVisitedClub: (data.lastVisitedClub as string | null) ?? null,
    };
  });
}

/** Reads a club document (name etc.). Returns null if missing or not readable. */
export async function fetchClub(clubId: string): Promise<Club | null> {
  return serviceCall('fetchClub', async () => {
    try {
      const snap = await getDoc(clubDoc(clubId));
      if (!snap.exists()) return null;
      return { id: snap.id, ...(snap.data() as Omit<Club, 'id'>) };
    } catch {
      return null; // not a member yet → club doc read denied; treat as unknown
    }
  });
}

/** Returns the user's role in a club, or null if they aren't a member. */
export async function fetchMemberRole(clubId: string, uid: string): Promise<ClubRole | null> {
  return serviceCall('fetchMemberRole', async () => {
    try {
      const snap = await getDoc(memberDoc(clubId, uid));
      if (!snap.exists()) return null;
      const role = snap.data().role;
      return role === 'superAdmin' || role === 'admin' || role === 'member' ? role : null;
    } catch {
      return null; // membership read denied / missing — treat as no access
    }
  });
}

/** Resolves the user's saved club ids into display clubs with names + roles. */
export async function fetchUserClubs(uid: string): Promise<UserClub[]> {
  return serviceCall('fetchUserClubs', async () => {
    const profile = await fetchUserProfile(uid);
    const clubs = await Promise.all(
      profile.clubs.map(async (clubId) => {
        const [club, role] = await Promise.all([fetchClub(clubId), fetchMemberRole(clubId, uid)]);
        return { id: clubId, name: club?.name ?? clubId, role };
      })
    );
    return clubs;
  });
}

/** Adds a club id to the user's saved list (idempotent). */
export async function addClubToUser(uid: string, clubId: string): Promise<void> {
  return serviceCall('addClubToUser', async () => {
    await fetchUserProfile(uid); // ensure the profile document exists
    await updateDoc(userDoc(uid), { clubs: arrayUnion(clubId) });
  });
}

/** Removes a club from the user's saved list; clears lastVisited if it pointed there. */
export async function removeClubFromUser(uid: string, clubId: string): Promise<void> {
  return serviceCall('removeClubFromUser', async () => {
    const profile = await fetchUserProfile(uid);
    const patch: Record<string, unknown> = { clubs: arrayRemove(clubId) };
    if (profile.lastVisitedClub === clubId) patch.lastVisitedClub = null;
    await updateDoc(userDoc(uid), patch);
  });
}

/** Records the club the user most recently opened. */
export async function setLastVisitedClub(uid: string, clubId: string): Promise<void> {
  return serviceCall('setLastVisitedClub', async () => {
    await fetchUserProfile(uid);
    await updateDoc(userDoc(uid), { lastVisitedClub: clubId });
  });
}

/**
 * Adds or updates a club member with the given role (admin-only, enforced by
 * rules). Also saves the club onto the target user's own profile so it shows
 * up in their club switcher right away — without this, a newly added member
 * wouldn't see the club at all until they separately opened a share link.
 * That second write is a narrowly-scoped exception in the rules (see
 * firestore.rules) for exactly this case, so it's safe even though the caller
 * isn't the target user. The writes are atomic so a profile-sync failure cannot
 * leave behind a membership that the target user cannot discover.
 */
export async function addClubMember(clubId: string, uid: string, role: ClubRole): Promise<void> {
  return serviceCall('addClubMember', async () => {
    const batch = writeBatch(db);
    batch.set(memberDoc(clubId, uid), { role, addedAt: serverTimestamp() }, { merge: true });
    batch.set(userDoc(uid), { clubs: arrayUnion(clubId) }, { merge: true });
    await batch.commit();
  });
}

/**
 * Persists the club's e-Transfer search cutoff as a rolling window (in days,
 * recomputed fresh on every search) — clears any previously saved one-off
 * absolute date, since the rolling window takes priority once set.
 */
export async function setClubEtransferSearchWindowDays(clubId: string, days: number): Promise<void> {
  return serviceCall('setClubEtransferSearchWindowDays', async () => {
    await setDoc(
      clubDoc(clubId),
      { etransferSearchWindowDays: days, etransferSearchAfterDate: null },
      { merge: true }
    );
  });
}

/**
 * Persists a one-off absolute cutoff date for e-Transfer searches — clears
 * any saved rolling window, since an absolute date is a manual override.
 */
export async function setClubEtransferSearchAfterDate(clubId: string, date: string): Promise<void> {
  return serviceCall('setClubEtransferSearchAfterDate', async () => {
    await setDoc(
      clubDoc(clubId),
      { etransferSearchAfterDate: date, etransferSearchWindowDays: null },
      { merge: true }
    );
  });
}

/** Clears any saved e-Transfer search cutoff, reverting to the default rolling window. */
export async function resetClubEtransferSearchSetting(clubId: string): Promise<void> {
  return serviceCall('resetClubEtransferSearchSetting', async () => {
    await setDoc(
      clubDoc(clubId),
      { etransferSearchAfterDate: null, etransferSearchWindowDays: null },
      { merge: true }
    );
  });
}

/** Reads the caller's linked player id in a club (null if unlinked or not a member). */
export async function fetchMemberPlayerId(clubId: string, uid: string): Promise<string | null> {
  return serviceCall('fetchMemberPlayerId', async () => {
    try {
      const snap = await getDoc(memberDoc(clubId, uid));
      if (!snap.exists()) return null;
      return (snap.data().playerId as string | undefined) ?? null;
    } catch {
      return null;
    }
  });
}

/** Lists all members of a club (admin-only). */
export async function fetchClubMembers(clubId: string): Promise<ClubMember[]> {
  return serviceCall('fetchClubMembers', async () => {
    const snap = await getDocs(membersRef(clubId));
    return snap.docs.map((d) => ({
      uid: d.id,
      role: (d.data().role as ClubRole) ?? 'member',
      playerId: (d.data().playerId as string | undefined) ?? null,
    }));
  });
}

/** Links (or unlinks) a member to a player. Creates the membership as 'member' if new. */
export async function setMemberPlayer(clubId: string, uid: string, playerId: string | null): Promise<void> {
  return serviceCall('setMemberPlayer', async () => {
    const snap = await getDoc(memberDoc(clubId, uid));
    if (snap.exists()) {
      await updateDoc(memberDoc(clubId, uid), { playerId });
    } else {
      await setDoc(memberDoc(clubId, uid), { role: 'member', playerId, addedAt: serverTimestamp() });
    }
  });
}

/** Removes a member from a club (admin-only). */
export async function removeClubMember(clubId: string, uid: string): Promise<void> {
  return serviceCall('removeClubMember', async () => {
    await deleteDoc(memberDoc(clubId, uid));
  });
}

// ─── Link requests ─────────────────────────────────────────────────────────

/** A user asks an admin to link them to a player. One pending request per user. */
export async function submitLinkRequest(clubId: string, uid: string, firstName: string, lastName: string | null, email: string): Promise<void> {
  return serviceCall('submitLinkRequest', async () => {
    await setDoc(linkRequestDoc(clubId, uid), { uid, firstName, lastName: lastName || null, email, createdAt: serverTimestamp() });
  });
}

/** Lists pending link requests for a club (admin-only). */
export async function fetchLinkRequests(clubId: string): Promise<LinkRequest[]> {
  return serviceCall('fetchLinkRequests', async () => {
    const snap = await getDocs(linkRequestsRef(clubId));
    return snap.docs.map((d) => {
      const data = d.data();
      return {
        uid: d.id,
        firstName: (data.firstName as string) ?? (data.name as string) ?? '',
        lastName: (data.lastName as string | null) ?? null,
        email: (data.email as string) ?? '',
        createdAt: data.createdAt,
      };
    });
  });
}

/** Removes a link request (after approval, or to dismiss it). */
export async function deleteLinkRequest(clubId: string, uid: string): Promise<void> {
  return serviceCall('deleteLinkRequest', async () => {
    await deleteDoc(linkRequestDoc(clubId, uid));
  });
}

/** Returns the caller's own pending link request, if any. */
export async function fetchMyLinkRequest(clubId: string, uid: string): Promise<LinkRequest | null> {
  return serviceCall('fetchMyLinkRequest', async () => {
    try {
      const snap = await getDoc(linkRequestDoc(clubId, uid));
      if (!snap.exists()) return null;
      const data = snap.data();
      return {
        uid,
        firstName: (data.firstName as string) ?? (data.name as string) ?? '',
        lastName: (data.lastName as string | null) ?? null,
        email: (data.email as string) ?? '',
        createdAt: data.createdAt,
      };
    } catch {
      return null;
    }
  });
}

// ─── Profile edit requests ──────────────────────────────────────────────────
// A linked member can't write to their player doc directly — they submit a
// proposed name/email change here for an admin to review and apply (via
// updatePlayerProfile), keeping every profile change auditable and admin-gated.

/** A linked member proposes a change to their own player's name/email. One pending request per user. */
export async function submitProfileEditRequest(
  clubId: string,
  uid: string,
  playerId: string,
  firstName: string,
  lastName: string | null,
  email: string | null
): Promise<void> {
  return serviceCall('submitProfileEditRequest', async () => {
    await setDoc(profileEditRequestDoc(clubId, uid), {
      uid, playerId, firstName, lastName: lastName || null, email: email || null, createdAt: serverTimestamp(),
    });
  });
}

/** Lists pending profile-edit requests for a club (admin-only). */
export async function fetchProfileEditRequests(clubId: string): Promise<ProfileEditRequest[]> {
  return serviceCall('fetchProfileEditRequests', async () => {
    const snap = await getDocs(profileEditRequestsRef(clubId));
    return snap.docs.map((d) => {
      const data = d.data();
      return {
        uid: d.id,
        playerId: data.playerId as string,
        firstName: (data.firstName as string) ?? '',
        lastName: (data.lastName as string | null) ?? null,
        email: (data.email as string | null) ?? null,
        createdAt: data.createdAt,
      };
    });
  });
}

/** Returns the caller's own pending profile-edit request, if any. */
export async function fetchMyProfileEditRequest(clubId: string, uid: string): Promise<ProfileEditRequest | null> {
  return serviceCall('fetchMyProfileEditRequest', async () => {
    try {
      const snap = await getDoc(profileEditRequestDoc(clubId, uid));
      if (!snap.exists()) return null;
      const data = snap.data();
      return {
        uid,
        playerId: data.playerId as string,
        firstName: (data.firstName as string) ?? '',
        lastName: (data.lastName as string | null) ?? null,
        email: (data.email as string | null) ?? null,
        createdAt: data.createdAt,
      };
    } catch {
      return null;
    }
  });
}

/** Removes a profile-edit request (after approval, or to dismiss it). */
export async function deleteProfileEditRequest(clubId: string, uid: string): Promise<void> {
  return serviceCall('deleteProfileEditRequest', async () => {
    await deleteDoc(profileEditRequestDoc(clubId, uid));
  });
}

/** Shows or hides a navbar tab for a club (admin-only, enforced by rules). */
export async function setClubTabEnabled(clubId: string, tabKey: string, enabled: boolean): Promise<void> {
  return serviceCall('setClubTabEnabled', async () => {
    await setDoc(
      clubDoc(clubId),
      { disabledTabs: enabled ? arrayRemove(tabKey) : arrayUnion(tabKey) },
      { merge: true }
    );
  });
}

/**
 * Permanently deletes a club. Refuses unless every data subcollection is already
 * empty (clear the data first). Removes the membership roster + club doc and drops
 * the club from the caller's profile.
 */
export async function deleteClub(clubId: string, uid: string): Promise<void> {
  return serviceCall('deleteClub', async () => {
    for (const name of CLUB_DATA_COLLECTIONS) {
      const snap = await getDocs(clubCollection(name, clubId));
      if (!snap.empty) {
        throw new Error(`Clear all club data first — "${name}" still has ${snap.size} document(s).`);
      }
    }

    const [members, linkRequests, profileEditRequests] = await Promise.all([
      getDocs(membersRef(clubId)),
      getDocs(linkRequestsRef(clubId)),
      getDocs(profileEditRequestsRef(clubId)),
    ]);
    // Chunked into <=500-write batches — a single batch would fail outright for
    // any club with more members/requests than Firestore's per-batch limit.
    const refsToDelete = [
      ...members.docs.map((d) => d.ref),
      ...linkRequests.docs.map((d) => d.ref),
      ...profileEditRequests.docs.map((d) => d.ref),
      clubDoc(clubId),
    ];
    const BATCH_LIMIT = 500;
    for (let i = 0; i < refsToDelete.length; i += BATCH_LIMIT) {
      const batch = writeBatch(db);
      for (const ref of refsToDelete.slice(i, i + BATCH_LIMIT)) batch.delete(ref);
      await batch.commit();
    }

    await removeClubFromUser(uid, clubId);
  });
}
