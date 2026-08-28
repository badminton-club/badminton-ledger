import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Container, Card, Button, Table, Spinner, Alert, Form, Modal, Badge } from 'react-bootstrap';
import { format } from 'date-fns';
import {
  fetchClub,
  fetchPendingEtransferImports,
  fetchEtransferImportHistory,
  importEtransferEmails,
  applyEtransferImport,
  rejectEtransferImport,
  undoEtransferImport,
  fetchEtransferSenderMappings,
  saveEtransferSenderMapping,
  deleteEtransferSenderMapping,
  setClubEtransferSearchAfterDate,
  formatPlayerName,
  DEFAULT_ETRANSFER_SENDER_ADDRESS,
  DEFAULT_ETRANSFER_SEARCH_AFTER_DATE,
} from '../services/firebase';
import { toJSDate } from '../services/firebase/utils';
import { useAppSelector } from '../hooks';
import { selectAllPlayers } from '../features/players/playersSlice';
import { selectIsClubAdmin, selectCurrentClubId } from '../features/club/clubSlice';
import type { EtransferImport, EtransferSenderMapping } from '../types';

const money = (n: number) => `$${n.toFixed(2)}`;

interface RowEdit {
  playerId: string;
  amount: string;
  remember: boolean;
}

function initialRowEdit(imp: EtransferImport): RowEdit {
  return {
    playerId: imp.matchedPlayerId ?? '',
    amount: imp.amount.toFixed(2),
    // Only default to "remember" for a brand-new match (name lookup, or no match
    // at all) — a mapping that was already used to find this player doesn't need
    // to be re-saved every time.
    remember: imp.matchSource !== 'mapping',
  };
}

const statusBadge = (status: EtransferImport['status']) => {
  switch (status) {
    case 'applied': return <Badge bg="success">Applied</Badge>;
    case 'rejected': return <Badge bg="secondary">Rejected</Badge>;
    case 'undone': return <Badge bg="warning" text="dark">Undone</Badge>;
    default: return <Badge bg="light" text="dark">Pending</Badge>;
  }
};

