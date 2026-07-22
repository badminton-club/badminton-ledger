import React, { useMemo, useState } from 'react';
import { Alert, Badge, Button, ButtonGroup, Col, Dropdown, Form, ListGroup, Row } from 'react-bootstrap';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { useAppSelector } from 'hooks';
import { selectPlayerById, selectAllPlayers } from '../../../features/players/playersSlice';
import { selectDisabledTabs, selectIsClubAdmin } from '../../../features/club/clubSlice';
import { setPlayerSettlement, setPlayerPaidBy } from '../../../services/firebase';
import type { PaidVia, Session, SessionPlayer } from 'types';
import type { RootState } from '../../../store';

interface Props {
  session:         Session;
  onSessionUpdate: (id: string) => void;
  onEdit:          () => void;
  onDelete:        (id: string) => Promise<void>;
}

export default function ExistingSessionView({ session, onSessionUpdate, onEdit, onDelete }: Props) {
  const isAdmin = useAppSelector(selectIsClubAdmin);
  const disabledTabs = useAppSelector(selectDisabledTabs);
  const birdiesEnabled = !disabledTabs.includes('birdies');
  const allPlayers = useAppSelector(selectAllPlayers);
  const payerOptions = useMemo(
    () => allPlayers.map(p => ({
      id:      p.id,
      name:    [p.firstName, p.lastName].filter(Boolean).join(' '),
      balance: p.balance,
    })),
    [allPlayers],
  );
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
  const compedTotal = useMemo(
    () => session.players.filter(p => p.comped).reduce((s, p) => s + p.cost, 0),
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
      {birdiesEnabled && <p><strong>Birdies Used:</strong> {totalBirds || 'N/A'}</p>}

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
            payerOptions={payerOptions}
            onSetSettlement={(method) => refresh(() => setPlayerSettlement(session.id, player.id, method))}
            onSetPaidBy={(payerId) => refresh(() => setPlayerPaidBy(session.id, player.id, payerId))}
          />
        ))}
      </ListGroup>

      <div className="mt-4 p-3 bg-light border rounded">
        <h6 className="mb-2">Session Cost Summary</h6>
        <SummaryRow label="Total Court Cost"              value={`$${(session.totalCourtCost ?? 0).toFixed(2)}`} />
        {birdiesEnabled && <SummaryRow label="Total Birdie Cost" value={`$${(session.totalBirdieCost ?? 0).toFixed(2)}`} />}
        <SummaryRow label="Total Session Cost"            value={`$${(session.totalSessionCost ?? 0).toFixed(2)}`} bold />
        <SummaryRow label="Players"                       value={String(session.players.length)} />
        <SummaryRow label="Unpaid players"                value={String(session.players.filter(p => !p.paid).length)} />
        <SummaryRow label="Total Paid"                    value={`$${paidTotal.toFixed(2)}`} />
        <SummaryRow label="Total Due"                     value={`$${(session.totalSessionCost - paidTotal).toFixed(2)}`} />
        <SummaryRow
          label="Total Due (excl. comped players)"
          value={`$${(session.totalSessionCost - compedTotal).toFixed(2)}`}
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
  player, isAdmin, payerOptions, onSetSettlement, onSetPaidBy,
}: {
  player:            SessionPlayer;
  isAdmin:           boolean;
  payerOptions:      { id: string; name: string; balance: number }[];
  onSetSettlement:   (method: PaidVia) => void;
  onSetPaidBy:       (payerId: string) => void;
}) {
  const stored = useAppSelector((s: RootState) => selectPlayerById(s, player.id));
  const name   = stored
    ? [stored.firstName, stored.lastName].filter(Boolean).join(' ')
    : player.id;

  const currentVia: PaidVia =
    player.paidVia ?? (player.comped ? 'comp' : player.paid ? 'etransfer' : null);

  // Resolve the payer's name when this player's dues were covered from another's balance.
  const payer = useAppSelector((s: RootState) =>
    player.paidBy ? selectPlayerById(s, player.paidBy) : undefined
  );
  const payerName = payer
    ? [payer.firstName, payer.lastName].filter(Boolean).join(' ')
    : player.paidBy;

  // Choosing 'balance' draws the session cost from prepaid credit, which can leave the
  // player negative. Compute the resulting balance to warn.
  const balanceIfDrawn = (stored?.balance ?? 0) - (currentVia === 'balance' ? 0 : player.cost);

  const handleSelect = (method: PaidVia) => {
    if (method === currentVia) return;
    if (method === 'balance' && balanceIfDrawn < 0) {
      const ok = window.confirm(
        `${name} doesn't have enough balance to cover $${player.cost.toFixed(2)}.\n` +
        `Their balance will go to $${balanceIfDrawn.toFixed(2)} (negative). Continue?`
      );
      if (!ok) return;
    }
    onSetSettlement(method);
  };

  // Cover this player's dues from another player's prepaid balance ('transfer').
  const handlePaidBy = (payerId: string) => {
    if (!payerId || payerId === player.paidBy) return;
    const opt = payerOptions.find(o => o.id === payerId);
    if (opt && opt.balance < player.cost) {
      const ok = window.confirm(
        `${opt.name} has $${opt.balance.toFixed(2)} — covering $${player.cost.toFixed(2)} ` +
        `will leave them at $${(opt.balance - player.cost).toFixed(2)} (negative). Continue?`
      );
      if (!ok) return;
    }
    onSetPaidBy(payerId);
  };

  // Clearly marks how the session was settled (shown to members).
  const settlement = player.comped
    ? { label: 'Comp', bg: 'info' }
    : currentVia === 'transfer'
      ? { label: payerName ? `Paid by ${payerName}` : 'Covered', bg: 'primary' }
      : player.paid
        ? (player.paidVia === 'balance'
            ? { label: 'Balance', bg: 'primary' }
            : { label: 'e-Transfer', bg: 'success' })
        : { label: 'Unpaid', bg: 'danger' };

  const options: { method: PaidVia; label: string; activeVariant: string }[] = [
    { method: null,        label: 'Unpaid',     activeVariant: 'danger'  },
    { method: 'comp',      label: 'Comp',       activeVariant: 'info'    },
    { method: 'balance',   label: 'Balance',    activeVariant: 'primary' },
    { method: 'etransfer', label: 'e-Transfer', activeVariant: 'success' },
  ];

  const otherPlayers = payerOptions.filter(o => o.id !== player.id);

  return (
    <ListGroup.Item
      className="d-flex justify-content-between align-items-center"
      style={{
        transition:      'background-color 0.2s',
      }}
    >
      <span>
        {isAdmin
          ? <Link to={`/players?playerId=${player.id}`}>{name}</Link>
          : name}
      </span>
      <div className="d-flex align-items-center gap-2">
        <span className={player.paid ? 'text-muted' : ''}>${player.cost.toFixed(2)}</span>
        {isAdmin ? (
          <ButtonGroup size="sm">
              {options.map(o => (
                <React.Fragment key={o.label}>
                  <Button
                    variant={currentVia === o.method ? o.activeVariant : 'outline-secondary'}
                    onClick={() => handleSelect(o.method)}
                  >
                    {o.label}
                  </Button>
                  {o.method === null && otherPlayers.length > 0 && (
                    <Dropdown as={ButtonGroup} align="end">
                      <Dropdown.Toggle
                        size="sm"
                        variant={currentVia === 'transfer' ? 'primary' : 'outline-secondary'}
                        title="Pay this player's dues from another player's balance"
                        className="text-truncate"
                        style={{ maxWidth: 150 }}
                      >
                        {currentVia === 'transfer' && payerName ? payerName : 'Paid by'}
                      </Dropdown.Toggle>
                      <Dropdown.Menu style={{ maxHeight: 320, overflowY: 'auto' }}>
                        <Dropdown.Header>Pay from another's balance</Dropdown.Header>
                        {otherPlayers.map(op => (
                          <Dropdown.Item
                            key={op.id}
                            active={currentVia === 'transfer' && player.paidBy === op.id}
                            onClick={() => handlePaidBy(op.id)}
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
              ))}
            </ButtonGroup>
        ) : (
          <Badge bg={settlement.bg} style={{ fontSize: 10, minWidth: 72 }}>
            {settlement.label}
          </Badge>
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
