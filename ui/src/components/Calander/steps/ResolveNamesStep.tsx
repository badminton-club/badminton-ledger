import React, { useState } from "react";
import { Alert, Button, Card, Row, Col, Form, InputGroup, Spinner, Tooltip, OverlayTrigger } from "react-bootstrap";
import { useAppDispatch, useAppSelector } from "../../../hooks";
import {
    selectResolutionItems,
    selectFormError,
    selectAllResolved,
    updateResolutionItem,
    setResolutionItems,
    setFormError,
} from "../../../features/SessionModal/sessionModalSlice";
import { findPlayersByName, addPlayer, formatPlayerName } from "../../../services/firebase";
import type { NameResolutionItem, Player, NewPlayerInput } from "types";
import { selectAllPlayers } from "features/players/playersSlice";

interface Props {
    onComplete: (items: NameResolutionItem[]) => void;
    onBack: () => void;
}

interface NewPlayerDraft {
    firstName: string;
    lastName: string;
    isGuest: boolean;
}

function draftFromName(name: string): NewPlayerDraft {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    return {
        firstName: parts[0] ?? "",
        lastName: parts.slice(1).join(" "),
        isGuest: false,
    };
}

export default function ResolveNamesStep({ onComplete, onBack }: Props) {
    const dispatch = useAppDispatch();
    const items = useAppSelector(selectResolutionItems);
    const formError = useAppSelector(selectFormError);
    const allDone = useAppSelector(selectAllResolved);
    const existingPlayers = useAppSelector(selectAllPlayers);
    const [isSavingAll, setIsSavingAll] = useState(false);
    const [newPlayerDrafts, setNewPlayerDrafts] = useState<Record<string, NewPlayerDraft>>({});

    const pendingCount = items.filter((i) => i.status === "pending").length;
    const unresolvedCount = items.filter((i) => !i.resolvedPlayerId).length;
    const saveableItems = items.filter((i) =>
        i.isEditing || !!newPlayerDrafts[i.id] || (i.status === "unmatched" && !i.resolvedPlayerId)
    );

    const resolvedIds = items.map((i) => i.resolvedPlayerId).filter(Boolean);
    const duplicateIds = new Set(resolvedIds.filter((id, _, arr) => arr.filter((x) => x === id).length > 1));

    // Drops the whole row — used when a suggested/matched player is wrong for
    // this session and the attendee should just be excluded, not re-matched.
    const handleRemove = (index: number) => {
        const itemId = items[index]?.id;
        if (itemId) {
            setNewPlayerDrafts((current) => {
                const next = { ...current };
                delete next[itemId];
                return next;
            });
        }
        dispatch(setResolutionItems(items.filter((_, i) => i !== index)));
    };

    const handleSaveAll = async () => {
        const knownFirstNames = new Set(existingPlayers.map((player) => player.firstName.trim().toLowerCase()));
        const knownFullNames = new Set(existingPlayers.map((player) =>
            `${player.firstName.trim().toLowerCase()} ${(player.lastName ?? "").trim().toLowerCase()}`.trim()
        ));
        const plans: Array<{ item: NameResolutionItem; input: NewPlayerInput }> = [];

        for (const item of saveableItems) {
            const draft = newPlayerDrafts[item.id] ?? draftFromName(item.editableName);
            const firstName = draft.firstName.trim();
            const lastName = draft.lastName.trim();
            const firstKey = firstName.toLowerCase();
            const fullKey = `${firstKey} ${lastName.toLowerCase()}`.trim();

            if (!firstName) {
                dispatch(setFormError(`"${item.rawName}" needs a first name before it can be saved.`));
                return;
            }
            if (!lastName && knownFirstNames.has(firstKey)) {
                dispatch(setFormError(`"${firstName}" already exists — add a last name to differentiate.`));
                return;
            }
            if (knownFullNames.has(fullKey)) {
                dispatch(setFormError(`"${[firstName, lastName].filter(Boolean).join(" ")}" already exists.`));
                return;
            }

            knownFirstNames.add(firstKey);
            knownFullNames.add(fullKey);
            plans.push({
                item,
                input: {
                    firstName,
                    lastName: lastName || null,
                    email: null,
                    balance: 0,
                    description: "",
                    isGuest: draft.isGuest,
                },
            });
        }

        dispatch(setFormError(""));
        setIsSavingAll(true);
        try {
            for (const { item, input } of plans) {
                const id = await addPlayer(input);
                const player = { id, ...input } as unknown as Player;
                dispatch(updateResolutionItem({
                    id: item.id,
                    patch: {
                        status: "matched",
                        candidates: [player],
                        resolvedPlayerId: id,
                        isEditing: false,
                    },
                }));
                setNewPlayerDrafts((current) => {
                    const next = { ...current };
                    delete next[item.id];
                    return next;
                });
            }
        } catch (err: unknown) {
            dispatch(setFormError(err instanceof Error ? err.message : "Failed to save all players."));
        } finally {
            setIsSavingAll(false);
        }
    };

    return (
        <>
            {pendingCount > 0 && (
                <div className="d-flex align-items-center gap-2 mb-3 text-muted small">
                    <Spinner size="sm" animation="border" />
                    Matching {pendingCount} name{pendingCount !== 1 ? "s" : ""}…
                </div>
            )}

            {items.map((item, index) => (
                <NameRow
                    key={item.id}
                    item={item}
                    index={index}
                    dispatch={dispatch}
                    isDuplicate={!!item.resolvedPlayerId && duplicateIds.has(item.resolvedPlayerId)}
                    onRemove={() => handleRemove(index)}
                    newPlayerDraft={newPlayerDrafts[item.id]}
                    onNewPlayerDraftChange={(draft) => setNewPlayerDrafts((current) => ({
                        ...current,
                        [item.id]: draft,
                    }))}
                    onNewPlayerDraftClear={() => setNewPlayerDrafts((current) => {
                        const next = { ...current };
                        delete next[item.id];
                        return next;
                    })}
                />
            ))}

            {formError && (
                <Alert variant="danger" dismissible onClose={() => dispatch(setFormError(""))}>
                    {formError}
                </Alert>
            )}

            <div className="d-flex justify-content-between align-items-center mt-4">
                <Button variant="outline-secondary" onClick={onBack}>
                    ← Back
                </Button>

                <div className="d-flex align-items-center gap-3">
                    {unresolvedCount > 0 && (
                        <span className="text-muted small">
                            {items.length - unresolvedCount} / {items.length} confirmed
                        </span>
                    )}
                    {saveableItems.length > 0 && (
                        <Button
                            variant="success"
                            disabled={pendingCount > 0 || isSavingAll}
                            onClick={handleSaveAll}
                        >
                            {isSavingAll ? <Spinner size="sm" animation="border" /> : "Save All"}
                        </Button>
                    )}
                    {duplicateIds.size > 0 ?
                        <OverlayTrigger
                            placement="right"
                            delay={{ show: 250, hide: 400 }}
                            overlay={
                                <Tooltip id="button-tooltip">
                                    Duplicate names found — please resolve before continuing. You can edit names or
                                    clear selections to fix duplicates.
                                </Tooltip>
                            }
                        >
                            <span className="d-inline-block" tabIndex={0}>
                                <Button
                                    variant="primary"
                                    disabled={!allDone || duplicateIds.size > 0}
                                    onClick={() => onComplete(items)}
                                >
                                    Confirm & Add Details →
                                </Button>
                            </span>
                        </OverlayTrigger>
                    :   <Button variant="primary" disabled={!allDone} onClick={() => onComplete(items)}>
                            Confirm & Add Details →
                        </Button>
                    }
                </div>
            </div>
        </>
    );
}

