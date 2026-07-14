import React, { useState, useEffect, useCallback } from 'react';
import {
  Container, Row, Col, Card, Form, Button,
  ListGroup, Spinner, Alert, InputGroup,
  Dropdown, DropdownButton, Table, Badge,
} from 'react-bootstrap';
import {
  format, startOfMonth, endOfMonth, addMonths, subMonths, startOfYear, endOfYear,
} from 'date-fns';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import { useSearchParams, Link } from 'react-router-dom';

import { getMonthYear } from '../utils/dateUtils';
import AddPlayerModal from '../components/AddPlayerModal';
import ConfirmDialog from '../components/ConfirmDialog';
import { db, refs } from '../services/firebase';
import { addPlayer } from '../services/firebase/players';
import {
  collection, query, where, getDocs, orderBy,
  doc, runTransaction, increment, serverTimestamp, updateDoc, deleteDoc,
} from 'firebase/firestore';
import { useAppSelector } from '../hooks';
import {
  selectAllPlayers, selectPlayerById,
  selectPlayersStatus, selectPlayersError,
} from '../features/players/playersSlice';
import type { NewPlayerInput, Player, Session } from '../types';
import type { RootState } from '../store';

interface BalanceAdjustment {
  amount: string;
  reason: string;
  type:   'credit' | 'debit';
}

interface LedgerEntry {
  id:            string;
  delta:         number;
  balanceBefore: number;
  balanceAfter:  number;
  reason:        string;
  note:          string;
  createdAt:     { toDate: () => Date } | null;
  sessionId?:    string;
}

const INIT_BALANCE: BalanceAdjustment = { amount: '', reason: '', type: 'credit' };

function formatPlayerName(player: Pick<Player, 'firstName' | 'lastName'>): string {
  return [player.firstName, player.lastName].filter(Boolean).join(' ');
}

