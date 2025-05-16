import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Container, Table, Button, Spinner, Alert, Card, Row, Col, Form, InputGroup, Accordion } from 'react-bootstrap'; // Added Accordion
import { format, compareDesc } from 'date-fns';
import { Link } from 'react-router-dom';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';

import AddCourtCreditModal from '../components/AddCourtCreditsModal';

import {
    addCourtCreditBatchToFirestore,
    updateCourtCreditBatchAndLogAdjustments,
    fetchCourtCreditBatchById,
    fetchCourtCreditAdjustmentsForBatch,
    fetchSessionUsageForCourtCreditBatch
} from '../services/firebaseService';
import { db } from '../services/firebaseService';
import { collection, getDocs, query, orderBy as firestoreOrderBy } from 'firebase/firestore';

// Styles for history rows
const sessionUsageRowStyle = { backgroundColor: '#e9f7ef' };
const adjustmentRowStyle = { backgroundColor: '#feefd8' };

// Initial state for the inline edit form
const initialEditFormState = {
    purchaseDate: new Date(),
    purchaserName: '',
    hoursPurchased: '',
    totalCost: '',
    remainingHours: '',
    notes: ''
};

function CourtCreditsPage() {
    const [courtCreditBatches, setCourtCreditBatches] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isLoadingHistory, setIsLoadingHistory] = useState(false);
    const [error, setError] = useState(null);
    const [formError, setFormError] = useState(''); // For edit form errors

    const [showAddModal, setShowAddModal] = useState(false); // For adding new batches
    const [sortConfig, setSortConfig] = useState({ key: 'purchaseDate', direction: 'desc' });

    // --- State for Accordion and Inline Editing ---
    const [activeKey, setActiveKey] = useState(null); // ID of the open batch
    const [editingBatchId, setEditingBatchId] = useState(null); // ID of the batch being edited inline
    const [editFormState, setEditFormState] = useState({ ...initialEditFormState });
    const [editReason, setEditReason] = useState('');
    const [isSaving, setIsSaving] = useState(false);
    // --- End State for Accordion ---

    const [combinedHistory, setCombinedHistory] = useState([]);

    const fetchCreditBatches = useCallback(async (newlyActiveKey = null) => {
        setIsLoading(true); setError(null); setFormError('');
        if (!db) { setError("Firestore is not initialized."); setIsLoading(false); return; }
        try {
            const creditsCollectionRef = collection(db, "courtCredits");
            const q = query(creditsCollectionRef, firestoreOrderBy("purchaseDate", "desc"));
            const querySnapshot = await getDocs(q);
            const batches = querySnapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data(),
                purchaseDate: doc.data().purchaseDate?.toDate ? doc.data().purchaseDate.toDate() : new Date(doc.data().purchaseDate)
            }));
            setCourtCreditBatches(batches);

            if (newlyActiveKey) {
                setActiveKey(newlyActiveKey); // Open the accordion for this batch
            }

        } catch (err) {
            console.error("Error fetching court credit batches:", err);
            setError("Failed to load court credit batches.");
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchCreditBatches();
    }, [fetchCreditBatches]);

    // Fetch history when activeKey changes (and not editing)
    useEffect(() => {
        if (activeKey && !editingBatchId) { // Only fetch if an item is open & not being edited
            const batchForHistory = courtCreditBatches.find(b => b.id === activeKey);
            if (batchForHistory) {
                const loadHistory = async () => {
                    setIsLoadingHistory(true); setCombinedHistory([]); setFormError('');
                    try {
                        const [adjustmentsData, usagesData] = await Promise.all([
                            fetchCourtCreditAdjustmentsForBatch(activeKey),
                            fetchSessionUsageForCourtCreditBatch(activeKey)
                        ]);
                        const adjustments = (adjustmentsData || []).map(adj => ({ ...adj, type: 'adjustment', eventDate: adj.adjustmentDate?.toDate ? adj.adjustmentDate.toDate() : new Date(adj.adjustmentDate || 0) }));
                        const usages = (usagesData || []).map(usage => ({ ...usage, type: 'sessionUsage', eventDate: usage.sessionDate?.toDate ? usage.sessionDate.toDate() : new Date(usage.sessionDate || 0) }));
                        const combined = [...adjustments, ...usages].sort((a, b) => compareDesc(a.eventDate, b.eventDate));
                        setCombinedHistory(combined);
                    } catch (historyError) {
                        console.error("Error fetching batch history:", historyError);
                        setFormError("Failed to load history for this batch.");
                    } finally { setIsLoadingHistory(false); }
                };
                loadHistory();
            }
        } else {
            setCombinedHistory([]); // Clear if no active key or if editing
        }
    }, [activeKey, editingBatchId, courtCreditBatches]); // Add courtCreditBatches if history needs to reflect it


    const sortedBatchesForAccordion = useMemo(() => {
        let sortableItems = [...courtCreditBatches].map(batch => ({
            ...batch
        }));
        if (sortConfig.key !== null) {
            sortableItems.sort((a, b) => {
                let aValue = a[sortConfig.key];
                let bValue = b[sortConfig.key];
                if (sortConfig.key === 'purchaseDate') {
                    aValue = aValue instanceof Date ? aValue.getTime() : 0;
                    bValue = bValue instanceof Date ? bValue.getTime() : 0;
                } else if (typeof aValue === 'number' && typeof bValue === 'number') {
                    // Standard number comparison
                 }
                else { aValue = String(aValue ?? '').toLowerCase(); bValue = String(bValue ?? '').toLowerCase(); }

                if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
                if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
                return 0;
            });
        }
        return sortableItems;
    }, [courtCreditBatches, sortConfig]);

    const requestSort = (key) => {
        let direction = 'asc';
        if (sortConfig.key === key && sortConfig.direction === 'asc') {
            direction = 'desc';
        }
        setSortConfig({ key, direction });
    };

    const getSortIndicator = (key) => {
        if (sortConfig.key === key) {
            return sortConfig.direction === 'asc' ? ' ▲' : ' ▼';
        }
        return '';
    };

    // Handler for submitting from the Add Modal
    const handleAddBatchFromModal = async (formData) => {
        try {
            const newBatchId = await addCourtCreditBatchToFirestore(formData);
            await fetchCreditBatches(newBatchId); // Refresh and set new as active
            setShowAddModal(false);
        } catch (error) {
            console.error("Error in Page's handleAddCourtCreditBatchFromModal:", error);
            throw error; // Re-throw for modal to display
        }
    };

    // --- Handlers for Inline Editing in Accordion Body ---
    const handleStartEditInline = (batch) => {
        setEditingBatchId(batch.id);
        setActiveKey(batch.id); // Ensure this accordion item is open
        setEditFormState({
            purchaseDate: batch.purchaseDate instanceof Date ? batch.purchaseDate : new Date(batch.purchaseDate || Date.now()),
            purchaserName: batch.purchaserName || '',
            hoursPurchased: batch.hoursPurchased?.toString() || '',
            totalCost: Number(batch.totalCost) || 0,
            remainingHours: batch.remainingHours?.toString() || '',
            notes: batch.notes || ''
        });
        setEditReason('');
        setFormError('');
    };

    const handleEditFormChange = (event) => {
        const { name, value, type } = event.target;
        setEditFormState(prevState => ({
            ...prevState,
            [name]: type === 'number' ? (value === '' ? '' : parseFloat(value)) : value
        }));
    };

    const handleEditDateChange = (date) => {
        setEditFormState(prevState => ({ ...prevState, purchaseDate: date }));
    };

    const handleCancelInlineEdit = () => {
        setEditingBatchId(null);
        setEditFormState({ ...initialEditFormState });
        setEditReason('');
        setFormError('');
        // activeKey remains to keep accordion open, history will re-fetch
    };

    const handleSaveInlineEdit = async () => {
        setFormError('');
        if (!editFormState || !editingBatchId) return;

        // --- Validation --- (Similar to modal validation)
        const purchasedHoursNum = parseFloat(editFormState.hoursPurchased);
        const costNum = parseFloat(editFormState.totalCost);
        const remainingHoursNum = parseFloat(editFormState.remainingHours);

        if (isNaN(purchasedHoursNum) || purchasedHoursNum <= 0) { setFormError('Valid Hours Purchased (> 0) is required.'); return; }
        if (isNaN(costNum) || costNum < 0) { setFormError('Valid Cost (>= 0) is required.'); return; }
        if (isNaN(remainingHoursNum) || remainingHoursNum < 0) { setFormError('Valid Remaining Hours (>= 0) is required.'); return; }
        // Find the original batch from state to compare original hoursPurchased
        const originalBatchForCheck = courtCreditBatches.find(b => b.id === editingBatchId);
        if (originalBatchForCheck && originalBatchForCheck.hoursPurchased === purchasedHoursNum && remainingHoursNum > purchasedHoursNum) {
            setFormError('Remaining hours cannot exceed originally purchased hours unless purchased hours also increased.'); return;
        }
        if (!editReason.trim()) { setFormError('Reason for edit is required.'); return; }
        // --- End Validation ---

        setIsSaving(true);
        const currentUserIdPlaceholder = "admin_user_id_placeholder";
        const currentUserNamePlaceholder = "Admin";

        const dataToSubmit = {
            purchaseDate: editFormState.purchaseDate instanceof Date ? editFormState.purchaseDate : new Date(editFormState.purchaseDate),
            purchaserName: editFormState.purchaserName.trim(),
            hoursPurchased: purchasedHoursNum,
            totalCost: Number(costNum),
            remainingHours: remainingHoursNum,
            notes: editFormState.notes.trim(),
        };

        try {
            const originalBatchData = await fetchCourtCreditBatchById(editingBatchId);
            if (!originalBatchData) throw new Error("Original batch data not found for update.");
            const originalDataForLog = { ...originalBatchData, purchaseDate: originalBatchData.purchaseDate?.toDate ? originalBatchData.purchaseDate.toDate() : new Date(originalBatchData.purchaseDate) };

            await updateCourtCreditBatchAndLogAdjustments(
                editingBatchId, originalDataForLog, dataToSubmit, editReason,
                currentUserIdPlaceholder, currentUserNamePlaceholder
            );
            await fetchCreditBatches(editingBatchId); // Refresh list and keep item open
            setEditingBatchId(null); // Exit edit mode
        } catch (error) {
            console.error("Error updating court credit batch:", error);
            setFormError(error.message || "Failed to update batch.");
        } finally {
            setIsSaving(false);
        }
    };
    // --- End Inline Edit Handlers ---


    // Render the table-like header for the accordion
    const renderAccordionHeader = (batch) => (
        <Row className="w-100 align-items-center gx-2 text-body"> {/* Use text-body for better contrast if header is dark */}
            <Col xs={4} md={2} className="text-md-center">${batch.costPerHour?.toFixed(2) || 'N/A'}</Col>
            <Col xs={4} md={2} className="text-md-center">{batch.remainingHours || '0'}</Col>
            <Col xs={4} md={3} className="text-md-center">{batch.purchaseDate ? format(batch.purchaseDate, 'yyyy-MM-dd') : 'N/A'}</Col>
            <Col xs={12} md={3} className="text-muted small d-none d-md-block" title={batch.purchaserName}>{batch.purchaserName || 'N/A'}</Col>
        </Row>
    );

    // Render the body of the accordion item (either details or edit form)
    const renderAccordionItemBody = (batch) => {
    console.log("batch ==> ", batch);
        if (editingBatchId === batch.id) {
            // --- Inline Edit Form ---
            return (
                <Form onSubmit={(e) => { e.preventDefault(); handleSaveInlineEdit(); }}>
                    {formError && <Alert variant="danger" onClose={() => setFormError('')} dismissible>{formError}</Alert>}
                    {/* Form fields similar to AddEditCourtCreditBatchModal */}
                    <Row>
                        <Col md={6} className="mb-3">
                            <Form.Group controlId={`editPDate-${batch.id}`}>
                                <Form.Label>Purchase Date</Form.Label>
                                <DatePicker selected={editFormState.purchaseDate} onChange={(date) => handleEditDateChange(date)} dateFormat="yyyy-MM-dd" className="form-control" required disabled={isSaving} maxDate={new Date()} />
                            </Form.Group>
                        </Col>
                        <Col md={6} className="mb-3">
                            <Form.Group controlId={`editPName-${batch.id}`}>
                                <Form.Label>Purchaser Name</Form.Label>
                                <Form.Control type="text" name="purchaserName" value={editFormState.purchaserName} onChange={handleEditFormChange} required disabled={isSaving} />
                            </Form.Group>
                        </Col>
                    </Row>
                    <Row>
                        <Col md={4} className="mb-3">
                            <Form.Group controlId={`editHPurch-${batch.id}`}>
                                <Form.Label>Hours Purchased</Form.Label>
                                <Form.Control type="number" name="hoursPurchased" min="0.25" step="0.25" value={editFormState.hoursPurchased} onChange={handleEditFormChange} required disabled={isSaving || (batch.hoursPurchased === parseFloat(editFormState.hoursPurchased))} title={batch.hoursPurchased === parseFloat(editFormState.hoursPurchased) ? "Initial purchased hours not changed." : ""} />
                            </Form.Group>
                        </Col>
                        <Col md={4} className="mb-3">
                            <Form.Group controlId={`editCost-${batch.id}`}>
                                <Form.Label>Total Cost ($)</Form.Label>
                                <Form.Control type="number" name="cost" min="0" step="0.01" value={editFormState.totalCost} onChange={handleEditFormChange} required disabled={isSaving} />
                            </Form.Group>
                        </Col>
                        <Col md={4} className="mb-3">
                            <Form.Group controlId={`editHRem-${batch.id}`}>
                                <Form.Label>Remaining Hours</Form.Label>
                                <Form.Control type="number" name="remainingHours" min="0" step="0.25" value={editFormState.remainingHours} onChange={handleEditFormChange} required disabled={isSaving} />
                            </Form.Group>
                        </Col>
                    </Row>
                    <Form.Group className="mb-3" controlId={`editReason-${batch.id}`}>
                        <Form.Label>Reason for Edit <span className="text-danger">*</span></Form.Label>
                        <Form.Control as="textarea" rows={2} value={editReason} onChange={(e) => setEditReason(e.target.value)} required disabled={isSaving} placeholder="e.g., Corrected data, updated remaining hours" />
                    </Form.Group>
                    <div className="text-end">
                        <Button variant="secondary" onClick={handleCancelInlineEdit} className="me-2" disabled={isSaving}>Cancel</Button>
                        <Button variant="primary" type="submit" disabled={isSaving}>
                            {isSaving ? <Spinner as="span" animation="border" size="sm" /> : 'Save Changes'}
                        </Button>
                    </div>
                </Form>
            );
        }

        // Read-only details
        return (
            <>
                <Row className="mb-3">
                    <Col md={6}>
                        <p className="mb-1"><strong>Batch ID:</strong> {batch.id}</p>
                        <p className="mb-1"><strong>Purchase Date:</strong> {batch.purchaseDate ? format(batch.purchaseDate, 'MMMM d, yyyy') : 'N/A'}</p>
                        <p className="mb-1"><strong>Purchaser:</strong> {batch.purchaserName || 'N/A'}</p>
                    </Col>
                    <Col md={6}>
                        <p className="mb-1"><strong>Hours Purchased:</strong> {batch.hoursPurchased}</p>
                        <p className="mb-1"><strong>Total Cost:</strong> ${batch.totalCost || '0.00'}</p>
                        <p className="mb-1"><strong>Remaining Hours:</strong> <strong>{batch.remainingHours}</strong></p>
                    </Col>
                </Row>
                {batch.notes && <><p className="mb-1"><strong>Notes:</strong> {batch.notes}</p></>}
                <Button variant="outline-primary" size="sm" className="mb-3" onClick={() => handleStartEditInline(batch)}>
                    Edit Batch Details
                </Button>
                <hr />
                <h5>Batch History</h5>
                {isLoadingHistory && <div className="text-center p-3"><Spinner animation="border" size="sm" /> <p>Loading history...</p></div>}
                {error && activeKey === batch.id && <Alert variant="danger" size="sm">{error}</Alert>}
                {!isLoadingHistory && combinedHistory.length === 0 && activeKey === batch.id && <p className="text-muted">No usage or adjustments recorded.</p>}
                {!isLoadingHistory && combinedHistory.length > 0 && activeKey === batch.id && (
                    <Table striped bordered hover responsive size="sm">
                        <thead><tr><th>Date</th><th>Type</th><th>Details</th><th>User/Session</th></tr></thead>
                        <tbody>
                            {combinedHistory.map((item, index) => {
                                const rowStyle = item.type === 'sessionUsage' ? sessionUsageRowStyle : adjustmentRowStyle;
                                return (
                                    <tr key={`${item.type}-${item.id || index}`}>
                                        <td style={rowStyle}>{item.eventDate ? format(item.eventDate.toDate ? item.eventDate.toDate() : new Date(item.eventDate), 'yyyy-MM-dd HH:mm') : 'N/A'}</td>
                                        <td style={rowStyle}>{item.type === 'sessionUsage' ? 'Session Usage' : 'Adjustment'}</td>
                                        <td style={rowStyle}>
                                            {item.type === 'sessionUsage' && `Used: ${item.hoursUsed} hrs`}
                                            {item.type === 'adjustment' && (<>Reason: {item.reason} {item.changes?.map((c, i) => <div key={i} style={{ fontSize: '0.8em' }}><em>{c.fieldName}:</em> {String(c.oldValue)} → {String(c.newValue)}</div>)}</>)}
                                        </td>
                                        <td style={rowStyle}>
                                            {item.type === 'sessionUsage' && item.sessionId ? (<Link to={`/sessions/${item.sessionId}`}>{item.sessionId.substring(0, 8)}...</Link>) : ''}
                                            {item.type === 'adjustment' && (item.userName || item.userId)}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </Table>
                )}
            </>
        );
    };

    if (isLoading && !courtCreditBatches.length) return <Container className="text-center mt-5"><Spinner animation="border" /><p>Loading court credits...</p></Container>;
    if (error && !courtCreditBatches.length) return <Container className="mt-4"><Alert variant="danger">{error}</Alert></Container>;

    return (
        <Container fluid className="mt-4">
            <Card>
                <Card.Header className="d-flex justify-content-between align-items-center">
                    <h2>Court Credit Inventory</h2>
                    <Button variant="primary" onClick={() => setShowAddModal(true)}> {/* Add button opens modal */}
                        + Add Credit Batch
                    </Button>
                </Card.Header>
                <Card.Body>
                    {/* Sortable Header Row for Accordion Titles */}
                    <Row className="fw-bold text-muted py-2 px-4 border-bottom mb-2 d-none d-md-flex">
                        <Col md={2} className="text-md-center" onClick={() => requestSort('costPerHour')} style={{ cursor: 'pointer' }}>Cost/Hr{getSortIndicator('costPerHour')}</Col>
                        <Col md={2} className="text-md-center" onClick={() => requestSort('remainingHours')} style={{ cursor: 'pointer' }}>Rem. Hrs{getSortIndicator('remainingHours')}</Col>
                        <Col md={3} className="text-md-center" onClick={() => requestSort('purchaseDate')} style={{ cursor: 'pointer' }}>Purchase Date{getSortIndicator('purchaseDate')}</Col>
                        <Col md={2} onClick={() => requestSort('purchaserName')} style={{ cursor: 'pointer' }}>Purchaser{getSortIndicator('purchaserName')}</Col>
                    </Row>

                    {sortedBatchesForAccordion.length === 0 && !isLoading && (
                        <Alert variant="info">No court credit batches found. Click "+ Add Credit Batch" to start.</Alert>
                    )}

                    <Accordion activeKey={activeKey} onSelect={(k) => setActiveKey(k === activeKey ? null : k)}>
                        {sortedBatchesForAccordion.map((batch) => (
                            <Accordion.Item eventKey={batch.id} key={batch.id}>
                                <Accordion.Header>{renderAccordionHeader(batch)}</Accordion.Header>
                                <Accordion.Body>
                                    {editingBatchId === batch.id ?
                                        renderAccordionItemBody(batch) 
                                        : renderAccordionItemBody(batch) 
                                    }
                                </Accordion.Body>
                            </Accordion.Item>
                        ))}
                    </Accordion>
                </Card.Body>
            </Card>

            {/* Modal is now ONLY for ADDING new batches */}
            {showAddModal && (
                <AddCourtCreditModal
                    show={showAddModal}
                    onHide={() => setShowAddModal(false)}
                    onAddBatch={handleAddBatchFromModal} // This handles ADDING
                // isEditMode={false} // Explicitly set to false
                // initialBatchData={null} // No initial data for add
                />
            )}
        </Container>
    );
}

export default CourtCreditsPage;
