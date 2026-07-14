import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Button, ButtonGroup, Spinner } from "react-bootstrap";
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import { getMonth, getYear, lastDayOfMonth } from "date-fns";
import { useSearchParams } from "react-router-dom";

import { useAppDispatch, useAppSelector } from "../../hooks";
import { selectModalMode, setMode } from "../../features/SessionModal/sessionModalSlice";
import { fetchSessions, fetchSessionById, addSession, editSession } from "../../services/firebase";
import { getMonthYear, getNextMonth, getPrevMonth } from "../../utils/dateUtils";
import type { Session } from "../../types";
import type { NewSessionData } from "../../services/firebase/sessions";

import CalendarGrid from "./CalendarGrid";
import SessionModal from "./SessionModal";
import SessionQuickView from "./SessionQuickView";

export default function SessionCalendar({ onSessionsChanged }: { onSessionsChanged?: () => void }) {
    const [currentDate, setCurrentDate] = useState(new Date());
    const [selectedDate, setSelectedDate] = useState<Date | null>(null);
    const [clickedDate, setClickedDate] = useState<Date | null>(null);
    const [sessions, setSessions] = useState<Session[]>([]);
    const [modalSession, setModalSession] = useState<Session | undefined>();
    const [showModal, setShowModal] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const modalMode = useAppSelector(selectModalMode);
    const dispatch = useAppDispatch();
    const [searchParams, setSearchParams] = useSearchParams();

    const selectedSessions = useMemo(
        () => (selectedDate ? sessions.filter((s) => +s.date === +selectedDate) : []),
        [selectedDate, sessions],
    );

    const loadMonth = useCallback(async () => {
        setIsLoading(true);
        try {
            const result = await fetchSessions({
                startDate: new Date(getYear(currentDate), getMonth(currentDate), 1),
                endDate: lastDayOfMonth(currentDate),
            });
            setSessions(result);
        } catch (err) {
            console.error("Failed to load sessions:", err);
        } finally {
            setIsLoading(false);
        }
    }, [currentDate]);

    useEffect(() => {
        loadMonth();
    }, [loadMonth]);

    // Deep link: /?date=YYYY-MM-DD opens the calendar on that month and selects the day.
    useEffect(() => {
        const dateParam = searchParams.get("date");
        if (!dateParam) return;
        const [y, m, d] = dateParam.split("-").map(Number);
        if (!y || !m || !d) return;
        setCurrentDate(new Date(y, m - 1, d));
        setSelectedDate(new Date(y, m - 1, d));
        searchParams.delete("date");
        setSearchParams(searchParams, { replace: true });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [searchParams]);

    const handleDayClick = (date: Date) => {
        setSelectedDate(date);
    };

    const handleOpenModal = (session: Session) => {
        if (!selectedDate) return;
        setClickedDate(selectedDate);
        setModalSession(session);
        dispatch(setMode("view"));
        setShowModal(true);
    };

    const handleAddSession = () => {
        if (!selectedDate) return;
        setClickedDate(selectedDate);
        setModalSession(undefined);
        dispatch(setMode("paste"));
        setShowModal(true);
    };

    const handleSessionUpdate = useCallback(async (sessionId: string) => {
        try {
            const updated = await fetchSessionById(sessionId);
            setModalSession(updated);
            setSessions((prev) => prev.map((s) => (s.id === sessionId ? updated : s)));
            onSessionsChanged?.();
        } catch (err) {
            console.error("Failed to refresh session:", err);
        }
    }, [onSessionsChanged]);

    const handleSaveSession = async (data: NewSessionData) => {
        if (!clickedDate) return;
        const sessionData = { ...data, date: clickedDate };
        if (modalMode === "edit" && modalSession?.id) {
            await editSession(modalSession.id, sessionData);
        } else {
            await addSession(sessionData);
        }
        await loadMonth();
        onSessionsChanged?.();
        setShowModal(false);
    };

    return (
        <div style={styles.outerWrap}>
            {/* ── Calendar panel ───────────────────────────────────────────── */}
            <div style={styles.calendarPanel}>
                <div style={styles.calendarHeader}>
                    <DatePicker
                        selected={currentDate}
                        onChange={(d: Date | null) => {
                            if (d) setCurrentDate(d);
                        }}
                        customInput={
                            <Button variant="outline-secondary" size="sm" className="fw-bold">
                                {getMonthYear(currentDate)}
                            </Button>
                        }
                        showMonthYearPicker
                        dateFormat="MMMM yyyy"
                    />
                    <ButtonGroup>
                        <Button
                            variant="outline-secondary"
                            size="sm"
                            onClick={() => setCurrentDate(getPrevMonth(currentDate))}
                        >
                            &lt;
                        </Button>
                        <Button
                            variant="outline-secondary"
                            size="sm"
                            onClick={() => setCurrentDate(getNextMonth(currentDate))}
                        >
                            &gt;
                        </Button>
                    </ButtonGroup>
                </div>

                {isLoading ?
                    <div style={styles.loadingWrap}>
                        <Spinner animation="border">
                            <span className="visually-hidden">Loading…</span>
                        </Spinner>
                    </div>
                :   <CalendarGrid
                        currentDate={currentDate}
                        sessions={sessions}
                        selectedDate={selectedDate}
                        onDayClick={handleDayClick}
                    />
                }
            </div>

            {/* ── Quick view panel ─────────────────────────────────────────── */}
            <div style={styles.quickViewPanel}>
                {selectedDate ?
                    <SessionQuickView
                        date={selectedDate}
                        sessions={selectedSessions}
                        onAddSession={handleAddSession}
                        onOpenModal={handleOpenModal}
                    />
                :   <div style={styles.quickViewEmpty}>
                        <p style={styles.quickViewEmptyText}>Select a day to see session details</p>
                    </div>
                }
            </div>

            <SessionModal
                show={showModal}
                onHide={() => setShowModal(false)}
                session={modalSession}
                onSessionUpdate={handleSessionUpdate}
                onSaveSession={handleSaveSession}
            />
        </div>
    );
}

const styles: Record<string, React.CSSProperties> = {
    outerWrap: {
        display: "flex",
        alignItems: "flex-start",
        gap: 16,
        width: "100%",
        paddingBottom: 40, 
    },

    // Calendar panel — its own card with header + grid inside
    calendarPanel: {
        flex: 1,
        minWidth: 0,
        border: "0.5px solid var(--color-border-tertiary)",
        borderRadius: 12,
        overflow: "hidden",
        background: "var(--color-background-primary)",
    },

    calendarHeader: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "12px 16px",
        borderBottom: "0.5px solid var(--color-border-tertiary)",
    },

    loadingWrap: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: 500,
    },

    // Quick view — separate card, no header
    quickViewPanel: {
        width: 300,
        flexShrink: 0,
        border: "0.5px solid var(--color-border-tertiary)",
        borderRadius: 12,
        overflow: "hidden",
        background: "var(--color-background-primary)",
        alignSelf: "flex-start", // don't stretch to calendar height
        position: "sticky",
        top: 20,
    },

    quickViewEmpty: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 40,
        minHeight: 200,
    },

    quickViewEmptyText: {
        fontSize: 13,
        color: "var(--color-text-tertiary)",
        textAlign: "center",
        margin: 0,
    },
};
