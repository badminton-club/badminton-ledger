import React from "react";
import { Spinner, Card, Row, Col, InputGroup, Form, Button, Alert } from "react-bootstrap";
import { useDispatch, useSelector } from "react-redux";
import {
    setFormError,
    setModalMode,
    MODALMODE,
    setParsedNamesWithMatches,
} from "../../../../features/SessionModal/sessionModalSlice";
import { store } from "../../../../store";

function ListNameConfirmation({
    isLoadingMatches,
    handleSaveNameAndRematch,
    onOpenAddUserModal,
    handleGoToDetails,
    formatDisplayPlayerName,
}) {
    const dispatch = useDispatch();
    const parsedNamesWithMatches = useSelector(() => store.getState().sessionModal.parsedNamesWithMatches);
    console.log("parsedNamesWithMatches ==> ", parsedNamesWithMatches);
    const formError = useSelector(() => store.getState().sessionModal.formError);

    const handleEditableNameChange = (index, newName) => {
        const temp = parsedNamesWithMatches.map((item, i) => (i === index ? { ...item, editableName: newName } : item));
        dispatch(setParsedNamesWithMatches(temp));
    };

    const handleToggleNameEdit = (index) => {
        const temp = parsedNamesWithMatches.map((item, i) =>
            i === index
                ? {
                      ...item,
                      isEditingName: !item.isEditingName,
                      editableName: item.isEditingName ? item.editableName : item.originalName,
                  }
                : { ...item, isEditingName: false }
        );

        dispatch(setParsedNamesWithMatches(temp));
    };

    const handleMatchSelectionChange = (index, selectedPlayerId) => {
        console.log("selectedPlayerId ==> ", selectedPlayerId);
        console.log("index ==> ", index);

        const updated = [...parsedNamesWithMatches];
        console.log("updated ==> ", updated);
        updated[index] = {
            ...updated[index],
            selectedPlayerId: selectedPlayerId,
            status: selectedPlayerId
                ? "resolved"
                : updated[index].potentialMatches.length > 1
                ? "multipleMatches"
                : "unmatched",
        };

        updated[index].status = selectedPlayerId
            ? "resolved"
            : updated[index].potentialMatches.length > 1
            ? "multipleMatches"
            : "unmatched";
        let matchedPlayer = updated[index].potentialMatches.find((player) => player.id === selectedPlayerId);
        if (matchedPlayer) matchedPlayer = { ...matchedPlayer, isSelected: true };
        dispatch(setParsedNamesWithMatches(updated));
    };

    return (
        <>
            {isLoadingMatches && (
                <div className="text-center">
                    <Spinner animation="border" />
                    <p>Matching names...</p>
                </div>
            )}
            {!isLoadingMatches &&
                parsedNamesWithMatches &&
                parsedNamesWithMatches.map((item, index) => (
                    <Card key={index} className="mb-3 shadow-sm">
                        <Card.Body>
                            <Row className="align-items-center">
                                <Col md={4} sm={12} className="mb-2 mb-md-0">
                                    {item.isEditingName ? (
                                        <InputGroup size="sm">
                                            <Form.Control
                                                type="text"
                                                value={item.editableName}
                                                onChange={(e) => handleEditableNameChange(index, e.target.value)}
                                                autoFocus
                                            />
                                            <Button
                                                variant="outline-success"
                                                onClick={() => handleSaveNameAndRematch(index)}
                                                disabled={isLoadingMatches}
                                            >
                                                Save
                                            </Button>
                                            <Button
                                                variant="outline-secondary"
                                                onClick={() => handleToggleNameEdit(index)}
                                            >
                                                X
                                            </Button>
                                        </InputGroup>
                                    ) : (
                                        <div style={{ display: "flex", alignItems: "start", flexDirection: "column" }}>
                                            <strong>{item.originalName}</strong>
                                            <Button
                                                variant="link"
                                                size="sm"
                                                className="p-0"
                                                onClick={() => handleToggleNameEdit(index)}
                                                disabled={isLoadingMatches}
                                            >
                                                Edit Name
                                            </Button>
                                        </div>
                                    )}
                                    {item.status === "matching" && (
                                        <Spinner animation="border" size="sm" className="ms-2" />
                                    )}
                                </Col>
                                <Col md={8} sm={12} style={{ minHeight: "60px", alignContent: "center" }}>
                                    {(item.status === "singleMatch" || item.status === "resolved") &&
                                        item.potentialMatches.length > 0 && (
                                            <div
                                                style={{
                                                    display: "flex",
                                                    alignItems: "start",
                                                    flexDirection: "column",
                                                }}
                                            >
                                                <div>
                                                    <strong>Match: </strong>
                                                    {formatDisplayPlayerName(
                                                        item.status === "resolved"
                                                            ? item.potentialMatches.find(
                                                                  (el) => el.id === item.selectedPlayerId
                                                              )
                                                            : item.potentialMatches[0]
                                                    )}
                                                </div>
                                                <Button
                                                    variant="link"
                                                    size="sm"
                                                    className="p-0 text-muted"
                                                    onClick={() => handleMatchSelectionChange(index, null)}
                                                >
                                                    (Clear Selection / Unmatched)
                                                </Button>
                                            </div>
                                        )}
                                    {item.status === "multipleMatches" && (
                                        <Form.Group controlId={`selectMatch-${index}`}>
                                            <Form.Label className="text-warning small mb-1">
                                                Multiple matches for "{item.originalName}". Please select:
                                            </Form.Label>
                                            <Form.Select
                                                size="sm"
                                                onChange={(e) => {
                                                    if (e.target.value === "newPlayer") {
                                                        onOpenAddUserModal(parsedNamesWithMatches[index].editableName);
                                                        e.target.value = "";
                                                        return;
                                                    } else {
                                                        handleMatchSelectionChange(index, e.target.value);
                                                    }
                                                }}
                                                value={item.selectedPlayerId || ""}
                                            >
                                                <option value="">-- Select Player --</option>
                                                <option
                                                    style={{ color: "green" }}
                                                    key={"newPlayer"}
                                                    value={"newPlayer"}
                                                >
                                                    Add New Player (+)
                                                </option>
                                                {item.potentialMatches.map((player) => (
                                                    <option
                                                        key={player.id}
                                                        value={player.id}
                                                        disabled={player.isSelected}
                                                    >
                                                        {formatDisplayPlayerName(player)}
                                                    </option>
                                                ))}
                                            </Form.Select>
                                        </Form.Group>
                                    )}
                                    {item.status === "unmatched" && (
                                        <div
                                            style={{
                                                display: "flex",
                                                justifyContent: "space-between",
                                                alignItems: "center",
                                            }}
                                        >
                                            <div
                                                style={{
                                                    display: "flex",
                                                    alignItems: "start",
                                                    flexDirection: "column",
                                                    justifyItems: "end",
                                                }}
                                            >
                                                <p className="text-danger small mb-0">
                                                    No match found for "{item.originalName}".
                                                </p>
                                                <p className="text-muted small">
                                                    Please add this Players or correct the name
                                                </p>
                                            </div>
                                            <Button
                                                variant="success"
                                                size="sm"
                                                className="h-25"
                                                onClick={() => onOpenAddUserModal(item.editableName)}
                                            >
                                                Add new Player{" "}
                                            </Button>
                                        </div>
                                    )}
                                    {item.error && <small className="text-danger d-block mt-1">{item.error}</small>}
                                </Col>
                            </Row>
                        </Card.Body>
                    </Card>
                ))}
            {formError && (
                <Alert variant="danger" onClose={() => dispatch(setFormError(""))} dismissible>
                    {formError}
                </Alert>
            )}
            <div className="d-flex justify-content-between mt-4">
                <Button variant="outline-secondary" onClick={() => dispatch(setModalMode(MODALMODE.ADDLIST))}>
                    Back to Player List
                </Button>
                <Button variant="primary" onClick={handleGoToDetails}>
                    Confirm Attendees & Add Details
                </Button>
            </div>
        </>
    );
}

export default ListNameConfirmation;
