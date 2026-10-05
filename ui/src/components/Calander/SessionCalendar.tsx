import React, { useCallback, useEffect, useState } from "react";
import { Button, ButtonGroup, Spinner } from "react-bootstrap";
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import { getMonth, getYear, lastDayOfMonth } from "date-fns";
import { useSearchParams } from "react-router-dom";

import { useAppDispatch, useAppSelector } from "../../hooks";
import { selectModalMode, setMode } from "../../features/SessionModal/sessionModalSlice";
import { selectCurrentClubId, selectIsClubAdmin } from "../../features/club/clubSlice";
import { fetchSessions, fetchSessionById, addSession, editSession, deleteSession } from "../../services/firebase";
import { fetchCourtCredits } from "../../services/firebase/inventory";
import { getMonthYear, getNextMonth, getPrevMonth } from "../../utils/dateUtils";
import type { Session } from "../../types";
import type { NewSessionData } from "../../services/firebase/sessions";

import CalendarGrid from "./CalendarGrid";
import SessionModal from "./SessionModal";

export default function SessionCalendar({ onSessionsChanged, onDaySelected }: { onSessionsChanged?: () => void; onDaySelected?: (date: Date) => void }) {
    const [currentDate, setCurrentDate] = useState(new Date());
    const [selectedDate, setSelectedDate] = useState<Date | null>(null);
    const [clickedDate, setClickedDate] = useState<Date | null>(null);
    const [sessions, setSessions] = useState<Session[]>([]);
    const [creditDates, setCreditDates] = useState<Map<number, number>>(new Map());
    const [modalSession, setModalSession] = useState<Session | undefined>();
    const [showModal, setShowModal] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const modalMode = useAppSelector(selectModalMode);
    const currentClubId = useAppSelector(selectCurrentClubId);
    const isAdmin = useAppSelector(selectIsClubAdmin);
    const dispatch = useAppDispatch();
    const [searchParams, setSearchParams] = useSearchParams();

    const loadMonth = useCallback(async () => {
        if (!currentClubId) return;
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
    }, [currentDate, currentClubId]);

    useEffect(() => {
        loadMonth();
    }, [loadMonth]);

    // Shows a small badge on any day in the visible month that a court credit
    // batch was purchased on, so admins/members can see at a glance when
    // credits were topped up without opening the Credits tab.
    const loadCourtCreditDates = useCallback(async () => {
        if (!currentClubId) return;
        try {
            const batches = await fetchCourtCredits();
            const monthStart = new Date(getYear(currentDate), getMonth(currentDate), 1);
            const monthEnd = lastDayOfMonth(currentDate);
            const byDay = new Map<number, number>();
            batches.forEach((batch) => {
                if (batch.purchaseDate < monthStart || batch.purchaseDate > monthEnd) return;
                const day = new Date(
                    batch.purchaseDate.getFullYear(),
                    batch.purchaseDate.getMonth(),
                    batch.purchaseDate.getDate(),
                ).getTime();
                byDay.set(day, (byDay.get(day) ?? 0) + batch.hoursPurchased);
            });
            setCreditDates(byDay);
        } catch (err) {
            console.error("Failed to load court credit purchase dates:", err);
        }
    }, [currentDate, currentClubId]);

    useEffect(() => {
        loadCourtCreditDates();
    }, [loadCourtCreditDates]);

    // Deep link: /?date=YYYY-MM-DD opens the calendar on that month, selects
    // the day, and opens the full session-details popup directly for that
    // day (via its own narrow fetch, so it doesn't race the month-level
    // `sessions` load below) — instead of just selecting the day and leaving
    // the user to find it via the Latest Session card alongside the calendar.
    useEffect(() => {
        const dateParam = searchParams.get("date");
        if (!dateParam) return;
        const [y, m, d] = dateParam.split("-").map(Number);
        if (!y || !m || !d) return;
        // "new=1" (set by e.g. the homepage's "+ Add Session" button) opens
        // the add-session flow directly for an empty day, instead of just
        // selecting it and leaving an admin to click "+ Add Session" again.
        const wantsNew = searchParams.get("new") === "1";
        const target = new Date(y, m - 1, d);
        setCurrentDate(target);
        setSelectedDate(target);
        searchParams.delete("date");
        searchParams.delete("new");
        setSearchParams(searchParams, { replace: true });

        fetchSessions({ startDate: target, endDate: target })
            .then((daySessions) => {
                if (daySessions.length > 0) handleOpenModal(daySessions[0], target);
                else if (wantsNew && isAdmin) openAddSession(target);
            })
            .catch((err) => console.error("Failed to open deep-linked session:", err));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [searchParams]);

    const openAddSession = (date: Date) => {
        setClickedDate(date);
        setModalSession(undefined);
        dispatch(setMode("paste"));
        setShowModal(true);
    };

    const handleDayClick = (date: Date) => {
        setSelectedDate(date);
        onDaySelected?.(date);
        const hasSession = sessions.some((session) => +session.date === +date);
        // Only admins can create sessions — clicking an empty day should just
        // select it (so members can see "no session" state), not launch the
        // admin-only paste/create flow that would fail on submit anyway.
        if (!hasSession && isAdmin) openAddSession(date);
    };

    const handleOpenModal = (session: Session, dateOverride?: Date) => {
        const targetDate = dateOverride ?? selectedDate;
        if (!targetDate) return;
        setClickedDate(targetDate);
        setModalSession(session);
        dispatch(setMode("view"));
        setShowModal(true);
    };

    // Calendar-grid shortcut: jump straight to the "View details" modal for a
    // day's session without first selecting it. Only wired up for days that
    // actually have a session (see CalendarGrid).
    const handleExpandDay = (date: Date) => {
        const daySessions = sessions.filter((s) => +s.date === +date);
        if (daySessions.length === 0) return;
        setSelectedDate(date);
        onDaySelected?.(date);
        handleOpenModal(daySessions[0], date);
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

    const handleDeleteSession = async (sessionId: string) => {
        await deleteSession(sessionId);
        setShowModal(false);
        await loadMonth();
        onSessionsChanged?.();
    };

    // Navigating months should deselect whatever day was picked in the
    // previous month — otherwise a stale selection lingers highlighted in
    // the newly displayed grid even though it belongs to the month just
    // navigated away from.
    const goToMonth = (nextDate: Date) => {
        setCurrentDate(nextDate);
        setSelectedDate(null);
    };

    return (
        <div style={styles.outerWrap}>
            {/* ── Calendar panel ───────────────────────────────────────────── */}
            <div style={styles.calendarPanel}>
                <div style={styles.calendarHeader}>
                    <DatePicker
                        selected={currentDate}
                        onChange={(d: Date | null) => {
                            if (d) goToMonth(d);
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
                            onClick={() => goToMonth(getPrevMonth(currentDate))}
                        >
                            &lt;
                        </Button>
                        <Button
                            variant="outline-secondary"
                            size="sm"
                            onClick={() => goToMonth(getNextMonth(currentDate))}
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
                        creditDates={creditDates}
                        onDayClick={handleDayClick}
                        onExpandDay={handleExpandDay}
                    />
                }
            </div>

            <SessionModal
                show={showModal}
                onHide={() => setShowModal(false)}
                session={modalSession}
                date={clickedDate}
                onSessionUpdate={handleSessionUpdate}
                onSaveSession={handleSaveSession}
                onDeleteSession={handleDeleteSession}
            />
        </div>
    );
}

const styles: Record<string, React.CSSProperties> = {
    outerWrap: {
        display: "flex",
        alignItems: "flex-start",
        flexWrap: "wrap",
        gap: 16,
        width: "100%",
        paddingBottom: 40, 
    },

    // Calendar panel — its own card with header + grid inside
    calendarPanel: {
        flex: 1,
        minWidth: 300,
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
};
