import React, { useState, useEffect } from 'react';
import { Modal, Button, Form, Row, Col, Alert, Spinner } from 'react-bootstrap';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';

function AddCourtCreditModal({
    show,
    onHide,
    onAddBatch,
}) {
    const [purchasedDate, setPurchasedDate] = useState(new Date());
    const [costPerHour, setCostPerHour] = useState('');
    const [hoursPurchased, setHoursPurchased] = useState('');
    const [totalCost, setTotalCost] = useState();
    const [purchaserName, setPurchaserName] = useState('');

    const [error, setError] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Reset form when modal is hidden
    useEffect(() => {
        if (!show) {
            setPurchasedDate(new Date());
            setCostPerHour('');
            setHoursPurchased('');
            setTotalCost('');
            setPurchaserName('');
            setError('');
            setIsSubmitting(false);
        }
    }, [show]);


    const handleSubmit = async (event) => {
        event.preventDefault();
        setError('');
        if (!purchasedDate) { setError('Purchase Date is required.'); return; }
        const cost = parseFloat(costPerHour);
        if (isNaN(cost) || cost <= 0) { setError('Valid Cost Per Hour (> 0) is required.'); return; }
        const hours = parseInt(hoursPurchased, 10);
        if (isNaN(hours) || hours <= 0) { setError('Valid Number of Hours Purchased (> 0) is required.'); return; }
        console.log("totalCost ==> ", totalCost);
        const totalCostOfBatch = Number.parseFloat(totalCost).toFixed(2);
        if (isNaN(totalCostOfBatch) || totalCostOfBatch <= 0) { setError('Valid Total Cost (> 0) is required.'); return; }
        if (!purchaserName.trim()) { setError('Purchaser Name is required.'); return; }

        setIsSubmitting(true);

        const newBatchData = {
            purchasedDate: purchasedDate,
            purchaserName: purchaserName.trim(),
            costPerHour: cost,
            totalCost: totalCostOfBatch,
            hours: hours,
            remainingHours: hours
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
                <Modal.Title>Add New Court Credits</Modal.Title>
            </Modal.Header>
            <Form onSubmit={handleSubmit}>
                <Modal.Body>
                    {error && <Alert variant="danger">{error}</Alert>}
                    <Form.Group className="mb-3" controlId="addBatchPurchaseDate">
                        <Form.Label>Purchase Date <span className="text-danger">*</span></Form.Label>
                        <div>
                            <DatePicker
                                selected={purchasedDate}
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
                            <Form.Label>Cost Per Hour ($) <span className="text-danger">*</span></Form.Label>
                            <Form.Control
                                type="number"
                                min="0.01"
                                step="0.01"
                                value={costPerHour}
                                onChange={(e) => setCostPerHour(e.target.value)}
                                required
                                disabled={isSubmitting}
                            />
                        </Form.Group>

                        <Form.Group as={Col} controlId="addBatchTubes">
                            <Form.Label>Hours Purchased <span className="text-danger">*</span></Form.Label>
                            <Form.Control
                                type="number"
                                min="1"
                                step="1"
                                value={hoursPurchased}
                                onChange={(e) => setHoursPurchased(e.target.value)}
                                required
                                disabled={isSubmitting}
                            />
                        </Form.Group>

                        <Form.Group as={Col} controlId="addBatchBirdsPerTube">
                            <Form.Label>Total Cost <span className="text-danger">*</span></Form.Label>
                            <Form.Control
                                type="number"
                                min="1"
                                step="1"
                                value={totalCost}
                                onChange={(e) => setTotalCost(e.target.value)}
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

export default AddCourtCreditModal;
