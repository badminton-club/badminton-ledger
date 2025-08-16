import React, { useEffect } from "react";
import "./App.css";
import AppNavbar from "./components/AppNavBar";
import { Routes, Route } from "react-router-dom";
import HomePage from "./Pages/HomePage";
import BirdiesPage from "./Pages/BirdiesPage";
import CourtCreditsPage from "./Pages/CourtCreditsPage";
import PlayersPage from "./Pages/PlayersPage";
import { Container } from "react-bootstrap";
import { subscribeToPlayers } from "./features/players/playersSlice";
import { useDispatch } from "react-redux";
import AuthPage from "./Pages/AuthPage";
function App() {
    const dispatch = useDispatch();

    useEffect(() => {
        const promise = dispatch(subscribeToPlayers());

        return () => {
            if (promise && typeof promise.abort === "function") {
                promise.abort();
            }
        };
    }, [dispatch]);

    return (
        <div>
            <AppNavbar />
            <Container className="mx-auto " style={{ maxWidth: "85%" }}>
                <Routes>
                    <Route path="/" element={<HomePage />} />
                    <Route path="/birdies" element={<BirdiesPage />} />
                    <Route path="/credits" element={<CourtCreditsPage />} />
                    <Route path="/players" element={<PlayersPage />} />
                    <Route path="/auth" element={<AuthPage />} />
                </Routes>
            </Container>
        </div>
    );
}

export default App;
