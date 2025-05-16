import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Container, Table, Button, Spinner, Alert, Card, Row, Col, Form } from 'react-bootstrap';
import { format, compareDesc } from 'date-fns';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';


import AddBirdieBatchModal from '../components/AddBirdieBatchModal';
import {
    addBirdieBatchToFirestore,
    db,
    updateBirdieBatchAndLogAdjustments,
    fetchBirdieBatchById,
    fetchInventoryAdjustmentsForBatch,
    fetchSessionUsageForBirdieBatch
} from '../firebaseService';
import { collection, getDocs, query, orderBy } from 'firebase/firestore';
import { Link } from 'react-router';

const calculateTotalRemainingBirds = (batch) => {
    if (!batch || typeof batch.unopenedTubesRemaining !== 'number' || typeof batch.birdsPerTube !== 'number' || typeof batch.birdsInOpenTube !== 'number') {
        return 0;
    }
    return (batch.unopenedTubesRemaining * batch.birdsPerTube) + batch.birdsInOpenTube;
};

// const sessionUsageRowStyle = {
//     backgroundColor: '#aef5cc', 
// };
const adjustmentRowStyle = {
    backgroundColor: "#f2bd6d",
};

function BirdiePage() {
    const [birdieBatches, setBirdieBatches] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(null);
    const [pageLevelError, setPageLevelError] = useState('');
    const [showAddModal, setShowAddModal] = useState(false);
    const [sortConfig, setSortConfig] = useState({ key: 'purchaseDate', direction: 'desc' });
    const [selectedBatch, setSelectedBatch] = useState(null);

    const [isDetailEditing, setIsDetailEditing] = useState(false);
    const [detailFormState, setDetailFormState] = useState(null);
    const [editReason, setEditReason] = useState('');
    const [isSavingEdit, setIsSavingEdit] = useState(false);

    const [combinedHistory, setCombinedHistory] = useState([]);
    const [isLoadingHistory, setIsLoadingHistory] = useState(false);

    useEffect(() => {
        if (selectedBatch && selectedBatch.id && !isDetailEditing) {
            const loadHistory = async () => {
                setIsLoadingHistory(true);
                setCombinedHistory([]);
                setPageLevelError('');
                try {
                    if (typeof fetchInventoryAdjustmentsForBatch !== 'function' || typeof fetchSessionUsageForBirdieBatch !== 'function') {
                        console.error("History fetching service functions are not defined!");
                        setPageLevelError("History functions are not available.");
                        setIsLoadingHistory(false);
                        return;
                    }

                    const [adjustmentsData, usagesData] = await Promise.all([
                        fetchInventoryAdjustmentsForBatch(selectedBatch.id),
                        fetchSessionUsageForBirdieBatch(selectedBatch.id)
                    ]);

                    const adjustments = (adjustmentsData || []).map(adj => ({
                        ...adj,
                        type: 'adjustment',
                        eventDate: adj.adjustmentDate?.toDate ? adj.adjustmentDate.toDate() : new Date(adj.adjustmentDate || 0)
                    }));

                    const usages = (usagesData || []).map(usage => ({
                        ...usage,
                        type: 'sessionUsage',
                        eventDate: usage.sessionDate?.toDate ? usage.sessionDate.toDate() : new Date(usage.sessionDate || 0)
                    }));

                    const combined = [...adjustments, ...usages].sort((a, b) =>
                        compareDesc(a.eventDate, b.eventDate)
                    );
                    setCombinedHistory(combined);

                } catch (historyError) {
                    console.error("Error fetching batch history:", historyError);
                    setPageLevelError("Failed to load history for this batch.");
                } finally {
                    setIsLoadingHistory(false);
                }
            };
            loadHistory();
        } else {
            setCombinedHistory([]);
        }
    }, [selectedBatch, isDetailEditing]);

    const fetchInventory = useCallback(async (selectBatchIdAfterFetch = null) => {
        setIsLoading(true);
        setError(null);
        setPageLevelError('');
        if (!db) {
            setError("Firestore is not initialized. Cannot fetch inventory.");
            setIsLoading(false);
            return;
        }
        try {
            const inventoryCollectionRef = collection(db, "birdieInventory");
            const q = query(inventoryCollectionRef, orderBy("purchaseDate", "desc"));
            const querySnapshot = await getDocs(q);
            const batches = querySnapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data(),
                purchaseDate: doc.data().purchaseDate?.toDate ? doc.data().purchaseDate.toDate() : new Date(doc.data().purchaseDate)
            }));
            setBirdieBatches(batches);

            const currentSelectedId = selectBatchIdAfterFetch || selectedBatch?.id;
            if (currentSelectedId) {
                const updatedSelectedBatch = batches.find(b => b.id === currentSelectedId);
                setSelectedBatch(updatedSelectedBatch || null);
                if (!updatedSelectedBatch && selectBatchIdAfterFetch) {
                    setSelectedBatch(null);
                }
            }

        } catch (err) {
            console.error("Error fetching birdie inventory:", err);
            setError("Failed to load birdie inventory. Please try again.");
        } finally {
            setIsLoading(false);
        }
    }, [selectedBatch?.id, isDetailEditing]);

    useEffect(() => {
        fetchInventory();
    }, [fetchInventory]);

    const sortedSummaryBatches = useMemo(() => {
        let sortableItems = [...birdieBatches];
        if (sortConfig.key !== null) {
            sortableItems.sort((a, b) => {
                let aValue = a[sortConfig.key];
                let bValue = b[sortConfig.key];

                if (sortConfig.key === 'purchaseDate') {
                    aValue = aValue instanceof Date ? aValue.getTime() : 0;
                    bValue = bValue instanceof Date ? bValue.getTime() : 0;
                } else if (typeof aValue === 'number' && typeof bValue === 'number') {
                    // Standard number comparison
                } else {
                    aValue = String(aValue ?? '').toLowerCase();
                    bValue = String(bValue ?? '').toLowerCase();
                }

                if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
                if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
                return 0;
            });
        }
        return sortableItems;
    }, [birdieBatches, sortConfig]);

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


    const handleAddBirdieBatch = async (newBatchDataFromModal) => {
        try {
            const dataToSave = { ...newBatchDataFromModal, purchaseDate: newBatchDataFromModal.purchaseDate };
            const newBatchId = await addBirdieBatchToFirestore(dataToSave);
            await fetchInventory(newBatchId);
            setShowAddModal(false);
        } catch (error) {
            console.error("Error in Page's handleAddBirdieBatch:", error);
            throw error;
        }
    };

    const handleSelectBatch = (batch) => {
        setSelectedBatch(batch);
        setIsDetailEditing(false);
        setDetailFormState(null);
        setEditReason('');
        setPageLevelError('');
    };

    const handleToggleDetailEdit = () => {
        if (selectedBatch) {
            setDetailFormState({
                name: selectedBatch.name || '',
                purchaseDate: selectedBatch.purchaseDate instanceof Date ? selectedBatch.purchaseDate : new Date(selectedBatch.purchaseDate || Date.now()),
                purchaserName: selectedBatch.purchaserName || '',
                costPerTube: selectedBatch.costPerTube || 0,
                tubesPurchased: selectedBatch.tubesPurchased || 0,
                birdsPerTube: selectedBatch.birdsPerTube || 12,
                unopenedTubesRemaining: selectedBatch.unopenedTubesRemaining || 0,
                birdsInOpenTube: selectedBatch.birdsInOpenTube || 0,
            });
            setEditReason('');
            setIsDetailEditing(true);
            setPageLevelError('');
        }
    };

    const handleDetailFormChange = (event) => {
        const { name, value, type } = event.target;
        setDetailFormState(prevState => ({
            ...prevState,
            [name]: type === 'number' ? (value === '' ? '' : parseFloat(value)) : value
        }));
    };
    const handleDateChange = (date) => {
        setDetailFormState(prevState => ({
            ...prevState,
            purchaseDate: date
        }));
    };


    const handleSaveDetailEdit = async () => {
        if (!detailFormState || !selectedBatch) return;
        setPageLevelError('');

        if (!detailFormState.name?.trim()) { setPageLevelError('Birdie Name/Type is required.'); return; }
        if (!detailFormState.purchaseDate) { setPageLevelError('Purchase Date is required.'); return; }
        const cost = parseFloat(detailFormState.costPerTube);
        if (isNaN(cost) || cost < 0) { setPageLevelError('Valid Cost Per Tube (>= 0) is required.'); return; }
        const tubes = parseInt(detailFormState.tubesPurchased, 10);
        if (isNaN(tubes) || tubes < 0) { setPageLevelError('Valid Initial Tubes Purchased (>= 0) is required.'); return; }
        const birdsNum = parseInt(detailFormState.birdsPerTube, 10);
        if (isNaN(birdsNum) || birdsNum <= 0) { setPageLevelError('Valid Birds Per Tube (> 0) is required.'); return; }
        const unopened = parseInt(detailFormState.unopenedTubesRemaining, 10);
        if (isNaN(unopened) || unopened < 0) { setPageLevelError('Valid Unopened Tubes (>= 0) is required.'); return; }
        const openBirds = parseInt(detailFormState.birdsInOpenTube, 10);
        if (isNaN(openBirds) || openBirds < 0 || openBirds > birdsNum) { setPageLevelError(`Birds in Open Tube must be between 0 and ${birdsNum}.`); return; }
        if (!detailFormState.purchaserName?.trim()) { setPageLevelError('Purchaser Name is required.'); return; }
        if (!editReason.trim()) { setPageLevelError('Reason for edit is required.'); return; }

        setIsSavingEdit(true);
        const currentUserId = "admin_user_placeholder"; // Placeholder
        const currentUserName = "Admin"; // Placeholder

        try {
            const originalBatchDataFromDb = await fetchBirdieBatchById(selectedBatch.id);
            if (!originalBatchDataFromDb) {
                throw new Error("Original batch data not found for update. It might have been deleted.");
            }
            const originalDataForLog = {
                ...originalBatchDataFromDb,
                purchaseDate: originalBatchDataFromDb.purchaseDate?.toDate ? originalBatchDataFromDb.purchaseDate.toDate() : new Date(originalBatchDataFromDb.purchaseDate)
            };


            const dataToUpdate = {
                ...detailFormState,
                purchaseDate: detailFormState.purchaseDate instanceof Date ? detailFormState.purchaseDate : new Date(detailFormState.purchaseDate),
            };


            await updateBirdieBatchAndLogAdjustments(
                selectedBatch.id,
                originalDataForLog,
                dataToUpdate,
                editReason,
                currentUserId,
                currentUserName
            );

            await fetchInventory(selectedBatch.id);
            setIsDetailEditing(false);
            setEditReason('');
        } catch (error) {
            console.error("Error updating batch:", error);
            setPageLevelError(error.message || "Failed to update batch.");
        } finally {
            setIsSavingEdit(false);
        }
    };

    const handleCancelDetailEdit = () => {
        setIsDetailEditing(false);
        setDetailFormState(null);
        setEditReason('');
        setPageLevelError('');
    };

    const renderSummaryTable = () => {
        if (isLoading && !birdieBatches.length) return <div className="text-center"><Spinner animation="border" /><p>Loading...</p></div>; // Show loading only if no data yet
        if (error && !birdieBatches.length) return <Alert variant="danger">{error}</Alert>; // Show error only if no data
        if (!isLoading && birdieBatches.length === 0) return <Alert variant="info">No birdie batches found.</Alert>;

        return (
            <Table striped bordered hover responsive="sm" size="sm" className="mt-2">
                <thead>
                    <tr>
                        <th onClick={() => requestSort('name')} style={{ cursor: 'pointer' }}>Name{getSortIndicator('name')}</th>
                        <th onClick={() => requestSort('purchaseDate')} style={{ cursor: 'pointer' }}>Purchase Date{getSortIndicator('purchaseDate')}</th>
                        <th onClick={() => requestSort('costPerTube')} style={{ cursor: 'pointer' }}>Cost/Tube{getSortIndicator('costPerTube')}</th>
                        <th onClick={() => requestSort('unopenedTubesRemaining')} style={{ cursor: 'pointer' }}>Unopened Tubes{getSortIndicator('unopenedTubesRemaining')}</th>
                    </tr>
                </thead>
                <tbody>
                    {sortedSummaryBatches.map((batch) => (
                        <tr
                            key={batch.id}
                            onClick={() => handleSelectBatch(batch)}
                            style={{ cursor: 'pointer' }}
                            className={selectedBatch?.id === batch.id ? 'table-primary' : ''}
                        >
                            <td>{batch.name}</td>
                            <td>{batch.purchaseDate ? format(batch.purchaseDate, 'yyyy-MM-dd') : 'N/A'}</td>
                            <td>${batch.costPerTube?.toFixed(2) || '0.00'}</td>
                            <td>{batch.unopenedTubesRemaining}</td>
                        </tr>
                    ))}
                </tbody>
            </Table>
        );
    };

    const renderDetailView = () => {
        if (!selectedBatch && !isDetailEditing) {
            return (
                <Card className="h-100">
                    <Card.Body className="d-flex align-items-center justify-content-center">
                        <p className="text-muted">Select a batch from the left to view details.</p>
                    </Card.Body>
                </Card>
            );
        }

        const displayData = isDetailEditing ? detailFormState : selectedBatch;
        if (!displayData) return null;

        const totalRemaining = calculateTotalRemainingBirds(displayData);

        if (isDetailEditing) {
            return (
                <Card>
                    <Card.Header>
                        <Card.Title>Editing Batch: {selectedBatch?.name}</Card.Title>
                    </Card.Header>
                    <Form onSubmit={(e) => { e.preventDefault(); handleSaveDetailEdit(); }}>
                        <Card.Body>
                            {pageLevelError && <Alert variant="danger">{pageLevelError}</Alert>}
                            <Row>
                                <Col md={6}>
                                    <Form.Group className="mb-3" controlId="editBatchName">
                                        <Form.Label>Name/Type</Form.Label>
                                        <Form.Control type="text" name="name" value={detailFormState.name} onChange={handleDetailFormChange} required />
                                    </Form.Group>
                                    <Form.Group className="mb-3" controlId="editBatchPurchaseDate">
                                        <Form.Label>Purchase Date</Form.Label>
                                        <div>
                                            <DatePicker
                                                selected={detailFormState.purchaseDate}
                                                onChange={handleDateChange}
                                                dateFormat="yyyy-MM-dd"
                                                className="form-control"
                                                maxDate={new Date()}
                                            />
                                        </div>
                                    </Form.Group>
                                    <Form.Group className="mb-3" controlId="editBatchPurchaserName">
                                        <Form.Label>Purchaser</Form.Label>
                                        <Form.Control type="text" name="purchaserName" value={detailFormState.purchaserName} onChange={handleDetailFormChange} required />
                                    </Form.Group>
                                    <Form.Group className="mb-3" controlId="editBatchCostPerTube">
                                        <Form.Label>Cost Per Tube ($)</Form.Label>
                                        <Form.Control type="number" name="costPerTube" min="0" step="0.01" value={detailFormState.costPerTube} onChange={handleDetailFormChange} required />
                                    </Form.Group>
                                </Col>
                                <Col md={6}>
                                    <Form.Group className="mb-3" controlId="editBatchTubesPurchased">
                                        <Form.Label>Initial Tubes Purchased</Form.Label>
                                        <Form.Control
                                            type="number"
                                            name="tubesPurchased"
                                            min="1" 
                                            step="1"
                                            value={detailFormState.tubesPurchased}
                                            onChange={handleDetailFormChange}
                                            required
                                        />
                                    </Form.Group>
                                    <Form.Group className="mb-3" controlId="editBatchBirdsPerTube">
                                        <Form.Label>Birds Per Tube</Form.Label>
                                        <Form.Control type="number" name="birdsPerTube" min="1" step="1" value={detailFormState.birdsPerTube} onChange={handleDetailFormChange} required />
                                    </Form.Group>
                                    <Form.Group className="mb-3" controlId="editBatchUnopenedTubes">
                                        <Form.Label>Unopened Tubes Remaining</Form.Label>
                                        <Form.Control type="number" name="unopenedTubesRemaining" min="0" step="1" value={detailFormState.unopenedTubesRemaining} onChange={handleDetailFormChange} required />
                                    </Form.Group>
                                    <Form.Group className="mb-3" controlId="editBatchBirdsInOpenTube">
                                        <Form.Label>Birds in Current Open Tube</Form.Label>
                                        <Form.Control type="number" name="birdsInOpenTube" min="0" max={detailFormState.birdsPerTube || 12} step="1" value={detailFormState.birdsInOpenTube} onChange={handleDetailFormChange} required />
                                    </Form.Group>
                                </Col>
                            </Row>
                            <Form.Group className="mb-3" controlId="editReason">
                                <Form.Label>Reason for Edit <span className="text-danger">*</span></Form.Label>
                                <Form.Control as="textarea" rows={2} value={editReason} onChange={(e) => setEditReason(e.target.value)} required placeholder="e.g., Stock count correction, found damaged tube" />
                            </Form.Group>
                        </Card.Body>
                        <Card.Footer className="text-end">
                            <Button variant="secondary" onClick={handleCancelDetailEdit} className="me-2" disabled={isSavingEdit}>Cancel</Button>
                            <Button variant="primary" type="submit" disabled={isSavingEdit}>
                                {isSavingEdit ? <Spinner as="span" animation="border" size="sm" /> : 'Save Changes'}
                            </Button>
                        </Card.Footer>
                    </Form>
                </Card>
            );
        }

        return (
            <Card>
                <Card.Header className="d-flex justify-content-between align-items-center">
                    <Card.Title className="mb-0">Batch Details: {displayData.name}</Card.Title>
                    <Button variant="outline-primary" size="sm" onClick={handleToggleDetailEdit}>Edit Batch</Button>
                </Card.Header>
                <Card.Body>
                    {pageLevelError && <Alert variant="danger">{pageLevelError}</Alert>}
                    <Row>
                        <Col md={6}>
                            <p><strong>Batch ID:</strong> {displayData.id}</p>
                            <p><strong>Purchase Date:</strong> {displayData.purchaseDate ? format(displayData.purchaseDate, 'MMMM d, yyyy') : 'N/A'}</p>
                            <p><strong>Purchaser:</strong> {displayData.purchaserName || 'N/A'}</p>
                            <p><strong>Cost Per Tube:</strong> ${displayData.costPerTube?.toFixed(2) || '0.00'}</p>
                        </Col>
                        <Col md={6}>
                            <p><strong>Initial Tubes Purchased:</strong> {displayData.tubesPurchased}</p>
                            <p><strong>Birds Per Tube:</strong> {displayData.birdsPerTube}</p>
                            <p><strong>Unopened Tubes Remaining:</strong> {displayData.unopenedTubesRemaining}</p>
                            <p><strong>Birds in Current Open Tube:</strong> {displayData.birdsInOpenTube}</p>
                            <p><strong>Total Remaining Birds:</strong> <strong>{totalRemaining}</strong></p>
                        </Col>
                    </Row>
                    <hr />
                    <h5>Batch History</h5>
                    {!isLoadingHistory && combinedHistory.length === 0 && <p className="text-muted">No usage or adjustments recorded for this batch.</p>}
                    {!isLoadingHistory && combinedHistory.length > 0 && (
                        <Table striped borderless hover responsive size="sm">
                            <thead>
                                <tr>
                                    <th>Date</th>
                                    <th>Type</th>
                                    <th>Details</th>
                                    <th>User/Session</th>
                                </tr>
                            </thead>
                            <tbody>
                                {combinedHistory.map((item, index) => {
                                    const rowStyle = item.type === 'sessionUsage' ? {} : adjustmentRowStyle;
                                    return (
                                        <tr key={`${item.type}-${item.id || index}`}>
                                            <td style={rowStyle}>{item.eventDate ? format(item.eventDate, 'yyyy-MM-dd HH:mm') : 'N/A'}</td>
                                            <td style={rowStyle}>
                                                {item.type === 'sessionUsage' ? 'Session Usage' : 'Adjustment'}
                                            </td>
                                            <td style={rowStyle}>
                                                {item.type === 'sessionUsage' && `Used: ${item.quantityUsed} birds`}
                                                {item.type === 'adjustment' && (
                                                    <>
                                                        Reason: {item.reason}
                                                        {item.changes && item.changes.map((change, cIdx) => (
                                                            <div key={cIdx} style={{ fontSize: '0.8em', marginLeft: '10px' }}>
                                                                <em>{change.fieldName}:</em> {String(change.oldValue)} → {String(change.newValue)}
                                                            </div>
                                                        ))}
                                                    </>
                                                )}
                                            </td>
                                            <td style={rowStyle}>
                                                {item.type === 'sessionUsage' && item.sessionId ? (
                                                    <Link to={`/sessions/${item.sessionId}`}>{item.sessionId.substring(0, 8)}...</Link>
                                                ) : ''}
                                                {item.type === 'adjustment' && (item.userName || item.userId)}
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
            <Row>
                <Col md={5} lg={4} className="mb-3 mb-md-0">
                    <Card>
                        <Card.Header className="d-flex justify-content-between align-items-center">
                            <h5>Birdie Batches</h5>
                            <Button variant="primary" size="sm" onClick={() => setShowAddModal(true)}>+ Add Batch</Button>
                        </Card.Header>
                        <Card.Body style={{ maxHeight: '80vh', overflowY: 'auto' }}>
                            {renderSummaryTable()}
                        </Card.Body>
                    </Card>
                </Col>
                <Col md={7} lg={8}>
                    {renderDetailView()}
                </Col>
            </Row>

            <AddBirdieBatchModal
                show={showAddModal}
                onHide={() => setShowAddModal(false)}
                onAddBatch={handleAddBirdieBatch}
            />
        </Container>
    );
}

export default BirdiePage;
