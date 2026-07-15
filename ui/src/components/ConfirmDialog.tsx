import React from "react";
import { Button, Modal } from "react-bootstrap";

interface Props {
    show: boolean;
    title: string;
    message: string;
    confirmLabel?: string;
    confirmVariant?: string;
    onConfirm: () => void;
    onCancel: () => void;
    isLoading?: boolean;
}

export default function ConfirmDialog({
    show,
    title,
    message,
    confirmLabel = "Confirm",
    confirmVariant = "danger",
    onConfirm,
    onCancel,
    isLoading = false,
}: Props) {
    return (
        <Modal show={show} onHide={onCancel} centered size="sm">
            <Modal.Header closeButton>
                <Modal.Title style={{ fontSize: 16 }}>{title}</Modal.Title>
            </Modal.Header>
            <Modal.Body>
                <p style={{ fontSize: 14, color: "var(--color-text-secondary)", margin: 0 }}>{message}</p>
            </Modal.Body>
            <Modal.Footer>
                <Button variant="outline-secondary" size="sm" onClick={onCancel} disabled={isLoading}>
                    Cancel
                </Button>
                <Button variant={confirmVariant} size="sm" onClick={onConfirm} disabled={isLoading}>
                    {confirmLabel}
                </Button>
            </Modal.Footer>
        </Modal>
    );
}
