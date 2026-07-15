import React, { useEffect, useState } from 'react';
import { Container, Card, Table, Spinner, Alert, Badge, Tabs, Tab, Form, Button, Row, Col, Modal, ListGroup } from 'react-bootstrap';
import { format } from 'date-fns';
import { fetchMemberPlayerId, fetchPlayerLedger, fetchMyLinkRequest, submitLinkRequest, fetchSessions } from '../services/firebase';
import { auth } from '../services/firebase/client';
import { toJSDate } from '../services/firebase/utils';
import { useAppSelector } from '../hooks';
import { selectCurrentClubId } from '../features/club/clubSlice';
import { selectPlayerById } from '../features/players/playersSlice';
import type { BalanceLedgerEntry, Session, LinkRequest } from '../types';
import type { RootState } from '../store';

const REASON_LABELS: Record<string, string> = {
  session: 'Session',
  'session-edit': 'Session edit',
  'session-deleted': 'Session removed',
  payment: 'Payment',
  comp: 'Comp',
  manual: 'Adjustment',
};

const money = (n: number) => `${n < 0 ? '-' : ''}$${Math.abs(n).toFixed(2)}`;

export default function AttendancePage() {
  const clubId = useAppSelector(selectCurrentClubId);
  const uid = auth.currentUser?.uid ?? null;
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [ledger, setLedger] = useState<BalanceLedgerEntry[]>([]);
  const [attended, setAttended] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [myRequest, setMyRequest] = useState<LinkRequest | null>(null);
  const [reqFirst, setReqFirst] = useState('');
  const [reqLast, setReqLast] = useState('');
  const [reqEmail, setReqEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  const [selectedSession, setSelectedSession] = useState<Session | null>(null);

  const player = useAppSelector((s: RootState) =>
    playerId ? selectPlayerById(s, playerId) : undefined
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!clubId || !uid) { setLoading(false); return; }
      setLoading(true);
      setError('');
      try {
        const pid = await fetchMemberPlayerId(clubId, uid);
        if (cancelled) return;
        setPlayerId(pid);
        if (pid) {
          const [entries, sessions] = await Promise.all([fetchPlayerLedger(pid), fetchSessions({})]);
          if (cancelled) return;
          setLedger(entries);
          setAttended(sessions.filter((s) => (s.players ?? []).some((p) => p.id === pid)));
        } else {
          const req = await fetchMyLinkRequest(clubId, uid);
          if (cancelled) return;
          setMyRequest(req);
          const u = auth.currentUser;
          const dn = (u?.displayName || '').trim();
          const sp = dn.split(/\s+/);
          setReqFirst((prev) => prev || sp[0] || '');
          setReqLast((prev) => prev || sp.slice(1).join(' ') || '');
          setReqEmail((prev) => prev || u?.email || '');
        }
      } catch {
        if (!cancelled) setError('Failed to load your attendance.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [clubId, uid]);

  const handleSubmitRequest = async () => {
    if (!clubId || !uid) return;
    const first = reqFirst.trim();
    if (!first) { setSubmitError('Enter your first name.'); return; }
    setSubmitError('');
    setSubmitting(true);
    try {
      const last = reqLast.trim() || null;
      await submitLinkRequest(clubId, uid, first, last, reqEmail.trim());
      setMyRequest({ uid, firstName: first, lastName: last, email: reqEmail.trim() });
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to send request.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <Container className="py-4 text-center">
        <Spinner animation="border" />
      </Container>
    );
  }

  return (
    <Container className="py-4" style={{ maxWidth: 720 }}>
      <h3>My attendance</h3>
      {error && <Alert variant="danger">{error}</Alert>}

      {!playerId ? (
        myRequest ? (
          <Alert variant="success">
            Your request to be linked was sent. An admin will match you to a player soon.
          </Alert>
        ) : (
          <Card>
            <Card.Body>
              <Card.Title className="h6">Request to be linked</Card.Title>
              <Card.Text className="text-muted">
                You're not linked to a player in this club yet. Send your details and an admin will
                link you (or create a player for you).
              </Card.Text>
              <Row>
                <Col sm={6}>
                  <Form.Group className="mb-2">
                    <Form.Label>First name</Form.Label>
                    <Form.Control value={reqFirst} onChange={(e) => setReqFirst(e.target.value)} disabled={submitting} />
                  </Form.Group>
                </Col>
                <Col sm={6}>
                  <Form.Group className="mb-2">
                    <Form.Label>Last name</Form.Label>
                    <Form.Control value={reqLast} onChange={(e) => setReqLast(e.target.value)} disabled={submitting} />
                  </Form.Group>
                </Col>
              </Row>
              <Form.Group className="mb-3">
                <Form.Label>Email</Form.Label>
                <Form.Control type="email" value={reqEmail} onChange={(e) => setReqEmail(e.target.value)} disabled={submitting} />
              </Form.Group>
              <Button variant="primary" onClick={handleSubmitRequest} disabled={submitting || !reqFirst.trim()}>
                {submitting ? <Spinner size="sm" animation="border" /> : 'Send request'}
              </Button>
              {submitError && <Alert variant="danger" className="mt-3 mb-0 py-2">{submitError}</Alert>}
            </Card.Body>
          </Card>
        )
      ) : (
        <>
          <Card className="mb-3">
            <Card.Body className="d-flex justify-content-between align-items-center">
              <span>{player ? `${player.firstName} ${player.lastName ?? ''}`.trim() : 'Your player'}</span>
              {player && (
                <span>
                  Balance:{' '}
                  <strong className={player.balance < 0 ? 'text-danger' : 'text-success'}>
                    {money(player.balance)}
                  </strong>
                </span>
              )}
            </Card.Body>
          </Card>

          <Tabs defaultActiveKey="sessions" className="mb-3">
            <Tab eventKey="sessions" title="Sessions attended">
              {attended.length === 0 ? (
                <p className="text-muted">No sessions attended yet.</p>
              ) : (
                <Table hover responsive size="sm">
                  <thead>
                    <tr><th>Date</th><th>Cost</th><th className="text-end">Status</th></tr>
                  </thead>
                  <tbody>
                    {attended.map((s) => {
                      const sp = (s.players ?? []).find((p) => p.id === playerId);
                      const d = toJSDate(s.date);
                      const status = sp?.comped
                        ? { label: 'Comped', bg: 'warning' }
                        : sp?.paid
                          ? { label: 'Paid', bg: 'success' }
                          : { label: 'Unpaid', bg: 'danger' };
                      return (
                        <tr key={s.id} style={{ cursor: 'pointer' }} onClick={() => setSelectedSession(s)}>
                          <td>{d ? format(d, 'MMM d, yyyy') : '—'}</td>
                          <td>{money(sp?.cost ?? 0)}</td>
                          <td className="text-end"><Badge bg={status.bg}>{status.label}</Badge></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </Table>
              )}
            </Tab>
            <Tab eventKey="transactions" title="Transactions">
              {ledger.length === 0 ? (
                <p className="text-muted">No transactions yet.</p>
              ) : (
                <Table hover responsive size="sm">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Type</th>
                      <th>Note</th>
                      <th className="text-end">Amount</th>
                      <th className="text-end">Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ledger.map((e) => {
                      const d = toJSDate(e.createdAt);
                      return (
                        <tr key={e.id}>
                          <td>{d ? format(d, 'MMM d, yyyy') : '—'}</td>
                          <td><Badge bg="secondary">{REASON_LABELS[e.reason] ?? e.reason}</Badge></td>
                          <td>{e.note ?? ''}</td>
                          <td className={`text-end ${e.delta < 0 ? 'text-danger' : 'text-success'}`}>{money(e.delta)}</td>
                          <td className="text-end">{money(e.balanceAfter)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </Table>
              )}
            </Tab>
          </Tabs>
        </>
      )}

      <Modal show={!!selectedSession} onHide={() => setSelectedSession(null)} centered>
        <Modal.Header closeButton>
          <Modal.Title>
            {(() => {
              const d = selectedSession ? toJSDate(selectedSession.date) : null;
              return d ? format(d, 'MMMM d, yyyy') : 'Session';
            })()}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {selectedSession && (() => {
            const sp = (selectedSession.players ?? []).find((p) => p.id === playerId);
            const numPlayers = selectedSession.players?.length ?? 0;
            const courtCost = selectedSession.totalCourtCost ?? 0;
            const birdieCost = selectedSession.totalBirdieCost ?? 0;
            const total = selectedSession.totalSessionCost ?? courtCost + birdieCost;
            const perPlayer = numPlayers ? total / numPlayers : 0;
            return (
              <ListGroup variant="flush">
                <ListGroup.Item className="d-flex justify-content-between"><span>Court cost</span><span>{money(courtCost)}</span></ListGroup.Item>
                {birdieCost > 0 && (
                  <ListGroup.Item className="d-flex justify-content-between"><span>Birdie cost</span><span>{money(birdieCost)}</span></ListGroup.Item>
                )}
                <ListGroup.Item className="d-flex justify-content-between fw-bold"><span>Total session cost</span><span>{money(total)}</span></ListGroup.Item>
                <ListGroup.Item className="d-flex justify-content-between"><span>Players</span><span>{numPlayers}</span></ListGroup.Item>
                <ListGroup.Item className="d-flex justify-content-between"><span>Split per player</span><span>{money(perPlayer)}</span></ListGroup.Item>
                <ListGroup.Item className="d-flex justify-content-between fw-bold">
                  <span>You owe</span>
                  <span>
                    {money(sp?.cost ?? 0)}{' '}
                    {sp?.comped ? <Badge bg="warning">Comped</Badge> : sp?.paid ? <Badge bg="success">Paid</Badge> : <Badge bg="danger">Unpaid</Badge>}
                  </span>
                </ListGroup.Item>
              </ListGroup>
            );
          })()}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setSelectedSession(null)}>Close</Button>
        </Modal.Footer>
      </Modal>
    </Container>
  );
}
