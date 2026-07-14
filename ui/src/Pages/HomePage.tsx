import React, { useEffect, useState } from "react";
import { Container, Row, Col } from "react-bootstrap";
import { format } from "date-fns";
// import "./HomePage.css";
import SessionCalendar from "components/Calander/SessionCalendar";
import { fetchSessions } from "services/firebase/sessions";
import { useAppSelector } from "../hooks";
import { selectAllPlayers, selectPlayerById } from "../features/players/playersSlice";
import type { Session } from "../types";
import type { RootState } from "../store";

export default function HomePage() {
    const [latestSession, setLatestSession] = useState<Session | null>(null);
    const players = useAppSelector(selectAllPlayers);

    useEffect(() => {
        fetchSessions({ limitCount: 1, orderDirection: "desc" })
            .then((sessions) => setLatestSession(sessions[0] ?? null))
            .catch(console.error);
    }, []);

    const maxDisplay = 5;
    const negativeBalancePlayers = players.filter((p) => p.balance < 0);
    const displayedPlayers = negativeBalancePlayers.slice(0, maxDisplay);
    const remainingCount = negativeBalancePlayers.length - displayedPlayers.length;

    return (
        <div className="home-page">
            <Container>
                <Row className="mb-3">
                    {/* ── Latest session summary ── */}
                    <Col md={6}>
                        {latestSession && latestSession.players.length > 0 && (
                            <div className="session-card">
                                <h2 className="session-title">Previous Session</h2>
                                <p className="session-date">{format(latestSession.date, "MMMM d, yyyy")}</p>
                                <div className="session-details">
                                    <p className="session-info">Players: {latestSession.players.length}</p>
                                    <p className="session-info">
                                        Birdies Used: {latestSession.birdieUsage.reduce((s, u) => s + u.quantity, 0)}
                                    </p>
                                </div>
                                <div className="mt-3">
                                    <h3 className="unpaid-title">Unpaid Players:</h3>
                                    {latestSession.players.filter((p) => !p.paid).length > 0 ?
                                        <ul className="list-disc list-inside">
                                            {latestSession.players
                                                .filter((p) => !p.paid)
                                                .map((p) => (
                                                    // Resolve name from Redux — not stored in session
                                                    <UnpaidPlayerItem key={p.id} playerId={p.id} />
                                                ))}
                                        </ul>
                                    :   <p className="no-unpaid">All players have paid.</p>}
                                </div>
                            </div>
                        )}
                    </Col>

                    {/* ── Negative balances ── */}
                    <Col md={6}>
                        <div className="session-card">
                            <h2 className="session-title">Player Balances</h2>
                            {negativeBalancePlayers.length > 0 ?
                                <>
                                    <ul className="list-disc list-inside">
                                        {displayedPlayers.map((player) => (
                                            <li key={player.id} className="player-balance">
                                                {player.firstName} {player.lastName ?? ""} —{" "}
                                                <strong>${Math.abs(player.balance).toFixed(2)}</strong>
                                            </li>
                                        ))}
                                    </ul>
                                    {remainingCount > 0 && (
                                        <p className="more-players-info">
                                            + {remainingCount} more with outstanding balances.
                                        </p>
                                    )}
                                </>
                            :   <p className="no-players">No players with outstanding balances.</p>}
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

// Resolves a player name from Redux rather than reading session.player.name
function UnpaidPlayerItem({ playerId }: { playerId: string }) {
    const player = useAppSelector((s: RootState) => selectPlayerById(s, playerId));
    const name = player ? [player.firstName, player.lastName].filter(Boolean).join(" ") : playerId;
    return <li className="unpaid-player">{name}</li>;
}
