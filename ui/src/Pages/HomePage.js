import React from "react";
import { Container, Row, Col, Button } from "react-bootstrap";
import "./HomePage.css";
import SessionCalendar from "../components/Calander/SessionCalendar";
import { useState, useEffect } from "react";
import { fetchSessions } from "../services/firebaseService";
import { format } from "date-fns";
import { useSelector } from "react-redux";
import { selectAllPlayers } from "../features/players/playersSlice";

function HomePage() {
    const [lastestSession, setLatestSession] = useState({});
    const players = useSelector(selectAllPlayers);
    console.log("lastestSession ==> ", lastestSession);

    const fetchSessionFromFirebase = async () => {
        const fetchedSessions = await fetchSessions({ limitCount: 1, orderDirection: "desc" });
        setLatestSession(fetchedSessions[0]);
    };
    
    useEffect(() => {
        fetchSessionFromFirebase();
    }, []);

    const maxDisplayCount = 5;
    const playersWithNegativeBalance = players.filter((p) => p.balance < 0);
    const displayedNegativeBalancePlayers = playersWithNegativeBalance.slice(0, maxDisplayCount);
    const remainingNegativeBalanceCount = playersWithNegativeBalance.length - displayedNegativeBalancePlayers.length;
    return (
        <div className="home-page">
            <Container>
                <Row className="mb-3">
                    <Col md={6}>
                        {lastestSession && lastestSession.players && lastestSession.players.length > 0 && (
                            <div className="session-card">
                                <h2 className="session-title">Previous Session</h2>
                                <p className="session-date">{format(lastestSession.date, "MMMM d, yyyy")}</p>
                                <div className="session-details">
                                    <p className="session-info">Players: {lastestSession.players.length}</p>
                                    <p className="session-info">
                                        Birdies Used:{" "}
                                        {lastestSession.birdieUsage.reduce((acc, curr) => acc + curr.quantity, 0)}
                                    </p>
                                </div>

                                <div className="mt-3">
                                    <h3 className="unpaid-title">Unpaid Players:</h3>
                                    {lastestSession.players.length > 0 ? (
                                        <ul className="list-disc list-inside">
                                            {lastestSession.players
                                                .filter((p) => !p.paid)
                                                .map((player, index) => (
                                                    <li key={index} className="unpaid-player">
                                                        {player.name}
                                                    </li>
                                                ))}
                                        </ul>
                                    ) : (
                                        <p className="no-unpaid">All players have paid.</p>
                                    )}
                                </div>
                            </div>
                        )}
                    </Col>
                    <Col md={6}>
                        <div className="session-card">
                            <h2 className="session-title">Player balances</h2>
                            {players && players.length > 0 ? (
                                <>
                                    {playersWithNegativeBalance.length > 0 ? (
                                        <>
                                            <ul className="list-disc list-inside">
                                                {displayedNegativeBalancePlayers.map((player, index) => (
                                                    <li key={player.id || index} className="player-balance">
                                                        {player.firstName} {player.lastName || ""} -{" "}
                                                        <strong>${Math.abs(player.balance).toFixed(2)}</strong>
                                                    </li>
                                                ))}
                                            </ul>
                                            {remainingNegativeBalanceCount > 0 && (
                                                <p className="more-players-info">
                                                    + {remainingNegativeBalanceCount} more with outstanding balances.
                                                </p>
                                            )}
                                        </>
                                    ) : (
                                        <p className="no-players">No players with outstanding balances.</p>
                                    )}
                                </>
                            ) : (
                                <p className="no-players">No players found.</p>
                            )}
                        </div>
                    </Col>
                </Row>
                <Row>
                    <SessionCalendar />
                </Row>
            </Container>
        </div>
    );
}

export default HomePage;
