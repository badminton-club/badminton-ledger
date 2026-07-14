import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Container, Table, Button, Spinner, Alert,
  Card, Row, Col, Form,
} from 'react-bootstrap';
import { format, compareDesc } from 'date-fns';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import { Link } from 'react-router-dom';

import AddBirdieBatchModal from 'components/AddBirdieBatchModal';
import {
  fetchBirdieInventory,
  addBirdieBatch,
  updateBirdieBatch,
  fetchBirdieBatchById,
  fetchInventoryAdjustmentsForBatch,
  fetchBirdieUsageForBatch,
} from '../services/firebase';
import type { BirdieBatch, InventoryAdjustment } from '../types';

// ─── Local types ──────────────────────────────────────────────────────────────

type SortKey = keyof BirdieBatch;
type SortDir = 'asc' | 'desc';

interface EditFormState {
  name:                   string;
  purchaseDate:           Date;
  purchaserName:          string;
  costPerTube:            number | '';
  tubesPurchased:         number | '';
  birdsPerTube:           number | '';
  unopenedTubesRemaining: number | '';
  birdsInOpenTube:        number | '';
}

interface HistoryItem {
  id:        string;
  type:      'adjustment' | 'sessionUsage';
  eventDate: Date;
  [key: string]: unknown;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function totalRemainingBirds(batch: Partial<BirdieBatch>): number {
  const { unopenedTubesRemaining = 0, birdsPerTube = 0, birdsInOpenTube = 0 } = batch;
  if (
    typeof unopenedTubesRemaining !== 'number' ||
    typeof birdsPerTube !== 'number' ||
    typeof birdsInOpenTube !== 'number'
  ) return 0;
  return unopenedTubesRemaining * birdsPerTube + birdsInOpenTube;
}

const ADJUSTMENT_ROW_STYLE: React.CSSProperties = { backgroundColor: '#f2bd6d' };

// ─── Component ────────────────────────────────────────────────────────────────

export default function BirdiesPage() {
  const [batches,          setBatches]          = useState<BirdieBatch[]>([]);
  const [isLoading,        setIsLoading]        = useState(true);
  const [error,            setError]            = useState<string | null>(null);
  const [pageError,        setPageError]        = useState('');
  const [showAddModal,     setShowAddModal]     = useState(false);
  const [sortConfig,       setSortConfig]       = useState<{ key: SortKey; direction: SortDir }>({
    key: 'purchaseDate', direction: 'desc',
  });
  const [selectedBatch,    setSelectedBatch]    = useState<BirdieBatch | null>(null);
  const [isEditing,        setIsEditing]        = useState(false);
  const [editForm,         setEditForm]         = useState<EditFormState | null>(null);
  const [editReason,       setEditReason]       = useState('');
  const [isSaving,         setIsSaving]         = useState(false);
  const [history,          setHistory]          = useState<HistoryItem[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);

  // ── Fetch history when selected batch changes ────────────────────────────────
  useEffect(() => {
    if (!selectedBatch?.id || isEditing) { setHistory([]); return; }
    setIsLoadingHistory(true);
    Promise.all([
      fetchInventoryAdjustmentsForBatch(selectedBatch.id),
      fetchBirdieUsageForBatch(selectedBatch.id),
    ]).then(([adjustments, usages]) => {
      const adj = adjustments.map(a => ({
        ...a,
        type:      'adjustment' as const,
        eventDate: (a.adjustmentDate as any)?.toDate?.() ?? new Date((a.adjustmentDate as any) ?? 0),
      }));
      const use = usages.map(u => ({
        ...u,
        type:      'sessionUsage' as const,
        eventDate: (u as any).date?.toDate?.() ?? new Date((u as any).date ?? 0),
      }));
      setHistory([...adj, ...use].sort((a, b) => compareDesc(a.eventDate, b.eventDate)));
    }).catch(() => setPageError('Failed to load batch history.'))
      .finally(() => setIsLoadingHistory(false));
  }, [selectedBatch?.id, isEditing]);

  // ── Fetch inventory ──────────────────────────────────────────────────────────
  const loadInventory = useCallback(async (selectAfterFetch?: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await fetchBirdieInventory();
      setBatches(data);
      if (selectAfterFetch) {
        setSelectedBatch(data.find(b => b.id === selectAfterFetch) ?? null);
      } else if (selectedBatch) {
        setSelectedBatch(data.find(b => b.id === selectedBatch.id) ?? null);
      }
    } catch {
      setError('Failed to load birdie inventory.');
    } finally {
      setIsLoading(false);
    }
  }, [selectedBatch?.id]);

