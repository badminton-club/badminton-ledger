import React, { useCallback, useEffect, useState } from "react";
import { Container, Row, Col, Button } from "react-bootstrap";
import { format } from "date-fns";
import { Link } from "react-router-dom";
// import "./HomePage.css";
import SessionCalendar from "components/Calander/SessionCalendar";
import { fetchSessions } from "services/firebase/sessions";
import { useAppSelector } from "../hooks";
import { selectAllPlayers, selectPlayerById } from "../features/players/playersSlice";
import type { Session } from "../types";
import type { RootState } from "../store";

export default function HomePage() {
    const [sessions, setSessions] = useState<Session[]>([]);
    const [sessionIndex, setSessionIndex] = useState(0);
    const players = useAppSelector(selectAllPlayers);

    const loadSessions = useCallback(() => {
        fetchSessions({ orderDirection: "desc", limitCount: 60 })
            .then((s) => { setSessions(s); setSessionIndex(0); })
            .catch(console.error);
    }, []);

    useEffect(() => { loadSessions(); }, [loadSessions]);

    const currentSession = sessions[sessionIndex] ?? null;

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
                        {currentSession && (
                            <div className="session-card">
                                <div className="d-flex align-items-center justify-content-between">
                                    <h2 className="session-title mb-0">
                                        {sessionIndex === 0 ? "Latest Session" : "Previous Session"}
                                    </h2>
                                    <div className="d-flex align-items-center gap-2">
                                        <Button
                                            size="sm"
                                            variant="outline-secondary"
                                            title="Older session"
                                            disabled={sessionIndex >= sessions.length - 1}
                                            onClick={() => setSessionIndex((i) => Math.min(sessions.length - 1, i + 1))}
                                        >
                                            ‹
                                        </Button>
                                        <small className="text-muted">
                                            {sessionIndex + 1} / {sessions.length}
                                        </small>
                                        <Button
                                            size="sm"
                                            variant="outline-secondary"
                                            title="Newer session"
                                            disabled={sessionIndex <= 0}
                                            onClick={() => setSessionIndex((i) => Math.max(0, i - 1))}
                                        >
                                            ›
                                        </Button>
                                    </div>
                                </div>
                                <p className="session-date">
                                    <Link to={`/?date=${format(currentSession.date, "yyyy-MM-dd")}`}>
                                        {format(currentSession.date, "MMMM d, yyyy")}
                                    </Link>
                                </p>
                                <div className="session-details">
                                    <p className="session-info">Players: {currentSession.players?.length ?? 0}</p>
                                    <p className="session-info">
                                        Birdies Used: {(currentSession.birdieUsage ?? []).reduce((s, u) => s + u.quantity, 0)}
                                    </p>
                                </div>
                                <div className="mt-3">
                                    <h3 className="unpaid-title">Unpaid Players:</h3>
                                    {(currentSession.players ?? []).filter((p) => !p.paid).length > 0 ?
                                        <ul className="list-disc list-inside">
                                            {(currentSession.players ?? [])
                                                .filter((p) => !p.paid)
                                                .map((p) => (
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
                    <SessionCalendar onSessionsChanged={loadSessions} />
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