export default function PlayersPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  const playersList   = useAppSelector(selectAllPlayers);
  const playersStatus = useAppSelector(selectPlayersStatus);
  const playersError  = useAppSelector(selectPlayersError);
  const selectedPlayer = useAppSelector((s: RootState) =>
    searchParams.get('playerId') ? selectPlayerById(s, searchParams.get('playerId')!) : null
);
console.log("selectedPlayer ==> ", selectedPlayer);
  const selectedPlayerId = searchParams.get('playerId');

  const [searchTerm,         setSearchTerm]         = useState('');
  const [filteredPlayers,    setFilteredPlayers]     = useState<Player[]>(playersList);
  const [currentMonth,       setCurrentMonth]        = useState(new Date());
  const [attendedSessions,   setAttendedSessions]    = useState<Session[]>([]);
  console.log("attendedSessions ==> ", attendedSessions);
  const [isLoadingSessions,  setIsLoadingSessions]   = useState(false);
  const [sessionsError,      setSessionsError]       = useState('');
  const [sessionsThisYear,   setSessionsThisYear]    = useState(0);
  const [ledger,             setLedger]              = useState<LedgerEntry[]>([]);
  const [isLoadingLedger,    setIsLoadingLedger]     = useState(false);
  const [ledgerError,        setLedgerError]         = useState('');
  const [balanceAdjustment,  setBalanceAdjustment]   = useState<BalanceAdjustment>({ ...INIT_BALANCE });
  const [isUpdatingBalance,  setIsUpdatingBalance]   = useState(false);
  const [balanceError,       setBalanceError]        = useState('');
  const [showAddModal,       setShowAddModal]        = useState(false);
  const [showDeleteConfirm,  setShowDeleteConfirm]   = useState(false);
  const [isDeletingPlayer,   setIsDeletingPlayer]    = useState(false);
  const [deleteError,        setDeleteError]         = useState('');

  const setSelectedPlayerId = (id: string | null) => {
    const next = new URLSearchParams(searchParams);
    if (id) next.set('playerId', id); else next.delete('playerId');
    setSearchParams(next);
  };

  // Filter
  useEffect(() => {
    if (!searchTerm.trim()) { setFilteredPlayers(playersList); return; }
    const term = searchTerm.toLowerCase();
    setFilteredPlayers(playersList.filter(p =>
      p.firstName.toLowerCase().includes(term) ||
      (p.lastName ?? '').toLowerCase().includes(term)
    ));
  }, [searchTerm, playersList]);

  // Balance ledger
  const fetchLedger = useCallback(async (playerId: string) => {
    setIsLoadingLedger(true);
    setLedgerError('');
    try {
      const q = query(
        collection(db, 'balanceLedger'),
        where('playerId', '==', playerId),
      );
      const snap = await getDocs(q);
      const entries = snap.docs.map(d => ({ id: d.id, ...d.data() } as LedgerEntry));
      // Sort client-side to avoid needing a composite (playerId + createdAt) index.
      entries.sort((a, b) => (b.createdAt?.toDate().getTime() ?? 0) - (a.createdAt?.toDate().getTime() ?? 0));
      setLedger(entries);
    } catch {
      setLedgerError('Failed to load balance history.');
    } finally {
      setIsLoadingLedger(false);
    }
  }, []);

  // Sessions attended in the current calendar year (for the player detail stat).
  useEffect(() => {
    if (!selectedPlayerId) { setSessionsThisYear(0); return; }
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDocs(query(
          refs.sessions,
          where('date', '>=', startOfYear(new Date())),
          where('date', '<=', endOfYear(new Date())),
        ));
        const count = snap.docs
          .map(d => d.data())
          .filter((s: any) => Array.isArray(s.players) && s.players.some((p: any) => p.id === selectedPlayerId))
          .length;
        if (!cancelled) setSessionsThisYear(count);
      } catch {
        if (!cancelled) setSessionsThisYear(0);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPlayerId]);

  // Attended sessions
  const fetchAttendedSessions = useCallback(async () => {
    if (!selectedPlayerId) { setAttendedSessions([]); return; }
    setIsLoadingSessions(true);
    setSessionsError('');
    try {
      const q = query(
        refs.sessions,
        where('date', '>=', startOfMonth(currentMonth)),
        where('date', '<=', endOfMonth(currentMonth)),
        orderBy('date', 'desc'),
      );
      const snap = await getDocs(q);
      const all  = snap.docs.map(d => ({ id: d.id, ...d.data() })) as Session[];
      setAttendedSessions(all.filter(s =>
        Array.isArray(s.players) && s.players.some(p => p.id === selectedPlayerId)
      ));
    } catch {
      setSessionsError('Failed to load sessions.');
    } finally {
      setIsLoadingSessions(false);
    }
  }, [selectedPlayerId, currentMonth]);

  useEffect(() => {
    if (selectedPlayerId) {
      fetchLedger(selectedPlayerId);
      fetchAttendedSessions();
    } else {
      setLedger([]);
      setAttendedSessions([]);
    }
  }, [selectedPlayerId, fetchLedger, fetchAttendedSessions]);

  // Balance adjustment
  const handleBalanceSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPlayer) return;

    const amount = parseFloat(balanceAdjustment.amount);
    if (isNaN(amount) || amount === 0) { setBalanceError('Enter a valid non-zero amount.'); return; }
    if (!balanceAdjustment.reason.trim()) { setBalanceError('Reason is required.'); return; }

    setIsUpdatingBalance(true);
    setBalanceError('');
    const delta = balanceAdjustment.type === 'credit' ? amount : -amount;

    try {
      await runTransaction(db, async tx => {
        const playerRef  = doc(refs.players, selectedPlayer.id);
        const playerSnap = await tx.get(playerRef);
        if (!playerSnap.exists()) throw new Error('Player not found.');
        const before = playerSnap.data().balance ?? 0;
        tx.update(playerRef, { balance: increment(delta) });
        tx.set(doc(collection(db, 'balanceLedger')), {
          playerId:      selectedPlayer.id,
          sessionId:     null,
          delta,
          balanceBefore: before,
          balanceAfter:  before + delta,
          reason:        'manual',
          note:          balanceAdjustment.reason.trim(),
          createdAt:     serverTimestamp(),
        });
      });
      setBalanceAdjustment({ ...INIT_BALANCE });
      await fetchLedger(selectedPlayer.id);
    } catch (err: unknown) {
      setBalanceError(err instanceof Error ? err.message : 'Failed to update balance.');
    } finally {
      setIsUpdatingBalance(false);
    }
  };

  // Delete player
  const handleDeletePlayer = async () => {
    if (!selectedPlayer) return;
    setIsDeletingPlayer(true);
    setDeleteError('');
    try {
      await deleteDoc(doc(refs.players, selectedPlayer.id));
      setSelectedPlayerId(null);
      setShowDeleteConfirm(false);
    } catch (err: unknown) {
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete player.');
    } finally {
      setIsDeletingPlayer(false);
    }
  };

  // Add player
  const handleAddPlayer = async (data: NewPlayerInput) => {
    const id = await addPlayer(data);
    setSelectedPlayerId(id);
    setShowAddModal(false);
  };

  const getDeltaLabel = (reason: string) => {
    const map: Record<string, string> = {
      session_add:  'Session',
      session_edit: 'Edit',
      payment:      'Payment',
      manual:       'Manual',
    };
    return map[reason] ?? reason;
  };

  return (
    <Container fluid className="mt-4">
      <Row className="mb-3">
        <Col className="text-end">
          <Button variant="success" onClick={() => setShowAddModal(true)}>+ Add New Player</Button>
        </Col>
      </Row>
      <Row>
        {/* Player list */}
        <Col md={4} className="mb-3">
          <Card>
            <Card.Header>Players</Card.Header>
            <Card.Body>
              <Form.Control
                type="text"
                placeholder="Search by name…"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="mb-2"
              />
              {playersStatus === 'loading' && playersList.length === 0 && (
                <div className="text-center"><Spinner animation="border" size="sm" /></div>
              )}
              {playersStatus === 'failed' && (
                <Alert variant="danger" className="small">{playersError}</Alert>
              )}
              <ListGroup style={{ maxHeight: 'calc(100vh - 280px)', overflowY: 'auto' }}>
                {filteredPlayers.map(player => (
                  <ListGroup.Item
                    key={player.id}
                    action
                    active={selectedPlayerId === player.id}
                    onClick={() => setSelectedPlayerId(player.id)}
                    className="d-flex justify-content-between align-items-center"
                  >
                    <span>{formatPlayerName(player)}</span>
                    {player.balance < 0 && (
                      <Badge bg="danger" style={{ fontSize: 10 }}>
                        ${Math.abs(player.balance).toFixed(0)} owed
                      </Badge>
                    )}
                  </ListGroup.Item>
                ))}
                {filteredPlayers.length === 0 && searchTerm && (
                  <ListGroup.Item className="text-muted small">
                    No players matching "{searchTerm}"
                  </ListGroup.Item>
                )}
              </ListGroup>
            </Card.Body>
          </Card>
        </Col>

        {/* Player detail */}
        <Col md={8}>
          {!selectedPlayer ? (
            <Card>
              <Card.Body className="text-center text-muted p-5">
                Select a player to view details.
              </Card.Body>
            </Card>
          ) : (
            <>
              {deleteError && <Alert variant="danger" className="mb-3">{deleteError}</Alert>}

              {/* Balance card */}
              <Card className="mb-3">
                <Card.Header className="d-flex justify-content-between align-items-center">
                  <h5 className="mb-0">{formatPlayerName(selectedPlayer)}</h5>
                  <Button
                    variant="outline-danger"
                    size="sm"
                    onClick={() => setShowDeleteConfirm(true)}
                  >
                    Remove Player
                  </Button>
                </Card.Header>
                <Card.Body>
                  <Row>
                    <Col md={6}>
                      <h5>Balance</h5>
                      <h4>
                        <span className={selectedPlayer.balance >= 0 ? 'text-success' : 'text-danger'}>
                          ${(selectedPlayer.balance ?? 0).toFixed(2)}
                        </span>
                        <small className="text-muted ms-2" style={{ fontSize: 13 }}>
                          {selectedPlayer.balance > 0 ? '(Credit)'
                            : selectedPlayer.balance < 0 ? '(Owes)' : ''}
                        </small>
                      </h4>
                      <p className="small text-muted mb-0">
                        Total Sessions attended: {selectedPlayer.sessionCount ?? 0}
                      </p>
                      <p className="small text-muted mb-0">
                        Sessions attended in {new Date().getFullYear()}: {sessionsThisYear}
                      </p>
                      {selectedPlayer.description && (
                        <p className="small text-muted mt-1">{selectedPlayer.description}</p>
                      )}
                    </Col>

                    <Col md={6}>
                      <h5>Adjust Balance</h5>
                      {balanceError && <Alert variant="danger" className="small py-1">{balanceError}</Alert>}
                      <Form onSubmit={handleBalanceSubmit}>
                        <InputGroup className="mb-2">
                          <DropdownButton
                            variant="outline-secondary"
                            title={balanceAdjustment.type === 'credit' ? 'Add (+)' : 'Deduct (-)'}
                          >
                            <Dropdown.Item onClick={() => setBalanceAdjustment(p => ({ ...p, type: 'credit' }))}>
                              Add to balance (+)
                            </Dropdown.Item>
                            <Dropdown.Item onClick={() => setBalanceAdjustment(p => ({ ...p, type: 'debit' }))}>
                              Deduct from balance (-)
                            </Dropdown.Item>
                          </DropdownButton>
                          <Form.Control
                            type="number" placeholder="Amount" min="0.01" step="0.01"
                            value={balanceAdjustment.amount}
                            onChange={e => setBalanceAdjustment(p => ({ ...p, amount: e.target.value }))}
                            required
                          />
                        </InputGroup>
                        <Form.Control
                          type="text"
                          placeholder="Reason (e.g., Cash Payment)"
                          value={balanceAdjustment.reason}
                          onChange={e => setBalanceAdjustment(p => ({ ...p, reason: e.target.value }))}
                          className="mb-2"
                          required
                        />
                        <Button type="submit" variant="primary" size="sm" disabled={isUpdatingBalance}>
                          {isUpdatingBalance
                            ? <Spinner as="span" size="sm" animation="border" />
                            : 'Update Balance'}
                        </Button>
                      </Form>
                    </Col>
                  </Row>
                </Card.Body>
              </Card>

              {/* Balance history */}
              <Card className="mb-3">
                <Card.Header><h5 className="mb-0">Balance History</h5></Card.Header>
                <Card.Body style={{ maxHeight: 260, overflowY: 'auto' }}>
                  {isLoadingLedger && (
                    <div className="text-center"><Spinner animation="border" size="sm" /></div>
                  )}
                  {ledgerError && <Alert variant="danger" className="small">{ledgerError}</Alert>}
                  {!isLoadingLedger && ledger.length === 0 && (
                    <p className="text-muted small mb-0">No balance history yet.</p>
                  )}
                  {!isLoadingLedger && ledger.length > 0 && (
                    <Table size="sm" borderless className="mb-0">
                      <thead>
                        <tr className="small text-muted">
                          <th>Date</th>
                          <th>Type</th>
                          <th>Note</th>
                          <th className="text-end">Change</th>
                          <th className="text-end">Balance</th>
                        </tr>
                      </thead>
                      <tbody>
                        {ledger.map(entry => (
                          <tr key={entry.id} style={{ fontSize: 13 }}>
                            <td className="text-muted">
                              {entry.createdAt?.toDate
                                ? format(entry.createdAt.toDate(), 'MMM d, yy')
                                : '—'}
                            </td>
                            <td>
                              <Badge
                                bg={entry.reason === 'payment' ? 'success'
                                  : entry.reason === 'session_add' ? 'secondary'
                                  : 'light'}
                                text={entry.reason === 'payment' || entry.reason === 'session_add'
                                  ? undefined : 'dark'}
                                style={{ fontSize: 10 }}
                              >
                                {getDeltaLabel(entry.reason)}
                              </Badge>
                            </td>
                            <td className="text-muted" style={{ maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {entry.note}
                            </td>
                            <td className={`text-end ${entry.delta >= 0 ? 'text-success' : 'text-danger'}`}>
                              {entry.delta >= 0 ? '+' : ''}{entry.delta.toFixed(2)}
                            </td>
                            <td className="text-end">
                              ${entry.balanceAfter.toFixed(2)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </Table>
                  )}
                </Card.Body>
              </Card>

              {/* Sessions this month */}
              <Card>
                <Card.Header>
                  <Row className="align-items-center">
                    <Col><h5 className="mb-0">Sessions — {getMonthYear(currentMonth)}</h5></Col>
                    <Col xs="auto">
                      <Button variant="outline-secondary" size="sm"
                        onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}>&lt;</Button>
                    </Col>
                    <Col xs="auto" style={{ width: 160 }}>
                      <DatePicker
                        selected={currentMonth}
                        onChange={(d: Date | null) => { if (d) setCurrentMonth(d); }}
                        dateFormat="MMMM yyyy"
                        showMonthYearPicker
                        className="form-control form-control-sm text-center"
                      />
                    </Col>
                    <Col xs="auto">
                      <Button variant="outline-secondary" size="sm"
                        onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}>&gt;</Button>
                    </Col>
                  </Row>
                </Card.Header>
                <Card.Body>
                  {isLoadingSessions && (
                    <div className="text-center"><Spinner animation="border" size="sm" /></div>
                  )}
                  {sessionsError && <Alert variant="danger">{sessionsError}</Alert>}
                  {!isLoadingSessions && attendedSessions.length === 0 && (
                    <p className="text-muted small">No sessions attended this month.</p>
                  )}
                  {!isLoadingSessions && attendedSessions.length > 0 && (
                    <ListGroup variant="flush" style={{ maxHeight: 200, overflowY: 'auto' }}>
                      {attendedSessions.map(s => {
                        const playerInSession = s.players.find(p => p.id === selectedPlayerId);
                        const sessionDate =
                          s.date instanceof Date
                            ? s.date
                            : (s.date as any)?.toDate?.() ?? (s.date ? new Date(s.date as any) : null);
                        return (
                          <ListGroup.Item key={s.id}>
                            <div className="d-flex justify-content-between align-items-center">
                              <div>
                                {sessionDate ? (
                                  <Link to={`/?date=${format(sessionDate, 'yyyy-MM-dd')}`} className="fw-bold">
                                    {format(sessionDate, 'MMM d, yyyy')}
                                  </Link>
                                ) : (
                                  <strong>—</strong>
                                )}
                                {s.location && <span className="text-muted small ms-2">at {s.location}</span>}
                              </div>
                              <div className="text-end">
                                <div>${playerInSession?.cost?.toFixed(2) ?? 'N/A'}</div>
                                {playerInSession && (
                                  <Badge bg={playerInSession.paid ? 'success' : 'danger'} style={{ fontSize: 10 }}>
                                    {playerInSession.paid ? 'Paid' : 'Unpaid'}
                                  </Badge>
                                )}
                              </div>
                            </div>
                          </ListGroup.Item>
                        );
                      })}
                    </ListGroup>
                  )}
                </Card.Body>
              </Card>
            </>
          )}
        </Col>
      </Row>

      <AddPlayerModal
        show={showAddModal}
        onHide={() => setShowAddModal(false)}
        onAddPlayer={handleAddPlayer}
        existingPlayers={playersList}
      />

      <ConfirmDialog
        show={showDeleteConfirm}
        title="Remove Player"
        message={`Remove ${selectedPlayer ? formatPlayerName(selectedPlayer) : 'this player'}? Their session history will remain but they will be removed from the players list.`}
        confirmLabel="Remove"
        confirmVariant="danger"
        onConfirm={handleDeletePlayer}
        onCancel={() => setShowDeleteConfirm(false)}
        isLoading={isDeletingPlayer}
      />
    </Container>
  );
}