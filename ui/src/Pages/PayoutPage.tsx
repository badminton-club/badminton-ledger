import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Container, Card, Button, Table, Spinner, Alert, Row, Col, Form, Badge } from 'react-bootstrap';
import { format } from 'date-fns';
import { fetchOwnerPayoutSummary, payOwner, addCustomPayoutTransaction, undoPayoutAdjustment, voidOwnerPayout } from '../services/firebase';
import { useAppSelector } from '../hooks';
import { selectAllPlayers } from '../features/players/playersSlice';
import { selectIsClubAdmin } from '../features/club/clubSlice';
import type { OwnerPayoutSummary, PayoutLedgerEntry } from '../types';

const money = (n: number) => `$${n.toFixed(2)}`;
const moneySigned = (n: number) => (n < 0 ? `-${money(Math.abs(n))}` : money(n));

const PAGE_SIZE = 100;

type LedgerColumn = 'dateRecorded' | 'sessionDate' | 'player' | 'type' | 'note' | 'amount' | 'runningTotal';

const LEDGER_COLUMNS: { key: LedgerColumn; label: string; align?: 'end'; searchable?: boolean }[] = [
  { key: 'dateRecorded', label: 'Date Recorded' },
  { key: 'sessionDate',  label: 'Session Date' },
  { key: 'player',       label: 'Player' },
  { key: 'type',         label: 'Type' },
  { key: 'note',         label: 'Note' },
  { key: 'amount',       label: 'Amount', align: 'end' },
  { key: 'runningTotal', label: 'Running Total', align: 'end', searchable: false },
];

const ledgerTypeLabel = (type: PayoutLedgerEntry['type']) =>
  type === 'payout' ? 'Payout' : type === 'payment' ? 'Payment' : type === 'comp' ? 'Comp' : 'Adjustment';

/**
 * Running total of what's owed to the owner, evaluated in true chronological order
 * (oldest → newest) regardless of how the table is currently sorted. Comps don't
 * count (the player paid the owner directly) and payouts reduce the balance. A
 * voided adjustment still counts here — its reversal entry (also in the ledger)
 * cancels it out naturally — but a voided payout has no reversal row, so it's
 * skipped entirely, matching how fetchOwnerPayoutSummary excludes it from totalPaid.
 */
function computeRunningTotals(ledger: PayoutLedgerEntry[]): Map<string, number> {
  const chronological = [...ledger].sort((a, b) => a.date.getTime() - b.date.getTime());
  let running = 0;
  const totals = new Map<string, number>();
  for (const entry of chronological) {
    if (entry.type === 'payout') {
      if (!entry.voided) running -= entry.amount;
    } else if (entry.type !== 'comp') {
      running += entry.amount;
    }
    totals.set(`${entry.type}-${entry.id}`, running);
  }
  return totals;
}

