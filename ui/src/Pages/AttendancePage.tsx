import React, { useEffect, useState } from 'react';
import { Container, Card, Table, Spinner, Alert, Badge, Tabs, Tab, Form, Button, Row, Col, Modal, ListGroup } from 'react-bootstrap';
import { format } from 'date-fns';
import { fetchMemberPlayerId, fetchPlayerLedger, fetchMyLinkRequest, submitLinkRequest, fetchSessions, fetchMyProfileEditRequest, submitProfileEditRequest } from '../services/firebase';
import { auth } from '../services/firebase/client';
import { toJSDate } from '../services/firebase/utils';
import { useAppSelector } from '../hooks';
import { selectCurrentClubId, selectIsClubAdmin } from '../features/club/clubSlice';
import { selectAllPlayers, selectPlayerById } from '../features/players/playersSlice';
import type { BalanceLedgerEntry, Session, LinkRequest, ProfileEditRequest } from '../types';
import type { RootState } from '../store';
import { isSessionPlayerUnpaid } from '../utils/sessionPayment';

const REASON_LABELS: Record<string, string> = {
  session: 'Session',
  'session-edit': 'Session edit',
  'session-deleted': 'Session removed',
  payment: 'Payment',
  comp: 'Comp',
  manual: 'Manual',
  // Logged when an admin manually switches a player's settlement method after
  // the session was created (vs. 'session', logged automatically at
  // session-creation time) — same kind of event from the player's perspective,
  // so it's shown with the same "Session" label.
  settlement: 'Session',
};

const REASON_BADGE: Record<string, string> = {
  session: 'secondary',
  'session-edit': 'secondary',
  'session-deleted': 'dark',
  payment: 'primary',
  comp: 'info',
  manual: 'secondary',
  settlement: 'secondary',
};

const money = (n: number) => `${n < 0 ? '-' : ''}$${Math.abs(n).toFixed(2)}`;

