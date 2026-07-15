import React, { useEffect, useState } from 'react';
import { Alert, Button, Col, Form, Modal, Row, Spinner } from 'react-bootstrap';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import type { CourtCreditBatch } from 'types';

type NewBatch = Omit<CourtCreditBatch, 'id' | 'createdAt' | 'remainingHours'>;

interface Props {
  show:       boolean;
  onHide:     () => void;
  onAddBatch: (data: NewBatch) => Promise<void>;
}

export default function AddCourtCreditModal({ show, onHide, onAddBatch }: Props) {
  const [purchaseDate,   setPurchaseDate]  = useState(new Date());
  const [costPerHour,    setCostPerHour]   = useState('');
  const [hoursPurchased, setHoursPurchased]= useState('');
  const [totalCost,      setTotalCost]     = useState('');
  const [purchaserName,  setPurchaserName] = useState('');
  const [error,          setError]         = useState('');
  const [isSubmitting,   setIsSubmitting]  = useState(false);

  useEffect(() => {
    if (!show) {
      setPurchaseDate(new Date()); setCostPerHour(''); setHoursPurchased('');
      setTotalCost(''); setPurchaserName(''); setError('');
    }
  }, [show]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const cost  = parseFloat(costPerHour);
    const hours = parseFloat(hoursPurchased);
    const total = parseFloat(totalCost);
    if (isNaN(cost)  || cost  <= 0) { setError('Valid cost per hour required.'); return; }
    if (isNaN(hours) || hours <= 0) { setError('Valid hours purchased required.'); return; }
    if (isNaN(total) || total <= 0) { setError('Valid total cost required.'); return; }
    if (!purchaserName.trim())       { setError('Purchaser name is required.'); return; }
    setIsSubmitting(true);
    try {
      await onAddBatch({ purchaseDate, purchaserName: purchaserName.trim(), costPerHour: cost, hoursPurchased: hours, totalCost: parseFloat(total.toFixed(2)) });
      onHide();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to add court credits.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal show={show} onHide={onHide} centered>
      <Modal.Header closeButton><Modal.Title>Add New Court Credits</Modal.Title></Modal.Header>
      <Form onSubmit={handleSubmit}>
        <Modal.Body>
          {error && <Alert variant="danger">{error}</Alert>}
          <Form.Group className="mb-3">
            <Form.Label>Purchase Date <span className="text-danger">*</span></Form.Label>
            <div>
              <DatePicker selected={purchaseDate} onChange={(d: Date) => setPurchaseDate(d)}
                dateFormat="yyyy-MM-dd" className="form-control" maxDate={new Date()} disabled={isSubmitting} />
            </div>
          </Form.Group>
          <Row className="mb-3">
            <Form.Group as={Col}><Form.Label>Cost/Hr ($) <span className="text-danger">*</span></Form.Label>
              <Form.Control type="number" min="0.01" step="0.01" value={costPerHour} onChange={e => setCostPerHour(e.target.value)} disabled={isSubmitting} required />
            </Form.Group>
            <Form.Group as={Col}><Form.Label>Hours Purchased <span className="text-danger">*</span></Form.Label>
              <Form.Control type="number" min="0.5" step="0.5" value={hoursPurchased} onChange={e => setHoursPurchased(e.target.value)} disabled={isSubmitting} required />
            </Form.Group>
            <Form.Group as={Col}><Form.Label>Total Cost ($) <span className="text-danger">*</span></Form.Label>
              <Form.Control type="number" min="0.01" step="0.01" value={totalCost} onChange={e => setTotalCost(e.target.value)} disabled={isSubmitting} required />
            </Form.Group>
          </Row>
          <Form.Group className="mb-3">
            <Form.Label>Purchaser Name <span className="text-danger">*</span></Form.Label>
            <Form.Control placeholder="Who bought them" value={purchaserName} onChange={e => setPurchaserName(e.target.value)} disabled={isSubmitting} required />
          </Form.Group>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={onHide} disabled={isSubmitting}>Cancel</Button>
          <Button variant="primary" type="submit" disabled={isSubmitting}>
            {isSubmitting ? <Spinner size="sm" animation="border" /> : 'Add Credits'}
          </Button>
        </Modal.Footer>
      </Form>
    </Modal>
  );
}
