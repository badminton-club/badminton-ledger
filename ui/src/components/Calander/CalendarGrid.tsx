import React, { useState } from "react";
import { getMonth, getYear, isToday } from "date-fns";
import { getFirstDayOfMonthWeekday, getTotalDaysInMonth } from "../../utils/dateUtils";
import type { Session } from "../../types";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

interface Props {
    currentDate: Date;
    sessions: Session[];
    selectedDate: Date | null;
    onDayClick: (date: Date) => void;
}

export default function CalendarGrid({ currentDate, sessions, selectedDate, onDayClick }: Props) {
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
            daySessions.every((s) => s.players.length > 0 && s.players.filter((p) => !p.paid && !p.comped).length === 0);

        cells.push(
            <DayCell
                key={day}
                day={day}
                sessionCount={daySessions.length}
                today={today}
                selected={!!selected}
                allPaid={allPaid}
                onClick={() => onDayClick(date)}
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
    );
}

function DayCell({
    day,
    sessionCount,
    today,
    selected,
    allPaid,
    onClick,
}: {
    day: number;
    sessionCount: number;
    today: boolean;
    selected: boolean;
    allPaid: boolean;
    onClick: () => void;
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
            {sessionCount > 1 && (
                <div
                    style={{
                        position: "absolute",
                        top: 8,
                        right: 8,
                        fontSize: 10,
                        fontWeight: 600,
                        color: "var(--color-text-secondary)",
                    }}
                >
                    ×{sessionCount}
                </div>
            )}
        </div>
    );
}

const styles: Record<string, React.CSSProperties> = {
    grid: {
        width: "100%",
        borderTop: "0.5px solid var(--color-border-tertiary)",
        borderLeft: "0.5px solid var(--color-border-tertiary)",
    },
    headerRow: {
        display: "grid",
        gridTemplateColumns: "repeat(7, 1fr)",
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
        gridTemplateColumns: "repeat(7, 1fr)",
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
        minWidth: 24,
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
