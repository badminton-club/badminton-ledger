import React from "react";
import { format } from "date-fns";
import { Button } from "react-bootstrap";
import type { Session } from "../../types";
import { useAppSelector } from "../../hooks";
import { selectPlayerById } from "../../features/players/playersSlice";
import type { RootState } from "../../store";

interface Props {
    date: Date;
    session: Session | undefined;
    onAddSession: () => void;
    onOpenModal: () => void;
}

export default function SessionQuickView({ date, session, onAddSession, onOpenModal }: Props) {
    if (!session) {
        return (
            <div style={styles.wrap}>
                <p style={styles.dateLabel}>{format(date, "EEEE, MMMM d")}</p>
                <div style={styles.empty}>
                    <p style={styles.emptyText}>No session this day</p>
                    <Button size="sm" variant="primary" onClick={onAddSession}>
                        + Add Session
                    </Button>
                </div>
            </div>
        );
    }

    const totalPlayers = session.players.length;
    const unpaidPlayers = session.players.filter((p) => !p.paid).length;
    const paidPlayers = totalPlayers - unpaidPlayers;
    const totalBirds = session.birdieUsage.reduce((s, u) => s + u.quantity, 0);
    const allPaid = unpaidPlayers === 0 && totalPlayers > 0;

    return (
        <div style={styles.wrap}>
            <div style={styles.header}>
                <div>
                    <p style={styles.dateLabel}>{format(date, "EEEE, MMMM d")}</p>
                    <div
                        style={{
                            ...styles.statusBadge,
                            background: allPaid ? "var(--color-background-success)" : "var(--color-background-danger)",
                            color: allPaid ? "var(--color-text-success)" : "var(--color-text-danger)",
                        }}
                    >
                        {allPaid ? "Fully paid" : `${unpaidPlayers} unpaid`}
                    </div>
                </div>
                <Button size="sm" variant="outline-secondary" onClick={onOpenModal}>
                    View details
                </Button>
            </div>

            <div style={styles.statsGrid}>
                <StatCard
                    label="Players"
                    value={String(totalPlayers)}
                    subColor="var(--color-text-success)"
                />
                <StatCard
                    label="Unpaid"
                    value={String(unpaidPlayers)}
                    subColor={unpaidPlayers === 0 ? "var(--color-text-success)" : "var(--color-text-danger)"}
                />
                <StatCard
                    label="Courts"
                    value={String(session.courtCount ?? "—")}
                    sub={session.location ?? ""}
                    subColor="var(--color-text-secondary)"
                />
                <StatCard
                    label="Birdies used"
                    value={String(totalBirds)}
                    sub={`${session.birdieUsage.length} batch${session.birdieUsage.length !== 1 ? "es" : ""}`}
                    subColor="var(--color-text-secondary)"
                />
            </div>

            <div style={styles.divider} />

            <div style={styles.costRow}>
                <span style={styles.costLabel}>Total cost</span>
                <span style={styles.costValue}>${(session.totalSessionCost ?? 0).toFixed(2)}</span>
            </div>
            <div style={styles.costRow}>
                <span style={styles.costLabel}>Court cost</span>
                <span style={styles.costSub}>${(session.totalCourtCost ?? 0).toFixed(2)}</span>
            </div>
            <div style={styles.costRow}>
                <span style={styles.costLabel}>Birdie cost</span>
                <span style={styles.costSub}>${(session.totalBirdieCost ?? 0).toFixed(2)}</span>
            </div>

            <div style={styles.divider} />

            {/* Player list */}
            <p style={styles.sectionLabel}>Players</p>
            <div style={styles.playerList}>
                {session.players.map((p) => (
                    <PlayerRow key={p.id} playerId={p.id} cost={p.cost} paid={p.paid} highlighted={p.highlighted} />
                ))}
            </div>
        </div>
    );
}

function StatCard({ label, value, sub, subColor }: { label: string; value: string; sub?: string; subColor: string }) {
    return (
        <div style={styles.statCard}>
            <p style={styles.statLabel}>{label}</p>
            <p style={styles.statValue}>{value}</p>
            {sub && <p style={{ ...styles.statSub, color: subColor }}>{sub}</p>}
        </div>
    );
}

