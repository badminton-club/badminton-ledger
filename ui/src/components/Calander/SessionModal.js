import React, { useState, useEffect, useMemo } from 'react';
import { Modal, Button, ListGroup, Form, InputGroup, Alert, Row, Col } from 'react-bootstrap';
import { format } from 'date-fns';

const initialUsedBirdieSet = { id: -1, quantity: 0 };

const MODALMODE = Object.freeze({
    VIEW: 0,
    ADDLIST: 1,
    ADDDETAILS: 2,
    EDIT: 3,
})

const highlightedStyle = {
    backgroundColor: '#fff3cd',
    transition: 'background-color 0.3s ease-in-out',
};
const defaultStyle = {
    backgroundColor: 'transparent',
    transition: 'background-color 0.3s ease-in-out',
};

function SessionModal({ show,
    onHide,
    session,
    birdies = [],
    courtCredits = [],
    onUpdateHighlightStatus,
    onUpdatePaymentStatus,
    onAddSubmit
}) {

    const [playerNamesList, setPlayerNamesList] = useState([]);
    const [modalMode, setModalMode] = useState(MODALMODE.VIEW);
    const [playersInput, setPlayersInput] = useState('');
    const [courtNumInput, setCourtNumInput] = useState('0');
    const [courtCostInput, setCourtCostInput] = useState('0');
    const [birdieUsage, setBirdieUsage] = useState([initialUsedBirdieSet]);
    const [addError, setAddError] = useState('');

    useEffect(() => {
        if (!show) {
            setModalMode(MODALMODE.VIEW);
            setPlayersInput('');
            setBirdieUsage([initialUsedBirdieSet]);
            setAddError('');
            setCourtCostInput('0')
            setCourtNumInput('0')
            setPlayerNamesList([])
        } else if (session) {
            setModalMode(MODALMODE.VIEW);
        }
    }, [show]);


    const totalCourtCost = useMemo(() =>
        parseFloat(courtCostInput * courtNumInput) || 0
        , [courtCostInput, courtNumInput]);

    console.log("totalCourtCost ==> ", totalCourtCost);
    const totalBirdieCost = useMemo(() => {
        let calculatedBirdieCost = 0;
        const validBirdieUsage = birdieUsage.filter(set => set.id && set.quantity > 0);
        validBirdieUsage.forEach(usage => {
            const batch = birdies.find(b => b.id === usage.id);
            if (batch && batch.birdsPerTube > 0) {
                calculatedBirdieCost += (usage.quantity / batch.birdsPerTube) * batch.costPerTube;
            }
        });
        return calculatedBirdieCost;
    }, [birdieUsage, birdies])

    const totalSessionCost = useMemo(() =>
        totalCourtCost + totalBirdieCost,
        [totalCourtCost, totalBirdieCost]);

    const { costPerPlayerEqual, playerCosts } = useMemo(() => {
        const numPlayers = playerNamesList.reduce((sum, player) => sum + player.percentage, 0);
        const calculatedCostPerPlayerEqual = numPlayers > 0 ? totalSessionCost / numPlayers : 0;
        const calculatedPlayerCosts = playerNamesList.map(player => ({
            ...player,
            cost: parseFloat((calculatedCostPerPlayerEqual * (player.percentage || 0)).toFixed(2)),
            paid: false,
            highlighted: false
        }));
        return {
            costPerPlayerEqual: calculatedCostPerPlayerEqual,
            playerCosts: calculatedPlayerCosts
        };
    }, [playerNamesList, totalSessionCost]);

    const handleBirdieUsageChange = (index, field, value) => {
        const updatedSets = [...birdieUsage];
        if (field === 'quantity') {
            const numValue = parseInt(value, 10);
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

    const handleGoToDetails = () => {
        setAddError('');
        if (!playersInput.trim()) {
            setAddError('Player list cannot be empty.');
            return;
        }
        const lines = playersInput.split('\n');
        const nameRegex = /^\s*\d+\s*\.\s*(.*)$/;
        const names = []
        for (const line of lines) {
            const matchResult = line.match(nameRegex);
            if (matchResult) {
                const name = matchResult[1].trim();
                if (name) {
                    names.push({ name: name, percentage: 1 });
                }
            }
        }
        if (names.length === 0) {
            setAddError('No valid player names found.');
            return;
        }
        setPlayerNamesList(names);
        setModalMode(2);
    };

    const handlePlayerDetailChange = (index, field, value) => {
        setPlayerNamesList(prevPlayers => {
            const updatedPlayers = [...prevPlayers];
            const playerToUpdate = { ...updatedPlayers[index] };

            if (field === 'name') {
                playerToUpdate.name = value;
            } else if (field === 'percentage') {
                let numValue = parseFloat(value);
                if (isNaN(numValue) || numValue < 0) {
                    numValue = 0;
                } else if (numValue > 1) {
                    numValue = 1;
                }
                playerToUpdate.percentage = numValue;
            }

            updatedPlayers[index] = playerToUpdate;
            return updatedPlayers;
        });
    }


    const handleRemovePlayer = (index) => {
        setPlayerNamesList(prevPlayers => {
            const updatedPlayers = [...prevPlayers];
            updatedPlayers.splice(index, 1);
            return updatedPlayers;
        });
    }

    const handlePaymentToggle = (player) => {
        console.log("player ==> ", player);
        if (!onUpdatePaymentStatus || !session || !session.id || !player || !player.name) {
            console.error("Missing data or handler for payment update", { handler: !!onUpdatePaymentStatus, session, player });
            setAddError("Cannot update payment status - configuration error.");
            return;
        }
        const currentPaidStatus = !!player.paid;
        const newPaidStatus = !currentPaidStatus;
        onUpdatePaymentStatus(session.id, player.name, newPaidStatus);
    };

    const handleHighlightToggle = (player) => {
        if (!onUpdateHighlightStatus || !session || !session.id || !player || !player.name) {
            console.error("Missing data or handler for highlight update", { handler: !!onUpdateHighlightStatus, session, player });
            setAddError("Cannot update highlight status - configuration error.");
            return;
        }
        const currentHighlightStatus = !!player.highlighted;
        const newHighlightStatus = !currentHighlightStatus;
        onUpdateHighlightStatus(session.id, player.name, newHighlightStatus);
    };

    const handleAddSubmit = (event) => {
        event.preventDefault();
        setAddError('');
        if (!playersInput.trim()) {
            setAddError('Player list cannot be empty.');
            return;
        }
        const courtCount = parseFloat(courtNumInput);
        const validBirdieSets = birdieUsage.filter(set => set.id && set.quantity > 0);

        const newSessionData = {
            players: playerCosts,
            courtCount,
            birdiesUsed: validBirdieSets.map(set => ({
                id: set.id,
                quantity: set.quantity
            })),
            courtCost: parseInt(courtCostInput),
            totalSessionCost,
            totalBirdieCost,
            totalCourtCost
        };
        onAddSubmit(newSessionData)
        console.log("newSessionData ==> ", newSessionData);
    };



    console.log("session ==> ", session);
    const renderSessionDetails = () => {
        const sessionPaidTotal = session?.players?.filter(player => player.paid)?.reduce((sum, player) => sum + player.cost, 0) || 0
        return (
            <><div key={session.id} className={session ? 'mb-4 border-bottom pb-3' : ''}>
                <h6>Session on: {format(session.date, 'PPP')}</h6>
                {session.location && <p><strong>Location:</strong> {session.location || 'NA'}</p>}
                <p><strong>Birdies Used:</strong> {session?.birdiesUsed?.quantity || 'N/A'}</p>
                <h6>Players:</h6>
                <ListGroup variant="flush">
                    {session.players && session.players.length > 0 ? session.players.map(player => {
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
                                    <span className={isPaid ? 'invisible' : ''}>{`$${player.cost}`}</span>

                                    <Button
                                        variant={isHighlighted ? 'warning' : 'outline-secondary'}
                                        size="sm"
                                        onClick={() => handleHighlightToggle(player)}
                                        disabled={!onUpdateHighlightStatus}
                                        aria-label={isHighlighted ? `Unhighlight ${player.name}` : `Highlight ${player.name}`}
                                        title={isHighlighted ? 'Remove Highlight' : 'Highlight Player'}
                                    >
                                        {isHighlighted ? '★' : '☆'}
                                    </Button>

                                    <Button
                                        size="sm"
                                        variant={isPaid ? 'success' : 'outline-secondary'}
                                        onClick={() => handlePaymentToggle(player)}
                                        disabled={!onUpdatePaymentStatus}
                                        style={{ minWidth: '110px' }}
                                    >
                                        {isPaid ? '✓ Paid' : 'Mark as Paid'}
                                    </Button>
                                </div>
                            </ListGroup.Item>
                        );
                    }) : <ListGroup.Item>No players listed.</ListGroup.Item>}
                </ListGroup>
                {session.notes && <p className="mt-3"><strong>Notes:</strong> {session.notes}</p>}

                <div className="mt-4 p-3 bg-light border rounded">
                    <h6 className="mb-2">Session Cost Summary</h6>
                    <Row>
                        <Col xs={7}>Total Court Cost:</Col>
                        <Col xs={5} className="text-end">${(session.totalCourtCost || 0).toFixed(2)}</Col>
                    </Row>
                    <Row>
                        <Col xs={7}>Total Birdie Cost:</Col>
                        <Col xs={5} className="text-end">${(session.totalBirdieCost || 0).toFixed(2)}</Col>
                    </Row>
                    <Row className="fw-bold my-1 pt-1 border-bottom">
                        <Col xs={7}>Total Session Cost:</Col>
                        <Col xs={5} className="text-end">${(session.totalSessionCost || 0).toFixed(2)}</Col>
                    </Row>
                    <Row>
                        <Col xs={7}>Player Count:</Col>
                        <Col xs={5} className="text-end">{session?.players?.length || 0}</Col>
                    </Row>
                    <Row>
                        <Col xs={7}>Unpaid Player Count:</Col>
                        <Col xs={5} className="text-end">{session?.players?.filter(a => !a.paid).length}</Col>
                    </Row>
                    <Row>
                        <Col xs={7}>Total Paid:</Col>
                        <Col xs={5} className="text-end">{sessionPaidTotal}</Col>
                    </Row>
                    <Row>
                        <Col xs={7}>Total Due:</Col>
                        <Col xs={5} className="text-end">{session.totalSessionCost - sessionPaidTotal}</Col>
                    </Row>
                </div>
            </div>
                <div className="d-flex justify-content-end mt-3">
                    <Button variant="primary" onClick={() => {
                        setPlayerNamesList(session.players.map((a) => { return { name: a.name, percentage: a.percentage } }))
                        setBirdieUsage(session.birdiesUsed)
                        setCourtCostInput(session.courtCost)
                        setCourtNumInput(session.courtCount)
                        setModalMode(MODALMODE.EDIT)
                    }} className="me-2">
                        Edit
                    </Button>
                </div>
            </>
        );
    }

    const renderNoSessionView = () => (
        <div className="text-center p-4">
            <p>No session data recorded for this day.</p>
            <Button variant="primary" onClick={() => { setModalMode(MODALMODE.ADDLIST); setAddError(''); }}>
                Add New Session
            </Button>
        </div>
    );

    const renderAddSessionListStage = () => (
        <>
            <h5 className="mb-3">Add New Session - Step 1: Players</h5>
            {addError && <Alert variant="danger" onClose={() => setAddError('')} dismissible>{addError}</Alert>}
            <Form.Group className="mb-3" controlId="formSessionPlayers">
                <Form.Label>Players</Form.Label>
                <Form.Control
                    as="textarea"
                    rows={4}
                    placeholder="Enter List of Players"
                    value={playersInput}
                    onChange={(e) => setPlayersInput(e.target.value)}
                    required
                />
                <Form.Text muted>Comma or newline separated list.</Form.Text>
            </Form.Group>
            <div className="d-flex justify-content-end mt-3">
                <Button variant="secondary" onClick={onHide} className="me-2">Cancel</Button>
                <Button variant="primary" onClick={handleGoToDetails}>Next: Add Details</Button>
            </div>
        </>
    );


    const calculateRemainingBirds = (batch) => {
        if (!batch || typeof batch.unopenedTubesRemaining !== 'number' || typeof batch.birdsPerTube !== 'number' || typeof batch.birdsInOpenTube !== 'number') {
            return 0;
        }
        return ((batch.unopenedTubesRemaining) + batch.birdsInOpenTube / batch.birdsPerTube).toFixed(2);
    }

    const formatBirdieBatchLabel = (batch) => {
        try {
            const dateObj = batch.purchaseDate?.toDate ? batch.purchaseDate.toDate() : new Date(batch.purchaseDate);
            const dateStr = format(dateObj, 'yyyy-MM-dd');
            const costStr = batch.costPerTube?.toFixed(2) ?? 'N/A';
            const remainingTotal = calculateRemainingBirds(batch);
            return `${batch.name} (Purch: ${dateStr}, $${costStr}/tube, remain: ${remainingTotal} tubes)`;
        } catch (e) {
            console.error("Error formatting birdie batch label:", batch, e);
            return `${batch.name} (Invalid Data)`;
        }
    };

    const renderAddSessionFormDetails = () => (
        <Form onSubmit={handleAddSubmit}>
            <h5 className="mb-3">Add New Session</h5>
            {addError && <Alert variant="danger">{addError}</Alert>}
            <Row className='justify-content-between'>
                <Col md={6}>
                    <Form.Label>Player Name</Form.Label>
                </Col>
                <Col md={3}>
                    <Form.Label>Payment Fraction</Form.Label>
                </Col>
            </Row>
            {playerCosts.map((player, index) => (
                <Row key={player.id} className="justify-content-between mb-1">
                    <Col md={5}>
                        <Form.Control
                            type="text"
                            aria-label="Player Name"
                            value={player.name}
                            onChange={(e) => handlePlayerDetailChange(index, 'name', e.target.value)}
                            required
                        />
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
                                value={player.percentage}
                                onChange={(e) => handlePlayerDetailChange(index, 'percentage', e.target.value)}
                                required
                                style={{ maxWidth: '100px' }}
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
                <Row className='justify-content-between'>
                    <Col md={6}>
                        <Form.Label >No. of courts</Form.Label>
                    </Col>
                    <Col md={6}>
                        <Form.Label >Cost per court (/2 hr)</Form.Label>
                    </Col>
                </Row>
                <InputGroup>
                    <Form.Control
                        type="number"
                        min="1"
                        placeholder="# of Courts"
                        value={courtNumInput}
                        onChange={(e) => setCourtNumInput(e.target.value)}
                        required
                    />
                    <Form.Control
                        type="number"
                        placeholder="Cost per hour"
                        value={courtCostInput}
                        onChange={(e) => setCourtCostInput(e.target.value)}
                        required
                    />
                    <div style={{ paddingLeft: "26px" }} />
                </InputGroup>
            </Form.Group>

            <Form.Label>Birdies Used</Form.Label>
            {birdieUsage.map((set, index) => {
                const selectedBatch = birdies.find(b => b.id === set.id);
                const costDisplay = selectedBatch ? `$${selectedBatch.costPerTube.toFixed(2)}/tube` : '';
                return (
                    <InputGroup key={index} className="mb-2">
                        <Form.Select
                            aria-label="Select Birdie Batch"
                            value={set.id}
                            onChange={(e) => handleBirdieUsageChange(index, 'id', parseInt(e.target.value))}
                            required={set.quantity > 0}
                        >
                            <option value="">-- Select Batch --</option>
                            {birdies.map(batch => (
                                <option
                                    key={batch.id}
                                    value={batch.id}
                                    disabled={calculateRemainingBirds(batch) <= 0}
                                >
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
                            onChange={(e) => handleBirdieUsageChange(index, 'quantity', e.target.value)}
                            required={!!set.id}
                        />
                        {costDisplay && <InputGroup.Text title={`Cost per tube: $${selectedBatch.costPerTube.toFixed(2)}`}>{costDisplay}</InputGroup.Text>}

                        <Button variant="outline-danger" size="sm"
                            className={birdieUsage.length > 1 ? '' : 'invisible'}
                            onClick={() => handleRemoveBirdieUsageSet(index)}
                            aria-label="Remove Birdie Usage">
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
                    <Col xs={5} className="text-end">${(totalCourtCost || 0).toFixed(2)}</Col>
                </Row>
                <Row>
                    <Col xs={7}>Total Birdie Cost:</Col>
                    <Col xs={5} className="text-end">${(totalBirdieCost || 0).toFixed(2)}</Col>
                </Row>
                <Row className="fw-bold mt-1 pt-1 border-top">
                    <Col xs={7}>Total Session Cost:</Col>
                    <Col xs={5} className="text-end">${(totalSessionCost || 0).toFixed(2)}</Col>
                </Row>
                {playerNamesList.length > 0 && (
                    <Row className="mt-1 text-muted">
                        <Col xs={7}>Avg. Cost:</Col>
                        <Col xs={5} className="text-end">${costPerPlayerEqual.toFixed(2)} / person</Col>
                    </Row>
                )}
            </div>

            <div className="d-flex justify-content-end mt-3">
                <Button variant="secondary" onClick={() => setModalMode(MODALMODE.VIEW)} className="me-2">
                    Cancel
                </Button>
                <Button variant="primary" type="submit">
                    Save Session
                </Button>
            </div>
        </Form>
    );
    const getModalHeader = () => {
        switch (modalMode) {
            case MODALMODE.ADDLIST:
                return 'Add Session - Step 1: Players';
            case MODALMODE.ADDDETAILS:
                return 'Add Session - Step 2: Details';
            case MODALMODE.EDIT:
                return 'Edit Session';
            default:
                return 'Session Details';
        }
    }

    const getModalBody = () => {
        switch (modalMode) {
            case MODALMODE.ADDLIST:
                return renderAddSessionListStage();
            case MODALMODE.ADDDETAILS:
            case MODALMODE.EDIT:
                return renderAddSessionFormDetails();
            default:
                return (session && session.id)
                    ? renderSessionDetails()
                    : renderNoSessionView();
        }

    }

    return (
        <Modal show={show} onHide={onHide} centered size="lg">
            <Modal.Header closeButton>
                <Modal.Title>{getModalHeader()}</Modal.Title>
            </Modal.Header>
            <Modal.Body>
                {getModalBody()}
            </Modal.Body>
        </Modal>
    );
}

export default SessionModal