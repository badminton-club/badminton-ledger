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
  setLastVisitedClub,
} from '../../services/firebase';
import { auth, setCurrentClubId } from '../../services/firebase/client';
import {
  setClubs,
  setCurrentClub,
  setRole,
  setDisabledTabs,
  setSignedIn,
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
    const unsubscribe = onAuthStateChangedListener(async (user) => {
      if (!user) {
        setCurrentClubId(null);
        dispatch(resetClub());
        return;
      }

      dispatch(setSignedIn(true));

      const clubParam = searchParams.get('club');
      if (clubParam) {
        try { await addClubToUser(user.uid, clubParam); } catch { /* ignore */ }
      }

      const [clubs, profile] = await Promise.all([
        fetchUserClubs(user.uid),
        fetchUserProfile(user.uid),
      ]);
      dispatch(setClubs(clubs));

      const stored = localStorage.getItem(LS_KEY);
      const pick =
        (clubParam && clubs.some((c) => c.id === clubParam) ? clubParam : null) ??
        (profile.lastVisitedClub && clubs.some((c) => c.id === profile.lastVisitedClub)
          ? profile.lastVisitedClub
          : null) ??
        (stored && clubs.some((c) => c.id === stored) ? stored : null) ??
        clubs[0]?.id ??
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
