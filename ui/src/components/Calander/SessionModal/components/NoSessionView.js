import React from "react";
import { useDispatch } from "react-redux";
import { setModalMode, setAddError, MODALMODE } from "../../../../features/SessionModal/sessionModalSlice";

const { Button } = require("react-bootstrap");

function NoSessionView({}) {
    const dispatch = useDispatch();
    return (
        <div className="text-center p-4">
            <p>No session data recorded for this day.</p>
            <Button
                variant="primary"
                onClick={() => {
                    dispatch(setModalMode(MODALMODE.ADDLIST));
                    dispatch(setAddError(""));
                }}
            >
                Add New Session
            </Button>
        </div>
    );
}

export default NoSessionView;
