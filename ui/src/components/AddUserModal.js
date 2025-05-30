import React, { useState, useEffect } from 'react';
import { Modal, Button, Form, Row, Col, Alert, Spinner } from 'react-bootstrap';
// Define the player interface (as provided by the user, modified for first/last name)
// interface User {
//   firstName: string;
//   lastName?: string; // Optional
//   id: string; // Typically assigned by backend/Firestore
//   attendedSessionIds: string[]; // Populated over time
//   balance: number;
//   description: string;
//   email?: string;
// }
// Example structure for existingUser prop:
// interface ExistingUser {
//   firstName: string;
//   lastName?: string;
//   description?: string; // Assuming description might be part of uniqueness check
//   // other fields like id, email might be present but not directly used in this validation
// }


const initialFormState = {
    firstName:'',
    lastName: '',
    email: '',
    balance: 0,
    description: '',
};

function AddPlayerModal({
    show,
    onHide,
    onAddPlayer,
    initialFirstName = '',
    existingPlayers = []
}) {
    console.log("initialFirstName ==> ", initialFirstName);
    const [formData, setFormData] = useState({...initialFormState,firstName:initialFirstName});
    console.log("formData ==> ", formData);
    const [error, setError] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    useEffect(() => {
        if (show) {
            setFormData({ ...initialFormState,firstName:initialFirstName }); 
            setError('');
            setIsSubmitting(false);
        }
    }, [show, initialFirstName]);

    const handleChange = (event) => {
        const { name, value, type, checked } = event.target;
        setFormData(prevData => ({
            ...prevData,
            [name]: type === 'checkbox' ? checked : (type === 'number' ? parseFloat(value) || 0 : value)
        }));
    };

    const handleSubmit = async (event) => {
        event.preventDefault();
        setError(''); 

        const currentFirstName = formData.firstName.trim().toLowerCase();
        const currentLastName = formData.lastName.trim().toLowerCase();
        const currentDescription = formData.description.trim().toLowerCase();
        if (!currentFirstName) {
            setError('First Name is required.');
            return;
        }
        if (formData.email.trim() && !/\S+@\S+\.\S+/.test(formData.email)) {
            setError('Please enter a valid email address.');
            return;
        }
        if (typeof formData.balance !== 'number') {
            setError('Initial balance must be a valid number.');
            return;
        }

        const firstNameExists = existingPlayers.some(
            player => player.firstName.toLowerCase() === currentFirstName
        );

        if (firstNameExists) {
            if (!currentLastName) {
                setError(`A player with the first name "${formData.firstName.trim()}" already exists. Please provide a Last Name to differentiate.`);
                return;
            }

            const firstAndLastNameExists = existingPlayers.some(
                player => player.firstName.toLowerCase() === currentFirstName &&
                    (player.lastName || '').toLowerCase() === currentLastName
            );

            if (firstAndLastNameExists) {
                if (!currentDescription) {
                    setError(`A player named "${formData.firstName.trim()} ${formData.lastName.trim()}" already exists. Please provide a Description to differentiate.`);
                    return;
                }
            }
        }

        setIsSubmitting(true);

        const newPlayerData = {
            firstName: formData.firstName.trim(),
            lastName: formData.lastName.trim() || null,
            email: formData.email.trim() || null,
            balance: formData.balance,
            description: formData.description.trim(),
        };

        try {
            if (onAddPlayer) {
                await onAddPlayer(newPlayerData);
                onHide();
            } else {
                console.error("onAddPlayer prop is missing!");
                setError("Configuration error: Cannot save player.");
            }
        } catch (err) {
            console.error("Error adding new player:", err);
            setError(err.message || "Failed to add new player. Please try again.");
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <Modal show={show} onHide={onHide} centered>
            <Modal.Header closeButton>
                <Modal.Title>Add New player</Modal.Title>
            </Modal.Header>
            <Form onSubmit={handleSubmit}>
                <Modal.Body>
                    {error && <Alert variant="danger" onClose={() => setError('')} dismissible>{error}</Alert>}

                    <Row className="mb-3">
                        <Form.Group as={Col} md="6" controlId="addPlayerFirstName">
                            <Form.Label>First Name <span className="text-danger">*</span></Form.Label>
                            <Form.Control
                                type="text"
                                name="firstName"
                                placeholder="Enter first name"
                                value={formData.firstName}
                                onChange={handleChange}
                                required
                                disabled={isSubmitting}
                            />
                        </Form.Group>

                        <Form.Group as={Col} md="6" controlId="addPlayerLastName">
                            <Form.Label>Last Name</Form.Label>
                            <Form.Control
                                type="text"
                                name="lastName"
                                placeholder="Enter last name"
                                value={formData.lastName}
                                onChange={handleChange}
                                disabled={isSubmitting}
                            />
                        </Form.Group>
                    </Row>


                    <Form.Group className="mb-3" controlId="addPlayerEmail">
                        <Form.Label>Email (Optional)</Form.Label>
                        <Form.Control
                            type="email"
                            name="email"
                            placeholder="player@example.com"
                            value={formData.email}
                            onChange={handleChange}
                            disabled={isSubmitting}
                        />
                    </Form.Group>

                    <Form.Group className="mb-3" controlId="addPlayerBalance">
                        <Form.Label>Initial Balance ($)</Form.Label>
                        <Form.Control
                            type="number"
                            name="balance"
                            step="0.01"
                            placeholder="0.00"
                            value={formData.balance}
                            onChange={handleChange}
                            disabled={isSubmitting}
                        />
                        <Form.Text muted>
                            Positive for credit, negative for debt (e.g., -10.50). Defaults to 0.
                        </Form.Text>
                    </Form.Group>

                    <Form.Group className="mb-3" controlId="addPlayerDescription">
                        <Form.Label>Description / Notes (Optional)</Form.Label>
                        <Form.Control
                            as="textarea"
                            name="description"
                            rows={3}
                            placeholder="Any notes about this player..."
                            value={formData.description}
                            onChange={handleChange}
                            disabled={isSubmitting}
                        />
                    </Form.Group>
                </Modal.Body>
                <Modal.Footer>
                    <Button variant="secondary" onClick={onHide} disabled={isSubmitting}>
                        Cancel
                    </Button>
                    <Button variant="primary" type="submit" disabled={isSubmitting}>
                        {isSubmitting ? <Spinner as="span" animation="border" size="sm" role="status" aria-hidden="true" /> : 'Add player'}
                    </Button>
                </Modal.Footer>
            </Form>
        </Modal>
    );
}

export default AddPlayerModal;
