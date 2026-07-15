import React, { useCallback, useEffect, useState } from 'react';
import { Container, Card, Button, Table, Spinner, Alert, Row, Col, Form, Badge } from 'react-bootstrap';
import { format } from 'date-fns';
import { fetchOwnerPayoutSummary, payOwner } from '../services/firebase';
import { onAuthStateChangedListener, checkIfAdmin } from '../services/firebase/auth';
import { useAppSelector } from '../hooks';
import { selectAllPlayers } from '../features/players/playersSlice';
import type { OwnerPayoutSummary } from '../types';

const money = (n: number) => `$${n.toFixed(2)}`;

export default function PayoutPage() {
  const [isAdmin, setIsAdmin] = useState(false);
  const [checkingAdmin, setCheckingAdmin] = useState(true);
  const [summary, setSummary] = useState<OwnerPayoutSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [paying, setPaying] = useState(false);
  const [payResult, setPayResult] = useState('');

  const players = useAppSelector(selectAllPlayers);
  const playerName = (id: string | null) => {
    if (!id) return '';
    const p = players.find((pl) => pl.id === id);
    return p ? `${p.firstName} ${p.lastName ?? ''}`.trim() : 'Unknown player';
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChangedListener(async (user) => {
      setIsAdmin(await checkIfAdmin(user?.uid ?? null));
      setCheckingAdmin(false);
    });
    return () => unsubscribe();
  }, []);

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

  const handlePayOwner = async () => {
    if (!summary || summary.pending <= 0) return;
    if (!window.confirm(
      `Record a payout of ${money(summary.pending)} to the owner? This resets the pending balance to zero.`
    )) return;

    setPaying(true);
    setError('');
    setPayResult('');
    try {
      const amount = await payOwner(note);
      setPayResult(`Paid ${money(amount)} to the owner. Pending balance is now zero.`);
      setNote('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Payout failed.');
    } finally {
      setPaying(false);
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
            Records a payout for the money collected from players and resets the pending balance to zero.
          </Card.Text>
          <Row className="g-2 align-items-end">
            <Col md={8}>
              <Form.Label>Note (optional)</Form.Label>
              <Form.Control
                type="text"
                placeholder="e.g. e-transfer, cash, cheque #123"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                disabled={paying}
              />
            </Col>
            <Col md={4} className="text-md-end">
              <Button
                variant="success"
                onClick={handlePayOwner}
                disabled={paying || loading || pending <= 0}
              >
                {paying ? <Spinner size="sm" animation="border" /> : `Pay owner ${money(pending)}`}
              </Button>
            </Col>
          </Row>
        </Card.Body>
      </Card>

      <Card>
        <Card.Header>Payout ledger</Card.Header>
        <Card.Body>
          {loading ? (
            <div className="text-center py-3"><Spinner animation="border" /></div>
          ) : !summary || summary.ledger.length === 0 ? (
            <p className="text-muted mb-0">No payments or adjustments yet.</p>
          ) : (
            <Table hover responsive size="sm" className="mb-0">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Player</th>
                  <th>Type</th>
                  <th>Note</th>
                  <th className="text-end">Amount</th>
                </tr>
              </thead>
              <tbody>
                {summary.ledger.map((entry) => (
                  <tr key={`${entry.type}-${entry.id}`}>
                    <td>{format(entry.date, 'MMM d, yyyy')}</td>
                    <td>{playerName(entry.playerId)}</td>
                    <td>
                      {entry.type === 'payout' ? (
                        <Badge bg="success">Payout</Badge>
                      ) : entry.type === 'payment' ? (
                        <Badge bg="primary">Payment</Badge>
                      ) : entry.type === 'comp' ? (
                        <Badge bg="info">Comp</Badge>
                      ) : (
                        <Badge bg="secondary">Adjustment</Badge>
                      )}
                    </td>
                    <td>{entry.note}</td>
                    {entry.type === 'comp' ? (
                      <td className="text-end text-muted">
                        {money(entry.amount)} <span className="small">(not counted)</span>
                      </td>
                    ) : (
                      <td className={`text-end ${entry.type === 'payout' ? 'text-success' : entry.amount < 0 ? 'text-danger' : ''}`}>
                        {entry.type === 'payout' ? `- ${money(entry.amount)}` : money(entry.amount)}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card.Body>
      </Card>
    </Container>
  );
}
