import React, { useCallback, useEffect, useState } from "react";
import { Button, ButtonGroup, Spinner } from "react-bootstrap";
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import { getMonth, getYear, lastDayOfMonth } from "date-fns";

import { useAppSelector } from "../../hooks";
import { selectModalMode } from "../../features/SessionModal/sessionModalSlice";
import { fetchSessions, fetchSessionById, addSession, editSession } from "../../services/firebase";
import { getMonthYear, getNextMonth, getPrevMonth } from "../../utils/dateUtils";
import type { Session } from "../../types";
import type { NewSessionData } from "../../services/firebase/sessions";

import CalendarGrid from "./CalendarGrid";
import SessionModal from "./SessionModal";
import SessionQuickView from "./SessionQuickView";

export default function SessionCalendar() {
    const [currentDate, setCurrentDate] = useState(new Date());
    const [selectedDate, setSelectedDate] = useState<Date | null>(null);
    const [selectedSession, setSelectedSession] = useState<Session | undefined>();
    const [clickedDate, setClickedDate] = useState<Date | null>(null);
    const [sessions, setSessions] = useState<Session[]>([]);
    const [modalSession, setModalSession] = useState<Session | undefined>();
    const [showModal, setShowModal] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const modalMode = useAppSelector(selectModalMode);

    const loadMonth = useCallback(async () => {
        setIsLoading(true);
        try {
            const result = await fetchSessions({
                startDate: new Date(getYear(currentDate), getMonth(currentDate), 1),
                endDate: lastDayOfMonth(currentDate),
            });
            setSessions(result);
            if (selectedDate) {
                setSelectedSession(result.find((s) => +s.date === +selectedDate));
            }
        } catch (err) {
            console.error("Failed to load sessions:", err);
        } finally {
            setIsLoading(false);
        }
    }, [currentDate]);

    useEffect(() => {
        loadMonth();
    }, [loadMonth]);

    const handleDayClick = (date: Date, session: Session | undefined) => {
        setSelectedDate(date);
        setSelectedSession(session);
    };

    const handleOpenModal = () => {
        if (!selectedDate) return;
        setClickedDate(selectedDate);
        setModalSession(selectedSession);
        setShowModal(true);
    };

    const handleAddSession = () => {
        if (!selectedDate) return;
        setClickedDate(selectedDate);
        setModalSession(undefined);
        setShowModal(true);
    };

    const handleSessionUpdate = useCallback(async (sessionId: string) => {
        try {
            const updated = await fetchSessionById(sessionId);
            setModalSession(updated);
            setSelectedSession(updated);
            setSessions((prev) => prev.map((s) => (s.id === sessionId ? updated : s)));
        } catch (err) {
            console.error("Failed to refresh session:", err);
        }
    }, []);

    const handleSaveSession = async (data: NewSessionData) => {
        if (!clickedDate) return;
        const sessionData = { ...data, date: clickedDate };
        if (modalMode === "edit" && modalSession?.id) {
            await editSession(modalSession.id, sessionData);
        } else {
            await addSession(sessionData);
        }
        await loadMonth();
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
                        session={selectedSession}
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
