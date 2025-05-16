import React from 'react';
import './App.css';
import AppNavbar from './components/AppNavBar';
import { Routes, Route } from 'react-router-dom';
import HomePage from './Pages/HomePage';
import BirdiesPage from './Pages/BirdiesPage';
import CourtCreditsPage from './Pages/CourtCreditsPage';


function App() {
  return (
    <div>
      <AppNavbar />
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/birdies" element={<BirdiesPage />} />
          // <Route path="/credits" element={<CourtCreditsPage />} />
          {/* // <Route path="/players" element={<PlayersPage />} />   */}
      </Routes>
    </div >
  );
}

export default App;
