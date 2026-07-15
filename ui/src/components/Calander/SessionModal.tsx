import React, { useEffect, useCallback } from "react";
import { Modal } from "react-bootstrap";
import { useAppDispatch, useAppSelector } from "../../hooks";
import {
    setMode,
    resetModal,
    setResolutionItems,
    setConfirmedPlayers,
    setFormError,
    clearErrors,
    selectModalMode,
    selectResolutionItems,
} from "../../features/SessionModal/sessionModalSlice";
import { findPlayersByName } from "../../services/firebase/players";
import type { Session, NameResolutionItem, ConfirmedPlayer } from "../../types";
import { formatPlayerName } from "../../services/firebase/players";

import PasteNamesStep from "./steps/PasteNamesStep";
import ResolveNamesStep from "./steps/ResolveNamesStep";
import SessionDetailsStep from "./steps/SessionDetailsStep";
import ExistingSessionView from "./steps/ExistingSessionView";
import NoSessionView from "./steps/NoSessionView";

interface Props {
    show: boolean;
    onHide: () => void;
    session?: Session;
    onSessionUpdate: (sessionId: string) => void;
    onSaveSession: (data: unknown) => Promise<void>;
    onDeleteSession: (sessionId: string) => Promise<void>;
}

const MODAL_TITLES: Record<string, string> = {
    paste: "Add Session — Step 1: Players",
    resolve: "Add Session — Step 2: Confirm Attendees",
    details: "Add Session — Step 3: Details",
    edit: "Edit Session",
    view: "Session Details",
};

export default function SessionModal({ show, onHide, session, onSessionUpdate, onSaveSession, onDeleteSession }: Props) {
    const dispatch = useAppDispatch();
    const mode = useAppSelector(selectModalMode);

    // Reset when modal closes
    useEffect(() => {
        if (!show) dispatch(resetModal());
    }, [show, dispatch]);

    // ── Step 1 → 2: parse names and kick off matching ───────────────────────────
    const handlePasteSubmit = useCallback(
        async (rawInput: string) => {
            dispatch(clearErrors());

            // Parse numbered list: "1. Name"
            const lines = rawInput
                .trim()
                .split(/[\n,]+/)
                .map((l) => l.trim())
                .filter(Boolean);
            const nameRegex = /^\s*\d+\s*\.\s*(.*)$/;
            const names = lines
                .map((l) => {
                    const m = l.match(nameRegex);
                    return m ? m[1].trim() : l;
                })
                .filter(Boolean);

            if (names.length === 0) {
                dispatch(setFormError("No valid player names found."));
                return;
            }

            // Build skeleton items immediately so the UI can show progress
            const items: NameResolutionItem[] = names.map((name, i) => ({
                id: String(i),
                rawName: name,
                editableName: name,
                isEditing: false,
                status: "pending",
                candidates: [],
                resolvedPlayerId: null,
            }));
            dispatch(setResolutionItems(items));
            dispatch(setMode("resolve"));

            // Kick off matching in the background — each result dispatches an update
            resolveAll(items, dispatch);
        },
        [dispatch],
    );

    // ── Step 2 → 3: all names resolved, build confirmed list ────────────────────
    const handleResolveComplete = useCallback(
        (items: NameResolutionItem[]) => {
            const confirmed: ConfirmedPlayer[] = items.map((item) => ({
                id: item.resolvedPlayerId!,
                percentage: 1,
            }));
            dispatch(setConfirmedPlayers(confirmed));
            dispatch(setMode("details"));
        },
        [dispatch],
    );

    // ── Step 3: save session ─────────────────────────────────────────────────────
    const handleDetailsSave = useCallback(
        async (sessionData: unknown) => {
            await onSaveSession(sessionData);
            onHide();
        },
        [onSaveSession, onHide],
    );

    const title = MODAL_TITLES[mode] ?? "Session Details";

    return (
        <Modal show={show} onHide={onHide} centered size="lg">
            <Modal.Header closeButton>
                <Modal.Title>{title}</Modal.Title>
            </Modal.Header>
            <Modal.Body>
                {mode === "paste" && <PasteNamesStep onSubmit={handlePasteSubmit} onCancel={onHide} />}
                {mode === "resolve" && (
                    <ResolveNamesStep onComplete={handleResolveComplete} onBack={() => dispatch(setMode("paste"))} />
                )}
                {(mode === "details" || mode === "edit") && (
                    <SessionDetailsStep session={session} onSave={handleDetailsSave} onCancel={onHide} />
                )}
                {mode === "view" && session?.id && (
                    <ExistingSessionView
                        session={session}
                        onSessionUpdate={onSessionUpdate}
                        onDelete={onDeleteSession}
                        onEdit={() => {
                            dispatch(
                                setConfirmedPlayers(
                                    session.players.map((p) => ({ id: p.id, percentage: p.percentage })),
                                ),
                            );
                            dispatch(setMode("edit"));
                        }}
                    />
                )}
                {mode === "view" && !session?.id && <NoSessionView onAddSession={() => dispatch(setMode("paste"))} />}
            </Modal.Body>
        </Modal>
    );
}

// ─── Background name resolver ─────────────────────────────────────────────────
// Runs all matches in parallel and dispatches individual item updates
// so the UI can update row-by-row as results arrive.

async function resolveAll(items: NameResolutionItem[], dispatch: ReturnType<typeof useAppDispatch>) {
    await Promise.all(
        items.map(async (item, index) => {
            try {
                const candidates = await findPlayersByName(item.editableName);
                let patch: Partial<NameResolutionItem>;

                if (candidates.length === 1) {
                    patch = {
                        status: "matched",
                        candidates,
                        resolvedPlayerId: candidates[0].id,
                    };
                } else if (candidates.length > 1) {
                    patch = { status: "conflict", candidates, resolvedPlayerId: null };
                } else {
                    patch = { status: "unmatched", candidates: [], resolvedPlayerId: null };
                }

                // Import updateResolutionItem inline to avoid circular dep in the helper
                const { updateResolutionItem } = await import("../../features/SessionModal/sessionModalSlice");
                dispatch(updateResolutionItem({ index, patch }));
            } catch {
                const { updateResolutionItem } = await import("../../features/SessionModal/sessionModalSlice");
                dispatch(updateResolutionItem({ index, patch: { status: "failed" } }));
            }
        }),
    );
}
