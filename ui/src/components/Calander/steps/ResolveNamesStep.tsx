import React, { useState } from "react";
import { Alert, Button, Card, Row, Col, Form, InputGroup, Spinner, Badge } from "react-bootstrap";
import { useAppDispatch, useAppSelector } from "../../../hooks";
import {
    selectResolutionItems,
    selectFormError,
    selectAllResolved,
    updateResolutionItem,
    setFormError,
} from "../../../features/SessionModal/sessionModalSlice";
import { findPlayersByName, addPlayer, formatPlayerName } from "../../../services/firebase";
import type { NameResolutionItem, Player, NewPlayerInput } from "types";
import { selectAllPlayers } from "features/players/playersSlice";

interface Props {
    onComplete: (items: NameResolutionItem[]) => void;
    onBack: () => void;
}

export default function ResolveNamesStep({ onComplete, onBack }: Props) {
    const dispatch = useAppDispatch();
    const items = useAppSelector(selectResolutionItems);
    console.log("items ==> ", items);
    const formError = useAppSelector(selectFormError);
    const allDone = useAppSelector(selectAllResolved);

    const pendingCount = items.filter((i) => i.status === "pending").length;
    const unresolvedCount = items.filter((i) => !i.resolvedPlayerId).length;

    const resolvedIds = items.map((i) => i.resolvedPlayerId).filter(Boolean);
    const duplicateIds = new Set(resolvedIds.filter((id, _, arr) => arr.filter((x) => x === id).length > 1));

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
                    <Button variant="primary" disabled={!allDone} onClick={() => onComplete(items)}>
                        Confirm & Add Details →
                    </Button>
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
}: {
    item: NameResolutionItem;
    index: number;
    dispatch: ReturnType<typeof useAppDispatch>;
    isDuplicate: boolean;
}) {
    const [isRematching, setIsRematching] = useState(false);
    const [showInlineAdd, setShowInlineAdd] = useState(false);

    const patch = (p: Partial<NameResolutionItem>) => dispatch(updateResolutionItem({ index, patch: p }));

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
        setShowInlineAdd(false);
    };

    return (
        <Card className="mb-2 shadow-sm">
            <Card.Body className="py-2">
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
                            onOpenAdd={() => setShowInlineAdd(true)}
                        />
                    </Col>
                </Row>

                {/* Inline create player */}
                {showInlineAdd && (
                    <InlineAddPlayer
                        initialName={item.editableName}
                        onCreated={handlePlayerCreated}
                        onCancel={() => setShowInlineAdd(false)}
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
        return (
            <Form.Group>
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
                    {item.candidates.map((p) => (
                        <option key={p.id} value={p.id}>
                            {formatPlayerName(p)}
                        </option>
                    ))}
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
    initialName,
    onCreated,
    onCancel,
}: {
    initialName: string;
    onCreated: (player: Player) => void;
    onCancel: () => void;
}) {
    const existingPlayers = useAppSelector(selectAllPlayers);

    const parts = initialName.trim().split(/\s+/);
    const [firstName, setFirstName] = useState(parts[0] ?? "");
    const [lastName, setLastName] = useState(parts.slice(1).join(" "));
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState("");

    const validate = (): string | null => {
        const first = firstName.trim().toLowerCase();
        const last = lastName.trim().toLowerCase();

        if (!first) return "First name is required.";

        // Check for exact first name match
        const sameFirst = existingPlayers.filter((p) => p.firstName.toLowerCase() === first);

        if (sameFirst.length > 0 && !last) {
            return `"${firstName.trim()}" already exists — add a last name to differentiate.`;
        }

        // Check for exact first + last name match
        if (sameFirst.some((p) => (p.lastName ?? "").toLowerCase() === last)) {
            return `"${firstName.trim()} ${lastName.trim()}" already exists. Check the player list — they may already be in the system.`;
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
                firstName: firstName.trim(),
                lastName: lastName.trim() || null,
                email: null,
                balance: 0,
                description: "",
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
                        value={firstName}
                        onChange={(e) => setFirstName(e.target.value)}
                    />
                </Col>
                <Col>
                    <Form.Control
                        size="sm"
                        placeholder="Last name"
                        value={lastName}
                        onChange={(e) => setLastName(e.target.value)}
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
        </div>
    );
}
