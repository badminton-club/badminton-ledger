import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Container, Table, Button, Spinner, Alert,
  Card, Row, Col, Form, Accordion,
} from 'react-bootstrap';
import { format, compareDesc } from 'date-fns';
import { Link } from 'react-router-dom';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import AddCourtCreditModal from 'components/AddCourtCreditModal';
import {
  fetchCourtCredits,
  addCourtCreditBatch,
  updateCourtCreditBatch,
  fetchCourtCreditBatchById,
  fetchCourtCreditAdjustments,
  fetchCourtCreditUsage,
} from '../services/firebase';
import type { CourtCreditBatch } from '../types';

// ─── Local types ──────────────────────────────────────────────────────────────

type SortKey = keyof CourtCreditBatch;
type SortDir = 'asc' | 'desc';

interface EditFormState {
  purchaseDate:   Date;
  purchaserName:  string;
  hoursPurchased: number | '';
  totalCost:      number | '';
  remainingHours: number | '';
  notes:          string;
}

interface HistoryItem {
  id:        string;
  type:      'adjustment' | 'sessionUsage';
  eventDate: Date;
  [key: string]: unknown;
}

const INIT_EDIT: EditFormState = {
  purchaseDate:   new Date(),
  purchaserName:  '',
  hoursPurchased: '',
  totalCost:      '',
  remainingHours: '',
  notes:          '',
};

const SESSION_ROW_STYLE:    React.CSSProperties = { backgroundColor: '#e9f7ef' };
const ADJUSTMENT_ROW_STYLE: React.CSSProperties = { backgroundColor: '#feefd8' };

// ─── Component ────────────────────────────────────────────────────────────────

