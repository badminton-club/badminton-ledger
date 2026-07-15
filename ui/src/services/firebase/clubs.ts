import {
  getDoc,
  setDoc,
  updateDoc,
  arrayUnion,
  arrayRemove,
  serverTimestamp,
} from 'firebase/firestore';
import { userDoc, clubDoc, memberDoc } from './client';
import { serviceCall } from './utils';
import type { UserProfile, Club, ClubRole, UserClub } from 'types';

const EMPTY_PROFILE: UserProfile = { clubs: [], lastVisitedClub: null };

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
