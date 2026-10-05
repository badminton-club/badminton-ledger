import React, { useCallback, useEffect, useState } from "react";
import { Container, Row, Col, Button, Alert } from "react-bootstrap";
import { format } from "date-fns";
import { Link, useSearchParams } from "react-router-dom";
// import "./HomePage.css";
import SessionCalendar from "components/Calander/SessionCalendar";
import SessionQuickView from "components/Calander/SessionQuickView";
import { fetchSessions } from "services/firebase/sessions";
import { useAppSelector } from "../hooks";
import { selectAllPlayers } from "../features/players/playersSlice";
import type { Session } from "../types";

export default function HomePage() {
    const [sessions, setSessions] = useState<Session[]>([]);
    const [sessionIndex, setSessionIndex] = useState(0);
    const [sessionsError, setSessionsError] = useState('');
    const players = useAppSelector(selectAllPlayers);
    const [searchParams, setSearchParams] = useSearchParams();

    const loadSessions = useCallback(() => {
        setSessionsError('');
        fetchSessions({ orderDirection: "desc", limitCount: 60 })
            .then((s) => { setSessions(s); setSessionIndex(0); })
            .catch((err) => {
                console.error(err);
                setSessionsError('Failed to load recent sessions.');
            });
    }, []);

    useEffect(() => { loadSessions(); }, [loadSessions]);

    const currentSession = sessions[sessionIndex] ?? null;

    const negativeBalancePlayers = players.filter((p) => (p.owed ?? 0) > 0);

    // Deep-links into the calendar rendered further down this same page —
    // SessionCalendar watches for its own ?date= query param and opens the
    // matching popup directly, so this summary card doesn't need its own
    // modal plumbing.
    const openSessionInCalendar = useCallback((date: Date) => {
        const next = new URLSearchParams(searchParams);
        next.set("date", format(date, "yyyy-MM-dd"));
        setSearchParams(next);
    }, [searchParams, setSearchParams]);

    return (
        <div className="home-page">
            <Container>
                <Row className="mb-3">
                    {/* ── Latest session summary — reuses the same quick-view panel
                        shown in the calendar below, so there's a single place that
                        defines what a session's summary looks like. ── */}
                    <Col md={6}>
                        {sessionsError && (
                            <Alert variant="danger" className="d-flex justify-content-between align-items-center">
                                <span>{sessionsError}</span>
                                <Button size="sm" variant="outline-danger" onClick={loadSessions}>Retry</Button>
                            </Alert>
                        )}
                        {currentSession && (
                            <div className="session-card" style={{ padding: 0, overflow: "hidden" }}>
                                <div
                                    className="d-flex align-items-center justify-content-between"
                                    style={{
                                        padding: "20px 20px 12px",
                                        borderBottom: "0.5px solid var(--color-border-tertiary)",
                                    }}
                                >
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
                                <SessionQuickView
                                    date={currentSession.date}
                                    sessions={[currentSession]}
                                    onOpenModal={() => openSessionInCalendar(currentSession.date)}
                                    bordered={false}
                                    allowAdd={false}
                                />
                            </div>
                        )}
                    </Col>

                    {/* ── Negative balances ── */}
                    <Col md={6}>
                        <div className="session-card">
                            <h2 className="session-title">Player Balances</h2>
                            {negativeBalancePlayers.length > 0 ?
                                <div className="balances-list-wrap">
                                    <ul className="list-disc list-inside mb-0">
                                        {negativeBalancePlayers.map((player) => (
                                            <li key={player.id} className="player-balance">
                                                <Link to={`/players?playerId=${player.id}`}>
                                                    {player.firstName} {player.lastName ?? ""}
                                                </Link>{" "}
                                                —{" "}
                                                <strong>${(player.owed ?? 0).toFixed(2)}</strong>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
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