export default function PayoutPage() {
  const isAdmin = useAppSelector(selectIsClubAdmin);
  const checkingAdmin = false;
  const [summary, setSummary] = useState<OwnerPayoutSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [customAmount, setCustomAmount] = useState('');
  const [paying, setPaying] = useState(false);
  const [payResult, setPayResult] = useState('');

  const [txType, setTxType] = useState<'add' | 'deduct'>('add');
  const [txAmount, setTxAmount] = useState('');
  const [txNote, setTxNote] = useState('');
  const [txPlayerId, setTxPlayerId] = useState('');
  const [txSubmitting, setTxSubmitting] = useState(false);
  const [txError, setTxError] = useState('');
  const [txResult, setTxResult] = useState('');

  const [sortColumn, setSortColumn] = useState<LedgerColumn>('dateRecorded');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [columnFilters, setColumnFilters] = useState<Record<LedgerColumn, string>>({
    dateRecorded: '', sessionDate: '', player: '', type: '', note: '', amount: '', runningTotal: '',
  });
  const [showFilters, setShowFilters] = useState(false);
  const [page, setPage] = useState(1);
  const [undoingId, setUndoingId] = useState<string | null>(null);

  const players = useAppSelector(selectAllPlayers);
  const playerName = useCallback((id: string | null) => {
    if (!id) return '';
    const p = players.find((pl) => pl.id === id);
    return p ? `${p.firstName} ${p.lastName ?? ''}`.trim() : 'Unknown player';
  }, [players]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setSummary(await fetchOwnerPayoutSummary());
    } catch {
      setError('Failed to load payout data.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Running totals are computed once from the full ledger in true chronological order,
  // so they stay stable no matter how the table is currently sorted or filtered.
  const runningTotals = useMemo(
    () => computeRunningTotals(summary?.ledger ?? []),
    [summary]
  );

  const getColumnText = useCallback((entry: PayoutLedgerEntry, key: LedgerColumn): string => {
    const runningTotal = runningTotals.get(`${entry.type}-${entry.id}`) ?? 0;
    switch (key) {
      case 'dateRecorded': return format(entry.date, 'MMM d, yyyy h:mm a');
      case 'sessionDate':  return entry.sessionDate ? format(entry.sessionDate, 'MMM d, yyyy') : '';
      case 'player':       return playerName(entry.playerId);
      case 'type':         return ledgerTypeLabel(entry.type);
      case 'note':         return entry.note;
      case 'amount':       return money(entry.amount);
      case 'runningTotal': return moneySigned(runningTotal);
    }
  }, [runningTotals, playerName]);

  const getSortValue = useCallback((entry: PayoutLedgerEntry, key: LedgerColumn): number | string => {
    switch (key) {
      case 'dateRecorded': return entry.date.getTime();
      case 'sessionDate':  return entry.sessionDate ? entry.sessionDate.getTime() : -Infinity;
      case 'player':       return playerName(entry.playerId).toLowerCase();
      case 'type':         return ledgerTypeLabel(entry.type).toLowerCase();
      case 'note':         return entry.note.toLowerCase();
      case 'amount':       return entry.amount;
      case 'runningTotal': return runningTotals.get(`${entry.type}-${entry.id}`) ?? 0;
    }
  }, [runningTotals, playerName]);

  const filteredLedger = useMemo(() => {
    const ledger = summary?.ledger ?? [];
    return ledger.filter((entry) =>
      LEDGER_COLUMNS.every(({ key }) => {
        const filterValue = columnFilters[key].trim().toLowerCase();
        if (!filterValue) return true;
        return getColumnText(entry, key).toLowerCase().includes(filterValue);
      })
    );
  }, [summary, columnFilters, getColumnText]);

  const sortedLedger = useMemo(() => {
    const copy = [...filteredLedger];
    copy.sort((a, b) => {
      const av = getSortValue(a, sortColumn);
      const bv = getSortValue(b, sortColumn);
      const cmp = typeof av === 'number' && typeof bv === 'number'
        ? av - bv
        : String(av).localeCompare(String(bv));
      return sortDirection === 'asc' ? cmp : -cmp;
    });
    return copy;
  }, [filteredLedger, sortColumn, sortDirection, getSortValue]);

  const totalPages = Math.max(1, Math.ceil(sortedLedger.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paginatedLedger = sortedLedger.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  // Reset to page 1 whenever the underlying data, sort, or filters change.
  useEffect(() => { setPage(1); }, [summary, sortColumn, sortDirection, columnFilters]);

  const handleSort = (key: LedgerColumn) => {
    if (sortColumn === key) {
      setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortColumn(key);
      setSortDirection(key === 'dateRecorded' ? 'desc' : 'asc');
    }
  };

  const handleFilterChange = (key: LedgerColumn, value: string) => {
    setColumnFilters((prev) => ({ ...prev, [key]: value }));
  };

  const activeFilterCount = Object.values(columnFilters).filter((v) => v.trim()).length;

  const clearFilters = () => {
    setColumnFilters({
      dateRecorded: '', sessionDate: '', player: '', type: '', note: '', amount: '', runningTotal: '',
    });
  };

  const handlePayOwner = async (custom?: number) => {
    if (!summary || summary.pending <= 0) return;

    const isPartial = custom !== undefined;
    const confirmMsg = isPartial
      ? `Record a payout of ${money(custom!)} to the owner?`
      : `Record a payout of ${money(summary.pending)} to the owner? This resets the pending balance to zero.`;
    if (!window.confirm(confirmMsg)) return;

    setPaying(true);
    setError('');
    setPayResult('');
    try {
      const amount = await payOwner(note, custom);
      const remaining = summary.pending - amount;
      setPayResult(
        remaining > 0
          ? `Paid ${money(amount)} to the owner. Pending balance is now ${money(remaining)}.`
          : `Paid ${money(amount)} to the owner. Pending balance is now zero.`
      );
      setNote('');
      setCustomAmount('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Payout failed.');
    } finally {
      setPaying(false);
    }
  };

  const handleAddTransaction = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = parseFloat(txAmount);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setTxError('Enter an amount greater than zero.');
      return;
    }
    if (!txNote.trim()) {
      setTxError('A note is required (e.g. what was sold and to whom).');
      return;
    }

    setTxSubmitting(true);
    setTxError('');
    setTxResult('');
    try {
      const delta = txType === 'add' ? parsed : -parsed;
      await addCustomPayoutTransaction(delta, txNote, txPlayerId || null);
      setTxResult(
        txType === 'add'
          ? `Added ${money(parsed)} to the pending payout.`
          : `Deducted ${money(parsed)} from the pending payout.`
      );
      setTxAmount('');
      setTxNote('');
      setTxPlayerId('');
      await load();
    } catch (err) {
      setTxError(err instanceof Error ? err.message : 'Failed to add transaction.');
    } finally {
      setTxSubmitting(false);
    }
  };

  const handleUndo = async (entry: PayoutLedgerEntry) => {
    const confirmMsg = entry.type === 'payout'
      ? `Undo this payout of ${money(entry.amount)}? It will be marked voided and added back to the pending balance.`
      : `Undo this adjustment of ${money(entry.amount)}? A reversal entry will be added.`;
    if (!window.confirm(confirmMsg)) return;

    setUndoingId(entry.id);
    setError('');
    try {
      if (entry.type === 'payout') {
        await voidOwnerPayout(entry.id);
      } else {
        await undoPayoutAdjustment(entry.id);
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to undo.');
    } finally {
      setUndoingId(null);
    }
  };

  if (checkingAdmin) {
    return (
      <Container className="py-4 text-center">
        <Spinner animation="border" />
      </Container>
    );
  }

  if (!isAdmin) {
    return (
      <Container className="py-4">
        <Alert variant="warning">You must be an admin to view owner payouts.</Alert>
      </Container>
    );
  }

  const pending = summary?.pending ?? 0;
  const parsedCustom = parseFloat(customAmount);
  const customValid = Number.isFinite(parsedCustom) && parsedCustom > 0 && parsedCustom <= pending;

  return (
    <Container className="py-4">
      <h1 className="mb-4">Owner Payout</h1>

      {error && <Alert variant="danger" onClose={() => setError('')} dismissible>{error}</Alert>}
      {payResult && <Alert variant="success" onClose={() => setPayResult('')} dismissible>{payResult}</Alert>}

      <Row className="g-3 mb-4">
        <Col md={4}>
          <Card className="text-center h-100">
            <Card.Body>
              <Card.Subtitle className="text-muted mb-2">Collected from players</Card.Subtitle>
              <h3 className="mb-0">{money(summary?.totalCollected ?? 0)}</h3>
            </Card.Body>
          </Card>
        </Col>
        <Col md={4}>
          <Card className="text-center h-100">
            <Card.Body>
              <Card.Subtitle className="text-muted mb-2">Total paid out</Card.Subtitle>
              <h3 className="mb-0">{money(summary?.totalPaid ?? 0)}</h3>
            </Card.Body>
          </Card>
        </Col>
        <Col md={4}>
          <Card className={`text-center h-100 ${pending > 0 ? 'border-warning' : 'border-success'}`}>
            <Card.Body>
              <Card.Subtitle className="text-muted mb-2">Pending payout</Card.Subtitle>
              <h3 className={`mb-0 ${pending > 0 ? 'text-warning' : 'text-success'}`}>{money(pending)}</h3>
            </Card.Body>
          </Card>
        </Col>
      </Row>

      <Card className="mb-4">
        <Card.Body>
          <Card.Title>Cash out to owner</Card.Title>
          <Card.Text className="text-muted">
            Pay out the full pending balance, or enter a custom amount for a partial payout.
          </Card.Text>
          <Row className="g-3">
            <Col md={12}>
              <Form.Label>Note (optional)</Form.Label>
              <Form.Control
                type="text"
                placeholder="e.g. e-transfer, cash, cheque #123"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                disabled={paying}
              />
            </Col>
            <Col md={6}>
              <Form.Label>Custom amount</Form.Label>
              <div className="d-flex gap-2">
                <Form.Control
                  type="number"
                  min="0"
                  step="0.01"
                  max={pending}
                  placeholder="0.00"
                  value={customAmount}
                  onChange={(e) => setCustomAmount(e.target.value)}
                  disabled={paying || pending <= 0}
                />
                <Button
                  variant="outline-success"
                  className="text-nowrap"
                  onClick={() => handlePayOwner(parsedCustom)}
                  disabled={paying || loading || !customValid}
                >
                  {paying ? <Spinner size="sm" animation="border" /> : 'Pay this'}
                </Button>
              </div>
            </Col>
            <Col md={6} className="d-flex align-items-end justify-content-md-end">
              <Button
                variant="success"
                onClick={() => handlePayOwner()}
                disabled={paying || loading || pending <= 0}
              >
                {paying ? <Spinner size="sm" animation="border" /> : `Pay full balance ${money(pending)}`}
              </Button>
            </Col>
          </Row>
        </Card.Body>
      </Card>

      <Card className="mb-4">
        <Card.Body>
          <Card.Title>Add custom transaction</Card.Title>
          <Card.Text className="text-muted">
            Record money the club collected (or paid out) outside of a normal session
            settlement — e.g. someone buying birdies from the shared stash with cash. This
            adjusts the pending payout without touching any player's prepaid balance.
          </Card.Text>
          <Form onSubmit={handleAddTransaction}>
            <Row className="g-3">
              <Col md={3}>
                <Form.Label>Type</Form.Label>
                <Form.Select
                  value={txType}
                  onChange={(e) => setTxType(e.target.value as 'add' | 'deduct')}
                  disabled={txSubmitting}
                >
                  <option value="add">Add to payout (+)</option>
                  <option value="deduct">Deduct from payout (-)</option>
                </Form.Select>
              </Col>
              <Col md={3}>
                <Form.Label>Amount</Form.Label>
                <Form.Control
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  value={txAmount}
                  onChange={(e) => setTxAmount(e.target.value)}
                  disabled={txSubmitting}
                />
              </Col>
              <Col md={3}>
                <Form.Label>Player (optional)</Form.Label>
                <Form.Select
                  value={txPlayerId}
                  onChange={(e) => setTxPlayerId(e.target.value)}
                  disabled={txSubmitting}
                >
                  <option value="">— None —</option>
                  {players.map((p) => (
                    <option key={p.id} value={p.id}>{`${p.firstName} ${p.lastName ?? ''}`.trim()}</option>
                  ))}
                </Form.Select>
              </Col>
              <Col md={3} className="d-flex align-items-end">
                <Button variant="primary" type="submit" disabled={txSubmitting} className="w-100">
                  {txSubmitting ? <Spinner size="sm" animation="border" /> : 'Add transaction'}
                </Button>
              </Col>
              <Col md={12}>
                <Form.Label>Note</Form.Label>
                <Form.Control
                  type="text"
                  placeholder="e.g. Manager bought 2 tubes of birdies from the stash (cash)"
                  value={txNote}
                  onChange={(e) => setTxNote(e.target.value)}
                  disabled={txSubmitting}
                />
              </Col>
            </Row>
          </Form>
          {txError && (
            <Alert variant="danger" className="mt-3 mb-0" onClose={() => setTxError('')} dismissible>
              {txError}
            </Alert>
          )}
          {txResult && (
            <Alert variant="success" className="mt-3 mb-0" onClose={() => setTxResult('')} dismissible>
              {txResult}
            </Alert>
          )}
        </Card.Body>
      </Card>

      <Card>
        <Card.Header className="d-flex flex-wrap justify-content-between align-items-center gap-2">
          <span>Payout ledger</span>
          {summary && summary.ledger.length > 0 && (
            <div className="d-flex align-items-center gap-2">
              <Button
                size="sm"
                variant={showFilters ? 'secondary' : 'outline-secondary'}
                onClick={() => setShowFilters((v) => !v)}
              >
                {showFilters ? 'Hide search' : 'Search'}
                {activeFilterCount > 0 && (
                  <Badge bg="light" text="dark" className="ms-2">{activeFilterCount}</Badge>
                )}
              </Button>
              {activeFilterCount > 0 && (
                <Button size="sm" variant="link" className="text-decoration-none p-0" onClick={clearFilters}>
                  Clear
                </Button>
              )}
            </div>
          )}
        </Card.Header>
        <Card.Body>
          {loading ? (
            <div className="text-center py-3"><Spinner animation="border" /></div>
          ) : !summary || summary.ledger.length === 0 ? (
            <p className="text-muted mb-0">No payments or adjustments yet.</p>
          ) : (
            <>
              <div className="border rounded" style={{ maxHeight: 600, overflowY: 'auto' }}>
                <Table hover striped responsive className="mb-0 align-middle">
                  <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
                    <tr className="table-light">
                      {LEDGER_COLUMNS.map((col) => (
                        <th
                          key={col.key}
                          onClick={() => handleSort(col.key)}
                          role="button"
                          className={col.align === 'end' ? 'text-end' : ''}
                          style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}
                        >
                          {col.label}
                          <span className="ms-1 text-muted">
                            {sortColumn === col.key ? (sortDirection === 'asc' ? '▲' : '▼') : ''}
                          </span>
                        </th>
                      ))}
                      <th style={{ whiteSpace: 'nowrap' }}>Actions</th>
                    </tr>
                    {showFilters && (
                      <tr className="table-light">
                        {LEDGER_COLUMNS.map((col) => (
                          <th key={col.key} className="p-1 pb-2">
                            {col.searchable === false ? null : (
                              <Form.Control
                                size="sm"
                                placeholder="Search…"
                                value={columnFilters[col.key]}
                                onChange={(e) => handleFilterChange(col.key, e.target.value)}
                              />
                            )}
                          </th>
                        ))}
                        <th className="p-1 pb-2" />
                      </tr>
                    )}
                  </thead>
                  <tbody>
                    {paginatedLedger.length === 0 ? (
                      <tr>
                        <td colSpan={LEDGER_COLUMNS.length + 1} className="text-center text-muted py-4">
                          No entries match your search.
                        </td>
                      </tr>
                    ) : (
                      paginatedLedger.map((entry) => {
                        const runningTotal = runningTotals.get(`${entry.type}-${entry.id}`) ?? 0;
                        const struckThrough = entry.voided || entry.isReversal;
                        return (
                          <tr
                            key={`${entry.type}-${entry.id}`}
                            style={struckThrough ? { opacity: 0.5, textDecoration: 'line-through' } : undefined}
                          >
                            <td className="text-nowrap">{format(entry.date, 'MMM d, yyyy h:mm a')}</td>
                            <td className="text-nowrap">{entry.sessionDate ? format(entry.sessionDate, 'MMM d, yyyy') : <span className="text-muted">—</span>}</td>
                            <td>{playerName(entry.playerId) || <span className="text-muted">—</span>}</td>
                            <td>
                              {entry.type === 'payout' ? (
                                <Badge bg="dark">Payout</Badge>
                              ) : entry.type === 'payment' ? (
                                <Badge bg="primary">Payment</Badge>
                              ) : entry.type === 'comp' ? (
                                <Badge bg="info">Comp</Badge>
                              ) : (
                                <Badge bg="secondary">Adjustment</Badge>
                              )}
                              {entry.voided && (
                                <Badge bg="light" text="dark" className="ms-1">Voided</Badge>
                              )}
                              {entry.isReversal && (
                                <Badge bg="light" text="dark" className="ms-1">Reversed</Badge>
                              )}
                            </td>
                            <td style={{ maxWidth: 320, whiteSpace: 'normal', wordBreak: 'break-word', textDecoration: 'none' }}>
                              {entry.note || <span className="text-muted">—</span>}
                            </td>
                            {entry.type === 'comp' ? (
                              <td className="text-end text-muted" style={{ fontVariantNumeric: 'tabular-nums' }}>
                                {money(entry.amount)} <span className="small">(not counted)</span>
                              </td>
                            ) : (
                              <td
                                className={`text-end fw-medium ${entry.type === 'payout' ? 'text-danger' : entry.amount < 0 ? 'text-danger' : 'text-success'}`}
                                style={{ fontVariantNumeric: 'tabular-nums' }}
                              >
                                {entry.type === 'payout' ? `- ${money(entry.amount)}` : money(entry.amount)}
                              </td>
                            )}
                            <td
                              className={`text-end fw-semibold ${runningTotal < 0 ? 'text-danger' : ''}`}
                              style={{ fontVariantNumeric: 'tabular-nums' }}
                            >
                              {moneySigned(runningTotal)}
                            </td>
                            <td className="text-end" style={{ textDecoration: 'none' }}>
                              {entry.canUndo && (
                                <Button
                                  size="sm"
                                  variant="outline-danger"
                                  disabled={undoingId !== null}
                                  onClick={() => handleUndo(entry)}
                                >
                                  {undoingId === entry.id ? (
                                    <Spinner as="span" animation="border" size="sm" />
                                  ) : (
                                    'Undo'
                                  )}
                                </Button>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </Table>
              </div>
              <div className="d-flex justify-content-between align-items-center mt-2">
                <span className="text-muted small">
                  {sortedLedger.length === 0
                    ? 'No entries match your search.'
                    : `Showing ${(currentPage - 1) * PAGE_SIZE + 1}–${Math.min(currentPage * PAGE_SIZE, sortedLedger.length)} of ${sortedLedger.length}`}
                </span>
                <div className="d-flex align-items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline-secondary"
                    disabled={currentPage <= 1}
                    onClick={() => setPage((p) => p - 1)}
                  >
                    Previous
                  </Button>
                  <span className="small text-muted">Page {currentPage} of {totalPages}</span>
                  <Button
                    size="sm"
                    variant="outline-secondary"
                    disabled={currentPage >= totalPages}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            </>
          )}
        </Card.Body>
      </Card>
    </Container>
  );
}