export default function CourtCreditsPage() {
  const [batches,          setBatches]          = useState<CourtCreditBatch[]>([]);
  const [isLoading,        setIsLoading]        = useState(true);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [error,            setError]            = useState<string | null>(null);
  const [formError,        setFormError]        = useState('');
  const [showAddModal,     setShowAddModal]     = useState(false);
  const [sortConfig,       setSortConfig]       = useState<{ key: SortKey; direction: SortDir }>({
    key: 'purchaseDate', direction: 'desc',
  });
  const [activeKey,        setActiveKey]        = useState<string | null>(null);
  const [editingId,        setEditingId]        = useState<string | null>(null);
  const [editForm,         setEditForm]         = useState<EditFormState>({ ...INIT_EDIT });
  const [editReason,       setEditReason]       = useState('');
  const [isSaving,         setIsSaving]         = useState(false);
  const [history,          setHistory]          = useState<HistoryItem[]>([]);

  // ── Load batches ─────────────────────────────────────────────────────────────
  const loadBatches = useCallback(async (openAfterLoad?: string) => {
    setIsLoading(true); setError(null);
    try {
      const data = await fetchCourtCredits();
      setBatches(data);
      if (openAfterLoad) setActiveKey(openAfterLoad);
    } catch {
      setError('Failed to load court credit batches.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { loadBatches(); }, []);

  // ── Load history when accordion opens ────────────────────────────────────────
  useEffect(() => {
    if (!activeKey || editingId) { setHistory([]); return; }
    setIsLoadingHistory(true);
    Promise.all([
      fetchCourtCreditAdjustments(activeKey),
      fetchCourtCreditUsage(activeKey),
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
    }).catch(() => setFormError('Failed to load history.'))
      .finally(() => setIsLoadingHistory(false));
  }, [activeKey, editingId]);

  // ── Sorting ──────────────────────────────────────────────────────────────────
  const sorted = useMemo(() => {
    return [...batches].sort((a, b) => {
      const av = a[sortConfig.key], bv = b[sortConfig.key];
      const norm = (v: unknown) =>
        v instanceof Date ? v.getTime() : typeof v === 'number' ? v : String(v ?? '').toLowerCase();
      const [an, bn] = [norm(av), norm(bv)];
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
  const handleAddBatch = async (data: Omit<CourtCreditBatch, 'id' | 'createdAt' | 'remainingHours'>) => {
    const id = await addCourtCreditBatch(data);
    await loadBatches(id);
    setShowAddModal(false);
  };

  const handleStartEdit = (batch: CourtCreditBatch) => {
    setEditingId(batch.id);
    setActiveKey(batch.id);
    setEditForm({
      purchaseDate:   batch.purchaseDate instanceof Date ? batch.purchaseDate : new Date(batch.purchaseDate),
      purchaserName:  batch.purchaserName,
      hoursPurchased: batch.hoursPurchased,
      totalCost:      batch.totalCost,
      remainingHours: batch.remainingHours,
      notes:          (batch as any).notes ?? '',
    });
    setEditReason('');
    setFormError('');
  };

  const handleFormChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value, type } = e.target;
    setEditForm(prev => ({
      ...prev,
      [name]: type === 'number' ? (value === '' ? '' : parseFloat(value)) : value,
    }));
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditForm({ ...INIT_EDIT });
    setEditReason('');
    setFormError('');
  };

  const handleSaveEdit = async () => {
    if (!editingId) return;
    setFormError('');

    const hours     = Number(editForm.hoursPurchased);
    const cost      = Number(editForm.totalCost);
    const remaining = Number(editForm.remainingHours);

    if (isNaN(hours)     || hours <= 0)     { setFormError('Valid hours purchased required.');   return; }
    if (isNaN(cost)      || cost < 0)       { setFormError('Valid total cost required.');        return; }
    if (isNaN(remaining) || remaining < 0)  { setFormError('Valid remaining hours required.');   return; }
    if (!editReason.trim())                  { setFormError('Reason for edit is required.');      return; }

    setIsSaving(true);
    try {
      const original = await fetchCourtCreditBatchById(editingId);
      if (!original) throw new Error('Batch not found.');
      await updateCourtCreditBatch(
        editingId,
        original,
        { ...editForm, hoursPurchased: hours, totalCost: cost, remainingHours: remaining },
        editReason,
        'admin',
        'Admin',
      );
      await loadBatches(editingId);
      setEditingId(null);
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Failed to update.');
    } finally {
      setIsSaving(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────────
  if (isLoading && !batches.length) return (
    <Container className="text-center mt-5"><Spinner animation="border" /><p>Loading…</p></Container>
  );
  if (error && !batches.length) return (
    <Container className="mt-4"><Alert variant="danger">{error}</Alert></Container>
  );

  return (
    <Container fluid className="mt-4">
      <Card>
        <Card.Header className="d-flex justify-content-between align-items-center">
          <h2>Court Credit Inventory</h2>
          <Button variant="primary" onClick={() => setShowAddModal(true)}>+ Add Credit Batch</Button>
        </Card.Header>
        <Card.Body>
          {/* Column headers */}
          <Row className="fw-bold text-muted py-2 px-4 border-bottom mb-2 d-none d-md-flex">
            {(['costPerHour', 'remainingHours', 'purchaseDate', 'purchaserName'] as SortKey[]).map(key => (
              <Col key={key} md={3} onClick={() => requestSort(key)} style={{ cursor: 'pointer' }}>
                {{ costPerHour: 'Cost/Hr', remainingHours: 'Rem. Hrs', purchaseDate: 'Purchase Date', purchaserName: 'Purchaser' }[key]}
                {sortIndicator(key)}
              </Col>
            ))}
          </Row>

          {sorted.length === 0 && !isLoading && (
            <Alert variant="info">No court credit batches found.</Alert>
          )}

          <Accordion
            activeKey={activeKey ?? undefined}
            onSelect={k => setActiveKey(k === activeKey ? null : (k as string))}
          >
            {sorted.map(batch => (
              <Accordion.Item eventKey={batch.id} key={batch.id}>
                <Accordion.Header>
                  <Row className="w-100 align-items-center gx-2">
                    <Col md={3}>${batch.costPerHour?.toFixed(2) ?? 'N/A'}</Col>
                    <Col md={3}>{batch.remainingHours ?? 0}</Col>
                    <Col md={3}>{batch.purchaseDate ? format(batch.purchaseDate, 'yyyy-MM-dd') : 'N/A'}</Col>
                    <Col md={3} className="text-muted small d-none d-md-block">{batch.purchaserName}</Col>
                  </Row>
                </Accordion.Header>
                <Accordion.Body>
                  {editingId === batch.id ? (
                    // ── Edit form ────────────────────────────────────────────
                    <Form onSubmit={e => { e.preventDefault(); handleSaveEdit(); }}>
                      {formError && <Alert variant="danger" dismissible onClose={() => setFormError('')}>{formError}</Alert>}
                      <Row>
                        <Col md={6} className="mb-3">
                          <Form.Group>
                            <Form.Label>Purchase Date</Form.Label>
                            <div>
                              <DatePicker
                                selected={editForm.purchaseDate}
                                onChange={(d: Date) => setEditForm(p => ({ ...p, purchaseDate: d }))}
                                dateFormat="yyyy-MM-dd" className="form-control" maxDate={new Date()}
                              />
                            </div>
                          </Form.Group>
                        </Col>
                        <Col md={6} className="mb-3">
                          <Form.Group>
                            <Form.Label>Purchaser Name</Form.Label>
                            <Form.Control name="purchaserName" value={editForm.purchaserName} onChange={handleFormChange} required />
                          </Form.Group>
                        </Col>
                      </Row>
                      <Row>
                        <Col md={4} className="mb-3">
                          <Form.Group>
                            <Form.Label>Hours Purchased</Form.Label>
                            <Form.Control type="number" name="hoursPurchased" min="0.25" step="0.25" value={editForm.hoursPurchased} onChange={handleFormChange} required />
                          </Form.Group>
                        </Col>
                        <Col md={4} className="mb-3">
                          <Form.Group>
                            <Form.Label>Total Cost ($)</Form.Label>
                            <Form.Control type="number" name="totalCost" min="0" step="0.01" value={editForm.totalCost} onChange={handleFormChange} required />
                          </Form.Group>
                        </Col>
                        <Col md={4} className="mb-3">
                          <Form.Group>
                            <Form.Label>Remaining Hours</Form.Label>
                            <Form.Control type="number" name="remainingHours" min="0" step="0.25" value={editForm.remainingHours} onChange={handleFormChange} required />
                          </Form.Group>
                        </Col>
                      </Row>
                      <Form.Group className="mb-3">
                        <Form.Label>Reason for Edit <span className="text-danger">*</span></Form.Label>
                        <Form.Control as="textarea" rows={2} value={editReason} onChange={e => setEditReason(e.target.value)} required />
                      </Form.Group>
                      <div className="text-end">
                        <Button variant="secondary" onClick={handleCancelEdit} className="me-2" disabled={isSaving}>Cancel</Button>
                        <Button variant="primary" type="submit" disabled={isSaving}>
                          {isSaving ? <Spinner as="span" animation="border" size="sm" /> : 'Save Changes'}
                        </Button>
                      </div>
                    </Form>
                  ) : (
                    // ── Detail view ──────────────────────────────────────────
                    <>
                      <Row className="mb-3">
                        <Col md={6}>
                          <p><strong>Purchase Date:</strong> {format(batch.purchaseDate, 'MMMM d, yyyy')}</p>
                          <p><strong>Purchaser:</strong> {batch.purchaserName}</p>
                        </Col>
                        <Col md={6}>
                          <p><strong>Hours Purchased:</strong> {batch.hoursPurchased}</p>
                          <p><strong>Total Cost:</strong> ${batch.totalCost.toFixed(2)}</p>
                          <p><strong>Remaining Hours:</strong> <strong>{batch.remainingHours}</strong></p>
                        </Col>
                      </Row>
                      <Button variant="outline-primary" size="sm" className="mb-3" onClick={() => handleStartEdit(batch)}>
                        Edit Batch Details
                      </Button>
                      <hr />
                      <h5>Batch History</h5>
                      {isLoadingHistory && <Spinner animation="border" size="sm" />}
                      {!isLoadingHistory && history.length === 0 && activeKey === batch.id && (
                        <p className="text-muted">No usage or adjustments recorded.</p>
                      )}
                      {!isLoadingHistory && history.length > 0 && activeKey === batch.id && (
                        <Table striped bordered hover responsive size="sm">
                          <thead><tr><th>Date</th><th>Type</th><th>Details</th><th>Source</th></tr></thead>
                          <tbody>
                            {history.map((item, i) => {
                              const style = item.type === 'sessionUsage' ? SESSION_ROW_STYLE : ADJUSTMENT_ROW_STYLE;
                              return (
                                <tr key={`${item.type}-${item.id ?? i}`}>
                                  <td style={style}>{format(item.eventDate, 'yyyy-MM-dd HH:mm')}</td>
                                  <td style={style}>{item.type === 'sessionUsage' ? 'Session Usage' : 'Adjustment'}</td>
                                  <td style={style}>
                                    {item.type === 'sessionUsage' && `Used: ${item.hoursUsed as number} hrs`}
                                    {item.type === 'adjustment' && (
                                      <>
                                        Reason: {item.reason as string}
                                        {(item.changes as { field: string; oldValue: unknown; newValue: unknown }[])?.map((c, ci) => (
                                          <div key={ci} style={{ fontSize: '0.8em' }}>
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
                    </>
                  )}
                </Accordion.Body>
              </Accordion.Item>
            ))}
          </Accordion>
        </Card.Body>
      </Card>

      <AddCourtCreditModal
        show={showAddModal}
        onHide={() => setShowAddModal(false)}
        onAddBatch={handleAddBatch}
      />
    </Container>
  );
}
