import React  from "react";
import { Alert, Form, Button } from "react-bootstrap";
import { useDispatch, useSelector } from "react-redux";
import { setAddError, setPlayersInput } from "../../../../features/SessionModal/sessionModalSlice";
import { store } from "../../../../store";

function AddSessionList({ handleGoToNamesMatching, onHide }) {


    const dispatch = useDispatch();
    const addError = useSelector(() => store.getState().sessionModal.addError);
    const playersInput = useSelector(() => store.getState().sessionModal.playersInput);
    return (
        <>
            {addError && (
                <Alert variant="danger" onClose={() => dispatch(setAddError(""))} dismissible>
                    {addError}
                </Alert>
            )}
            <Form.Group className="mb-3" controlId="formSessionPlayers">
                <Form.Label>Players</Form.Label>
                <Form.Control
                    as="textarea"
                    rows={12}
                    placeholder="Enter List of Players"
                    value={playersInput}
                    onChange={(e) => dispatch(setPlayersInput(e.target.value))}
                    required
                />
                <Form.Text muted>newline separated list.</Form.Text>
            </Form.Group>
            <div className="d-flex justify-content-end mt-3">
                <Button variant="secondary" onClick={onHide} className="me-2">
                    Cancel
                </Button>
                <Button variant="primary" onClick={() => handleGoToNamesMatching(playersInput)}>
                    Next: Add Details
                </Button>
            </div>
        </>
    );
}
export default AddSessionList;
