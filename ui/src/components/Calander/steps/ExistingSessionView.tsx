import React, { useMemo } from 'react';
import { Button, Col, ListGroup, Row } from 'react-bootstrap';
import { format } from 'date-fns';
import { useAppSelector } from 'hooks';
import { selectPlayerById } from '../../../features/players/playersSlice';
import { togglePlayerHighlightStatus, togglePlayerPaidStatus } from '../../../services/firebase';
import type { Session, SessionPlayer } from 'types';
import type { RootState } from '../../../store';

interface Props {
  session:         Session;
  onSessionUpdate: (id: string) => void;
  onEdit:          () => void;
}

export default function ExistingSessionView({ session, onSessionUpdate, onEdit }: Props) {
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
            onTogglePaid={() => refresh(() => togglePlayerPaidStatus(session.id, player.id))}
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

      <div className="d-flex justify-content-end mt-3">
        <Button variant="primary" onClick={onEdit}>Edit</Button>
      </div>
    </>
  );
}

function PlayerRow({
  player, onTogglePaid, onToggleHighlight,
}: {
  player:            SessionPlayer;
  onTogglePaid:      () => void;
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
        <Button size="sm" variant={player.highlighted ? 'warning' : 'outline-secondary'} onClick={onToggleHighlight}>
          {player.highlighted ? '★' : '☆'}
        </Button>
        <Button size="sm" variant={player.paid ? 'success' : 'outline-secondary'} onClick={onTogglePaid} style={{ minWidth: 110 }}>
          {player.paid ? '✓ Paid' : 'Mark as Paid'}
        </Button>
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
