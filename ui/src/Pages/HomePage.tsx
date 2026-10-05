import React, { useCallback, useEffect, useState } from "react";
import { Container, Row, Col, Button, Alert } from "react-bootstrap";
import { format } from "date-fns";
import { Link, useSearchParams } from "react-router-dom";
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
// import "./HomePage.css";
import SessionCalendar from "components/Calander/SessionCalendar";
import SessionQuickView from "components/Calander/SessionQuickView";
import { fetchSessions } from "services/firebase/sessions";
import { useAppSelector } from "../hooks";
import { selectAllPlayers } from "../features/players/playersSlice";
import { selectIsClubAdmin } from "../features/club/clubSlice";
import type { Session } from "../types";

export default function HomePage() {
    const [sessions, setSessions] = useState<Session[]>([]);
    const [sessionIndex, setSessionIndex] = useState(0);
    const [sessionsError, setSessionsError] = useState('');
    const players = useAppSelector(selectAllPlayers);
    const isAdmin = useAppSelector(selectIsClubAdmin);
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

    // Distinct concerns: "owed" is unsettled session costs (never paid in any
    // form), while "overdrawn" is an actual negative prepaid balance (see the
    // Help & FAQ page) — surfaced as two separate lists so neither masks the
    // other.
    const owingPlayers = players.filter((p) => (p.owed ?? 0) > 0);
    const overdrawnPlayers = players.filter((p) => (p.balance ?? 0) < 0);

    // Deep-links into the calendar rendered further down this same page —
    // SessionCalendar watches for its own ?date= query param and opens the
    // matching popup directly, so this summary card doesn't need its own
    // modal plumbing.
    const openSessionInCalendar = useCallback((date: Date) => {
        const next = new URLSearchParams(searchParams);
        next.set("date", format(date, "yyyy-MM-dd"));
        setSearchParams(next);
    }, [searchParams, setSearchParams]);

    // Same deep-link mechanism as above, plus a "new" flag the calendar uses
    // to open the add-session flow straight away (rather than just selecting
    // the day) when there's no session there yet. Defaults to today, but the
    // "Choose date…" control next to the button lets an admin pick any day.
    const openAddSessionInCalendar = useCallback((date: Date = new Date()) => {
        const next = new URLSearchParams(searchParams);
        next.set("date", format(date, "yyyy-MM-dd"));
        next.set("new", "1");
        setSearchParams(next);
    }, [searchParams, setSearchParams]);

    // Clicking a date in the calendar below pages the "Latest/Previous
    // Session" card above to that same session, instead of only updating the
    // calendar's own (separate) quick-view panel — so the two stay in sync
    // rather than showing two different days at once. Only matches within
    // the already-loaded recent-sessions array (older sessions beyond that
    // window are left as-is, since there's nothing in the array to select).
    const handleCalendarDaySelected = useCallback((date: Date) => {
        const idx = sessions.findIndex((s) => +s.date === +date);
        if (idx !== -1) setSessionIndex(idx);
    }, [sessions]);

    return (
        <div className="home-page">
            <Container className="pb-4">
                {isAdmin && (
                    <div className="d-flex flex-wrap justify-content-end align-items-center gap-2 mb-3">
                        <Button variant="primary" onClick={() => openAddSessionInCalendar()}>
                            + Add Session
                        </Button>
                        <DatePicker
                            selected={null}
                            onChange={(date: Date | null) => {
                                if (date) openAddSessionInCalendar(date);
                            }}
                            customInput={
                                <Button size="sm" variant="outline-secondary" title="Add a session for a different date">
                                    Choose date…
                                </Button>
                            }
                            dateFormat="MMMM d, yyyy"
                        />
                    </div>
                )}

                {/* ── Outstanding balances — unsettled session dues and overdrawn
                    prepaid balances are distinct concerns, shown separately so
                    neither list masks the other. ── */}
                <Row className="mb-3">
                    <Col>
                        <div className="session-card">
                            <h2 className="session-title">Outstanding Balances</h2>
                            <div className="balances-list-wrap d-flex flex-column gap-3">
                                <div>
                                    <h3 className="small text-muted fw-bold mb-1">Owe for sessions</h3>
                                    {owingPlayers.length > 0 ?
                                        <ul className="list-disc list-inside mb-0">
                                            {owingPlayers.map((player) => (
                                                <li key={player.id} className="player-balance">
                                                    <Link to={`/players?playerId=${player.id}`}>
                                                        {player.firstName} {player.lastName ?? ""}
                                                    </Link>{" "}
                                                    —{" "}
                                                    <strong>${(player.owed ?? 0).toFixed(2)}</strong>
                                                </li>
                                            ))}
                                        </ul>
                                    :   <p className="no-players mb-0">No players owe for sessions.</p>}
                                </div>
                                <div>
                                    <h3 className="small text-muted fw-bold mb-1">Overdrawn balance</h3>
                                    {overdrawnPlayers.length > 0 ?
                                        <ul className="list-disc list-inside mb-0">
                                            {overdrawnPlayers.map((player) => (
                                                <li key={player.id} className="player-balance">
                                                    <Link to={`/players?playerId=${player.id}`}>
                                                        {player.firstName} {player.lastName ?? ""}
                                                    </Link>{" "}
                                                    —{" "}
                                                    <strong>Overdrawn ${Math.abs(player.balance).toFixed(2)}</strong>
                                                </li>
                                            ))}
                                        </ul>
                                    :   <p className="no-players mb-0">No players are overdrawn.</p>}
                                </div>
                            </div>
                        </div>
                    </Col>
                </Row>

                {/* ── Calendar + Latest/Previous Session — side by side so the
                    detail card can page through whatever day is clicked in the
                    calendar, without a second duplicate detail panel inside the
                    calendar itself. ── */}
                <Row>
                    <Col md={8} className="mb-3 mb-md-0">
                        <SessionCalendar
                            onSessionsChanged={loadSessions}
                            onDaySelected={handleCalendarDaySelected}
                            highlightDate={currentSession?.date ?? null}
                        />
                    </Col>
                    <Col md={4}>
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
                </Row>
            </Container>
        </div>
    );
}
