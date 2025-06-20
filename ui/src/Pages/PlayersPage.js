import React, { useState, useEffect, useCallback } from "react";
import {
    Container,
    Row,
    Col,
    Card,
    Form,
    Button,
    ListGroup,
    Spinner,
    Alert,
    InputGroup,
    Dropdown,
    DropdownButton,
} from "react-bootstrap";
import { format, startOfMonth, endOfMonth, addMonths, subMonths } from "date-fns";
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import { getMonthYear } from "../utils/dateUtils";
import AddPlayerModal from "../components/AddUserModal";
import { db } from "../services/firebaseService";
import {
    collection,
    query,
    where,
    getDocs,
    orderBy,
    Timestamp,
    addDoc,
    serverTimestamp,
    doc,
    getDoc,
    runTransaction,
} from "firebase/firestore";
import { useSearchParams } from "react-router-dom";

import { useSelector } from "react-redux";
import {
    selectAllPlayers,
    selectPlayerById,
    selectPlayersStatus,
    selectPlayersError,
} from "../features/players/playersSlice";

const initialBalanceAdjustmentState = { amount: "", reason: "", type: "credit" };

const formatPlayerName = (player) => {
    if (!player) return "";
    return `${player.firstName || ""} ${player.lastName || ""}`.trim();
};

