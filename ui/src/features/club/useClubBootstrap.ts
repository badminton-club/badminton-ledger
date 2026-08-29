import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAppDispatch, useAppSelector } from '../../hooks';
import {
  onAuthStateChangedListener,
  fetchUserClubs,
  fetchUserProfile,
  fetchMemberRole,
  fetchClub,
  addClubToUser,
  removeClubFromUser,
  setLastVisitedClub,
} from '../../services/firebase';
import { auth, setCurrentClubId } from '../../services/firebase/client';
import {
  setClubs,
  setCurrentClub,
  setRole,
  setDisabledTabs,
  setSignedIn,
  setAccountName,
  setReady,
  resetClub,
  selectCurrentClubId,
} from './clubSlice';

const LS_KEY = 'currentClubId';

/**
 * Bootstraps club context from the signed-in user:
 *  - saves a `?club=<id>` deep link into the user's club list and opens it
 *  - loads the user's saved clubs and picks the current one
 *    (?club → last visited → localStorage → first)
 *  - keeps the client's scoped `refs` and the user's role/last-visited in sync
 */
export function useClubBootstrap(): void {
  const dispatch = useAppDispatch();
  const [searchParams, setSearchParams] = useSearchParams();
  const currentClubId = useAppSelector(selectCurrentClubId);

  // Auth → club list → current club
  useEffect(() => {
    // Tracks the most recent auth event so a slower-resolving fetch for a
    // previous user (e.g. right after a fast sign-out/account-switch) can't
    // overwrite state with stale data once a newer auth event has already
    // been processed.
    let latestUid: string | null = null;
    const unsubscribe = onAuthStateChangedListener(async (user) => {
      const uid = user?.uid ?? null;
      latestUid = uid;

      if (!user) {
        setCurrentClubId(null);
        dispatch(resetClub());
        return;
      }

      dispatch(setSignedIn(true));
      dispatch(setAccountName(user.displayName?.trim() || user.email || null));

      const clubParam = searchParams.get('club');
      if (clubParam) {
        try { await addClubToUser(user.uid, clubParam); } catch { /* ignore */ }
      }
      if (latestUid !== uid) return;

      const [clubs, profile] = await Promise.all([
        fetchUserClubs(user.uid),
        fetchUserProfile(user.uid),
      ]);
      if (latestUid !== uid) return;

      // Self-heal: a club becomes inaccessible if this user was removed as a
      // member (or the club itself was deleted), but nothing else can scrub
      // it from this user's own saved list — an admin can only ever append
      // one club id to another user's profile, never remove one (see
      // firestore.rules) — so a dead entry would otherwise linger forever,
      // showing up broken in the switcher and possibly auto-selected below.
      const deadClubIds = clubs.filter((c) => c.role === null).map((c) => c.id);
      const liveClubs = deadClubIds.length > 0 ? clubs.filter((c) => c.role !== null) : clubs;
      if (deadClubIds.length > 0) {
        await Promise.all(deadClubIds.map((id) => removeClubFromUser(user.uid, id).catch(() => { /* best effort */ })));
      }
      dispatch(setClubs(liveClubs));

      const stored = localStorage.getItem(LS_KEY);
      const pick =
        (clubParam && liveClubs.some((c) => c.id === clubParam) ? clubParam : null) ??
        (profile.lastVisitedClub && liveClubs.some((c) => c.id === profile.lastVisitedClub)
          ? profile.lastVisitedClub
          : null) ??
        (stored && liveClubs.some((c) => c.id === stored) ? stored : null) ??
        liveClubs[0]?.id ??
        null;

      dispatch(setCurrentClub(pick));
      // When a club is picked, the club-scope effect below loads its role/settings
      // and flips `ready`. Only mark ready here when there's nothing to load.
      if (!pick) dispatch(setReady(true));

      if (clubParam) {
        const next = new URLSearchParams(searchParams);
        next.delete('club');
        setSearchParams(next, { replace: true });
      }
    });

    return () => unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispatch]);

  // Current club → client scope + persistence + role
  useEffect(() => {
    setCurrentClubId(currentClubId);
    if (!currentClubId) {
      dispatch(setRole(null));
      dispatch(setDisabledTabs([]));
      return;
    }
    localStorage.setItem(LS_KEY, currentClubId);
    const user = auth.currentUser;
    if (!user) return;
    // Switching clubs: hide club-scoped routes until the new club's role and
    // settings have loaded. This keeps role-based guards from acting on the
    // previous club's role, and remounts pages so they refetch for the new club.
    dispatch(setReady(false));
    setLastVisitedClub(user.uid, currentClubId).catch(() => { /* ignore */ });
    let cancelled = false;
    Promise.all([
      fetchMemberRole(currentClubId, user.uid),
      fetchClub(currentClubId),
    ]).then(([role, club]) => {
      if (cancelled) return;
      dispatch(setRole(role));
      dispatch(setDisabledTabs(club?.disabledTabs ?? []));
      dispatch(setReady(true));
    });
    return () => { cancelled = true; };
  }, [currentClubId, dispatch]);
}
