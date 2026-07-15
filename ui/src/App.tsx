import React, { useEffect } from 'react';
import './App.css';
import AppNavbar from './components/AppNavBar';
import { Routes, Route, Navigate } from 'react-router-dom';
import HomePage from './Pages/HomePage';
import BirdiesPage from './Pages/BirdiesPage';
import CourtCreditsPage from './Pages/CourtCreditsPage';
import PlayersPage from './Pages/PlayersPage';
import SettingsPage from './Pages/SettingsPage';
import PayoutPage from './Pages/PayoutPage';
import AttendancePage from './Pages/AttendancePage';
import AuthPage from './Pages/AuthPage';
import { Container, Spinner } from 'react-bootstrap';
import { subscribeToPlayers } from './features/players/playersSlice';
import { useAppDispatch, useAppSelector } from './hooks';
import { setCurrentClubId } from './services/firebase/client';
import { useClubBootstrap } from './features/club/useClubBootstrap';
import { selectCurrentClubId, selectClubReady, selectClubRole } from './features/club/clubSlice';

function ClubLoading() {
  return (
    <Container className="py-5 text-center">
      <Spinner animation="border" />
    </Container>
  );
}

// Requires a selected club; otherwise sends the user to the account page to pick one.
function RequireClub({ children }: { children: React.ReactElement }) {
  const ready = useAppSelector(selectClubReady);
  const clubId = useAppSelector(selectCurrentClubId);
  if (!ready) return <ClubLoading />;
  if (!clubId) return <Navigate to="/auth" replace />;
  return children;
}

// Requires admin role in the current club; members are redirected to the calendar.
function RequireAdmin({ children }: { children: React.ReactElement }) {
  const ready = useAppSelector(selectClubReady);
  const role = useAppSelector(selectClubRole);
  if (!ready) return <ClubLoading />;
  if (role !== 'admin' && role !== 'superAdmin') return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  const dispatch = useAppDispatch();
  const currentClubId = useAppSelector(selectCurrentClubId);

  useClubBootstrap();

  // Subscribe to the current club's players; re-subscribe when the club changes.
  useEffect(() => {
    if (!currentClubId) return;
    setCurrentClubId(currentClubId);
    const promise = dispatch(subscribeToPlayers());
    return () => { promise.abort(); };
  }, [dispatch, currentClubId]);

  return (
    <div>
      <AppNavbar />
      <Container style={{ maxWidth: '85%' }}>
        <Routes>
          <Route path="/auth" element={<AuthPage />} />
          <Route path="/" element={<RequireClub><HomePage /></RequireClub>} />
          <Route path="/attendance" element={<RequireClub><AttendancePage /></RequireClub>} />
          <Route path="/birdies"  element={<RequireClub><RequireAdmin><BirdiesPage /></RequireAdmin></RequireClub>} />
          <Route path="/credits"  element={<RequireClub><RequireAdmin><CourtCreditsPage /></RequireAdmin></RequireClub>} />
          <Route path="/players"  element={<RequireClub><RequireAdmin><PlayersPage /></RequireAdmin></RequireClub>} />
          <Route path="/payout"   element={<RequireClub><RequireAdmin><PayoutPage /></RequireAdmin></RequireClub>} />
          <Route path="/settings" element={<RequireClub><RequireAdmin><SettingsPage /></RequireAdmin></RequireClub>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Container>
    </div>
  );
}
