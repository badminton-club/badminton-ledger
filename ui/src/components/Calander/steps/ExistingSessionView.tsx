import React, { useMemo, useState } from 'react';
import { Alert, Button, Col, Form, ListGroup, Row } from 'react-bootstrap';
import { format } from 'date-fns';
import { useAppSelector } from 'hooks';
import { selectPlayerById } from '../../../features/players/playersSlice';
import { selectIsClubAdmin } from '../../../features/club/clubSlice';
import { togglePlayerHighlightStatus, togglePlayerPaidStatus, togglePlayerCompStatus } from '../../../services/firebase';
import type { Session, SessionPlayer } from 'types';
import type { RootState } from '../../../store';

interface Props {
  session:         Session;
  onSessionUpdate: (id: string) => void;
  onEdit:          () => void;
  onDelete:        (id: string) => Promise<void>;
}

export default function ExistingSessionView({ session, onSessionUpdate, onEdit, onDelete }: Props) {
  const isAdmin = useAppSelector(selectIsClubAdmin);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteText, setDeleteText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const handleDelete = async () => {
    setDeleteError('');
    setDeleting(true);
    try {
      await onDelete(session.id);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete session.');
      setDeleting(false);
    }
  };

  const paidTotal = useMemo(
    () => session.players.filter(p => p.paid).reduce((s, p) => s + p.cost, 0),
    [session.players]
  );
  const highlightedTotal = useMemo(
    () => session.players.filter(p => p.highlighted).reduce((s, p) => s + p.cost, 0),
    [session.players]
  );
  const totalBirds = session.birdieUsage?.reduce((s, u) => s + u.quantity, 0) ?? 0;

  const refresh = async (fn: () => Promise<void>) => {
    await fn();
    onSessionUpdate(session.id);
  };

  return (
    <>
      <h6>Session Date: {format(session.date, 'PPP')}</h6>
      {session.location && <p><strong>Location:</strong> {session.location}</p>}
      <p><strong>Birdies Used:</strong> {totalBirds || 'N/A'}</p>

      <h6 className="mt-3">Players</h6>
      <ListGroup variant="flush">
        {session.players.length === 0 && (
          <ListGroup.Item>No players listed.</ListGroup.Item>
        )}
        {session.players.map(player => (
          <PlayerRow
            key={player.id}
            player={player}
            isAdmin={isAdmin}
            onTogglePaid={() => refresh(() => togglePlayerPaidStatus(session.id, player.id))}
            onToggleComp={() => refresh(() => togglePlayerCompStatus(session.id, player.id))}
            onToggleHighlight={() => refresh(() => togglePlayerHighlightStatus(session.id, player.id))}
          />
        ))}
      </ListGroup>

      <div className="mt-4 p-3 bg-light border rounded">
        <h6 className="mb-2">Session Cost Summary</h6>
        <SummaryRow label="Total Court Cost"              value={`$${(session.totalCourtCost ?? 0).toFixed(2)}`} />
        <SummaryRow label="Total Birdie Cost"             value={`$${(session.totalBirdieCost ?? 0).toFixed(2)}`} />
        <SummaryRow label="Total Session Cost"            value={`$${(session.totalSessionCost ?? 0).toFixed(2)}`} bold />
        <SummaryRow label="Players"                       value={String(session.players.length)} />
        <SummaryRow label="Unpaid players"                value={String(session.players.filter(p => !p.paid).length)} />
        <SummaryRow label="Total Paid"                    value={`$${paidTotal.toFixed(2)}`} />
        <SummaryRow label="Total Due"                     value={`$${(session.totalSessionCost - paidTotal).toFixed(2)}`} />
        <SummaryRow
          label="Total Due (excl. highlighted)"
          value={`$${(session.totalSessionCost - highlightedTotal).toFixed(2)}`}
        />
      </div>

      {isAdmin && (
        <div className="d-flex justify-content-end mt-3 gap-2">
          <Button variant="outline-danger" onClick={() => setConfirmingDelete(true)} disabled={confirmingDelete}>
            Delete
          </Button>
          <Button variant="primary" onClick={onEdit}>Edit</Button>
        </div>
      )}

      {confirmingDelete && (
        <div className="mt-3 p-3 border border-danger rounded">
          <p className="mb-2 text-danger">
            This permanently deletes the session and reverses its inventory and balance
            effects (a copy is archived). Type <strong>DELETE</strong> to confirm.
          </p>
          <Form.Control
            className="mb-2"
            value={deleteText}
            onChange={e => setDeleteText(e.target.value)}
            placeholder="DELETE"
            disabled={deleting}
          />
          {deleteError && <Alert variant="danger" className="py-1 small mb-2">{deleteError}</Alert>}
          <div className="d-flex justify-content-end gap-2">
            <Button
              variant="secondary" size="sm" disabled={deleting}
              onClick={() => { setConfirmingDelete(false); setDeleteText(''); setDeleteError(''); }}
            >
              Cancel
            </Button>
            <Button
              variant="danger" size="sm"
              disabled={deleteText !== 'DELETE' || deleting}
              onClick={handleDelete}
            >
              {deleting ? 'Deleting…' : 'Delete permanently'}
            </Button>
          </div>
        </div>
      )}
    </>
  );
}

function PlayerRow({
  player, isAdmin, onTogglePaid, onToggleComp, onToggleHighlight,
}: {
  player:            SessionPlayer;
  isAdmin:           boolean;
  onTogglePaid:      () => void;
  onToggleComp:      () => void;
  onToggleHighlight: () => void;
}) {
  const stored = useAppSelector((s: RootState) => selectPlayerById(s, player.id));
  const name   = stored
    ? [stored.firstName, stored.lastName].filter(Boolean).join(' ')
    : player.id;

  return (
    <ListGroup.Item
      className="d-flex justify-content-between align-items-center"
      style={{
        backgroundColor: player.highlighted ? '#fff3cd' : 'transparent',
        transition:      'background-color 0.2s',
      }}
    >
      <span>{name}</span>
      <div className="d-flex align-items-center gap-2">
        <span className={player.paid ? 'text-muted' : ''}>${player.cost.toFixed(2)}</span>
        {isAdmin ? (
          <>
            <Button size="sm" variant={player.highlighted ? 'warning' : 'outline-secondary'} onClick={onToggleHighlight}>
              {player.highlighted ? '★' : '☆'}
            </Button>
            <Button
              size="sm"
              variant="warning"
              onClick={onToggleComp}
              style={{
                minWidth: 72,
                backgroundColor: player.comped ? '#b8860b' : 'transparent',
                borderColor: '#b8860b',
                color: player.comped ? '#fff' : '#b8860b',
              }}
            >
              {player.comped ? '✓ Comp' : 'Comp'}
            </Button>
            <Button size="sm" variant={player.paid ? 'success' : 'outline-secondary'} onClick={onTogglePaid} style={{ minWidth: 110 }}>
              {player.paid ? '✓ Paid' : 'Mark as Paid'}
            </Button>
          </>
        ) : (
          <span className={player.comped ? 'text-info' : player.paid ? 'text-success' : 'text-danger'}>
            {player.comped ? 'Comped' : player.paid ? 'Paid' : 'Unpaid'}
          </span>
        )}
      </div>
    </ListGroup.Item>
  );
}

function SummaryRow({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <Row className={bold ? 'fw-bold my-1 pt-1 border-top' : ''}>
      <Col xs={7}>{label}</Col>
      <Col xs={5} className="text-end">{value}</Col>
    </Row>
  );
}
