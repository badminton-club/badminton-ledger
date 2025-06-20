import { format } from "date-fns";
import React, { useMemo } from "react";
import { ListGroup, Button, Row, Col } from "react-bootstrap";
import { MODALMODE, setMatchedPlayers, setModalMode } from "../../../../features/SessionModal/sessionModalSlice";
import { useDispatch } from "react-redux";
import { togglePlayerHighlightStatus, togglePlayerPaidStatus } from "../../../../services/firebaseService";

const highlightedStyle = {
    backgroundColor: "#fff3cd",
    transition: "background-color 0.3s ease-in-out",
};
const defaultStyle = {
    backgroundColor: "transparent",
    transition: "background-color 0.3s ease-in-out",
};

function ExistingSessionDetails({ session = {}, onSessionUpdate }) {
    const dispatch = useDispatch();
    console.log("sessasdfasdfion ==> ", session);

    const sessionPaidTotal = useMemo(() => {
        return session?.players?.filter((player) => player.paid)?.reduce((sum, player) => sum + player.cost, 0) || 0;
    }, [session?.players]);

    const sessionTotalMinusHighlighted = useMemo(() => {
        const highlightedPlayers = session?.players?.filter((player) => player.highlighted);
        const totalHighlightedCost = highlightedPlayers.reduce((sum, player) => sum + player.cost, 0);
        return session.totalSessionCost - totalHighlightedCost || 0;
    }, [session?.players, session.totalSessionCost]);

    const handleHighlightToggle = async (sessionId, playerId) => {
        if (!sessionId || !playerId) return;
        await togglePlayerHighlightStatus(sessionId, playerId).then(() => {
            onSessionUpdate(sessionId);
        });
    };
    const handlePaymentToggle = async (sessionId, playerId) => {
        if (!sessionId || !playerId) return;

        await togglePlayerPaidStatus(sessionId, playerId).then(() => {
            onSessionUpdate(sessionId);
        });
    };
    return (
        <>
            <div key={session.id} className={session ? "mb-4 border-bottom pb-3" : ""}>
                <h6>Session Date: {format(session.date, "PPP")}</h6>
                {session.location && (
                    <p>
                        <strong>Location:</strong> {session.location || "NA"}
                    </p>
                )}
                <p>
                    <strong>Birdies Used:</strong>{" "}
                    {session?.birdieUsage.reduce((acc, curr) => acc + curr.quantity, 0) || "N/A"}
                </p>
                <h6>Players:</h6>
                <ListGroup variant="flush">
                    {session.players && session.players.length > 0 ? (
                        session.players.map((player) => {
                            if (!player || !player.name) return null;
                            const isPaid = !!player.paid;
                            const isHighlighted = !!player.highlighted;
                            return (
                                <ListGroup.Item
                                    key={player.name}
                                    className="d-flex justify-content-between align-items-center"
                                    style={isHighlighted ? highlightedStyle : defaultStyle}
                                >
                                    <span>{player.name || player.userId}</span>
                                    <div className="d-flex align-items-center gap-2">
                                        <span className={isPaid ? "text-muted" : ""}>{`$${player.cost}`}</span>

                                        <Button
                                            variant={isHighlighted ? "warning" : "outline-secondary"}
                                            size="sm"
                                            onClick={() => handleHighlightToggle(session.id, player.id)}
                                            // disabled={!onUpdateHighlightStatus}
                                            aria-label={
                                                isHighlighted
                                                    ? `Unhighlight ${player.name}`
                                                    : `Highlight ${player.name}`
                                            }
                                            title={isHighlighted ? "Remove Highlight" : "Highlight Player"}
                                        >
                                            {isHighlighted ? "★" : "☆"}
                                        </Button>

                                        <Button
                                            size="sm"
                                            variant={isPaid ? "success" : "outline-secondary"}
                                            onClick={() => handlePaymentToggle(session.id, player.id)}
                                            // disabled={!onUpdatePaymentStatus}
                                            style={{ minWidth: "110px" }}
                                        >
                                            {isPaid ? "✓ Paid" : "Mark as Paid"}
                                        </Button>
                                    </div>
                                </ListGroup.Item>
                            );
                        })
                    ) : (
                        <ListGroup.Item>No players listed.</ListGroup.Item>
                    )}
                </ListGroup>
                {session.notes && (
                    <p className="mt-3">
                        <strong>Notes:</strong> {session.notes}
                    </p>
                )}

                <div className="mt-4 p-3 bg-light border rounded">
                    <h6 className="mb-2">Session Cost Summary</h6>
                    <Row>
                        <Col xs={7}>Total Court Cost:</Col>
                        <Col xs={5} className="text-end">
                            ${(session.totalCourtCost || 0).toFixed(2)}
                        </Col>
                    </Row>
                    <Row>
                        <Col xs={7}>Total Birdie Cost:</Col>
                        <Col xs={5} className="text-end">
                            ${(session.totalBirdieCost || 0).toFixed(2)}
                        </Col>
                    </Row>
                    <Row className="fw-bold my-1 pt-1 border-bottom">
                        <Col xs={7}>Total Session Cost:</Col>
                        <Col xs={5} className="text-end">
                            ${(session.totalSessionCost || 0).toFixed(2)}
                        </Col>
                    </Row>
                    <Row>
                        <Col xs={7}>Player Count:</Col>
                        <Col xs={5} className="text-end">
                            {session?.players?.length || 0}
                        </Col>
                    </Row>
                    <Row>
                        <Col xs={7}>Unpaid Player Count:</Col>
                        <Col xs={5} className="text-end">
                            {session?.players?.filter((a) => !a.paid).length}
                        </Col>
                    </Row>
                    <Row>
                        <Col xs={7}>Total Paid:</Col>
                        <Col xs={5} className="text-end">
                            {sessionPaidTotal.toFixed(2)}
                        </Col>
                    </Row>
                    <Row>
                        <Col xs={7}>Total Due:</Col>
                        <Col xs={5} className="text-end">
                            {(session.totalSessionCost - sessionPaidTotal).toFixed(2)}
                        </Col>
                    </Row>
                    <Row>
                        <Col xs={7}>Total Due (minus highlighted):</Col>
                        <Col xs={5} className="text-end">
                            {sessionTotalMinusHighlighted.toFixed(2)}
                        </Col>
                    </Row>
                </div>
            </div>
            <div className="d-flex justify-content-end mt-3">
                <Button
                    variant="primary"
                    onClick={() => {
                        dispatch(setMatchedPlayers(session.players));
                        // setBirdieUsage(session.birdiesUsed);
                        // setCourtCostInput(session.courtCost);
                        // setCourtNumInput(session.courtCount);
                        dispatch(setModalMode(MODALMODE.EDIT));
                    }}
                    className="me-2"
                >
                    Edit
                </Button>
            </div>
        </>
    );
}

export default ExistingSessionDetails;
