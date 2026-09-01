import React, { useState } from "react";
import { getMonth, getYear, isToday } from "date-fns";
import { getFirstDayOfMonthWeekday, getTotalDaysInMonth } from "../../utils/dateUtils";
import type { Session } from "../../types";
import { isSessionPlayerUnpaid } from "../../utils/sessionPayment";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

interface Props {
    currentDate: Date;
    sessions: Session[];
    selectedDate: Date | null;
    onDayClick: (date: Date) => void;
    onExpandDay?: (date: Date) => void;
}

export default function CalendarGrid({ currentDate, sessions, selectedDate, onDayClick, onExpandDay }: Props) {
    const totalDays = getTotalDaysInMonth(currentDate);
    const startDay = getFirstDayOfMonthWeekday(currentDate);
    const year = getYear(currentDate);
    const month = getMonth(currentDate);

    const cells: React.ReactNode[] = [];

    for (let i = 0; i < startDay; i++) {
        cells.push(<div key={`pre-${i}`} style={styles.emptyCell} />);
    }

    for (let day = 1; day <= totalDays; day++) {
        const date = new Date(year, month, day);
        const daySessions = sessions.filter((s) => +s.date === +date);
        const today = isToday(date);
        const selected = selectedDate && +selectedDate === +date;
        const allPaid =
            daySessions.length > 0 &&
            daySessions.every((s) => s.players.length > 0 && !s.players.some(isSessionPlayerUnpaid));

        cells.push(
            <DayCell
                key={day}
                day={day}
                sessionCount={daySessions.length}
                today={today}
                selected={!!selected}
                allPaid={allPaid}
                onClick={() => onDayClick(date)}
                onExpand={daySessions.length > 0 && onExpandDay ? () => onExpandDay(date) : undefined}
            />,
        );
    }

    const remainder = cells.length % 7;
    if (remainder !== 0) {
        for (let i = remainder; i < 7; i++) {
            cells.push(<div key={`post-${i}`} style={styles.emptyCell} />);
        }
    }

    const weeks: React.ReactNode[][] = [];
    for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

    return (
        <div style={styles.scrollContainer}>
            <div style={styles.grid}>
                <div style={styles.headerRow}>
                    {WEEKDAYS.map((wd) => (
                        <div key={wd} style={styles.headerCell}>
                            {wd}
                        </div>
                    ))}
                </div>
                {weeks.map((week, i) => (
                    <div key={i} style={styles.weekRow}>
                        {week}
                    </div>
                ))}
            </div>
        </div>
    );
}

function DayCell({
    day,
    sessionCount,
    today,
    selected,
    allPaid,
    onClick,
    onExpand,
}: {
    day: number;
    sessionCount: number;
    today: boolean;
    selected: boolean;
    allPaid: boolean;
    onClick: () => void;
    onExpand?: () => void;
}) {
    const [hovered, setHovered] = useState(false);

    return (
        <div
            onClick={onClick}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            style={{
                ...styles.cell,
                background:
                    selected ? "var(--color-background-info)"
                    : hovered ? "var(--color-background-secondary)"
                    : "transparent",
                cursor: "pointer",
                position: "relative",
            }}
        >
            {/* Day number */}
            <div
                style={{
                    ...styles.dayNumber,
                    ...(today ? styles.todayNumber : {}),
                }}
            >
                {day}
            </div>

            {/* Session indicator bar at bottom */}
            {sessionCount > 0 && (
                <div
                    style={{
                        position: "absolute",
                        bottom: 4,
                        left: 8,
                        right: 8,
                        height: 5,
                        borderRadius: 2,
                        background: allPaid ? "var(--color-text-success)" : "var(--color-text-danger)",
                    }}
                />
            )}

            {/* Multi-session count + expand-to-details shortcut (only when a session exists) */}
            {(sessionCount > 1 || onExpand) && (
                <div
                    style={{
                        position: "absolute",
                        top: 6,
                        right: 6,
                        display: "flex",
                        alignItems: "center",
                        gap: 4,
                    }}
                >
                    {sessionCount > 1 && (
                        <span style={{ fontSize: 10, fontWeight: 600, color: "var(--color-text-secondary)" }}>
                            ×{sessionCount}
                        </span>
                    )}
                    {onExpand && (
                        <button
                            type="button"
                            aria-label="View session details"
                            title="View session details"
                            onClick={(e) => {
                                e.stopPropagation();
                                onExpand();
                            }}
                            style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                width: 18,
                                height: 18,
                                padding: 0,
                                border: "none",
                                borderRadius: 4,
                                background: "transparent",
                                color: "var(--color-text-secondary)",
                                cursor: "pointer",
                            }}
                        >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                <g stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                                    <polyline points="15 3 21 3 21 9" />
                                    <line x1="10" y1="14" x2="21" y2="3" />
                                </g>
                            </svg>
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}

const styles: Record<string, React.CSSProperties> = {
    // On narrow screens, 7 columns of readable day cells don't fit — rather
    // than squeezing cells until they're illegibly small, the grid keeps a
    // fixed minimum width and this wrapper scrolls horizontally instead.
    scrollContainer: {
        width: "100%",
        overflowX: "auto",
        WebkitOverflowScrolling: "touch", // momentum scrolling on iOS
    },
    grid: {
        width: "100%",
        minWidth: 560, // 7 cols × 80px — the smallest a day cell stays usable
        borderTop: "0.5px solid var(--color-border-tertiary)",
        borderLeft: "0.5px solid var(--color-border-tertiary)",
    },
    headerRow: {
        display: "grid",
        // minmax(0, 1fr), not bare 1fr: without the explicit 0 minimum, a grid
        // track can't shrink below its content's min-content size, so a cell
        // with wider content (e.g. the "×3" session-count badge) silently
        // pushes just *that* column wider than the others — which is exactly
        // why header and week rows were drifting out of alignment on mobile.
        gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
    },
    headerCell: {
        padding: "10px 0",
        textAlign: "center",
        fontSize: 11,
        fontWeight: 500,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        color: "var(--color-text-secondary)",
        borderRight: "0.5px solid var(--color-border-tertiary)",
        borderBottom: "0.5px solid var(--color-border-tertiary)",
    },
    weekRow: {
        display: "grid",
        gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
    },
    cell: {
        minHeight: 120,
        padding: "10px 10px 14px",
        borderRight: "0.5px solid var(--color-border-tertiary)",
        borderBottom: "0.5px solid var(--color-border-tertiary)",
        display: "flex",
        flexDirection: "column",
        transition: "background 0.1s",
        borderRadius: 4,
    },
    emptyCell: {
        minHeight: 120,
        borderRight: "0.5px solid var(--color-border-tertiary)",
        borderBottom: "0.5px solid var(--color-border-tertiary)",
        background: "var(--color-background-tertiary)",
        opacity: 0.4,
    },
    dayNumber: {
        width: 28,
        height: 28,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: "50%",
        fontSize: 13,
        color: "var(--color-text-primary)",
    },
    todayNumber: {
        background: "var(--color-text-info)",
        color: "#fff",
        fontWeight: 600,
    },
};