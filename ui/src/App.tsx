import React, { useEffect } from 'react';
import './App.css';
import AppNavbar from './components/AppNavBar';
import { Routes, Route } from 'react-router-dom';
import HomePage from './Pages/HomePage';
import BirdiesPage from './Pages/BirdiesPage';
import CourtCreditsPage from './Pages/CourtCreditsPage';
import PlayersPage from './Pages/PlayersPage';
import SettingsPage from './Pages/SettingsPage';
import AuthPage from './Pages/AuthPage';
import { Container } from 'react-bootstrap';
import { subscribeToPlayers } from './features/players/playersSlice';
import { useAppDispatch } from './hooks';

export default function App() {
  const dispatch = useAppDispatch();

  useEffect(() => {
    const promise = dispatch(subscribeToPlayers());
    return () => { promise.abort(); };
  }, [dispatch]);

  return (
    <div>
      <AppNavbar />
      <Container style={{ maxWidth: '85%' }}>
        <Routes>
          <Route path="/"        element={<HomePage />} />
          <Route path="/birdies" element={<BirdiesPage />} />
          <Route path="/credits" element={<CourtCreditsPage />} />
          <Route path="/players" element={<PlayersPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/auth" element={<AuthPage />} />
        </Routes>
      </Container>
    </div>
  );
}