function PlayersPage() {
    const [searchParams, setSearchParams] = useSearchParams();

    const playersList = useSelector(selectAllPlayers);
    const playersStatus = useSelector(selectPlayersStatus);
    const playersError = useSelector(selectPlayersError);

    const [searchTerm, setSearchTerm] = useState("");
    const [selectedPlayerId, setSelectedPlayerId] = useState(() => {
        return searchParams.get("playerId") || null;
    });
    const [filteredPlayers, setFilteredPlayers] = useState([]);
    const selectedPlayer = useSelector((state) =>
        selectedPlayerId ? selectPlayerById(state, selectedPlayerId) : null
    );
    const [selectedPlayerDetails, setSelectedPlayerDetails] = useState(null);

    const [isLoadingPlayerDetails, setIsLoadingPlayerDetails] = useState(false);
    const [playerDetailsError, setPlayerDetailsError] = useState("");

    const [currentMonthForSessions, setCurrentMonthForSessions] = useState(new Date());
    const [attendedSessions, setAttendedSessions] = useState([]);
    const [isLoadingSessions, setIsLoadingSessions] = useState(false);
    const [sessionsError, setSessionsError] = useState("");

    const [balanceAdjustment, setBalanceAdjustment] = useState({ ...initialBalanceAdjustmentState });
    const [isUpdatingBalance, setIsUpdatingBalance] = useState(false);
    const [balanceUpdateError, setBalanceUpdateError] = useState("");
    const [lastReloadInfo, setLastReloadInfo] = useState(null);

    const [showAddPlayerModal, setShowAddPlayerModal] = useState(false);

    useEffect(() => {
        const newSearchParams = new URLSearchParams(searchParams);
        if (selectedPlayerId) {
            newSearchParams.set("playerId", selectedPlayerId);
        } else {
            newSearchParams.delete("playerId");
        }
        setSearchParams(newSearchParams);
    }, [selectedPlayerId, setSearchParams]);

    useEffect(() => {
        if (!searchTerm.trim()) {
            setFilteredPlayers(playersList);
        } else {
            const lowerSearchTerm = searchTerm.toLowerCase();
            setFilteredPlayers(
                playersList.filter(
                    (player) =>
                        (player.firstName?.toLowerCase() || "").includes(lowerSearchTerm) ||
                        (player.lastName?.toLowerCase() || "").includes(lowerSearchTerm) ||
                        formatPlayerName(player).toLowerCase().includes(lowerSearchTerm)
                )
            );
        }
    }, [searchTerm, playersList]);

    const fetchAdditionalSelectedPlayerDetails = useCallback(async (playerId) => {
        if (!playerId) {
            setLastReloadInfo(null);
            return;
        }
        setIsLoadingPlayerDetails(true);
        setPlayerDetailsError("");
        if (!db) {
            setPlayerDetailsError("Firestore not initialized.");
            setIsLoadingPlayerDetails(false);
            return;
        }
        try {
            const transactionsRef = collection(db, "transactions");
            const qTransactions = query(
                transactionsRef,
                where("playerId", "==", playerId),
                where("amount", ">", 0),
                where("type", "in", ["credit_purchase", "manual_balance_add", "payment_received"]),
                orderBy("date", "desc")
            );
            const transactionSnap = await getDocs(qTransactions);
            if (!transactionSnap.empty) {
                const lastReloadTx = transactionSnap.docs[0].data();
                setLastReloadInfo({
                    date: lastReloadTx.date.toDate(),
                    amount: lastReloadTx.amount,
                    type: lastReloadTx.type,
                    description: lastReloadTx.description,
                });
            } else {
                setLastReloadInfo(null);
            }
        } catch (err) {
            console.error("Error fetching last reload info:", err);
            setPlayerDetailsError("Failed to load last reload details.");
            setLastReloadInfo(null);
        } finally {
            setIsLoadingPlayerDetails(false);
        }
    }, []);

    const fetchAttendedSessions = useCallback(async () => {
        if (!selectedPlayerId) {
            setAttendedSessions([]);
            return;
        }
        setIsLoadingSessions(true);
        setSessionsError("");
        if (!db) {
            setSessionsError("Firestore not initialized.");
            setIsLoadingSessions(false);
            return;
        }
        try {
            const monthStart = startOfMonth(currentMonthForSessions);
            console.log("monthStart ==> ", monthStart);
            const monthEnd = endOfMonth(currentMonthForSessions);
            const sessionsCollectionRef = collection(db, "sessions");
            const q = query(
                sessionsCollectionRef,
                where("date", ">=", monthStart),
                where("date", "<=", monthEnd),
                orderBy("date", "desc")
            );
            console.log("q ==> ", q);
            const querySnapshot = await getDocs(q);
            console.log("querySnapshot ==> ", querySnapshot);
            const allSessionsInMonth = querySnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
            console.log("allSessionsInMonth ==> ", allSessionsInMonth);
            const playerSessions = allSessionsInMonth.filter(
                (session) =>
                    session.players &&
                    Array.isArray(session.players) &&
                    session.players.some((p) => p.id === selectedPlayerId)
            );
            setAttendedSessions(playerSessions);
        } catch (err) {
            console.error("Error fetching attended sessions:", err);
            setSessionsError("Failed to load attended sessions.");
        } finally {
            setIsLoadingSessions(false);
        }
    }, [selectedPlayerId, currentMonthForSessions]);

    useEffect(() => {
        if (selectedPlayerId) {
            fetchAttendedSessions();
        }
    }, [currentMonthForSessions, selectedPlayerId, fetchAttendedSessions]);

    const handlePlayerSelect = (player) => {
        setSelectedPlayerId(player.id);
        setCurrentMonthForSessions(new Date());
    };

    const handleBalanceAdjustmentChange = (e) => {
        const { name, value } = e.target;
        setBalanceAdjustment((prev) => ({ ...prev, [name]: value }));
    };

    const handleBalanceAdjustmentSubmit = async (e) => {
        e.preventDefault();
        if (!selectedPlayer || !selectedPlayer.id) {
            setBalanceUpdateError("No player selected.");
            return;
        }
        const amountNum = parseFloat(balanceAdjustment.amount);
        if (isNaN(amountNum) || amountNum === 0) {
            setBalanceUpdateError("Please enter a valid, non-zero amount.");
            return;
        }
        if (!balanceAdjustment.reason.trim()) {
            setBalanceUpdateError("Please provide a reason for the adjustment.");
            return;
        }

        setIsUpdatingBalance(true);
        setBalanceUpdateError("");
        if (!db) {
            setBalanceUpdateError("Firestore not initialized.");
            setIsUpdatingBalance(false);
            return;
        }

        const transactionAmount = balanceAdjustment.type === "credit" ? amountNum : -amountNum;
        const transactionType = balanceAdjustment.type === "credit" ? "manual_balance_add" : "manual_balance_deduct";
        const transactionDescription = balanceAdjustment.reason.trim();

        try {
            const transactionsRef = collection(db, "transactions");
            await addDoc(transactionsRef, {
                playerId: selectedPlayer.id,
                amount: transactionAmount,
                type: transactionType,
                description: transactionDescription,
                date: serverTimestamp(),
                performedBy: "admin_placeholder_user_id",
            });

            const userDocRef = doc(db, "players", selectedPlayer.id);
            await runTransaction(db, async (transaction) => {
                const userDoc = await transaction.get(userDocRef);
                if (!userDoc.exists()) {
                    throw new Error("User document not found!");
                }
                const currentBalance = userDoc.data().balance || 0;
                const newBalance = currentBalance + transactionAmount;
                transaction.update(userDocRef, { balance: newBalance });
            });

            await fetchAdditionalSelectedPlayerDetails(selectedPlayer.id);
            setBalanceAdjustment({ ...initialBalanceAdjustmentState });
            alert("balance successfully updated!");
        } catch (err) {
            console.error("Error updating balance:", err);
            setBalanceUpdateError(`Failed to update balance: ${err.message}`);
        } finally {
            setIsUpdatingBalance(false);
        }
    };

    console.log("attendedSessions ==> ", attendedSessions);

    const handleAddNewPlayer = async (newPlayerDataFromModal) => {
        if (!db) {
            throw new Error("Database not available. Cannot add player.");
        }
        try {
            const playersCollectionRef = collection(db, "players");
            const dataToSave = {
                firstName: newPlayerDataFromModal.firstName,
                lastName: newPlayerDataFromModal.lastName || null,
                email: newPlayerDataFromModal.email || null,
                balance: newPlayerDataFromModal.balance || 0,
                description: newPlayerDataFromModal.description || "",
                attendedSessionIds: [],
                createdAt: serverTimestamp(),
                firstNameLower: newPlayerDataFromModal.firstName.toLowerCase(),
                lastNameLower: (newPlayerDataFromModal.lastName || "").toLowerCase(),
            };
            const docRef = await addDoc(playersCollectionRef, dataToSave);
            setSelectedPlayerId(docRef.id);
            alert("Player added successfully!");
            setShowAddPlayerModal(false);
        } catch (error) {
            console.error("Error adding player to Firestore:", error);
            throw new Error(error.message || "Could not save new player.");
        }
    };

    return (
        <Container fluid className="mt-4">
            <Row className="mb-3">
                <Col>
                    <Button variant="success" onClick={() => setShowAddPlayerModal(true)}>
                        + Add New Player
                    </Button>
                </Col>
            </Row>
            <Row>
                <Col md={4} className="mb-3">
                    <Card>
                        <Card.Header>Find Player</Card.Header>
                        <Card.Body>
                            <Form.Control
                                type="text"
                                placeholder="Search by first or last name..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="mb-2"
                            />
                            {playersStatus === "loading" && playersList.length === 0 && (
                                <div className="text-center">
                                    <Spinner animation="border" size="sm" />
                                </div>
                            )}
                            {/* {playersStatus === 'failed' && <Alert variant="danger" size="sm">{playersError}</Alert>} */}
                            {playersStatus === "succeeded" && filteredPlayers.length === 0 && searchTerm && (
                                <p className="text-muted small">No players found matching "{searchTerm}".</p>
                            )}
                            {playersStatus === "succeeded" &&
                                filteredPlayers.length === 0 &&
                                !searchTerm &&
                                playersList.length > 0 && (
                                    <p className="text-muted small">Showing all players. Type to search.</p>
                                )}
                            {playersStatus === "succeeded" &&
                                playersList.length === 0 &&
                                !searchTerm &&
                                !playersError && <p className="text-muted small">No players in the system yet.</p>}
                            <ListGroup style={{ maxHeight: "calc(100vh - 250px)", overflowY: "auto" }}>
                                {filteredPlayers.map((player) => (
                                    <ListGroup.Item
                                        key={player.id}
                                        action
                                        onClick={() => handlePlayerSelect(player)}
                                        active={selectedPlayerId === player.id}
                                    >
                                        {formatPlayerName(player)}
                                    </ListGroup.Item>
                                ))}
                            </ListGroup>
                        </Card.Body>
                    </Card>
                </Col>

                {/* Selected User Details Column */}
                <Col md={8}>
                    {!selectedPlayer && (
                        <Card>
                            <Card.Body
                                className="text-center text-muted"
                                style={{
                                    minHeight: "400px",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                }}
                            >
                                Please select a user from the list to view their details, or add a new user.
                            </Card.Body>
                        </Card>
                    )}
                    {selectedPlayerId && isLoadingPlayerDetails && (
                        <div className="text-center mt-5">
                            <Spinner animation="border" />
                            <p>Loading user details...</p>
                        </div>
                    )}
                    {selectedPlayerId && !isLoadingPlayerDetails && playerDetailsError && (
                        <Alert variant="danger">{playerDetailsError}</Alert>
                    )}
                    {selectedPlayerId && selectedPlayer && !isLoadingPlayerDetails && !playerDetailsError && (
                        <>
                            <Card className="mb-3">
                                <Card.Header>
                                    <Card.Title className="mb-0">
                                        {formatPlayerName(selectedPlayer)} - Details
                                    </Card.Title>
                                </Card.Header>
                                <Card.Body>
                                    <p>
                                        <strong>Email:</strong> {selectedPlayer.email || "N/A"}
                                    </p>
                                    <p>
                                        <strong>Description:</strong> {selectedPlayer.description || "N/A"}
                                    </p>
                                    <p>
                                        <strong>User ID:</strong> {selectedPlayer.id}
                                    </p>
                                    <hr />
                                    <h5>Quick Stats</h5>
                                    <p>
                                        Total Sessions Attended (All Time):{" "}
                                        {selectedPlayer.attendedSessionIds?.length || 0}
                                    </p>
                                    {/* <p>Average Birdies Used Per Session (Last Year): [To be calculated]</p>
                                    <p>Total Spent (Last Year): [To be calculated]</p> */}
                                </Card.Body>
                            </Card>

                            <Card className="mb-3">
                                <Card.Header>Balance</Card.Header>
                                <Card.Body>
                                    <Row>
                                        <Col md={6}>
                                            <h4>
                                                Current Balance:
                                                <span
                                                    className={
                                                        selectedPlayer.balance >= 0 ? "text-success" : "text-danger"
                                                    }
                                                >
                                                    ${(selectedPlayer.balance || 0).toFixed(2)}
                                                </span>
                                                {selectedPlayer.balance > 0 && (
                                                    <small className="text-muted"> (Credit)</small>
                                                )}
                                                {selectedPlayer.balance < 0 && (
                                                    <small className="text-muted"> (Owes)</small>
                                                )}
                                            </h4>
                                            {lastReloadInfo && (
                                                <p className="small text-muted">
                                                    Last credit: ${lastReloadInfo.amount.toFixed(2)} on{" "}
                                                    {format(lastReloadInfo.date, "MMM d, yyyy")} (
                                                    {lastReloadInfo.description || lastReloadInfo.type})
                                                </p>
                                            )}
                                            {!lastReloadInfo && selectedPlayer.balance >= 0 && (
                                                <p className="small text-muted">No recent credit adjustments found.</p>
                                            )}
                                        </Col>
                                        <Col md={6}>
                                            <h5>Adjust Balance</h5>
                                            {balanceUpdateError && (
                                                <Alert variant="danger" size="sm">
                                                    {balanceUpdateError}
                                                </Alert>
                                            )}
                                            <Form onSubmit={handleBalanceAdjustmentSubmit}>
                                                <InputGroup className="mb-2">
                                                    <DropdownButton
                                                        variant="outline-secondary"
                                                        title={
                                                            balanceAdjustment.type === "credit"
                                                                ? "Add to balance (+)"
                                                                : "Deduct from balance (-)"
                                                        }
                                                        id="balance-adjustment-type"
                                                    >
                                                        <Dropdown.Item
                                                            onClick={() =>
                                                                setBalanceAdjustment((prev) => ({
                                                                    ...prev,
                                                                    type: "credit",
                                                                }))
                                                            }
                                                        >
                                                            Add to balance (+)
                                                        </Dropdown.Item>
                                                        <Dropdown.Item
                                                            onClick={() =>
                                                                setBalanceAdjustment((prev) => ({
                                                                    ...prev,
                                                                    type: "debit",
                                                                }))
                                                            }
                                                        >
                                                            Deduct from balance (-)
                                                        </Dropdown.Item>
                                                    </DropdownButton>
                                                    <Form.Control
                                                        type="number"
                                                        name="amount"
                                                        placeholder="Amount"
                                                        value={balanceAdjustment.amount}
                                                        onChange={handleBalanceAdjustmentChange}
                                                        min="0.01"
                                                        required
                                                    />
                                                </InputGroup>
                                                <Form.Control
                                                    type="text"
                                                    name="reason"
                                                    placeholder="Reason (e.g., Cash Payment, Session Fee)"
                                                    value={balanceAdjustment.reason}
                                                    onChange={handleBalanceAdjustmentChange}
                                                    required
                                                    className="mb-2"
                                                />
                                                <Button
                                                    type="submit"
                                                    variant="primary"
                                                    size="sm"
                                                    disabled={isUpdatingBalance}
                                                >
                                                    {isUpdatingBalance ? (
                                                        <Spinner as="span" animation="border" size="sm" />
                                                    ) : (
                                                        "Update Balance"
                                                    )}
                                                </Button>
                                            </Form>
                                        </Col>
                                    </Row>
                                </Card.Body>
                            </Card>

                            <Card>
                                <Card.Header>
                                    <Row className="align-items-center">
                                        <Col>
                                            <h5 className="mb-0">
                                                Attended Sessions - {getMonthYear(currentMonthForSessions)}
                                            </h5>
                                        </Col>
                                        <Col xs="auto">
                                            <Button
                                                variant="outline-secondary"
                                                size="sm"
                                                onClick={() =>
                                                    setCurrentMonthForSessions(subMonths(currentMonthForSessions, 1))
                                                }
                                            >
                                                &lt; Prev
                                            </Button>
                                        </Col>
                                        <Col xs="auto" style={{ width: "160px" }}>
                                            <DatePicker
                                                selected={currentMonthForSessions}
                                                onChange={(date) => setCurrentMonthForSessions(date)}
                                                dateFormat="MMMM yyyy"
                                                showMonthYearPicker
                                                className="form-control form-control-sm text-center"
                                            />
                                        </Col>
                                        <Col xs="auto">
                                            <Button
                                                variant="outline-secondary"
                                                size="sm"
                                                onClick={() =>
                                                    setCurrentMonthForSessions(addMonths(currentMonthForSessions, 1))
                                                }
                                            >
                                                Next &gt;
                                            </Button>
                                        </Col>
                                    </Row>
                                </Card.Header>
                                <Card.Body>
                                    {isLoadingSessions && (
                                        <div className="text-center">
                                            <Spinner animation="border" size="sm" />
                                        </div>
                                    )}
                                    {sessionsError && (
                                        <Alert variant="danger" size="sm">
                                            {sessionsError}
                                        </Alert>
                                    )}
                                    {!isLoadingSessions && attendedSessions.length === 0 && (
                                        <p className="text-muted">No sessions attended this month.</p>
                                    )}
                                    {!isLoadingSessions && attendedSessions.length > 0 && (
                                        <ListGroup variant="flush" style={{ maxHeight: "200px", overflowY: "auto" }}>
                                            {attendedSessions.map((s) => (
                                                <ListGroup.Item key={s.id}>
                                                    <div style={{ display: "flex", flexDirection: "column" }}>
                                                        <strong>
                                                            {s.date?.toDate
                                                                ? format(s.date.toDate(), "MMM d, yyyy - p")
                                                                : "Invalid Date"}
                                                        </strong>
                                                        {s.location && ` at ${s.location}`}
                                                        <div className="float-end">
                                                            Cost for session: $
                                                            {s.players.find((p) => p.id === selectedPlayerId)?.cost}
                                                        </div>
                                                        <div className="float-end text-muted">
                                                            birdies used:{" "}
                                                            {s.birdieUsage?.reduce(
                                                                (acc, curr) => acc + curr.quantity,
                                                                0
                                                            )}
                                                        </div>
                                                    </div>
                                                </ListGroup.Item>
                                            ))}
                                        </ListGroup>
                                    )}
                                </Card.Body>
                            </Card>
                        </>
                    )}
                </Col>
            </Row>

            <AddPlayerModal
                show={showAddPlayerModal}
                onHide={() => setShowAddPlayerModal(false)}
                onAddPlayer={handleAddNewPlayer}
                existingPlayers={playersList}
            />
        </Container>
    );
}

export default PlayersPage;