function PlayerRow({ playerId, cost, paid, highlighted }: { playerId: string; cost: number; paid: boolean; highlighted?: boolean }) {
    const player = useAppSelector((s: RootState) => selectPlayerById(s, playerId));
    const name = player ? [player.firstName, player.lastName].filter(Boolean).join(" ") : playerId;

    return (
        <div style={{...styles.playerRow, background: highlighted ? "#fff3cd" : ""}}>
            <div style={styles.playerAvatar}>{(player?.firstName?.[0] ?? "?").toUpperCase()}</div>
            <span style={styles.playerName}>{name}</span>
            <span
                style={{
                    ...styles.playerCost,
                    color: paid ? "var(--color-text-success)" : "var(--color-text-danger)",
                }}
            >
                ${cost.toFixed(2)}
            </span>
            <span
                style={{
                    ...styles.paidPill,
                    background: paid ? "var(--color-background-success)" : "var(--color-background-danger)",
                    color: paid ? "var(--color-text-success)" : "var(--color-text-danger)",
                }}
            >
                {paid ? "Paid" : "Unpaid"}
            </span>
        </div>
    );
}

const styles: Record<string, React.CSSProperties> = {
    wrap: {
        padding: "16px",
        borderLeft: "0.5px solid var(--color-border-tertiary)",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        gap: 0,
    },
    header: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-start",
        marginBottom: 16,
    },
    dateLabel: {
        fontSize: 14,
        fontWeight: 500,
        color: "var(--color-text-primary)",
        margin: "0 0 6px",
    },
    statusBadge: {
        display: "inline-block",
        fontSize: 11,
        fontWeight: 500,
        padding: "3px 8px",
        borderRadius: 20,
    },
    statsGrid: {
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 8,
        marginBottom: 16,
    },
    statCard: {
        background: "var(--color-background-secondary)",
        borderRadius: 8,
        padding: "10px 12px",
    },
    statLabel: {
        fontSize: 11,
        color: "var(--color-text-secondary)",
        margin: "0 0 2px",
        textTransform: "uppercase",
        letterSpacing: "0.06em",
        fontWeight: 500,
    },
    statValue: {
        fontSize: 22,
        fontWeight: 500,
        color: "var(--color-text-primary)",
        margin: "0 0 2px",
        lineHeight: 1,
    },
    statSub: {
        fontSize: 11,
        margin: 0,
    },
    divider: {
        height: "0.5px",
        background: "var(--color-border-tertiary)",
        margin: "12px 0",
    },
    costRow: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "baseline",
        marginBottom: 4,
    },
    costLabel: {
        fontSize: 13,
        color: "var(--color-text-secondary)",
    },
    costValue: {
        fontSize: 16,
        fontWeight: 500,
        color: "var(--color-text-primary)",
    },
    costSub: {
        fontSize: 13,
        color: "var(--color-text-secondary)",
    },
    sectionLabel: {
        fontSize: 11,
        fontWeight: 500,
        textTransform: "uppercase",
        letterSpacing: "0.06em",
        color: "var(--color-text-secondary)",
        margin: "0 0 8px",
    },
    playerList: {
        display: "flex",
        flexDirection: "column",
        gap: 4,
        overflowY: "auto",
        maxHeight: 280,
    },
    playerRow: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 8px",
        borderRadius: 6,
        background: "var(--color-background-secondary)",
    },
    playerAvatar: {
        width: 26,
        height: 26,
        borderRadius: "50%",
        background: "var(--color-background-info)",
        color: "var(--color-text-info)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 11,
        fontWeight: 600,
        flexShrink: 0,
    },
    playerName: {
        fontSize: 13,
        color: "var(--color-text-primary)",
        flex: 1,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
    },
    playerCost: {
        fontSize: 13,
        fontWeight: 500,
        flexShrink: 0,
    },
    paidPill: {
        fontSize: 10,
        fontWeight: 500,
        padding: "2px 6px",
        borderRadius: 10,
        flexShrink: 0,
    },
    empty: {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        flex: 1,
        gap: 12,
    },
    emptyText: {
        fontSize: 13,
        color: "var(--color-text-secondary)",
        margin: 0,
    },
};
