import React, { useEffect, useState } from 'react';
import { Alert, Button, Col, Form, Modal, Row, Spinner } from 'react-bootstrap';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import type { BirdieBatch } from 'types';

type FormData = Omit<BirdieBatch, 'id' | 'createdAt' | 'unopenedTubesRemaining' | 'birdsInOpenTube'>;

interface Props {
  show:       boolean;
  onHide:     () => void;
  onAddBatch: (data: FormData) => Promise<void>;
}

const EMPTY: FormData = {
  name: '', purchaserName: '', purchaseDate: new Date(),
  costPerTube: 0, tubesPurchased: 0, birdsPerTube: 12,
};

export default function AddBirdieBatchModal({ show, onHide, onAddBatch }: Props) {
  const [form,         setForm]         = useState<FormData>(EMPTY);
  const [error,        setError]        = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => { if (!show) { setForm(EMPTY); setError(''); setIsSubmitting(false); } }, [show]);

  const set = (field: keyof FormData, value: unknown) =>
    setForm(prev => ({ ...prev, [field]: value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!form.name.trim())         { setError('Birdie name is required.');            return; }
    if (!form.purchaserName.trim()){ setError('Purchaser name is required.');         return; }
    if (form.costPerTube <= 0)     { setError('Cost per tube must be greater than 0.'); return; }
    if (form.tubesPurchased <= 0)  { setError('Tubes purchased must be greater than 0.'); return; }
    if (form.birdsPerTube <= 0)    { setError('Birds per tube must be greater than 0.'); return; }

    setIsSubmitting(true);
    try {
      await onAddBatch({ ...form, name: form.name.trim(), purchaserName: form.purchaserName.trim() });
      onHide();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to add batch.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal show={show} onHide={onHide} centered>
      <Modal.Header closeButton><Modal.Title>Add New Birdie Batch</Modal.Title></Modal.Header>
      <Form onSubmit={handleSubmit}>
        <Modal.Body>
          {error && <Alert variant="danger">{error}</Alert>}
          <Form.Group className="mb-3">
            <Form.Label>Birdie Name/Type <span className="text-danger">*</span></Form.Label>
            <Form.Control placeholder="e.g. Yonex AS-50" value={form.name} onChange={e => set('name', e.target.value)} disabled={isSubmitting} />
          </Form.Group>
          <Form.Group className="mb-3">
            <Form.Label>Purchase Date <span className="text-danger">*</span></Form.Label>
            <div>
              <DatePicker
                selected={form.purchaseDate}
                onChange={(d: Date) => set('purchaseDate', d)}
                dateFormat="yyyy-MM-dd"
                className="form-control"
                maxDate={new Date()}
                disabled={isSubmitting}
              />
            </div>
          </Form.Group>
          <Row className="mb-3">
            <Form.Group as={Col}>
              <Form.Label>Cost/Tube ($) <span className="text-danger">*</span></Form.Label>
              <Form.Control type="number" min="0.01" step="0.01" value={form.costPerTube || ''} onChange={e => set('costPerTube', parseFloat(e.target.value) || 0)} disabled={isSubmitting} />
            </Form.Group>
            <Form.Group as={Col}>
              <Form.Label>Tubes Purchased <span className="text-danger">*</span></Form.Label>
              <Form.Control type="number" min="1" step="1" value={form.tubesPurchased || ''} onChange={e => set('tubesPurchased', parseInt(e.target.value) || 0)} disabled={isSubmitting} />
            </Form.Group>
            <Form.Group as={Col}>
              <Form.Label>Birds/Tube <span className="text-danger">*</span></Form.Label>
              <Form.Control type="number" min="1" step="1" value={form.birdsPerTube || ''} onChange={e => set('birdsPerTube', parseInt(e.target.value) || 0)} disabled={isSubmitting} />
            </Form.Group>
          </Row>
          <Form.Group className="mb-3">
            <Form.Label>Purchaser Name <span className="text-danger">*</span></Form.Label>
            <Form.Control value={form.purchaserName} onChange={e => set('purchaserName', e.target.value)} disabled={isSubmitting} />
          </Form.Group>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={onHide} disabled={isSubmitting}>Cancel</Button>
          <Button variant="primary" type="submit" disabled={isSubmitting}>
            {isSubmitting ? <Spinner size="sm" animation="border" /> : 'Add Batch'}
          </Button>
        </Modal.Footer>
      </Form>
    </Modal>
  );
}
