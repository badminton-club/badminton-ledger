import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Container, Row, Col, Card, Form, Button, ButtonGroup,
  ListGroup, Spinner, Alert, InputGroup,
  Dropdown, DropdownButton, Table, Badge, Modal,
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
import {
  db, refs, fetchSessionById, setPlayerSettlement, setPlayerPaidBy,
} from '../services/firebase';
import { addPlayer, updatePlayerProfile, deletePlayer } from '../services/firebase/players';
import {
  query, where, getDocs, orderBy,
  doc, runTransaction, increment, serverTimestamp,
} from 'firebase/firestore';
import { useAppSelector } from '../hooks';
import {
  selectAllPlayers, selectPlayerById,
  selectPlayersStatus, selectPlayersError,
} from '../features/players/playersSlice';
import { selectDisabledTabs } from '../features/club/clubSlice';
import type { NewPlayerInput, PaidVia, Player, Session } from '../types';
import type { RootState } from '../store';

interface BalanceAdjustment {
  amount: string;
  reason: string;
  type:   'credit' | 'debit';
  includeInPayout: boolean;
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
  walletAdjustment?: boolean;
  voided?:       boolean;
  voidedNote?:   string;
}

type PlayerSort = 'name' | 'owed' | 'overdrawn';

const INIT_BALANCE: BalanceAdjustment = { amount: '', reason: '', type: 'credit', includeInPayout: true };

// Common top-up amounts shown as one-tap shortcuts in the Adjust Balance form.
const QUICK_ADD_AMOUNTS = [10, 20, 50, 100];

// Common reasons shown as one-tap shortcuts in the Adjust Balance form.
const QUICK_REASONS = ['Cash Payment', 'E-Transfer Payment'];

function formatPlayerName(player: Pick<Player, 'firstName' | 'lastName'>): string {
  return [player.firstName, player.lastName].filter(Boolean).join(' ');
}

function comparePlayerNames(a: Player, b: Player): number {
  return formatPlayerName(a).localeCompare(formatPlayerName(b), undefined, { sensitivity: 'base' });
}

function comparePlayers(a: Player, b: Player, sort: PlayerSort): number {
  if (sort === 'owed') {
    const aOwed = a.owed ?? 0;
    const bOwed = b.owed ?? 0;
    if ((aOwed > 0) !== (bOwed > 0)) return aOwed > 0 ? -1 : 1;
    if (aOwed > 0 && aOwed !== bOwed) return bOwed - aOwed;
    if ((a.balance < 0) !== (b.balance < 0)) return a.balance < 0 ? -1 : 1;
  }

  if (sort === 'overdrawn') {
    if ((a.balance < 0) !== (b.balance < 0)) return a.balance < 0 ? -1 : 1;
    if (a.balance < 0 && a.balance !== b.balance) return a.balance - b.balance;
    const aOwed = a.owed ?? 0;
    const bOwed = b.owed ?? 0;
    if ((aOwed > 0) !== (bOwed > 0)) return aOwed > 0 ? -1 : 1;
  }

  return comparePlayerNames(a, b);
}