// ─── Individual name row ──────────────────────────────────────────────────────

function NameRow({
    item,
    index,
    dispatch,
    isDuplicate,
    onRemove,
    newPlayerDraft,
    onNewPlayerDraftChange,
    onNewPlayerDraftClear,
}: {
    item: NameResolutionItem;
    index: number;
    dispatch: ReturnType<typeof useAppDispatch>;
    isDuplicate: boolean;
    onRemove: () => void;
    newPlayerDraft?: NewPlayerDraft;
    onNewPlayerDraftChange: (draft: NewPlayerDraft) => void;
    onNewPlayerDraftClear: () => void;
}) {
    const [isRematching, setIsRematching] = useState(false);
    const [showInlineAdd, setShowInlineAdd] = useState(false);

    const patch = (p: Partial<NameResolutionItem>) => dispatch(updateResolutionItem({ id: item.id, patch: p }));

    const handleRematch = async (name: string) => {
        setIsRematching(true);
        patch({ status: "pending", editableName: name, isEditing: false });
        try {
            const candidates = await findPlayersByName(name);
            if (candidates.length === 1) {
                patch({ status: "matched", candidates, resolvedPlayerId: candidates[0].id });
            } else if (candidates.length > 1) {
                patch({ status: "conflict", candidates, resolvedPlayerId: null });
            } else {
                patch({ status: "unmatched", candidates: [], resolvedPlayerId: null });
            }
        } catch {
            patch({ status: "failed" });
        } finally {
            setIsRematching(false);
        }
    };

    const handlePlayerCreated = (newPlayer: Player) => {
        patch({
            status: "matched",
            candidates: [newPlayer],
            resolvedPlayerId: newPlayer.id,
        });
        onNewPlayerDraftClear();
        setShowInlineAdd(false);
    };

    const handleOpenAdd = () => {
        if (!newPlayerDraft) onNewPlayerDraftChange(draftFromName(item.editableName));
        setShowInlineAdd(true);
    };

    return (
        <Card className="mb-2 shadow-sm position-relative">
            <button
                type="button"
                className="btn-close"
                aria-label={`Remove ${item.rawName}`}
                title="Remove this attendee"
                onClick={onRemove}
                style={{ position: "absolute", top: 12, right: 12 }}
            />
            <Card.Body className="py-2 pe-5">
                <Row className="align-items-center g-2">
                    {/* Left: name + edit */}
                    <Col md={4}>
                        {item.isEditing ?
                            <InputGroup size="sm">
                                <Form.Control
                                    autoFocus
                                    value={item.editableName}
                                    onChange={(e) => patch({ editableName: e.target.value })}
                                    onKeyDown={(e) => e.key === "Enter" && handleRematch(item.editableName)}
                                />
                                <Button
                                    variant="outline-success"
                                    disabled={isRematching}
                                    onClick={() => handleRematch(item.editableName)}
                                >
                                    {isRematching ?
                                        <Spinner size="sm" animation="border" />
                                    :   "Search"}
                                </Button>
                                <Button
                                    variant="outline-secondary"
                                    onClick={() => patch({ isEditing: false, editableName: item.rawName })}
                                >
                                    ✕
                                </Button>
                            </InputGroup>
                        :   <div>
                                <strong>{item.rawName}</strong>
                                <Button
                                    variant="link"
                                    size="sm"
                                    className={`p-0 ms-2  ${isDuplicate ? "text-warning" : "text-muted"}`}
                                    onClick={() => patch({ isEditing: true })}
                                >
                                    edit
                                </Button>
                            </div>
                        }
                    </Col>
                </Row>

                <Row>
                    <Col>
                        <StatusContent
                            item={item}
                            isRematching={isRematching}
                            onSelect={(id) =>
                                patch({
                                    resolvedPlayerId: id,
                                    status:
                                        id ? "matched"
                                        : item.candidates.length > 1 ? "conflict"
                                        : "unmatched",
                                })
                            }
                            onOpenAdd={handleOpenAdd}
                        />
                    </Col>
                </Row>

                {/* Inline create player */}
                {showInlineAdd && !item.resolvedPlayerId && (
                    <InlineAddPlayer
                        idSuffix={item.id}
                        draft={newPlayerDraft ?? draftFromName(item.editableName)}
                        onDraftChange={onNewPlayerDraftChange}
                        onCreated={handlePlayerCreated}
                        onCancel={() => {
                            onNewPlayerDraftClear();
                            setShowInlineAdd(false);
                        }}
                    />
                )}
            </Card.Body>
        </Card>
    );
}

