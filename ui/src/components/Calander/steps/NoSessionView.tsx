import React from "react";
import { Button } from "react-bootstrap";

interface Props {
    onAddSession: () => void;
}

export default function NoSessionView({ onAddSession }: Props) {
    return (
        <div className="text-center p-4">
            <p className="text-muted">No session recorded for this day.</p>
            <Button variant="primary" onClick={onAddSession}>
                Add New Session
            </Button>
        </div>
    );
}
