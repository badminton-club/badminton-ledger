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
  clubCollection,
  CLUB_DATA_COLLECTIONS,
} from './client';
import { serviceCall } from './utils';
import type { UserProfile, Club, ClubRole, ClubMember, UserClub } from 'types';

const EMPTY_PROFILE: UserProfile = { clubs: [], lastVisitedClub: null };

/**
 * Creates a brand-new, empty club: the club doc, the creator's admin membership,
 * and saves it to their profile as the current club. No data is imported.
 * `ownerUid` lets the Firestore rules bootstrap the first admin.
 */
export async function createClub(clubId: string, name: string, uid: string): Promise<void> {
  return serviceCall('createClub', async () => {
    await setDoc(clubDoc(clubId), { name, ownerUid: uid, createdAt: serverTimestamp() }, { merge: true });
    await setDoc(memberDoc(clubId, uid), { role: 'admin', addedAt: serverTimestamp() }, { merge: true });
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
      return role === 'admin' || role === 'member' ? role : null;
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

/** Adds or updates a club member with the given role. Admin-only (enforced by rules). */
export async function addClubMember(clubId: string, uid: string, role: ClubRole): Promise<void> {
  return serviceCall('addClubMember', async () => {
    await setDoc(memberDoc(clubId, uid), { role, addedAt: serverTimestamp() }, { merge: true });
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

    const members = await getDocs(membersRef(clubId));
    const batch = writeBatch(db);
    members.docs.forEach((d) => batch.delete(d.ref));
    batch.delete(clubDoc(clubId));
    await batch.commit();

    await removeClubFromUser(uid, clubId);
  });
}