export default function EtransfersPage() {
  const isAdmin = useAppSelector(selectIsClubAdmin);
  const clubId = useAppSelector(selectCurrentClubId);
  const players = useAppSelector(selectAllPlayers);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [pending, setPending] = useState<EtransferImport[]>([]);
  const [history, setHistory] = useState<EtransferImport[]>([]);
  const [rowEdits, setRowEdits] = useState<Record<string, RowEdit>>({});

  const [senderAddress, setSenderAddress] = useState(DEFAULT_ETRANSFER_SENDER_ADDRESS);
  const [searchAfterDate, setSearchAfterDate] = useState(DEFAULT_ETRANSFER_SEARCH_AFTER_DATE);
  const [savingSearchDate, setSavingSearchDate] = useState(false);
  const [searchDateMessage, setSearchDateMessage] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [searchMessage, setSearchMessage] = useState('');

  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [applyError, setApplyError] = useState<Record<string, string>>({});
  const [applyWarning, setApplyWarning] = useState<Record<string, string>>({});

  const [rejectTarget, setRejectTarget] = useState<EtransferImport | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const [rejectError, setRejectError] = useState('');

  const [undoTarget, setUndoTarget] = useState<EtransferImport | null>(null);
  const [undoReason, setUndoReason] = useState('');
  const [undoing, setUndoing] = useState(false);
  const [undoError, setUndoError] = useState('');
  const [undoWarning, setUndoWarning] = useState('');

  const [mappings, setMappings] = useState<EtransferSenderMapping[]>([]);
  const [mappingSavingId, setMappingSavingId] = useState<string | null>(null);
  const [mappingError, setMappingError] = useState('');

  const playerName = useCallback((id: string | null) => {
    if (!id) return '';
    const p = players.find((pl) => pl.id === id);
    return p ? formatPlayerName(p) : 'Unknown player';
  }, [players]);

  const load = useCallback(async () => {
    if (!isAdmin) { setLoading(false); return; }
    setLoading(true);
    setLoadError('');
    try {
      const [club, pendingList, historyList, mappingList] = await Promise.all([
        clubId ? fetchClub(clubId) : Promise.resolve(null),
        fetchPendingEtransferImports(),
        fetchEtransferImportHistory(),
        fetchEtransferSenderMappings(),
      ]);
      setSenderAddress(club?.etransferSenderAddress || DEFAULT_ETRANSFER_SENDER_ADDRESS);
      setSearchAfterDate(club?.etransferSearchAfterDate || DEFAULT_ETRANSFER_SEARCH_AFTER_DATE);
      setPending(pendingList);
      setHistory(historyList);
      setMappings(mappingList);
      setRowEdits((prev) => {
        const next = { ...prev };
        for (const imp of pendingList) {
          if (!next[imp.id]) next[imp.id] = initialRowEdit(imp);
        }
        return next;
      });
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load e-Transfer imports.');
    } finally {
      setLoading(false);
    }
  }, [isAdmin, clubId]);

  useEffect(() => { load(); }, [load]);

  const handleSearch = async () => {
    setSearching(true);
    setSearchError('');
    setSearchMessage('');
    try {
      if (clubId) await setClubEtransferSearchAfterDate(clubId, searchAfterDate);
      const { found, created } = await importEtransferEmails(senderAddress, searchAfterDate);
      setSearchMessage(
        found === 0
          ? 'No new autodeposit emails found.'
          : created > 0
            ? `Found ${found} email(s) — ${created} new, added below for review.`
            : `Found ${found} email(s) — all already reviewed.`
      );
      await load();
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : 'Failed to search Gmail.');
    } finally {
      setSearching(false);
    }
  };

  const handleSaveSearchDate = async () => {
    if (!clubId) return;
    setSavingSearchDate(true);
    setSearchError('');
    setSearchDateMessage('');
    try {
      await setClubEtransferSearchAfterDate(clubId, searchAfterDate);
      setSearchDateMessage('Search date saved.');
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : 'Failed to save the search date.');
    } finally {
      setSavingSearchDate(false);
    }
  };

  const updateRowEdit = (id: string, patch: Partial<RowEdit>) => {
    setRowEdits((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  };

  const handleApply = async (imp: EtransferImport) => {
    const edit = rowEdits[imp.id] ?? initialRowEdit(imp);
    const amount = parseFloat(edit.amount);
    setApplyError((prev) => ({ ...prev, [imp.id]: '' }));
    if (!edit.playerId) {
      setApplyError((prev) => ({ ...prev, [imp.id]: 'Select which player this payment belongs to.' }));
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      setApplyError((prev) => ({ ...prev, [imp.id]: 'Enter a valid positive amount.' }));
      return;
    }

    setApplyingId(imp.id);
    try {
      const { labelFailed } = await applyEtransferImport(imp.id, {
        playerId: edit.playerId,
        amount,
        rememberMapping: edit.remember,
      });
      if (labelFailed) {
        setApplyWarning((prev) => ({
          ...prev,
          [imp.id]: 'Balance updated, but labelling the Gmail message "Processed" failed — you may want to label it manually so it isn\'t found again.',
        }));
      }
      await load();
    } catch (err) {
      setApplyError((prev) => ({ ...prev, [imp.id]: err instanceof Error ? err.message : 'Failed to apply.' }));
    } finally {
      setApplyingId(null);
    }
  };

  const handleConfirmReject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rejectTarget) return;
    if (!rejectReason.trim()) { setRejectError('Enter a reason for rejecting this.'); return; }
    setRejecting(true);
    setRejectError('');
    try {
      await rejectEtransferImport(rejectTarget.id, rejectReason);
      setRejectTarget(null);
      setRejectReason('');
      await load();
    } catch (err) {
      setRejectError(err instanceof Error ? err.message : 'Failed to reject.');
    } finally {
      setRejecting(false);
    }
  };

  const handleConfirmUndo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!undoTarget) return;
    if (!undoReason.trim()) { setUndoError('Enter a reason for undoing this.'); return; }
    setUndoing(true);
    setUndoError('');
    setUndoWarning('');
    try {
      const { labelFailed } = await undoEtransferImport(undoTarget.id, undoReason);
      if (labelFailed) {
        setUndoWarning('The import was reopened, but its Gmail label could not be removed. Remove the label manually in Gmail.');
      }
      setUndoTarget(null);
      setUndoReason('');
      await load();
    } catch (err) {
      setUndoError(err instanceof Error ? err.message : 'Failed to undo.');
    } finally {
      setUndoing(false);
    }
  };

  const handleMappingPlayerChange = async (mapping: EtransferSenderMapping, playerId: string) => {
    if (!playerId) return;
    setMappingError('');
    setMappingSavingId(mapping.id);
    try {
      await saveEtransferSenderMapping(mapping.senderEmail, mapping.senderName, playerId);
      setMappings((prev) => prev.map((m) => (m.id === mapping.id ? { ...m, playerId } : m)));
    } catch (err) {
      setMappingError(err instanceof Error ? err.message : 'Failed to update mapping.');
    } finally {
      setMappingSavingId(null);
    }
  };

  const handleDeleteMapping = async (mapping: EtransferSenderMapping) => {
    setMappingError('');
    setMappingSavingId(mapping.id);
    try {
      await deleteEtransferSenderMapping(mapping.id);
      setMappings((prev) => prev.filter((m) => m.id !== mapping.id));
    } catch (err) {
      setMappingError(err instanceof Error ? err.message : 'Failed to remove mapping.');
    } finally {
      setMappingSavingId(null);
    }
  };

  const sortedHistory = useMemo(
    () => [...history].sort((a, b) => (toJSDate(b.emailDate)?.getTime() ?? 0) - (toJSDate(a.emailDate)?.getTime() ?? 0)),
    [history]
  );

  if (!isAdmin) {
    return (
      <Container className="py-4">
        <Alert variant="warning">You must be a club admin to view this page.</Alert>
      </Container>
    );
  }

  if (loading) {
    return (
      <Container className="py-4 text-center">
        <Spinner animation="border" />
      </Container>
    );
  }

  return (
    <Container className="py-4">
      <h2>e-Transfer Import</h2>
      <p className="text-muted">
        Search Gmail for Interac e-Transfer autodeposit notifications, review the suggested player
        match and amount, then apply to credit their balance. Nothing is written to a player's
        balance — or labelled in Gmail — until you approve or reject each one below.
      </p>

      <Card className="mb-3">
        <Card.Body className="d-flex flex-wrap align-items-end gap-3">
          <Button onClick={handleSearch} disabled={searching || !searchAfterDate}>
            {searching ? <><Spinner size="sm" animation="border" className="me-2" />Connecting to Gmail…</> : 'Connect Gmail & Search'}
          </Button>
          <span className="text-muted small">Searching e-Transfers from: {senderAddress}</span>
          <Form.Group controlId="etransfer-search-after">
            <Form.Label className="small mb-1">Search emails after</Form.Label>
            <Form.Control
              type="date"
              size="sm"
              value={searchAfterDate}
              onChange={(e) => {
                setSearchAfterDate(e.target.value);
                setSearchDateMessage('');
              }}
              disabled={savingSearchDate}
            />
          </Form.Group>
          <Button
            size="sm"
            variant="outline-secondary"
            onClick={handleSaveSearchDate}
            disabled={savingSearchDate || !searchAfterDate}
          >
            {savingSearchDate ? <Spinner size="sm" animation="border" /> : 'Save date'}
          </Button>
          {searchDateMessage && <span className="text-success small">{searchDateMessage}</span>}
        </Card.Body>
        {(searchMessage || searchError) && (
          <Card.Body className="pt-0">
            {searchMessage && <Alert variant="info" className="mb-0 py-2">{searchMessage}</Alert>}
            {searchError && <Alert variant="danger" className="mb-0 py-2">{searchError}</Alert>}
          </Card.Body>
        )}
      </Card>

      {loadError && <Alert variant="danger">{loadError}</Alert>}
      {undoWarning && <Alert variant="warning">{undoWarning}</Alert>}

      <Card className="mb-4">
        <Card.Header>Pending review ({pending.length})</Card.Header>
        <Card.Body className="p-0">
          {pending.length === 0 ? (
            <p className="text-muted p-3 mb-0">Nothing to review — search Gmail to find new e-Transfers.</p>
          ) : (
            <Table responsive hover className="mb-0 align-middle">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Sender</th>
                  <th>Memo</th>
                  <th>Matched player</th>
                  <th>Amount</th>
                  <th>Remember?</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {pending.map((imp) => {
                  const edit = rowEdits[imp.id] ?? initialRowEdit(imp);
                  const emailDate = toJSDate(imp.emailDate);
                  return (
                    <tr key={imp.id}>
                      <td>{emailDate ? format(emailDate, 'MMM d, yyyy') : '—'}</td>
                      <td>
                        {imp.senderName}
                        {imp.matchSource === 'mapping' && (
                          <Badge bg="info" className="ms-2">remembered match</Badge>
                        )}
                      </td>
                      <td className="text-muted">{imp.memo || '—'}</td>
                      <td>
                        <Form.Select
                          size="sm"
                          value={edit.playerId}
                          onChange={(e) => updateRowEdit(imp.id, { playerId: e.target.value })}
                          disabled={applyingId === imp.id}
                        >
                          <option value="">— Select player —</option>
                          {players.map((p) => (
                            <option key={p.id} value={p.id}>{formatPlayerName(p)}</option>
                          ))}
                        </Form.Select>
                      </td>
                      <td>
                        <Form.Control
                          size="sm"
                          type="number"
                          step="0.01"
                          min="0"
                          style={{ width: 100 }}
                          value={edit.amount}
                          onChange={(e) => updateRowEdit(imp.id, { amount: e.target.value })}
                          disabled={applyingId === imp.id}
                        />
                      </td>
                      <td>
                        <Form.Check
                          type="checkbox"
                          checked={edit.remember}
                          onChange={(e) => updateRowEdit(imp.id, { remember: e.target.checked })}
                          disabled={applyingId === imp.id}
                          title={`Remember "${imp.senderName}" → this player for future imports`}
                        />
                      </td>
                      <td className="text-nowrap">
                        <Button
                          size="sm"
                          variant="success"
                          className="me-2"
                          disabled={applyingId === imp.id}
                          onClick={() => handleApply(imp)}
                        >
                          {applyingId === imp.id ? <Spinner size="sm" animation="border" /> : 'Approve'}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline-danger"
                          disabled={applyingId === imp.id}
                          onClick={() => { setRejectTarget(imp); setRejectReason(''); setRejectError(''); }}
                        >
                          Reject
                        </Button>
                        {applyError[imp.id] && (
                          <div className="text-danger small mt-1">{applyError[imp.id]}</div>
                        )}
                        {applyWarning[imp.id] && (
                          <div className="text-warning small mt-1">{applyWarning[imp.id]}</div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Card.Body>
      </Card>

      <Card>
        <Card.Header>History</Card.Header>
        <Card.Body className="p-0">
          {sortedHistory.length === 0 ? (
            <p className="text-muted p-3 mb-0">No reviewed imports yet.</p>
          ) : (
            <Table responsive hover className="mb-0 align-middle">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Sender</th>
                  <th>Player</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th>Note</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {sortedHistory.map((imp) => {
                  const emailDate = toJSDate(imp.emailDate);
                  return (
                    <tr key={imp.id}>
                      <td>{emailDate ? format(emailDate, 'MMM d, yyyy') : '—'}</td>
                      <td>{imp.senderName}</td>
                      <td>{playerName(imp.matchedPlayerId)}</td>
                      <td>{money(imp.appliedAmount ?? imp.amount)}</td>
                      <td>{statusBadge(imp.status)}</td>
                      <td className="text-muted small">
                        {imp.status === 'rejected' && imp.rejectionReason}
                        {imp.status === 'undone' && imp.undoneReason}
                      </td>
                      <td>
                        {['applied', 'rejected', 'undone'].includes(imp.status) && (
                          <Button
                            size="sm"
                            variant="outline-secondary"
                            onClick={() => { setUndoTarget(imp); setUndoReason(''); setUndoError(''); }}
                          >
                            Undo
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Card.Body>
      </Card>

      <Card className="mt-4">
        <Card.Header>Saved sender mappings</Card.Header>
        <Card.Body className="p-0">
          <p className="text-muted p-3 pb-0 mb-0">
            Remembered matches between a Gmail sender (their e-Transfer name/email, which may differ
            from their name in the app) and a player. Change the player or remove a mapping below —
            removing one just means that sender's next email will need to be matched again, either
            automatically by name or manually.
          </p>
          {mappingError && <Alert variant="danger" className="mx-3 mt-3 mb-0 py-2">{mappingError}</Alert>}
          {mappings.length === 0 ? (
            <p className="text-muted p-3 mb-0">No saved mappings yet.</p>
          ) : (
            <Table responsive hover className="mb-0 align-middle">
              <thead>
                <tr>
                  <th>Gmail sender name</th>
                  <th>Gmail sender email</th>
                  <th>Mapped player</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {mappings.map((mapping) => (
                  <tr key={mapping.id}>
                    <td>{mapping.senderName}</td>
                    <td className="text-muted">{mapping.senderEmail || '—'}</td>
                    <td>
                      <Form.Select
                        size="sm"
                        value={mapping.playerId}
                        disabled={mappingSavingId === mapping.id}
                        onChange={(e) => handleMappingPlayerChange(mapping, e.target.value)}
                        style={{ maxWidth: 220 }}
                      >
                        {players.map((p) => (
                          <option key={p.id} value={p.id}>{formatPlayerName(p)}</option>
                        ))}
                      </Form.Select>
                    </td>
                    <td>
                      <Button
                        size="sm"
                        variant="outline-danger"
                        disabled={mappingSavingId === mapping.id}
                        onClick={() => handleDeleteMapping(mapping)}
                      >
                        {mappingSavingId === mapping.id ? <Spinner size="sm" animation="border" /> : 'Remove'}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card.Body>
      </Card>

      <Modal show={!!rejectTarget} onHide={() => setRejectTarget(null)} centered>
        <Modal.Header closeButton>
          <Modal.Title>Reject e-Transfer import</Modal.Title>
        </Modal.Header>
        <Form onSubmit={handleConfirmReject}>
          <Modal.Body>
            {rejectTarget && (
              <p className="text-muted">
                This email ({money(rejectTarget.amount)} from {rejectTarget.senderName}) will be marked
                rejected and labelled "Rejected" in Gmail so it isn't found again. No balance is changed.
              </p>
            )}
            <Form.Group className="mb-3" controlId="etransfer-reject-reason">
              <Form.Label>Reason <span className="text-danger">*</span></Form.Label>
              <Form.Control
                as="textarea"
                rows={2}
                placeholder="e.g. not a club payment"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                disabled={rejecting}
                autoFocus
              />
            </Form.Group>
            {rejectError && <Alert variant="danger" className="py-2 mb-0">{rejectError}</Alert>}
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={() => setRejectTarget(null)} disabled={rejecting}>Cancel</Button>
            <Button variant="danger" type="submit" disabled={rejecting}>
              {rejecting ? <Spinner size="sm" animation="border" /> : 'Reject'}
            </Button>
          </Modal.Footer>
        </Form>
      </Modal>

      <Modal show={!!undoTarget} onHide={() => setUndoTarget(null)} centered>
        <Modal.Header closeButton>
          <Modal.Title>Undo e-Transfer import</Modal.Title>
        </Modal.Header>
        <Form onSubmit={handleConfirmUndo}>
          <Modal.Body>
            {undoTarget && (
              <p className="text-muted">
                {undoTarget.status === 'applied'
                  ? `${money(undoTarget.appliedAmount ?? undoTarget.amount)} will be reversed from ${playerName(undoTarget.matchedPlayerId)}'s balance. `
                  : 'No player balance will be changed. '}
                The import will return to pending review and its Gmail label will be removed. The
                original decision and ledger entries are kept for the audit record.
              </p>
            )}
            <Form.Group className="mb-3" controlId="etransfer-undo-reason">
              <Form.Label>Reason for undoing this <span className="text-danger">*</span></Form.Label>
              <Form.Control
                as="textarea"
                rows={2}
                placeholder="e.g. wrong player matched"
                value={undoReason}
                onChange={(e) => setUndoReason(e.target.value)}
                disabled={undoing}
                autoFocus
              />
            </Form.Group>
            {undoError && <Alert variant="danger" className="py-2 mb-0">{undoError}</Alert>}
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={() => setUndoTarget(null)} disabled={undoing}>Cancel</Button>
            <Button variant="warning" type="submit" disabled={undoing}>
              {undoing ? <Spinner size="sm" animation="border" /> : 'Undo'}
            </Button>
          </Modal.Footer>
        </Form>
      </Modal>
    </Container>
  );
}
