import React, { useState, useEffect } from 'react';
import { Modal, Button, Form, Row, Col, Alert, Spinner } from 'react-bootstrap';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';


function AddBirdieBatchModal({
    show,
    onHide,
    onAddBatch,
}) {
    const [name, setName] = useState('');
    const [purchaseDate, setPurchasedDate] = useState(new Date());
    const [costPerTube, setCostPerTube] = useState('');
    const [tubesPurchased, setTubesPurchased] = useState('');
    const [birdsPerTube, setBirdsPerTube] = useState('12');
    const [purchaserName, setPurchaserName] = useState('');

    const [error, setError] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    useEffect(() => {
        if (!show) {
            setName('');
            setPurchasedDate(new Date());
            setCostPerTube('');
            setTubesPurchased('');
            setBirdsPerTube('12');
            setPurchaserName('');
            setError('');
            setIsSubmitting(false);
        }
    }, [show]);


    const handleSubmit = async (event) => {
        event.preventDefault();
        setError('');

        if (!name.trim()) { setError('Birdie Name/Type is required.'); return; }
        if (!purchaseDate) { setError('Purchase Date is required.'); return; }
        const cost = parseFloat(costPerTube);
        if (isNaN(cost) || cost <= 0) { setError('Valid Cost Per Tube (> 0) is required.'); return; }
        const tubes = parseInt(tubesPurchased, 10);
        if (isNaN(tubes) || tubes <= 0) { setError('Valid Number of Tubes Purchased (> 0) is required.'); return; }
        const birdsNum = parseInt(birdsPerTube, 10);
        if (isNaN(birdsNum) || birdsNum <= 0) { setError('Valid Birds Per Tube (> 0) is required.'); return; }
        if (!purchaserName.trim()) { setError('Purchaser Name is required.'); return; }

        setIsSubmitting(true);

        const newBatchData = {
            name: name.trim(),
            purchaseDate: purchaseDate,
            purchaserName: purchaserName.trim(),
            costPerTube: cost,
            tubesPurchased: tubes,
            birdsPerTube: birdsNum,
            unopenedTubesRemaining: tubes,
            birdsInOpenTube: 0,
        };

        try {
            if (onAddBatch) {
                await onAddBatch(newBatchData);
                onHide();
            } else {
                console.error("onAddBatch prop is missing!");
                setError("Configuration error: Cannot save batch.");
            }
        } catch (err) {
            console.error("Error adding birdie batch:", err);
            setError(err.message || "Failed to add birdie batch. Please try again.");
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <Modal show={show} onHide={onHide} centered>
            <Modal.Header closeButton>
                <Modal.Title>Add New Birdie Batch</Modal.Title>
            </Modal.Header>
            <Form onSubmit={handleSubmit}>
                <Modal.Body>
                    {error && <Alert variant="danger">{error}</Alert>}

                    <Form.Group className="mb-3" controlId="addBatchName">
                        <Form.Label>Birdie Name/Type <span className="text-danger">*</span></Form.Label>
                        <Form.Control
                            type="text"
                            placeholder="e.g., Yonex AS-50, HangYu 1"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            required
                            disabled={isSubmitting}
                        />
                    </Form.Group>

                    <Form.Group className="mb-3" controlId="addBatchPurchaseDate">
                        <Form.Label>Purchase Date <span className="text-danger">*</span></Form.Label>
                        <div>
                            <DatePicker
                                selected={purchaseDate}
                                onChange={(date) => setPurchasedDate(date)}
                                dateFormat="yyyy-MM-dd"
                                className="form-control"
                                required
                                disabled={isSubmitting}
                                maxDate={new Date()}
                            />
                        </div>
                    </Form.Group>

                    <Row className="mb-3">
                        <Form.Group as={Col} controlId="addBatchCost">
                            <Form.Label>Cost Per Tube ($) <span className="text-danger">*</span></Form.Label>
                            <Form.Control
                                type="number"
                                min="0.01"
                                step="0.01"
                                placeholder="e.g., 28.50"
                                value={costPerTube}
                                onChange={(e) => setCostPerTube(e.target.value)}
                                required
                                disabled={isSubmitting}
                            />
                        </Form.Group>

                        <Form.Group as={Col} controlId="addBatchTubes">
                            <Form.Label>#Tubes Purchased <span className="text-danger">*</span></Form.Label>
                            <Form.Control
                                type="number"
                                min="1"
                                step="1"
                                placeholder="e.g., 10"
                                value={tubesPurchased}
                                onChange={(e) => setTubesPurchased(e.target.value)}
                                required
                                disabled={isSubmitting}
                            />
                        </Form.Group>

                        <Form.Group as={Col} controlId="addBatchBirdsPerTube">
                            <Form.Label>Birds Per Tube <span className="text-danger">*</span></Form.Label>
                            <Form.Control
                                type="number"
                                min="1"
                                step="1"
                                placeholder="e.g., 12"
                                value={birdsPerTube}
                                onChange={(e) => setBirdsPerTube(e.target.value)}
                                required
                                disabled={isSubmitting}
                            />
                        </Form.Group>
                    </Row>

                    <Form.Group className="mb-3" controlId="addBatchPurchaser">
                        <Form.Label>Purchaser Name <span className="text-danger">*</span></Form.Label>
                        <Form.Control
                            type="text"
                            placeholder="Name of person who bought them"
                            value={purchaserName}
                            onChange={(e) => setPurchaserName(e.target.value)}
                            required
                            disabled={isSubmitting}
                        />
                        {/* 
                         <Form.Select value={purchaserId} onChange={(e) => setPurchaserId(e.target.value)} required disabled={isSubmitting}>
                             <option value="">-- Select User --</option>
                             {usersList.map(user => <option key={user.id} value={user.id}>{user.name}</option>)}
                         </Form.Select>
                        */}
                    </Form.Group>

                </Modal.Body>
                <Modal.Footer>
                    <Button variant="secondary" onClick={onHide} disabled={isSubmitting}>
                        Cancel
                    </Button>
                    <Button variant="primary" type="submit" disabled={isSubmitting}>
                        {isSubmitting ? <Spinner as="span" animation="border" size="sm" role="status" aria-hidden="true" /> : 'Add Batch'}
                    </Button>
                </Modal.Footer>
            </Form>
        </Modal>
    );
}

export default AddBirdieBatchModal;