  useEffect(() => { loadInventory(); }, []);

  // ── Sorting ──────────────────────────────────────────────────────────────────
  const sorted = useMemo(() => {
    return [...batches].sort((a, b) => {
      const av = a[sortConfig.key];
      const bv = b[sortConfig.key];
      const norm = (v: unknown) =>
        v instanceof Date ? v.getTime()
        : typeof v === 'number' ? v
        : String(v ?? '').toLowerCase();
      const an = norm(av), bn = norm(bv);
      if (an < bn) return sortConfig.direction === 'asc' ? -1 : 1;
      if (an > bn) return sortConfig.direction === 'asc' ?  1 : -1;
      return 0;
    });
  }, [batches, sortConfig]);

  const requestSort = (key: SortKey) => setSortConfig(prev => ({
    key,
    direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc',
  }));

  const sortIndicator = (key: SortKey) =>
    sortConfig.key === key ? (sortConfig.direction === 'asc' ? ' ▲' : ' ▼') : '';

  // ── Handlers ─────────────────────────────────────────────────────────────────
  const handleAddBatch = async (data: Omit<BirdieBatch, 'id' | 'createdAt'>) => {
    const id = await addBirdieBatch(data);
    await loadInventory(id);
    setShowAddModal(false);
  };

  const handleSelectBatch = (batch: BirdieBatch) => {
    setSelectedBatch(batch);
    setIsEditing(false);
    setEditForm(null);
    setEditReason('');
    setPageError('');
  };

  const handleStartEdit = () => {
    if (!selectedBatch) return;
    setEditForm({
      name:                   selectedBatch.name,
      purchaseDate:           selectedBatch.purchaseDate instanceof Date
                                ? selectedBatch.purchaseDate
                                : new Date(selectedBatch.purchaseDate),
      purchaserName:          selectedBatch.purchaserName,
      costPerTube:            selectedBatch.costPerTube,
      tubesPurchased:         selectedBatch.tubesPurchased,
      birdsPerTube:           selectedBatch.birdsPerTube,
      unopenedTubesRemaining: selectedBatch.unopenedTubesRemaining,
      birdsInOpenTube:        selectedBatch.birdsInOpenTube,
    });
    setIsEditing(true);
    setPageError('');
  };

