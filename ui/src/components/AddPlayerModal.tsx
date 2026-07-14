import React, { useEffect, useState } from 'react';
import { Alert, Button, Col, Form, Modal, Row, Spinner } from 'react-bootstrap';
import type { Player, NewPlayerInput } from 'types';

interface Props {
  show:              boolean;
  onHide:            () => void;
  onAddPlayer:       (data: NewPlayerInput) => Promise<void>;
  initialFirstName?: string;
  existingPlayers:   Player[];
}

const EMPTY = { firstName: '', lastName: '', email: '', balance: 0, description: '' };

export default function AddPlayerModal({
  show, onHide, onAddPlayer, initialFirstName = '', existingPlayers,
}: Props) {
  const [form,         setForm]         = useState({ ...EMPTY, firstName: initialFirstName });
  const [error,        setError]        = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (show) { setForm({ ...EMPTY, firstName: initialFirstName }); setError(''); }
  }, [show, initialFirstName]);

  const set = (field: string, value: string | number) =>
    setForm(prev => ({ ...prev, [field]: value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const firstName = form.firstName.trim();
    const lastName  = form.lastName.trim();
    if (!firstName) { setError('First name is required.'); return; }
    if (form.email.trim() && !/\S+@\S+\.\S+/.test(form.email)) {
      setError('Please enter a valid email address.'); return;
    }
    const sameFirst = existingPlayers.filter(
      p => p.firstName.toLowerCase() === firstName.toLowerCase()
    );
    if (sameFirst.length > 0 && !lastName) {
      setError(`A player named "${firstName}" already exists. Add a last name to differentiate.`);
      return;
    }
    if (lastName && sameFirst.some(p => (p.lastName ?? '').toLowerCase() === lastName.toLowerCase())) {
      if (!form.description.trim()) {
        setError(`"${firstName} ${lastName}" already exists. Add a description to differentiate.`);
        return;
      }
    }
    setIsSubmitting(true);
    try {
      await onAddPlayer({
        firstName,
        lastName:    lastName || null,
        email:       form.email.trim() || null,
        balance:     form.balance,
        description: form.description.trim(),
      });
      onHide();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to add player.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal show={show} onHide={onHide} centered>
      <Modal.Header closeButton><Modal.Title>Add New Player</Modal.Title></Modal.Header>
      <Form onSubmit={handleSubmit}>
        <Modal.Body>
          {error && <Alert variant="danger" dismissible onClose={() => setError('')}>{error}</Alert>}
          <Row className="mb-3">
            <Form.Group as={Col} md={6}>
              <Form.Label>First Name <span className="text-danger">*</span></Form.Label>
              <Form.Control value={form.firstName} onChange={e => set('firstName', e.target.value)} disabled={isSubmitting} required />
            </Form.Group>
            <Form.Group as={Col} md={6}>
              <Form.Label>Last Name</Form.Label>
              <Form.Control value={form.lastName} onChange={e => set('lastName', e.target.value)} disabled={isSubmitting} />
            </Form.Group>
          </Row>
          <Form.Group className="mb-3">
            <Form.Label>Email (optional)</Form.Label>
            <Form.Control type="email" value={form.email} onChange={e => set('email', e.target.value)} disabled={isSubmitting} />
          </Form.Group>
          <Form.Group className="mb-3">
            <Form.Label>Initial Balance ($)</Form.Label>
            <Form.Control type="number" step="0.01" value={form.balance} onChange={e => set('balance', parseFloat(e.target.value) || 0)} disabled={isSubmitting} />
            <Form.Text muted>Positive = credit, negative = debt. Defaults to 0.</Form.Text>
          </Form.Group>
          <Form.Group className="mb-3">
            <Form.Label>Description / Notes (optional)</Form.Label>
            <Form.Control as="textarea" rows={2} value={form.description} onChange={e => set('description', e.target.value)} disabled={isSubmitting} />
          </Form.Group>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={onHide} disabled={isSubmitting}>Cancel</Button>
          <Button variant="primary" type="submit" disabled={isSubmitting}>
            {isSubmitting ? <Spinner size="sm" animation="border" /> : 'Add Player'}
          </Button>
        </Modal.Footer>
      </Form>
    </Modal>
  );
}