export default function AttendancePage() {
  const clubId = useAppSelector(selectCurrentClubId);
  const isAdmin = useAppSelector(selectIsClubAdmin);
  const players = useAppSelector(selectAllPlayers);
  const uid = auth.currentUser?.uid ?? null;
  const [linkedPlayerId, setLinkedPlayerId] = useState<string | null>(null);
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

  const [myProfileEditRequest, setMyProfileEditRequest] = useState<ProfileEditRequest | null>(null);
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [edFirst, setEdFirst] = useState('');
  const [edLast, setEdLast] = useState('');
  const [edEmail, setEdEmail] = useState('');
  const [submittingEdit, setSubmittingEdit] = useState(false);
  const [editError, setEditError] = useState('');

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
        setLinkedPlayerId(pid);
        setPlayerId(pid);
        if (pid) {
          const editReq = await fetchMyProfileEditRequest(clubId, uid);
          if (cancelled) return;
          setMyProfileEditRequest(editReq);
        } else if (!isAdmin) {
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
  }, [clubId, uid, isAdmin]);

  useEffect(() => {
    if (isAdmin && !playerId && players.length > 0) {
      setPlayerId(players[0].id);
    }
  }, [isAdmin, playerId, players]);

  useEffect(() => {
    let cancelled = false;
    if (!playerId) {
      setLedger([]);
      setAttended([]);
      return;
    }

    setLoading(true);
    setError('');
    Promise.all([fetchPlayerLedger(playerId), fetchSessions({})])
      .then(([entries, sessions]) => {
        if (cancelled) return;
        setLedger(entries);
        setAttended(sessions.filter((session) =>
          (session.players ?? []).some((sessionPlayer) => sessionPlayer.id === playerId)
        ));
      })
      .catch(() => {
        if (!cancelled) setError(isAdmin ? 'Failed to load attendance.' : 'Failed to load your attendance.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [playerId, isAdmin]);

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

  const startEditingProfile = () => {
    // Prefill from the pending proposal (if any) rather than the live player
    // record — otherwise reopening "Edit details" silently discards whatever
    // was already proposed and awaiting approval, and resubmitting would
    // overwrite it with values based on the stale, unedited player record.
    const source = myProfileEditRequest ?? player;
    setEdFirst(source?.firstName ?? '');
    setEdLast(source?.lastName ?? '');
    setEdEmail(source?.email ?? '');
    setEditError('');
    setIsEditingProfile(true);
  };

  const handleSubmitProfileEdit = async () => {
    if (!clubId || !uid || !playerId) return;
    const first = edFirst.trim();
    if (!first) { setEditError('Enter your first name.'); return; }
    const last = edLast.trim() || null;
    const email = edEmail.trim() || null;
    // Compare against whatever's already on record for this proposal — the
    // pending request if one exists, otherwise the live player — so a resubmit
    // with nothing actually changed doesn't create a no-op request (and, if a
    // request is already pending, doesn't silently replace it with an
    // identical copy that just resets the review clock for no reason).
    const baseline = myProfileEditRequest ?? player;
    if (
      baseline
      && first === (baseline.firstName ?? '')
      && last === (baseline.lastName ?? null)
      && email === (baseline.email ?? null)
    ) {
      setEditError(
        myProfileEditRequest
          ? 'Nothing has changed from your pending request.'
          : 'Nothing has changed from your current details.'
      );
      return;
    }
    setEditError('');
    setSubmittingEdit(true);
    try {
      await submitProfileEditRequest(clubId, uid, playerId, first, last, email);
      setMyProfileEditRequest({ uid, playerId, firstName: first, lastName: last, email });
      setIsEditingProfile(false);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Failed to send request.');
    } finally {
      setSubmittingEdit(false);
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
    <Container className="py-4" style={{ maxWidth: 840 }}>
      <h3>{isAdmin ? 'Attendance' : 'My attendance'}</h3>
      {error && <Alert variant="danger">{error}</Alert>}

      {isAdmin && (
        <Form.Group className="mb-3" controlId="attendance-player">
          <Form.Label>View attendance for</Form.Label>
          <Form.Select
            value={playerId ?? ''}
            onChange={(event) => {
              setSelectedSession(null);
              setPlayerId(event.target.value || null);
            }}
            disabled={players.length === 0}
          >
            {players.length === 0
              ? <option value="">No players</option>
              : players.map((option) => (
                  <option key={option.id} value={option.id}>
                    {[option.firstName, option.lastName].filter(Boolean).join(' ') || option.id}
                  </option>
                ))}
          </Form.Select>
        </Form.Group>
      )}

      {!playerId ? (
        isAdmin ? (
          <Alert variant="info">There are no players in this club yet.</Alert>
        ) :
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
                  <Form.Group className="mb-2" controlId="attendance-link-request-first-name">
                    <Form.Label>First name</Form.Label>
                    <Form.Control value={reqFirst} onChange={(e) => setReqFirst(e.target.value)} disabled={submitting} />
                  </Form.Group>
                </Col>
                <Col sm={6}>
                  <Form.Group className="mb-2" controlId="attendance-link-request-last-name">
                    <Form.Label>Last name</Form.Label>
                    <Form.Control value={reqLast} onChange={(e) => setReqLast(e.target.value)} disabled={submitting} />
                  </Form.Group>
                </Col>
              </Row>
              <Form.Group className="mb-3" controlId="attendance-link-request-email">
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
            <Card.Body>
              <div className="d-flex justify-content-between align-items-center flex-wrap gap-2">
                <span>{player ? `${player.firstName} ${player.lastName ?? ''}`.trim() : 'Your player'}</span>
                <div className="d-flex align-items-center gap-3">
                  {player && (
                    <span>
                      Balance:{' '}
                      <strong className={player.balance < 0 ? 'text-danger' : 'text-success'}>
                        {money(player.balance)}
                      </strong>
                      {(player.owed ?? 0) > 0 && (
                        <>
                          {' · '}Owed:{' '}
                          <strong className="text-danger">{money(player.owed ?? 0)}</strong>
                        </>
                      )}
                    </span>
                  )}
                  {playerId === linkedPlayerId && !isEditingProfile && (
                    <Button variant="outline-secondary" size="sm" onClick={startEditingProfile}>
                      Edit details
                    </Button>
                  )}
                </div>
              </div>

              {playerId === linkedPlayerId && myProfileEditRequest && !isEditingProfile && (
                <Alert variant="info" className="mt-3 mb-0 py-2">
                  Your request to update your details is awaiting admin approval.
                </Alert>
              )}

              {playerId === linkedPlayerId && isEditingProfile && (
                <div className="mt-3 p-3 border rounded">
                  {editError && <Alert variant="danger" className="py-1 small">{editError}</Alert>}
                  <Row>
                    <Col sm={6}>
                      <Form.Group className="mb-2" controlId="attendance-edit-first-name">
                        <Form.Label>First name</Form.Label>
                        <Form.Control value={edFirst} onChange={(e) => setEdFirst(e.target.value)} disabled={submittingEdit} />
                      </Form.Group>
                    </Col>
                    <Col sm={6}>
                      <Form.Group className="mb-2" controlId="attendance-edit-last-name">
                        <Form.Label>Last name</Form.Label>
                        <Form.Control value={edLast} onChange={(e) => setEdLast(e.target.value)} disabled={submittingEdit} />
                      </Form.Group>
                    </Col>
                  </Row>
                  <Form.Group className="mb-2" controlId="attendance-edit-email">
                    <Form.Label>Email</Form.Label>
                    <Form.Control type="email" value={edEmail} onChange={(e) => setEdEmail(e.target.value)} disabled={submittingEdit} />
                  </Form.Group>
                  <div className="d-flex gap-2">
                    <Button size="sm" variant="primary" onClick={handleSubmitProfileEdit} disabled={submittingEdit || !edFirst.trim()}>
                      {submittingEdit ? <Spinner size="sm" animation="border" /> : 'Submit for approval'}
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => setIsEditingProfile(false)} disabled={submittingEdit}>
                      Cancel
                    </Button>
                  </div>
                  <Form.Text muted className="d-block mt-2">
                    Changes are reviewed by an admin before they take effect.
                  </Form.Text>
                </div>
              )}
            </Card.Body>
          </Card>

          <Tabs defaultActiveKey="sessions" className="mb-3">
            <Tab eventKey="sessions" title="Sessions attended">
              {attended.length === 0 ? (
                <p className="text-muted">No sessions attended yet.</p>
              ) : (
                <Table hover striped responsive size="sm" className="align-middle mb-0">
                  <thead>
                    <tr className="table-light">
                      <th>Date</th>
                      <th className="text-end">Cost</th>
                      <th className="text-end">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {attended.map((s) => {
                      const sp = (s.players ?? []).find((p) => p.id === playerId);
                      const d = toJSDate(s.date);
                      const status = sp?.comped
                        ? { label: 'Comped', bg: 'warning' }
                        : sp && !isSessionPlayerUnpaid(sp)
                          ? { label: 'Paid', bg: 'success' }
                          : { label: 'Unpaid', bg: 'danger' };
                      return (
                        <tr key={s.id} style={{ cursor: 'pointer' }} onClick={() => setSelectedSession(s)}>
                          <td className="text-nowrap">{d ? format(d, 'MMM d, yyyy') : '—'}</td>
                          <td className="text-end" style={{ fontVariantNumeric: 'tabular-nums' }}>{money(sp?.cost ?? 0)}</td>
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
                <Table hover striped responsive size="sm" className="align-middle mb-0">
                  <thead>
                    <tr className="table-light">
                      <th title="When this entry was recorded (not necessarily the session date)">Recorded</th>
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
                          <td className="text-nowrap">{d ? format(d, 'MMM d, yyyy h:mm a') : '—'}</td>
                          <td><Badge bg={REASON_BADGE[e.reason] ?? 'secondary'}>{REASON_LABELS[e.reason] ?? e.reason}</Badge></td>
                          <td style={{ maxWidth: 320, whiteSpace: 'normal', wordBreak: 'break-word' }}>
                            {e.note || <span className="text-muted">—</span>}
                          </td>
                          <td
                            className={`text-end ${e.delta < 0 ? 'text-danger' : 'text-success'}`}
                            style={{ fontVariantNumeric: 'tabular-nums' }}
                          >
                            {money(e.delta)}
                          </td>
                          <td className="text-end fw-medium" style={{ fontVariantNumeric: 'tabular-nums' }}>
                            {typeof e.balanceAfter === 'number' ? money(e.balanceAfter) : <span className="text-muted">—</span>}
                          </td>
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
                    {sp?.comped ? <Badge bg="warning">Comped</Badge> : sp && !isSessionPlayerUnpaid(sp) ? <Badge bg="success">Paid</Badge> : <Badge bg="danger">Unpaid</Badge>}
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
