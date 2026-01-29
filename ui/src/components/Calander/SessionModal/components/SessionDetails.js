import React, { useMemo, useCallback, useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { setAddError, setMatchedPlayers } from "../../../../features/SessionModal/sessionModalSlice";
import { fetchBirdieInventory, fetchCourtCredits } from "../../../../services/firebaseService";
import { format } from "date-fns";
import { store } from "../../../../store";

const { Form, Alert, Row, Col, InputGroup, Button } = require("react-bootstrap");

const initialUsedBirdieSet = { id: "-1", quantity: 0 };

function SessionDetails({ handleSessionSubmit, onHide, session = {} }) {
    const dispatch = useDispatch();

    const addError = useSelector(() => store.getState().sessionModal.addError);
    const [courtNumInput, setCourtNumInput] = useState("4");
    const [courtCostInput, setCourtCostInput] = useState("");
    const [birdieUsage, setBirdieUsage] = useState([initialUsedBirdieSet]);
    const [birdieInventory, setBirdieInventory] = useState([]);
    const [useCourtCredits, setUseCourtCredits] = useState(true);
    const [courtCredits, setCourtCredits] = useState([]);

    const matchedPlayers = useSelector((state) => state.sessionModal.matchedPlayers);
    console.log("matchedPlayers ==> ", matchedPlayers);

    const handlePlayerDetailChange = (index, field, value) => {
        const updatedPlayers = [...matchedPlayers];
        const playerToUpdate = { ...updatedPlayers[index] };

        if (field === "name") {
            playerToUpdate.name = value;
        } else if (field === "paymentPercentage") {
            let numValue = parseFloat(value);
            if (isNaN(numValue) || numValue < 0) {
                numValue = 0;
            } else if (numValue > 1) {
                numValue = 1;
            }
            playerToUpdate.paymentPercentage = numValue;
        }

        updatedPlayers[index] = playerToUpdate;
        dispatch(setMatchedPlayers(updatedPlayers));
    };
    useEffect(() => {
        if (session) {
            if (session.courtCreditUsage) {
                const courtNum = session.courtCreditUsage.reduce((sum, credit) => sum + credit.hoursUsed, 0) / 2;
                setCourtNumInput(courtNum || "4");
            }
            setCourtCostInput(session.courtCostInput || "");
            setBirdieUsage(session.birdieUsage || [initialUsedBirdieSet]);
            setUseCourtCredits(session.useCourtCredits || true);
        }
    }, [session]);

    const handleRemovePlayer = (index) => {
        const updatedPlayers = [...matchedPlayers];
        updatedPlayers.splice(index, 1);
        dispatch(setMatchedPlayers(updatedPlayers));
    };

    const handleBirdieUsageChange = (index, field, value) => {
        const updatedSets = [...birdieUsage];
        console.log("birdieUsageddd ==> ", birdieUsage);
        if (field === "quantity") {
            const selectedBatch = birdieInventory.find((b) => b.id === updatedSets[index].id);
            const totalBirdiesRemaining =
                selectedBatch.unopenedTubesRemaining * selectedBatch.birdsPerTube + selectedBatch.birdsInOpenTube;
            const numValue = parseInt(value, 10);
            if (numValue > totalBirdiesRemaining) {
                setAddError(`Birdies used is greater than # of birdies left in this batch.`);
                return;
            }
            updatedSets[index][field] = isNaN(numValue) || numValue < 0 ? 0 : numValue;
        } else {
            updatedSets[index][field] = value;
        }
        setBirdieUsage(updatedSets);
    };

    const handleAddBirdieSet = () => {
        setBirdieUsage([...birdieUsage, { ...initialUsedBirdieSet }]);
    };

    const handleRemoveBirdieUsageSet = (index) => {
        if (birdieUsage.length > 1) {
            const updatedSets = birdieUsage.filter((_, i) => i !== index);
            setBirdieUsage(updatedSets);
        }
    };

    const getBirdieInventory = useCallback(async () => {
        try {
            const batches = await fetchBirdieInventory();
            setBirdieInventory(batches);
        } catch (err) {
            console.error("Error fetching birdie inventory:", err);
        }
    }, []);

    const getCourtCredits = useCallback(async () => {
        try {
            const credits = await fetchCourtCredits();
            setCourtCredits(credits);
        } catch (err) {
            console.error("Error fetching court credits:", err);
        }
    }, []);

    useEffect(() => {
        getBirdieInventory();
        getCourtCredits();
    }, [getBirdieInventory, getCourtCredits]);

    const calculateRemainingBirds = (batch) => {
        if (
            !batch ||
            typeof batch.unopenedTubesRemaining !== "number" ||
            typeof batch.birdsPerTube !== "number" ||
            typeof batch.birdsInOpenTube !== "number"
        ) {
            return 0;
        }
        return (batch.unopenedTubesRemaining + batch.birdsInOpenTube / batch.birdsPerTube).toFixed(2);
    };

    const formatBirdieBatchLabel = (batch) => {
        try {
            const dateObj = batch.purchaseDate?.toDate ? batch.purchaseDate.toDate() : new Date(batch.purchaseDate);
            const dateStr = format(dateObj, "yyyy-MM-dd");
            const costStr = batch.costPerTube?.toFixed(2) ?? "N/A";
            const remainingTotal = calculateRemainingBirds(batch);
            return `${batch.name} (${dateStr}, $${costStr}/tube, remain: ${remainingTotal} tubes)`;
        } catch (e) {
            console.error("Error formatting birdie batch label:", batch, e);
            return `${batch.name} (Invalid Data)`;
        }
    };

    const { courtCreditUsage, totalCourtCostFromCredits } = useMemo(() => {
        if (!useCourtCredits) {
            return {
                courtCreditUsage: [],
                totalCourtCostFromCredits: parseFloat(Number(courtCostInput) * Number(courtNumInput)) || 0,
            };
        }
        const totalHoursUsed = parseFloat(courtNumInput) * 2; // Assuming 2 hours per court
        if (totalHoursUsed <= 0) {
            return [];
        }
        const tempCourtCredits = courtCredits.map((batch) => ({ ...batch }));

        const usageDetails = [];
        let hoursLeftToFulfill = totalHoursUsed;
        let totalCostOfUsage = 0;

        for (const batch of tempCourtCredits) {
            if (hoursLeftToFulfill <= 0) {
                break;
            }
            if (batch.remainingHours <= 0) {
                continue;
            }

            const hoursTaken = Math.min(batch.remainingHours, hoursLeftToFulfill);
            const costFromThisBatch = hoursTaken * batch.costPerHour;
            batch.remainingHours -= hoursTaken;

            usageDetails.push({
                id: batch.id,
                costFromBatch: costFromThisBatch,
                costPerHour: batch.costPerHour,
                hoursUsed: hoursTaken,
                hoursLeft: batch.remainingHours,
            });
            hoursLeftToFulfill -= hoursTaken;
            totalCostOfUsage += costFromThisBatch;
        }

        return {
            courtCreditUsage: usageDetails,
            totalCourtCostFromCredits: totalCostOfUsage,
        };
    }, [courtCostInput, courtCredits, courtNumInput, useCourtCredits]);

    const totalCourtCost = useMemo(
        () =>
            useCourtCredits ? totalCourtCostFromCredits : (
                parseFloat(Number(courtCostInput) * Number(courtNumInput)) || 0
            ),
        [courtCostInput, courtNumInput, totalCourtCostFromCredits, useCourtCredits],
    );

    const totalBirdieCost = useMemo(() => {
        let calculatedBirdieCost = 0;
        const validBirdieUsage = birdieUsage.filter((set) => set.id && set.quantity > 0);
        validBirdieUsage.forEach((usage) => {
            const batch = birdieInventory.find((b) => b.id === usage.id);
            if (batch && batch.birdsPerTube > 0) {
                calculatedBirdieCost += (usage.quantity / batch.birdsPerTube) * batch.costPerTube;
            }
        });
        return calculatedBirdieCost;
    }, [birdieUsage, birdieInventory]);

    const totalSessionCost = useMemo(() => totalCourtCost + totalBirdieCost, [totalCourtCost, totalBirdieCost]);

    const { costPerPlayerEqual, playerCosts } = useMemo(() => {
        const numPlayers = matchedPlayers.reduce((sum, player) => sum + player.paymentPercentage, 0);
        const calculatedCostPerPlayerEqual = numPlayers > 0 ? totalSessionCost / numPlayers : 0;
        const calculatedPlayerCosts = matchedPlayers.map((player) => ({
            ...player,
            cost: parseFloat((calculatedCostPerPlayerEqual * (player.paymentPercentage || 0)).toFixed(2)),
            paid: false,
            highlighted: false,
        }));
        return {
            costPerPlayerEqual: calculatedCostPerPlayerEqual,
            playerCosts: calculatedPlayerCosts,
        };
    }, [matchedPlayers, totalSessionCost]);

    return (
        <Form
            onSubmit={(e) => {
                e.preventDefault();
                // handleSessionSubmit(
                //     courtNumInput,
                //     totalBirdieCost,
                //     totalSessionCost,
                //     totalCourtCost,
                //     birdieUsage,
                //     playerCosts,
                //     courtCreditUsage
                // );
                console.log({ courtCreditUsage });
            }}
        >
            {addError && <Alert variant="danger">{addError}</Alert>}
            <Row className="justify-content-between">
                <Col md={6}>
                    <strong>Players:</strong>
                </Col>
                <Col md={3}>
                    <Form.Label>Payment Fraction</Form.Label>
                </Col>
            </Row>
            {playerCosts.map((player, index) => (
                <Row key={player.id} className="justify-content-between mb-1">
                    <Col md={5}>
                        <p>{player.name}</p>
                    </Col>
                    <Col md={4}>
                        <InputGroup>
                            <Form.Label style={{ marginRight: 20, minWidth: 48 }}>{`$${player.cost}`}</Form.Label>
                            <Form.Control
                                type="number"
                                min="0"
                                max="1"
                                step="0.25"
                                aria-label="Payment Percentage"
                                value={player.paymentPercentage}
                                onChange={(e) => handlePlayerDetailChange(index, "paymentPercentage", e.target.value)}
                                required
                                style={{ maxWidth: "100px" }}
                            />
                            <Button
                                variant="outline-danger"
                                size="sm"
                                onClick={() => handleRemovePlayer(index)}
                                aria-label={`Remove player ${player.name}`}
                            >
                                X
                            </Button>
                        </InputGroup>
                    </Col>
                </Row>
            ))}
            <Form.Group className="my-4" controlId="formSessionCourtHours">
                <Form.Check
                    type={"switch"}
                    id="custom-switch"
                    label="Use pre-purchased court credits"
                    checked={useCourtCredits}
                    onChange={() => setUseCourtCredits(!useCourtCredits)}
                />
                <Row className="justify-content-between">
                    <Col md={6}>
                        <Form.Label>No. of courts</Form.Label>
                    </Col>
                    <Col md={6}>{!useCourtCredits && <Form.Label>Cost per court (/2 hr)</Form.Label>}</Col>
                </Row>
                <InputGroup>
                    <Form.Control
                        type="number"
                        min="1"
                        placeholder="# of Courts"
                        value={courtNumInput}
                        onChange={(e) => setCourtNumInput(e.target.value)}
                        required
                        style={{ maxWidth: "50%" }}
                    />
                    {!useCourtCredits && (
                        <>
                            <Form.Control
                                type="number"
                                placeholder="Cost per hour"
                                value={courtCostInput}
                                onChange={(e) => setCourtCostInput(e.target.value)}
                                required
                            />
                            <div style={{ paddingLeft: "26px" }} />
                        </>
                    )}
                </InputGroup>
                {useCourtCredits &&
                    courtCreditUsage.map((credit) => (
                        <div key={credit.id} className="mt-2">
                            <strong>
                                {credit.hoursUsed} hrs @ ${credit.costPerHour}
                            </strong>
                            <div>hours remaining in batch: {credit.hoursLeft}</div>
                        </div>
                    ))}
            </Form.Group>

            <Form.Label>Birdies Used</Form.Label>
            {birdieUsage.map((set, index) => {
                const selectedBatch = birdieInventory.find((b) => b.id === set.id);
                const costDisplay = selectedBatch ? `$${selectedBatch.costPerTube.toFixed(2)}/tube` : "";
                return (
                    <InputGroup key={index} className="mb-2">
                        <Form.Select
                            aria-label="Select Birdie Batch"
                            value={set.id}
                            onChange={(e) => handleBirdieUsageChange(index, "id", e.currentTarget.value)}
                            required={set.quantity > 0}
                        >
                            <option value="">-- Select Batch --</option>
                            {birdieInventory.map((batch) => (
                                <option key={batch.id} value={batch.id} disabled={calculateRemainingBirds(batch) <= 0}>
                                    {formatBirdieBatchLabel(batch)}
                                </option>
                            ))}
                        </Form.Select>
                        <InputGroup.Text>Birdies Used:</InputGroup.Text>
                        <Form.Control
                            type="number"
                            min="1"
                            step="1"
                            placeholder="# Birds"
                            aria-label="Number of birds used"
                            value={set.quantity}
                            onChange={(e) => handleBirdieUsageChange(index, "quantity", e.target.value)}
                            required={!!set.id}
                            disabled={!selectedBatch}
                        />
                        <InputGroup.Text title={`Cost per tube: $${selectedBatch?.costPerTube.toFixed(2)}`}>
                            {costDisplay || ""}
                        </InputGroup.Text>

                        <Button
                            variant="outline-danger"
                            size="sm"
                            className={birdieUsage.length > 1 ? "" : "invisible"}
                            onClick={() => handleRemoveBirdieUsageSet(index)}
                            aria-label="Remove Birdie Usage"
                        >
                            X
                        </Button>
                    </InputGroup>
                );
            })}
            <Button variant="outline-secondary" size="sm" onClick={handleAddBirdieSet} className="mt-1 mb-3">
                + Add Another Birdie Type
            </Button>

            <div className="mt-4 p-3 bg-light border rounded">
                <h6 className="mb-2">Session Cost Summary</h6>
                <Row>
                    <Col xs={7}>Total Court Cost:</Col>
                    <Col xs={5} className="text-end">
                        ${(totalCourtCost || 0).toFixed(2)}
                    </Col>
                </Row>
                <Row>
                    <Col xs={7}>Total Birdie Cost:</Col>
                    <Col xs={5} className="text-end">
                        ${(totalBirdieCost || 0).toFixed(2)}
                    </Col>
                </Row>
                <Row className="fw-bold mt-1 pt-1 border-top">
                    <Col xs={7}>Total Session Cost:</Col>
                    <Col xs={5} className="text-end">
                        ${(totalSessionCost || 0).toFixed(2)}
                    </Col>
                </Row>
                {matchedPlayers.length > 0 && (
                    <Row className="mt-1 text-muted">
                        <Col xs={7}>Avg. Cost:</Col>
                        <Col xs={5} className="text-end">
                            ${costPerPlayerEqual.toFixed(2)} / person
                        </Col>
                    </Row>
                )}
            </div>

            <div className="d-flex justify-content-end mt-3">
                <Button variant="secondary" onClick={onHide} className="me-2">
                    Cancel
                </Button>
                <Button variant="primary" type="submit">
                    Save Session
                </Button>
            </div>
        </Form>
    );
}

export default SessionDetails;