export default function PlayersPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  const playersList   = useAppSelector(selectAllPlayers);
  const playersStatus = useAppSelector(selectPlayersStatus);
  const playersError  = useAppSelector(selectPlayersError);
  const disabledTabs  = useAppSelector(selectDisabledTabs);
  const selectedPlayer = useAppSelector((s: RootState) =>
    searchParams.get('playerId') ? selectPlayerById(s, searchParams.get('playerId')!) : null
);
  const selectedPlayerId = searchParams.get('playerId');

  const [searchTerm,         setSearchTerm]         = useState('');
  const [playerSort,         setPlayerSort]         = useState<PlayerSort>('name');
  const [filteredPlayers,    setFilteredPlayers]     = useState<Player[]>(playersList);
  const [currentMonth,       setCurrentMonth]        = useState(new Date());
  const [attendedSessions,   setAttendedSessions]    = useState<Session[]>([]);
  const [isLoadingSessions,  setIsLoadingSessions]   = useState(false);
  const [sessionsError,      setSessionsError]       = useState('');
  const [sessionsThisYear,   setSessionsThisYear]    = useState(0);
  const [ledger,             setLedger]              = useState<LedgerEntry[]>([]);
  const [isLoadingLedger,    setIsLoadingLedger]     = useState(false);
  const [ledgerError,        setLedgerError]         = useState('');
  const [linkedSessionsById, setLinkedSessionsById] = useState<Record<string, Session>>({});
  const [selectedLedgerSessionId, setSelectedLedgerSessionId] = useState<string | null>(null);
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

  // Filter and sort
  useEffect(() => {
    const term = searchTerm.toLowerCase();
    const matchingPlayers = searchTerm.trim()
      ? playersList.filter(p =>
          p.firstName.toLowerCase().includes(term) ||
          (p.lastName ?? '').toLowerCase().includes(term)
        )
      : playersList;
    setFilteredPlayers([...matchingPlayers].sort((a, b) => comparePlayers(a, b, playerSort)));
  }, [searchTerm, playerSort, playersList]);

  // Balance ledger
  // Guards against rapid player switches: an older in-flight request resolving
  // after a newer one has started must never overwrite the newer request's
  // result (or its loading/error state) with stale data.
  const ledgerRequestSeqRef = useRef(0);
  const fetchLedger = useCallback(async (playerId: string, opts?: { silent?: boolean }) => {
    const seq = ++ledgerRequestSeqRef.current;
    if (!opts?.silent) setIsLoadingLedger(true);
    setLedgerError('');
    try {
      const q = query(
        refs.balanceLedger,
        where('playerId', '==', playerId),
      );
      const snap = await getDocs(q);
      if (seq !== ledgerRequestSeqRef.current) return; // superseded by a newer request
      const entries = snap.docs.map(d => ({ id: d.id, ...d.data() } as LedgerEntry));
      // Sort client-side to avoid needing a composite (playerId + createdAt) index.
      entries.sort((a, b) => (b.createdAt?.toDate().getTime() ?? 0) - (a.createdAt?.toDate().getTime() ?? 0));
      setLedger(entries);

      // Session details are supplementary to the ledger, so a deleted linked
      // session must not prevent the balance history itself from loading.
      const sessionIds = [...new Set(
        entries.map(e => e.sessionId).filter((id): id is string => !!id)
      )];
      if (sessionIds.length > 0) {
        const results = await Promise.allSettled(sessionIds.map(fetchSessionById));
        if (seq !== ledgerRequestSeqRef.current) return; // superseded by a newer request
        const sessions: Record<string, Session> = {};
        results.forEach((result) => {
          if (result.status === 'fulfilled') sessions[result.value.id] = result.value;
        });
        setLinkedSessionsById(sessions);
      } else {
        setLinkedSessionsById({});
      }
    } catch {
      if (seq === ledgerRequestSeqRef.current) setLedgerError('Failed to load balance history.');
    } finally {
      if (!opts?.silent && seq === ledgerRequestSeqRef.current) setIsLoadingLedger(false);
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
  const sessionsRequestSeqRef = useRef(0);
  const fetchAttendedSessions = useCallback(async (opts?: { silent?: boolean }) => {
    const seq = ++sessionsRequestSeqRef.current;
    if (!selectedPlayerId) { setAttendedSessions([]); return; }
    if (!opts?.silent) setIsLoadingSessions(true);
    setSessionsError('');
    try {
      const q = query(
        refs.sessions,
        where('date', '>=', startOfMonth(currentMonth)),
        where('date', '<=', endOfMonth(currentMonth)),
        orderBy('date', 'desc'),
      );
      const snap = await getDocs(q);
      if (seq !== sessionsRequestSeqRef.current) return; // superseded by a newer request
      const all  = snap.docs.map(d => ({ id: d.id, ...d.data() })) as Session[];
      setAttendedSessions(all.filter(s =>
        Array.isArray(s.players) && s.players.some(p => p.id === selectedPlayerId)
      ));
    } catch {
      if (seq === sessionsRequestSeqRef.current) setSessionsError('Failed to load sessions.');
    } finally {
      if (!opts?.silent && seq === sessionsRequestSeqRef.current) setIsLoadingSessions(false);
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

  const handleSetSettlement = async (sessionId: string, method: PaidVia) => {
    if (!selectedPlayerId) return;
    setSessionsError('');
    try {
      await setPlayerSettlement(sessionId, selectedPlayerId, method);
      // Refresh silently so the list doesn't collapse and jump the page to the top.
      await fetchAttendedSessions({ silent: true });
      await fetchLedger(selectedPlayerId, { silent: true });
    } catch (err) {
      setSessionsError(err instanceof Error ? err.message : 'Failed to update settlement.');
    }
  };

  const handleSetPaidBy = async (sessionId: string, payerId: string) => {
    if (!selectedPlayerId) return;
    setSessionsError('');
    try {
      await setPlayerPaidBy(sessionId, selectedPlayerId, payerId);
      await fetchAttendedSessions({ silent: true });
      await fetchLedger(selectedPlayerId, { silent: true });
    } catch (err) {
      setSessionsError(err instanceof Error ? err.message : 'Failed to update settlement.');
    }
  };

  // Balance adjustment
  const handleBalanceSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPlayer) return;

    const amount = parseFloat(balanceAdjustment.amount);
    if (isNaN(amount) || amount <= 0) { setBalanceError('Enter a valid positive amount.'); return; }
    if (!balanceAdjustment.reason.trim()) { setBalanceError('Reason is required.'); return; }

    const delta = balanceAdjustment.type === 'credit' ? amount : -amount;
    const projectedBalance = (selectedPlayer.balance ?? 0) + delta;
    if (delta < 0 && projectedBalance < 0) {
      const ok = window.confirm(
        `${formatPlayerName(selectedPlayer)} has $${(selectedPlayer.balance ?? 0).toFixed(2)} — ` +
        `deducting $${amount.toFixed(2)} will leave them at $${projectedBalance.toFixed(2)} (negative). Continue?`
      );
      if (!ok) return;
    }

    setIsUpdatingBalance(true);
    setBalanceError('');
    // The checkbox itself is hidden (not just disabled) when the Payout tab is
    // off, so its stale value must never leak into the write — force exclusion
    // whenever the admin never had the option to see/set it.
    const includeInPayout = !disabledTabs.includes('payout') && balanceAdjustment.includeInPayout;

    try {
      await runTransaction(db, async tx => {
        const playerRef  = doc(refs.players, selectedPlayer.id);
        const playerSnap = await tx.get(playerRef);
        if (!playerSnap.exists()) throw new Error('Player not found.');
        const before = playerSnap.data().balance ?? 0;
        tx.update(playerRef, { balance: increment(delta) });
        tx.set(doc(refs.balanceLedger), {
          playerId:      selectedPlayer.id,
          sessionId:     null,
          delta,
          balanceBefore: before,
          balanceAfter:  before + delta,
          // 'manual' counts toward the owner payout; 'manual-excluded' is a balance
          // change the club doesn't owe the owner (e.g. correcting an error).
          reason:        includeInPayout ? 'manual' : 'manual-excluded',
          note:          balanceAdjustment.reason.trim(),
          walletAdjustment: true, // this entry actually moves the player's prepaid balance
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
      await deletePlayer(selectedPlayer.id);
      setSelectedPlayerId(null);
      setShowDeleteConfirm(false);
    } catch (err: unknown) {
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete player.');
    } finally {
      setIsDeletingPlayer(false);
    }
  };

  // Edit player details (name / email)
  const [editingDetails, setEditingDetails] = useState(false);
  const [edFirst, setEdFirst] = useState('');
  const [edLast, setEdLast] = useState('');
  const [edEmail, setEdEmail] = useState('');
  const [savingDetails, setSavingDetails] = useState(false);
  const [detailsError, setDetailsError] = useState('');

  const startEditDetails = () => {
    if (!selectedPlayer) return;
    setEdFirst(selectedPlayer.firstName ?? '');
    setEdLast(selectedPlayer.lastName ?? '');
    setEdEmail(selectedPlayer.email ?? '');
    setDetailsError('');
    setEditingDetails(true);
  };

  const handleSaveDetails = async () => {
    if (!selectedPlayer) return;
    const first = edFirst.trim();
    if (!first) { setDetailsError('First name is required.'); return; }
    setDetailsError('');
    setSavingDetails(true);
    try {
      await updatePlayerProfile(selectedPlayer.id, { firstName: first, lastName: edLast.trim() || null, email: edEmail.trim() || null });
      setEditingDetails(false);
    } catch (err) {
      setDetailsError(err instanceof Error ? err.message : 'Failed to save details.');
    } finally {
      setSavingDetails(false);
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
      session:           'Session',
      session_add:       'Session',
      'session-edit':    'Edit',
      session_edit:      'Edit',
      'session-deleted': 'Session removed',
      payment:           'Payment',
      comp:              'Comp',
      // 'settlement' is logged when an admin manually switches a player's
      // settlement method after the session was created (vs. 'session', logged
      // automatically at session-creation time) — same kind of event from the
      // player's perspective, so it's shown with the same "Session" label.
      settlement:        'Session',
      manual:            'Manual',
      'manual-excluded': 'Manual (off payout)',
    };
    return map[reason] ?? reason;
  };

  // The Balance History shows prepaid-wallet movements only. e-Transfer/comp
  // settlements never touch the wallet, so they belong in the payout ledger, not
  // here — same for a custom payout transaction that's tied to a player only for
  // record-keeping (walletAdjustment === false), since it never moves their balance.
  const walletLedger = ledger.filter(e =>
    e.reason !== 'payment' && e.reason !== 'comp' && e.walletAdjustment !== false
  );
  const selectedLedgerSession = selectedLedgerSessionId
    ? linkedSessionsById[selectedLedgerSessionId] ?? null
    : null;
  const selectedLedgerSessionPlayer = selectedLedgerSession?.players.find(
    player => player.id === selectedPlayerId
  );

  return (
    <Container fluid className="mt-4 pb-4">
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
              <Row className="g-2 mb-2">
                <Col>
                  <Form.Control
                    type="text"
                    placeholder="Search by name…"
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                  />
                </Col>
                <Col xs="auto">
                  <Form.Select
                    aria-label="Sort players"
                    value={playerSort}
                    onChange={e => setPlayerSort(e.target.value as PlayerSort)}
                  >
                    <option value="name">Name</option>
                    <option value="owed">Owed first</option>
                    <option value="overdrawn">Overdrawn first</option>
                  </Form.Select>
                </Col>
              </Row>
              {playersStatus === 'loading' && playersList.length === 0 && (
                <div className="text-center"><Spinner animation="border" size="sm" /></div>
              )}
              {playersStatus === 'failed' && (
                <Alert variant="danger" className="small">{playersError}</Alert>
              )}
              <ListGroup style={{ maxHeight: 'calc(100vh - 280px)', overflowY: 'auto' }}>
                {filteredPlayers.map((player, i) => (
                  <ListGroup.Item
                    key={player.id}
                    action
                    active={selectedPlayerId === player.id}
                    onClick={() => setSelectedPlayerId(player.id)}
                    className="d-flex justify-content-between align-items-center"
                    style={
                      selectedPlayerId !== player.id && i % 2 === 1
                        ? { backgroundColor: 'var(--color-background-secondary)' }
                        : undefined
                    }
                  >
                    <span>{formatPlayerName(player)}</span>
                    <span className="d-flex flex-column align-items-end gap-1">
                      {player.balance < 0 && (
                        <Badge bg="warning" text="dark" style={{ fontSize: 10 }}>
                          Overdrawn ${Math.abs(player.balance).toFixed(2)}
                        </Badge>
                      )}
                      {(player.owed ?? 0) > 0 && (
                        <Badge bg="danger" style={{ fontSize: 10 }}>
                          ${(player.owed ?? 0).toFixed(2)} owed
                        </Badge>
                      )}
                    </span>
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
                  <div className="d-flex gap-2">
                    <Button variant="outline-secondary" size="sm" onClick={startEditDetails}>
                      Edit
                    </Button>
                    <Button
                      variant="outline-danger"
                      size="sm"
                      onClick={() => setShowDeleteConfirm(true)}
                    >
                      Remove Player
                    </Button>
                  </div>
                </Card.Header>
                <Card.Body>
                  {editingDetails && (
                    <div className="mb-3 p-3 border rounded">
                      {detailsError && <Alert variant="danger" className="small py-1">{detailsError}</Alert>}
                      <Row>
                        <Col md={6}>
                          <Form.Group className="mb-2" controlId="players-edit-first-name">
                            <Form.Label>First name</Form.Label>
                            <Form.Control value={edFirst} onChange={(e) => setEdFirst(e.target.value)} disabled={savingDetails} />
                          </Form.Group>
                        </Col>
                        <Col md={6}>
                          <Form.Group className="mb-2" controlId="players-edit-last-name">
                            <Form.Label>Last name</Form.Label>
                            <Form.Control value={edLast} onChange={(e) => setEdLast(e.target.value)} disabled={savingDetails} />
                          </Form.Group>
                        </Col>
                      </Row>
                      <Form.Group className="mb-2" controlId="players-edit-email">
                        <Form.Label>Email</Form.Label>
                        <Form.Control type="email" value={edEmail} onChange={(e) => setEdEmail(e.target.value)} disabled={savingDetails} />
                      </Form.Group>
                      <div className="d-flex gap-2">
                        <Button size="sm" variant="primary" onClick={handleSaveDetails} disabled={savingDetails || !edFirst.trim()}>
                          {savingDetails ? <Spinner size="sm" animation="border" /> : 'Save'}
                        </Button>
                        <Button size="sm" variant="secondary" onClick={() => setEditingDetails(false)} disabled={savingDetails}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  )}
                  <Row>
                    <Col md={6}>
                      <h5>Balance</h5>
                      <h4>
                        <span className={selectedPlayer.balance >= 0 ? 'text-success' : 'text-danger'}>
                          ${(selectedPlayer.balance ?? 0).toFixed(2)}
                        </span>
                        <small className="text-muted ms-2" style={{ fontSize: 13 }}>
                          {selectedPlayer.balance > 0 ? '(Prepaid credit)'
                            : selectedPlayer.balance < 0 ? '(Overdrawn)' : ''}
                        </small>
                      </h4>
                      <h5 className="mb-0">Owed for sessions</h5>
                      <h4>
                        <span className={(selectedPlayer.owed ?? 0) > 0 ? 'text-danger' : 'text-success'}>
                          ${(selectedPlayer.owed ?? 0).toFixed(2)}
                        </span>
                      </h4>
                      <p className="small text-muted mb-0 mt-1">
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
                        <div className="d-flex gap-2 mb-2">
                          {QUICK_ADD_AMOUNTS.map(quickAmount => (
                            <Button
                              key={quickAmount}
                              type="button"
                              size="sm"
                              variant="outline-primary"
                              onClick={() => setBalanceAdjustment(p => {
                                // Stacks onto whatever's already entered while adding (e.g. clicking
                                // +10 twice gives 20); switching from a deduction starts fresh instead
                                // of subtracting from it.
                                const current = p.type === 'credit' ? parseFloat(p.amount) : 0;
                                const base = isNaN(current) ? 0 : current;
                                return { ...p, type: 'credit', amount: String(base + quickAmount) };
                              })}
                            >
                              +{quickAmount}
                            </Button>
                          ))}
                        </div>
                        <Form.Control
                          type="text"
                          placeholder="Reason (e.g., Cash Payment)"
                          value={balanceAdjustment.reason}
                          onChange={e => setBalanceAdjustment(p => ({ ...p, reason: e.target.value }))}
                          className="mb-2"
                          required
                        />
                        <div className="d-flex gap-2 mb-2">
                          {QUICK_REASONS.map(quickReason => (
                            <Button
                              key={quickReason}
                              type="button"
                              size="sm"
                              variant={balanceAdjustment.reason === quickReason ? 'success' : 'outline-success'}
                              onClick={() => setBalanceAdjustment(p => ({ ...p, reason: quickReason }))}
                            >
                              {quickReason}
                            </Button>
                          ))}
                        </div>
                        {!disabledTabs.includes('payout') && (
                          <Form.Check
                            type="checkbox"
                            id="balance-include-in-payout"
                            label="Include in owner payout"
                            checked={balanceAdjustment.includeInPayout}
                            onChange={e => setBalanceAdjustment(p => ({ ...p, includeInPayout: e.target.checked }))}
                            className="mb-2"
                          />
                        )}
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
                <Card.Body style={{ maxHeight: 400, overflowY: 'auto' }}>
                  {isLoadingLedger && (
                    <div className="text-center"><Spinner animation="border" size="sm" /></div>
                  )}
                  {ledgerError && <Alert variant="danger" className="small">{ledgerError}</Alert>}
                  {!isLoadingLedger && walletLedger.length === 0 && (
                    <p className="text-muted small mb-0">No balance history yet.</p>
                  )}
                  {!isLoadingLedger && walletLedger.length > 0 && (
                    <Table size="sm" borderless className="mb-0">
                      <thead>
                        <tr className="small text-muted">
                          <th title="When this entry was recorded (not necessarily the session date)" style={{ whiteSpace: 'nowrap' }}>
                            Recorded
                          </th>
                          <th style={{ whiteSpace: 'nowrap' }}>Type</th>
                          <th>Note</th>
                          <th style={{ whiteSpace: 'nowrap' }}>Session</th>
                          <th className="text-end">Change</th>
                          <th className="text-end">Balance</th>
                        </tr>
                      </thead>
                      <tbody>
                        {walletLedger.map(entry => (
                          <tr key={entry.id} style={{ fontSize: 13, opacity: entry.voided ? 0.5 : 1 }}>
                            <td className="text-muted text-nowrap">
                              {entry.createdAt?.toDate
                                ? format(entry.createdAt.toDate(), 'MMM d, yy h:mm a')
                                : '—'}
                            </td>
                            <td className="text-nowrap">
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
                              {entry.voided && (
                                <Badge
                                  bg="secondary"
                                  style={{ fontSize: 9 }}
                                  className="ms-1"
                                  title={entry.voidedNote || undefined}
                                >
                                  Undone
                                </Badge>
                              )}
                            </td>
                            <td className="text-muted" style={{ whiteSpace: 'normal', wordBreak: 'break-word' }}>
                              {entry.note}
                            </td>
                            <td className="text-nowrap">
                              {entry.sessionId && linkedSessionsById[entry.sessionId] && (
                                <Button
                                  variant="link"
                                  className="p-0 align-baseline"
                                  style={{ fontSize: 'inherit' }}
                                  onClick={() => setSelectedLedgerSessionId(entry.sessionId!)}
                                >
                                  {format(linkedSessionsById[entry.sessionId].date, 'MMM d, yyyy')}
                                </Button>
                              )}
                            </td>
                            <td className={`text-end text-nowrap ${entry.delta >= 0 ? 'text-success' : 'text-danger'}`}>
                              {entry.delta >= 0 ? '+' : ''}{entry.delta.toFixed(2)}
                            </td>
                            <td className="text-end text-nowrap">
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
                    <ListGroup variant="flush" style={{ maxHeight: 'calc(100vh - 320px)', overflowY: 'auto' }}>
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
                                {playerInSession && (() => {
                                  const via: PaidVia =
                                    playerInSession.paidVia ??
                                    (playerInSession.comped ? 'comp' : playerInSession.paid ? 'etransfer' : null);
                                  // A 'balance' settlement auto-applied from a Gmail e-Transfer batch
                                  // (see etransferImports.ts) is called out distinctly from a manually
                                  // chosen balance draw, since the money ultimately came from that
                                  // e-Transfer.
                                  const settledViaEtransferBalance =
                                    via === 'balance' && !!playerInSession.settledByEtransferImportId;
                                  // Switching any non-balance settlement to Balance draws the
                                  // full session cost from this player's current prepaid wallet.
                                  const balanceIfDrawn =
                                    (selectedPlayer?.balance ?? 0) - playerInSession.cost;
                                  const settleOptions: { method: PaidVia; label: string; activeVariant: string }[] = [
                                    { method: null,        label: 'Unpaid',  activeVariant: 'danger'  },
                                    { method: 'comp',      label: 'Comp',    activeVariant: 'info'    },
                                    { method: 'balance',   label: 'Balance', activeVariant: 'primary' },
                                    { method: 'etransfer', label: 'e-Trans', activeVariant: 'success' },
                                  ];
                                  const pick = (method: PaidVia) => {
                                    if (method === via) return;
                                    if (method === 'balance' && balanceIfDrawn < 0) {
                                      const nm = selectedPlayer ? formatPlayerName(selectedPlayer) : 'This player';
                                      const ok = window.confirm(
                                        `${nm} doesn't have enough balance to cover $${playerInSession.cost.toFixed(2)}.\n` +
                                        `Their balance will go to $${balanceIfDrawn.toFixed(2)} (negative). Continue?`
                                      );
                                      if (!ok) return;
                                    }
                                    handleSetSettlement(s.id, method);
                                  };
                                  // Cover the selected player's dues from another player's balance.
                                  const otherPlayers = playersList
                                    .filter(pp => pp.id !== selectedPlayerId)
                                    .map(pp => ({ id: pp.id, name: formatPlayerName(pp), balance: pp.balance }));
                                  const currentPayer = via === 'transfer' && playerInSession.paidBy
                                    ? playersList.find(pp => pp.id === playerInSession.paidBy)
                                    : undefined;
                                  const payerName = currentPayer ? formatPlayerName(currentPayer) : undefined;
                                  const pickPaidBy = (payerId: string) => {
                                    if (payerId === playerInSession.paidBy) return;
                                    const opt = otherPlayers.find(o => o.id === payerId);
                                    if (opt && opt.balance < playerInSession.cost) {
                                      const ok = window.confirm(
                                        `${opt.name} has $${opt.balance.toFixed(2)} — covering $${playerInSession.cost.toFixed(2)} ` +
                                        `will leave them at $${(opt.balance - playerInSession.cost).toFixed(2)} (negative). Continue?`
                                      );
                                      if (!ok) return;
                                    }
                                    handleSetPaidBy(s.id, payerId);
                                  };
                                  return (
                                    <>
                                      <ButtonGroup size="sm" className="mt-1">
                                        {settleOptions.map(o => {
                                          const isActive = via === o.method;
                                          const displayLabel = o.method === 'balance' && isActive && settledViaEtransferBalance
                                            ? 'Gmail e-Transfer'
                                            : o.label;
                                          return (
                                          <React.Fragment key={o.label}>
                                            <Button
                                              variant={isActive ? o.activeVariant : 'outline-secondary'}
                                              style={{ fontSize: 11, padding: '1px 8px' }}
                                              onClick={() => pick(o.method)}
                                              title={
                                                o.method === 'balance' && isActive && settledViaEtransferBalance
                                                  ? 'Automatically settled from balance funded by a Gmail e-Transfer'
                                                  : undefined
                                              }
                                            >
                                              {displayLabel}
                                            </Button>
                                            {o.method === null && otherPlayers.length > 0 && (
                                              <Dropdown as={ButtonGroup} align="end">
                                                <Dropdown.Toggle
                                                  variant={via === 'transfer' ? 'primary' : 'outline-secondary'}
                                                  style={{ fontSize: 11, padding: '1px 8px', maxWidth: 130 }}
                                                  className="text-truncate"
                                                  title="Pay these dues from another player's balance"
                                                >
                                                  {via === 'transfer' && payerName ? payerName : 'Paid by'}
                                                </Dropdown.Toggle>
                                                <Dropdown.Menu
                                                  style={{ maxHeight: '60vh', overflowY: 'auto' }}
                                                  popperConfig={{ strategy: 'fixed' }}
                                                >
                                                  <Dropdown.Header>Pay from another's balance</Dropdown.Header>
                                                  {otherPlayers.map(op => (
                                                    <Dropdown.Item
                                                      key={op.id}
                                                      active={via === 'transfer' && playerInSession.paidBy === op.id}
                                                      onClick={() => pickPaidBy(op.id)}
                                                      className="d-flex justify-content-between align-items-center gap-3"
                                                    >
                                                      <span>{op.name}</span>
                                                      <span className="text-muted small">${op.balance.toFixed(2)}</span>
                                                    </Dropdown.Item>
                                                  ))}
                                                </Dropdown.Menu>
                                              </Dropdown>
                                            )}
                                          </React.Fragment>
                                          );
                                        })}
                                      </ButtonGroup>
                                      {playerInSession.settledAt && (via === 'comp' || playerInSession.paid) && (
                                        <div className="text-muted" style={{ fontSize: 11 }}>
                                          Updated {format(playerInSession.settledAt.toDate(), 'MMM d, yyyy h:mm a')}
                                        </div>
                                      )}
                                    </>
                                  );
                                })()}
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

      <Modal
        show={!!selectedLedgerSession}
        onHide={() => setSelectedLedgerSessionId(null)}
        centered
      >
        <Modal.Header closeButton>
          <Modal.Title>
            {selectedLedgerSession
              ? `Session — ${format(selectedLedgerSession.date, 'MMMM d, yyyy')}`
              : 'Session'}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {selectedLedgerSession && (
            <ListGroup variant="flush">
              {selectedLedgerSession.location && (
                <ListGroup.Item className="d-flex justify-content-between">
                  <span>Location</span>
                  <span>{selectedLedgerSession.location}</span>
                </ListGroup.Item>
              )}
              <ListGroup.Item className="d-flex justify-content-between">
                <span>Courts</span>
                <span>{selectedLedgerSession.courtCount}</span>
              </ListGroup.Item>
              <ListGroup.Item className="d-flex justify-content-between">
                <span>Players</span>
                <span>{selectedLedgerSession.players.length}</span>
              </ListGroup.Item>
              <ListGroup.Item className="d-flex justify-content-between">
                <span>Court cost</span>
                <span>${selectedLedgerSession.totalCourtCost.toFixed(2)}</span>
              </ListGroup.Item>
              {selectedLedgerSession.totalBirdieCost > 0 && (
                <ListGroup.Item className="d-flex justify-content-between">
                  <span>Birdie cost</span>
                  <span>${selectedLedgerSession.totalBirdieCost.toFixed(2)}</span>
                </ListGroup.Item>
              )}
              <ListGroup.Item className="d-flex justify-content-between fw-bold">
                <span>Total session cost</span>
                <span>${selectedLedgerSession.totalSessionCost.toFixed(2)}</span>
              </ListGroup.Item>
              {selectedLedgerSessionPlayer && (
                <ListGroup.Item className="d-flex justify-content-between fw-bold">
                  <span>{selectedPlayer ? formatPlayerName(selectedPlayer) : 'Player'} cost</span>
                  <span>
                    ${selectedLedgerSessionPlayer.cost.toFixed(2)}{' '}
                    {selectedLedgerSessionPlayer.comped || selectedLedgerSessionPlayer.paidVia === 'comp'
                      ? <Badge bg="warning">Comped</Badge>
                      : selectedLedgerSessionPlayer.paid
                        ? <Badge bg="success">Paid</Badge>
                        : <Badge bg="danger">Unpaid</Badge>}
                  </span>
                </ListGroup.Item>
              )}
            </ListGroup>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setSelectedLedgerSessionId(null)}>
            Close
          </Button>
          {selectedLedgerSession && (
            <Link
              to={`/?date=${format(selectedLedgerSession.date, 'yyyy-MM-dd')}`}
              className="btn btn-primary"
              onClick={() => setSelectedLedgerSessionId(null)}
            >
              Open in calendar
            </Link>
          )}
        </Modal.Footer>
      </Modal>

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