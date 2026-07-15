import React, { useEffect, useState } from 'react';
import { Container, Card, Table, Spinner, Alert, Badge } from 'react-bootstrap';
import { format } from 'date-fns';
import { fetchMemberPlayerId, fetchPlayerLedger } from '../services/firebase';
import { auth } from '../services/firebase/client';
import { toJSDate } from '../services/firebase/utils';
import { useAppSelector } from '../hooks';
import { selectCurrentClubId } from '../features/club/clubSlice';
import { selectPlayerById } from '../features/players/playersSlice';
import type { BalanceLedgerEntry } from '../types';
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

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
        setLedger(pid ? await fetchPlayerLedger(pid) : []);
      } catch {
        if (!cancelled) setError('Failed to load your attendance.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [clubId, uid]);

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
        <Alert variant="info">
          You're not linked to a player in this club yet. Ask a club admin to link your account —
          share your user ID (find it on the Account page).
        </Alert>
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

          <Card>
            <Card.Header>Transactions</Card.Header>
            <Card.Body>
              {ledger.length === 0 ? (
                <p className="text-muted mb-0">No transactions yet.</p>
              ) : (
                <Table hover responsive size="sm" className="mb-0">
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
            </Card.Body>
          </Card>
        </>
      )}
    </Container>
  );
}