// ─── Status-driven match UI ───────────────────────────────────────────────────

function StatusContent({
    item,
    isRematching,
    onSelect,
    onOpenAdd,
}: {
    item: NameResolutionItem;
    isRematching: boolean;
    onSelect: (id: string | null) => void;
    onOpenAdd: () => void;
}) {
    if (item.status === "pending" || isRematching) {
        return <Spinner size="sm" animation="border" />;
    }

    if (item.status === "matched") {
        const player = item.candidates.find((c) => c.id === item.resolvedPlayerId) ?? item.candidates[0];
        return (
            <div className="d-flex align-items-center gap-2">
                <span>{player ? formatPlayerName(player) : item.resolvedPlayerId}</span>
                <Button variant="link" size="sm" className="p-0 text-muted" onClick={() => onSelect(null)}>
                    clear
                </Button>
            </div>
        );
    }

    if (item.status === "conflict") {
        const nameCounts = item.candidates.reduce<Record<string, number>>((counts, player) => {
            const name = formatPlayerName(player).toLocaleLowerCase();
            counts[name] = (counts[name] ?? 0) + 1;
            return counts;
        }, {});

        return (
            <Form.Group controlId={`resolve-name-conflict-${item.id}`}>
                <Form.Label className="text-warning small mb-1">Multiple matches — please select:</Form.Label>
                <Form.Select
                    size="sm"
                    value={item.resolvedPlayerId ?? ""}
                    onChange={(e) => {
                        if (e.target.value === "__new__") {
                            onOpenAdd();
                            return;
                        }
                        onSelect(e.target.value || null);
                    }}
                >
                    <option value="">— Select player —</option>
                    <option value="__new__" style={{ color: "green" }}>
                        + Add new player
                    </option>
                    {item.candidates.map((p) => {
                        const name = formatPlayerName(p);
                        const label = nameCounts[name.toLocaleLowerCase()] > 1 ? `${name} (${p.email ?? "no email"})` : name;
                        return (
                            <option key={p.id} value={p.id}>
                                {label}
                            </option>
                        );
                    })}
                </Form.Select>
            </Form.Group>
        );
    }

    if (item.status === "unmatched") {
        return (
            <div className="d-flex justify-content-between align-items-center">
                <span className="text-danger small">No match found</span>
                <Button variant="success" size="sm" onClick={onOpenAdd}>
                    + Add player
                </Button>
            </div>
        );
    }

    if (item.status === "failed") {
        return <span className="text-danger small">Match failed — try editing the name</span>;
    }

    return null;
}

