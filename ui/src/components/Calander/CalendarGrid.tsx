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
    creditDates?: Map<number, { hours: number; batchIds: string[] }>;
    onDayClick: (date: Date) => void;
    onExpandDay?: (date: Date) => void;
    onCreditClick?: (batchIds: string[]) => void;
}

export default function CalendarGrid({ currentDate, sessions, selectedDate, creditDates, onDayClick, onExpandDay, onCreditClick }: Props) {
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
        const creditInfo = creditDates?.get(+date);

        cells.push(
            <DayCell
                key={day}
                day={day}
                sessionCount={daySessions.length}
                today={today}
                selected={!!selected}
                allPaid={allPaid}
                creditHoursAdded={creditInfo?.hours}
                onCreditClick={creditInfo && onCreditClick ? () => onCreditClick(creditInfo.batchIds) : undefined}
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
    creditHoursAdded,
    onClick,
    onExpand,
    onCreditClick,
}: {
    day: number;
    sessionCount: number;
    today: boolean;
    selected: boolean;
    allPaid: boolean;
    creditHoursAdded?: number;
    onClick: () => void;
    onExpand?: () => void;
    onCreditClick?: () => void;
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

            {/* Court credit purchase badge — placed in normal flow right under the
                day number (not absolutely positioned) so it has room to be large
                enough to actually read, without overlapping the day number or the
                multi-session count / expand shortcut in the top-right corner.
                It's its own button (stopping propagation) so clicking it opens
                the purchased batch on the Credits page instead of just
                selecting the day underneath it. */}
            {!!creditHoursAdded && (
                <button
                    type="button"
                    title={`+${creditHoursAdded} court credit hr${creditHoursAdded === 1 ? "" : "s"} added — view in Credits`}
                    aria-label={`+${creditHoursAdded} court credit hours added — view in Credits`}
                    onClick={(e) => {
                        e.stopPropagation();
                        onCreditClick?.();
                    }}
                    style={{
                        alignSelf: "flex-start",
                        display: "inline-block",
                        marginTop: 4,
                        // Can't exceed the (possibly narrow, on mobile) cell's
                        // own width, so it never overflows into the
                        // neighboring day's cell — wraps onto a second line
                        // instead (cells are tall enough) rather than
                        // truncating/hiding the hours count.
                        maxWidth: "100%",
                        boxSizing: "border-box",
                        textAlign: "left",
                        // A border (not just a fill color) and a small icon
                        // make this read as its own clickable chip rather
                        // than a plain label.
                        border: "1px solid var(--color-border-success)",
                        fontSize: 11,
                        fontWeight: 700,
                        lineHeight: 1.3,
                        padding: "2px 6px",
                        borderRadius: 6,
                        color: "var(--color-text-success)",
                        background: "var(--color-background-success)",
                        cursor: onCreditClick ? "pointer" : "default",
                    }}
                >
                    <svg
                        width="10"
                        height="10"
                        viewBox="0 0 24 24"
                        fill="none"
                        aria-hidden="true"
                        style={{ verticalAlign: -1, marginRight: 3 }}
                    >
                        <g stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="1" y="4" width="22" height="16" rx="2" />
                            <line x1="1" y1="10" x2="23" y2="10" />
                        </g>
                    </svg>
                    +{creditHoursAdded} hrs
                </button>
            )}

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
    grid: {
        width: "100%",
        borderTop: "0.5px solid var(--color-border-tertiary)",
        borderLeft: "0.5px solid var(--color-border-tertiary)",
    },
    headerRow: {
        display: "grid",
        // minmax(0, 1fr) (not just 1fr) lets columns actually shrink on narrow
        // screens — grid's implicit minimum track size is otherwise each
        // cell's content width (e.g. the credit badge or day number), which
        // can add up past the viewport on mobile and clip the grid's right
        // edge instead of letting each column compress.
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
        minWidth: 0,
        // Horizontal padding is tighter than vertical — 7 columns on a phone
        // leaves very little width per cell, so this is the main lever for
        // fitting the day number and the court-credit badge's text without
        // clipping/truncating on mobile.
        padding: "10px 4px 14px",
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