  const handleFormChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value, type } = e.target;
    setEditForm(prev => prev && ({
      ...prev,
      [name]: type === 'number' ? (value === '' ? '' : parseFloat(value)) : value,
    }));
  };

  const handleSaveEdit = async () => {
    if (!editForm || !selectedBatch) return;
    setPageError('');

    // Validate
    const cost     = Number(editForm.costPerTube);
    const tubes    = Number(editForm.tubesPurchased);
    const birds    = Number(editForm.birdsPerTube);
    const unopened = Number(editForm.unopenedTubesRemaining);
    const open     = Number(editForm.birdsInOpenTube);

    if (!editForm.name.trim())              { setPageError('Name is required.');                            return; }
    if (isNaN(cost)     || cost < 0)        { setPageError('Valid cost per tube required.');                return; }
    if (isNaN(tubes)    || tubes < 0)       { setPageError('Valid tubes purchased required.');              return; }
    if (isNaN(birds)    || birds <= 0)      { setPageError('Valid birds per tube required.');               return; }
    if (isNaN(unopened) || unopened < 0)    { setPageError('Valid unopened tubes required.');               return; }
    if (isNaN(open)     || open < 0 || open > birds) { setPageError(`Birds in open tube must be 0–${birds}.`); return; }
    if (!editForm.purchaserName.trim())     { setPageError('Purchaser name is required.');                  return; }
    if (!editReason.trim())                 { setPageError('Reason for edit is required.');                 return; }

    setIsSaving(true);
    try {
      const original = await fetchBirdieBatchById(selectedBatch.id);
      if (!original) throw new Error('Original batch not found.');
      await updateBirdieBatch(
        selectedBatch.id,
        original,
        { ...editForm, costPerTube: cost, tubesPurchased: tubes, birdsPerTube: birds,
          unopenedTubesRemaining: unopened, birdsInOpenTube: open },
        editReason,
        'admin',
        'Admin',
      );
      await loadInventory(selectedBatch.id);
      setIsEditing(false);
      setEditReason('');
    } catch (err: unknown) {
      setPageError(err instanceof Error ? err.message : 'Failed to update batch.');
    } finally {
      setIsSaving(false);
    }
  };

  // ── Render helpers ────────────────────────────────────────────────────────────
  const renderTable = () => {
    if (isLoading && !batches.length) return <div className="text-center"><Spinner animation="border" /></div>;
    if (error && !batches.length)     return <Alert variant="danger">{error}</Alert>;
    if (!batches.length)              return <Alert variant="info">No birdie batches found.</Alert>;

    return (
      <Table striped bordered hover responsive="sm" size="sm" className="mt-2">
        <thead>
          <tr>
            {(['name', 'purchaseDate', 'costPerTube', 'unopenedTubesRemaining'] as SortKey[]).map(key => (
              <th key={key} onClick={() => requestSort(key)} style={{ cursor: 'pointer' }}>
                {{ name: 'Name', purchaseDate: 'Purchase Date', costPerTube: 'Cost/Tube', unopenedTubesRemaining: 'Unopened' }[key]}
                {sortIndicator(key)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map(batch => (
            <tr
              key={batch.id}
              onClick={() => handleSelectBatch(batch)}
              style={{ cursor: 'pointer' }}
              className={selectedBatch?.id === batch.id ? 'table-primary' : ''}
            >
              <td>{batch.name}</td>
              <td>{format(batch.purchaseDate, 'yyyy-MM-dd')}</td>
              <td>${batch.costPerTube.toFixed(2)}</td>
              <td>{batch.unopenedTubesRemaining}</td>
            </tr>
          ))}
        </tbody>
      </Table>
    );
  };

  const renderDetail = () => {
    if (!selectedBatch) {
      return (
        <Card className="h-100">
          <Card.Body className="d-flex align-items-center justify-content-center">
            <p className="text-muted">Select a batch to view details.</p>
          </Card.Body>
        </Card>
      );
    }

    if (isEditing && editForm) {
      return (
        <Card>
          <Card.Header><Card.Title>Editing: {selectedBatch.name}</Card.Title></Card.Header>
          <Form onSubmit={e => { e.preventDefault(); handleSaveEdit(); }}>
            <Card.Body>
              {pageError && <Alert variant="danger">{pageError}</Alert>}
              <Row>
                <Col md={6}>
                  <Form.Group className="mb-3">
                    <Form.Label>Name/Type</Form.Label>
                    <Form.Control name="name" value={editForm.name} onChange={handleFormChange} required />
                  </Form.Group>
                  <Form.Group className="mb-3">
                    <Form.Label>Purchase Date</Form.Label>
                    <div>
                      <DatePicker
                        selected={editForm.purchaseDate}
                        onChange={(d: Date) => setEditForm(p => p && ({ ...p, purchaseDate: d }))}
                        dateFormat="yyyy-MM-dd" className="form-control" maxDate={new Date()}
                      />
                    </div>
                  </Form.Group>
                  <Form.Group className="mb-3">
                    <Form.Label>Purchaser</Form.Label>
                    <Form.Control name="purchaserName" value={editForm.purchaserName} onChange={handleFormChange} required />
                  </Form.Group>
                  <Form.Group className="mb-3">
                    <Form.Label>Cost Per Tube ($)</Form.Label>
                    <Form.Control type="number" name="costPerTube" min="0" step="0.01" value={editForm.costPerTube} onChange={handleFormChange} required />
                  </Form.Group>
                </Col>
                <Col md={6}>
                  <Form.Group className="mb-3">
                    <Form.Label>Initial Tubes Purchased</Form.Label>
                    <Form.Control type="number" name="tubesPurchased" min="1" step="1" value={editForm.tubesPurchased} onChange={handleFormChange} required />
                  </Form.Group>
                  <Form.Group className="mb-3">
                    <Form.Label>Birds Per Tube</Form.Label>
                    <Form.Control type="number" name="birdsPerTube" min="1" step="1" value={editForm.birdsPerTube} onChange={handleFormChange} required />
                  </Form.Group>
                  <Form.Group className="mb-3">
                    <Form.Label>Unopened Tubes Remaining</Form.Label>
                    <Form.Control type="number" name="unopenedTubesRemaining" min="0" step="1" value={editForm.unopenedTubesRemaining} onChange={handleFormChange} required />
                  </Form.Group>
                  <Form.Group className="mb-3">
                    <Form.Label>Birds in Open Tube</Form.Label>
                    <Form.Control type="number" name="birdsInOpenTube" min="0" max={Number(editForm.birdsPerTube) || 12} step="1" value={editForm.birdsInOpenTube} onChange={handleFormChange} required />
                  </Form.Group>
                </Col>
              </Row>
              <Form.Group className="mb-3">
                <Form.Label>Reason for Edit <span className="text-danger">*</span></Form.Label>
                <Form.Control as="textarea" rows={2} value={editReason} onChange={e => setEditReason(e.target.value)} placeholder="e.g., Stock count correction" required />
              </Form.Group>
            </Card.Body>
            <Card.Footer className="text-end">
              <Button variant="secondary" onClick={() => setIsEditing(false)} className="me-2" disabled={isSaving}>Cancel</Button>
              <Button variant="primary" type="submit" disabled={isSaving}>
                {isSaving ? <Spinner as="span" animation="border" size="sm" /> : 'Save Changes'}
              </Button>
            </Card.Footer>
          </Form>
        </Card>
      );
    }

    const remaining = totalRemainingBirds(selectedBatch);
    return (
      <Card>
        <Card.Header className="d-flex justify-content-between align-items-center">
          <Card.Title className="mb-0">{selectedBatch.name}</Card.Title>
          <Button variant="outline-primary" size="sm" onClick={handleStartEdit}>Edit Batch</Button>
        </Card.Header>
        <Card.Body>
          {pageError && <Alert variant="danger">{pageError}</Alert>}
          <Row>
            <Col md={6}>
              <p><strong>Purchase Date:</strong> {format(selectedBatch.purchaseDate, 'MMMM d, yyyy')}</p>
              <p><strong>Purchaser:</strong> {selectedBatch.purchaserName}</p>
              <p><strong>Cost Per Tube:</strong> ${selectedBatch.costPerTube.toFixed(2)}</p>
              <p><strong>Initial Tubes:</strong> {selectedBatch.tubesPurchased}</p>
            </Col>
            <Col md={6}>
              <p><strong>Birds Per Tube:</strong> {selectedBatch.birdsPerTube}</p>
              <p><strong>Unopened Tubes:</strong> {selectedBatch.unopenedTubesRemaining}</p>
              <p><strong>Birds in Open Tube:</strong> {selectedBatch.birdsInOpenTube}</p>
              <p><strong>Total Remaining:</strong> <strong>{remaining}</strong></p>
            </Col>
          </Row>

          <hr />
          <h5>Batch History</h5>
          {isLoadingHistory && <Spinner animation="border" size="sm" />}
          {!isLoadingHistory && history.length === 0 && (
            <p className="text-muted">No usage or adjustments recorded.</p>
          )}
          {!isLoadingHistory && history.length > 0 && (
            <Table striped borderless hover responsive size="sm">
              <thead>
                <tr><th>Date</th><th>Type</th><th>Details</th><th>Source</th></tr>
              </thead>
              <tbody>
                {history.map((item, i) => {
                  const style = item.type === 'adjustment' ? ADJUSTMENT_ROW_STYLE : {};
                  return (
                    <tr key={`${item.type}-${item.id ?? i}`}>
                      <td style={style}>{format(item.eventDate, 'yyyy-MM-dd HH:mm')}</td>
                      <td style={style}>{item.type === 'sessionUsage' ? 'Session Usage' : 'Adjustment'}</td>
                      <td style={style}>
                        {item.type === 'sessionUsage' && `Used: ${item.quantityUsed as number} birds`}
                        {item.type === 'adjustment' && (
                          <>
                            Reason: {item.reason as string}
                            {(item.changes as { field: string; oldValue: unknown; newValue: unknown }[])?.map((c, ci) => (
                              <div key={ci} style={{ fontSize: '0.8em', marginLeft: 10 }}>
                                <em>{c.field}:</em> {String(c.oldValue)} → {String(c.newValue)}
                              </div>
                            ))}
                          </>
                        )}
                      </td>
                      <td style={style}>
                        {item.type === 'sessionUsage' && item.sessionId ? (
                          <Link to={`/sessions/${item.sessionId as string}`}>
                            {(item.sessionId as string).substring(0, 8)}…
                          </Link>
                        ) : item.type === 'adjustment' ? (item.userName as string) : ''}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Card.Body>
      </Card>
    );
  };

  return (
    <Container fluid className="mt-4">
      <Row className="mb-3">
        <Col>
          <Button variant="success" onClick={() => setShowAddModal(true)}>+ Add New Batch</Button>
        </Col>
      </Row>
      <Row>
        <Col md={5} lg={4} className="mb-3 mb-md-0">
          <Card>
            <Card.Header><h5 className="mb-0">Birdie Batches</h5></Card.Header>
            <Card.Body style={{ maxHeight: '80vh', overflowY: 'auto' }}>{renderTable()}</Card.Body>
          </Card>
        </Col>
        <Col md={7} lg={8}>{renderDetail()}</Col>
      </Row>

      <AddBirdieBatchModal
        show={showAddModal}
        onHide={() => setShowAddModal(false)}
        onAddBatch={handleAddBatch}
      />
    </Container>
  );
}