// ─── Inline new player form ───────────────────────────────────────────────────

function InlineAddPlayer({
    idSuffix,
    draft,
    onDraftChange,
    onCreated,
    onCancel,
}: {
    idSuffix: string;
    draft: NewPlayerDraft;
    onDraftChange: (draft: NewPlayerDraft) => void;
    onCreated: (player: Player) => void;
    onCancel: () => void;
}) {
    const existingPlayers = useAppSelector(selectAllPlayers);

    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState("");

    const validate = (): string | null => {
        const first = draft.firstName.trim().toLowerCase();
        const last = draft.lastName.trim().toLowerCase();

        if (!first) return "First name is required.";

        // Check for exact first name match
        const sameFirst = existingPlayers.filter((p) => p.firstName.toLowerCase() === first);

        if (sameFirst.length > 0 && !last) {
            return `"${draft.firstName.trim()}" already exists — add a last name to differentiate.`;
        }

        // Check for exact first + last name match
        if (sameFirst.some((p) => (p.lastName ?? "").toLowerCase() === last)) {
            return `"${draft.firstName.trim()} ${draft.lastName.trim()}" already exists. Check the player list — they may already be in the system.`;
        }

        return null;
    };
    const handleSave = async () => {
        const validationError = validate();
        if (validationError) {
            setError(validationError);
            return;
        }
        setIsSaving(true);
        try {
            const input: NewPlayerInput = {
                firstName: draft.firstName.trim(),
                lastName: draft.lastName.trim() || null,
                email: null,
                balance: 0,
                description: "",
                isGuest: draft.isGuest,
            };
            const id = await addPlayer(input);
            onCreated({ id, ...input } as unknown as Player);
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : "Failed to add player");
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="border rounded p-2 mt-2 bg-light">
            <small className="fw-bold d-block mb-2">New player</small>
            {error && (
                <Alert variant="danger" className="py-1 px-2 small">
                    {error}
                </Alert>
            )}
            <Row className="g-2">
                <Col>
                    <Form.Control
                        size="sm"
                        placeholder="First name *"
                        value={draft.firstName}
                        onChange={(e) => onDraftChange({ ...draft, firstName: e.target.value })}
                    />
                </Col>
                <Col>
                    <Form.Control
                        size="sm"
                        placeholder="Last name"
                        value={draft.lastName}
                        onChange={(e) => onDraftChange({ ...draft, lastName: e.target.value })}
                    />
                </Col>
                <Col xs="auto">
                    <Button size="sm" variant="success" disabled={isSaving} onClick={handleSave}>
                        {isSaving ?
                            <Spinner size="sm" animation="border" />
                        :   "Save"}
                    </Button>
                </Col>
                <Col xs="auto">
                    <Button size="sm" variant="outline-secondary" onClick={onCancel}>
                        Cancel
                    </Button>
                </Col>
            </Row>
            <Form.Check
                type="checkbox"
                id={`guest-checkbox-${idSuffix}`}
                className="mt-2 small"
                label="Guest (one-time attendee — won't show on the Players tab, but their balance is still tracked)"
                checked={draft.isGuest}
                onChange={(e) => onDraftChange({ ...draft, isGuest: e.target.checked })}
            />
        </div>
    );
}
