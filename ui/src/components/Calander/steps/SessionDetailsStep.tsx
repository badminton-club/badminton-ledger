import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert, Button, Col, Form, InputGroup, Row,
} from 'react-bootstrap';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { useAppDispatch, useAppSelector } from '../../../hooks';
import {
  selectConfirmedPlayers,
  selectAddError,
  setConfirmedPlayers,
  setAddError,
} from '../../../features/SessionModal/sessionModalSlice';

import { selectPlayerById, selectAllPlayers } from '../../../features/players/playersSlice';
import { fetchBirdieInventory, fetchCourtCredits } from '../../../services/firebase';
import { addPlayer } from '../../../services/firebase/players';
import AddPlayerModal from '../../AddPlayerModal';
import type {
  BirdieBatch, CourtCreditBatch, Session,
  BirdieUsage, CourtCreditUsage, SessionPlayer, NewPlayerInput,
} from 'types';
import type { RootState } from '../../../store';
import { useAppSelector as useSelector } from '../../../hooks';

// ─── Types ────────────────────────────────────────────────────────────────────

interface CourtCreditAllocation {
  id:           string;
  hoursUsed:    number;
  hoursLeft:    number;
  costPerHour:  number;
  costFromBatch: number;
}

interface SavedSession {
  courtCount:        number;
  totalCourtCost:    number;
  totalBirdieCost:   number;
  totalSessionCost:  number;
  birdieUsage:       BirdieUsage[];
  courtCreditUsage:  CourtCreditUsage[];
  players:           SessionPlayer[];
}

interface Props {
  session?: Session;
  onSave:   (data: SavedSession) => Promise<void>;
  onCancel: () => void;
}

const EMPTY_BIRDIE: BirdieUsage = { id: '', quantity: 0 };

// ─── Component ────────────────────────────────────────────────────────────────

export default function SessionDetailsStep({ session, onSave, onCancel }: Props) {
  const dispatch          = useAppDispatch();
  const confirmedPlayers  = useAppSelector(selectConfirmedPlayers);
  const addError          = useAppSelector(selectAddError);
  const allPlayers        = useAppSelector(selectAllPlayers);
  const [playerToAdd, setPlayerToAdd] = useState('');
  const [showNewPlayerModal, setShowNewPlayerModal] = useState(false);

  const [courtCount,      setCourtCount]      = useState(session ? String(
    Math.round((session.courtCreditUsage?.reduce((s, c) => s + c.hoursUsed, 0) ?? 0) / 2)
  ) : '4');
  const [useCredits,      setUseCredits]      = useState(true);
  const [manualCourtCost, setManualCourtCost] = useState('');
  const [birdieUsage,     setBirdieUsage]     = useState<BirdieUsage[]>(
    session?.birdieUsage?.length ? session.birdieUsage : [{ ...EMPTY_BIRDIE }]
  );
  const [birdieInventory, setBirdieInventory] = useState<BirdieBatch[]>([]);
  const [courtCredits,    setCourtCredits]    = useState<CourtCreditBatch[]>([]);

  // Load inventory once
  useEffect(() => {
    fetchBirdieInventory().then(setBirdieInventory).catch(console.error);
    fetchCourtCredits().then(setCourtCredits).catch(console.error);
  }, []);

  // Pre-fill when editing
  useEffect(() => {
    if (session?.birdieUsage?.length) setBirdieUsage(session.birdieUsage);
  }, [session]);

  // ── Cost calculations ──────────────────────────────────────────────────────

  const courtCreditAllocation = useMemo<CourtCreditAllocation[]>(() => {
    if (!useCredits) return [];
    const totalHours = parseFloat(courtCount) * 2;
    if (isNaN(totalHours) || totalHours <= 0) return [];

    let hoursLeft = totalHours;
    const allocs: CourtCreditAllocation[] = [];

    for (const batch of courtCredits) {
      if (hoursLeft <= 0 || batch.remainingHours <= 0) continue;
      const taken = Math.min(batch.remainingHours, hoursLeft);
      allocs.push({
        id:            batch.id,
        hoursUsed:     taken,
        hoursLeft:     batch.remainingHours - taken,
        costPerHour:   batch.costPerHour,
        costFromBatch: taken * batch.costPerHour,
      });
      hoursLeft -= taken;
    }
    return allocs;
  }, [useCredits, courtCount, courtCredits]);

  // Each court is 2 hours. Warn if the requested courts exceed the remaining credit balance.
  const totalRemainingHours = useMemo(
    () => courtCredits.reduce((sum, b) => sum + b.remainingHours, 0),
    [courtCredits],
  );
  const requiredCourtHours = (parseFloat(courtCount) || 0) * 2;
  const notEnoughCredits = useCredits && requiredCourtHours > totalRemainingHours;

  const totalCourtCost = useMemo(() => {
    if (useCredits) return courtCreditAllocation.reduce((s, a) => s + a.costFromBatch, 0);
    return parseFloat(manualCourtCost) * parseFloat(courtCount) || 0;
  }, [useCredits, courtCreditAllocation, manualCourtCost, courtCount]);

  const totalBirdieCost = useMemo(() => {
    return birdieUsage.reduce((sum, usage) => {
      const batch = birdieInventory.find(b => b.id === usage.id);
      if (!batch || !usage.quantity) return sum;
      return sum + (usage.quantity / batch.birdsPerTube) * batch.costPerTube;
    }, 0);
  }, [birdieUsage, birdieInventory]);

  const totalSessionCost = totalCourtCost + totalBirdieCost;

  const playerCosts: SessionPlayer[] = useMemo(() => {
    const totalPercentage = confirmedPlayers.reduce((s, p) => s + p.percentage, 0);
    const perUnit         = totalPercentage > 0 ? totalSessionCost / totalPercentage : 0;
    return confirmedPlayers.map(p => {
      const existing = session?.players.find(sp => sp.id === p.id);
      return {
        id:          p.id,
        percentage:  p.percentage,
        cost:        parseFloat((perUnit * p.percentage).toFixed(2)),
        paid:        existing?.paid ?? false,
        paidVia:     existing?.paidVia ?? null,
        comped:      existing?.comped ?? false,
        highlighted: existing?.highlighted ?? false,
      };
    });
  }, [confirmedPlayers, totalSessionCost, session]);

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handleBirdieChange = (index: number, field: keyof BirdieUsage, value: string) => {
    const updated = birdieUsage.map((u, i) => {
      if (i !== index) return u;
      if (field === 'quantity') {
        const qty = parseInt(value, 10);
        const batch = birdieInventory.find(b => b.id === u.id);
        if (batch) {
          const avail = batch.unopenedTubesRemaining * batch.birdsPerTube + batch.birdsInOpenTube;
          if (!isNaN(qty) && qty > avail) {
            dispatch(setAddError(`Only ${avail} birds remain in this batch.`));
            return u;
          }
        }
        return { ...u, quantity: isNaN(qty) || qty < 0 ? 0 : qty };
      }
      return { ...u, [field]: value };
    });
    setBirdieUsage(updated);
    dispatch(setAddError(''));
  };

  const handlePercentageChange = (id: string, value: string) => {
    const num = Math.max(0, parseFloat(value) || 0);
    dispatch(setConfirmedPlayers(
      confirmedPlayers.map(p => p.id === id ? { ...p, percentage: num } : p)
    ));
  };

  const handleAddPlayer = () => {
    if (!playerToAdd || confirmedPlayers.some(p => p.id === playerToAdd)) return;
    dispatch(setConfirmedPlayers([...confirmedPlayers, { id: playerToAdd, percentage: 1 }]));
    setPlayerToAdd('');
  };

  const handleCreatePlayer = async (data: NewPlayerInput) => {
    const id = await addPlayer(data);
    dispatch(setConfirmedPlayers([...confirmedPlayers, { id, percentage: 1 }]));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSave({
      courtCount:        parseFloat(courtCount),
      totalCourtCost,
      totalBirdieCost,
      totalSessionCost,
      birdieUsage:       birdieUsage.filter(u => u.id && u.quantity > 0),
      courtCreditUsage:  courtCreditAllocation.map(a => ({ id: a.id, hoursUsed: a.hoursUsed })),
      players:           playerCosts,
    });
  };

  return (
    <>
    <Form onSubmit={handleSubmit}>
      {addError && <Alert variant="danger">{addError}</Alert>}

      {/* ── Players ─────────────────────────────────────────────────────── */}
      <Row className="fw-bold mb-1">
        <Col md={6}>Player</Col>
        <Col md={4}>Cost / Fraction</Col>
      </Row>
      {playerCosts.map((player, i) => (
        <PlayerRow
          key={player.id}
          playerId={player.id}
          cost={player.cost}
          percentage={player.percentage}
          onPercentageChange={v => handlePercentageChange(player.id, v)}
          onRemove={() => dispatch(setConfirmedPlayers(confirmedPlayers.filter(p => p.id !== player.id)))}
        />
      ))}

      <Row className="mb-3">
        <Col md={9}>
          <InputGroup size="sm">
            <Form.Select value={playerToAdd} onChange={e => setPlayerToAdd(e.target.value)}>
              <option value="">+ Add existing player…</option>
              {allPlayers
                .filter(p => !confirmedPlayers.some(cp => cp.id === p.id))
                .map(p => (
                  <option key={p.id} value={p.id}>
                    {[p.firstName, p.lastName].filter(Boolean).join(' ')}
                  </option>
                ))}
            </Form.Select>
            <Button variant="outline-primary" disabled={!playerToAdd} onClick={handleAddPlayer}>
              Add
            </Button>
            <Button variant="outline-success" onClick={() => setShowNewPlayerModal(true)}>
              + New player
            </Button>
          </InputGroup>
        </Col>
      </Row>

      {/* ── Courts ──────────────────────────────────────────────────────── */}
      <Form.Group className="my-3">
        <Form.Check
          type="switch"
          label="Use pre-purchased court credits"
          checked={useCredits}
          onChange={() => setUseCredits(v => !v)}
          className="mb-2"
        />
        <InputGroup>
          <InputGroup.Text>Courts</InputGroup.Text>
          <Form.Control
            type="number" min="1"
            value={courtCount}
            onChange={e => setCourtCount(e.target.value)}
            style={{ maxWidth: 100 }}
          />
          {!useCredits && (
            <>
              <InputGroup.Text>$/court</InputGroup.Text>
              <Form.Control
                type="number" min="0" step="0.01"
                value={manualCourtCost}
                onChange={e => setManualCourtCost(e.target.value)}
              />
            </>
          )}
        </InputGroup>

        {useCredits && courtCreditAllocation.map(alloc => (
          <div key={alloc.id} className="mt-2 text-muted small">
            {alloc.hoursUsed} hrs @ ${alloc.costPerHour}/hr
            — {alloc.hoursLeft} hrs remaining in batch
          </div>
        ))}

        {notEnoughCredits && (
          <Alert variant="warning" className="mt-2 mb-0 py-2 small">
            Not enough court credits — {requiredCourtHours} hrs needed for {courtCount} court
            {Number(courtCount) === 1 ? '' : 's'}, but only {totalRemainingHours} hrs left.{' '}
            <Alert.Link as={Link} to="/credits">Add more here</Alert.Link>.
          </Alert>
        )}
      </Form.Group>

      {/* ── Birdies ─────────────────────────────────────────────────────── */}
      <Form.Label className="fw-semibold">Birdies Used</Form.Label>
      {birdieUsage.map((usage, i) => {
        const batch = birdieInventory.find(b => b.id === usage.id);
        const avail = batch
          ? batch.unopenedTubesRemaining * batch.birdsPerTube + batch.birdsInOpenTube
          : null;
        return (
          <InputGroup key={i} className="mb-2">
            <Form.Select
              value={usage.id}
              onChange={e => handleBirdieChange(i, 'id', e.target.value)}
            >
              <option value="">— Select batch —</option>
              {birdieInventory.map(b => {
                const remaining = b.unopenedTubesRemaining * b.birdsPerTube + b.birdsInOpenTube;
                return (
                  <option key={b.id} value={b.id} disabled={remaining <= 0}>
                    {b.name} ({format(b.purchaseDate, 'yyyy-MM-dd')},
                    ${b.costPerTube.toFixed(2)}/tube, {remaining} birds left)
                  </option>
                );
              })}
            </Form.Select>
            <Form.Control
              type="number" min="0"
              placeholder="# birds"
              value={usage.quantity || ''}
              disabled={!batch}
              onChange={e => handleBirdieChange(i, 'quantity', e.target.value)}
            />
            {avail != null && (
              <InputGroup.Text className="small text-muted">{avail} avail</InputGroup.Text>
            )}
            {birdieUsage.length > 1 && (
              <Button
                variant="outline-danger" size="sm"
                onClick={() => setBirdieUsage(birdieUsage.filter((_, idx) => idx !== i))}
              >✕</Button>
            )}
          </InputGroup>
        );
      })}
      <Button
        variant="outline-secondary" size="sm" className="mb-3"
        onClick={() => setBirdieUsage([...birdieUsage, { ...EMPTY_BIRDIE }])}
      >
        + Add another birdie batch
      </Button>

      {/* ── Cost summary ────────────────────────────────────────────────── */}
      <div className="p-3 bg-light border rounded mb-3">
        <h6 className="mb-2">Session Cost Summary</h6>
        <CostRow label="Court cost"  value={totalCourtCost} />
        <CostRow label="Birdie cost" value={totalBirdieCost} />
        <CostRow label="Total"       value={totalSessionCost} bold />
        {confirmedPlayers.length > 0 && (
          <CostRow
            label="Avg. per player"
            value={totalSessionCost / confirmedPlayers.length}
            muted
          />
        )}
      </div>

      <div className="d-flex justify-content-end gap-2">
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button variant="primary"   type="submit">Save Session</Button>
      </div>
    </Form>

    <AddPlayerModal
      show={showNewPlayerModal}
      onHide={() => setShowNewPlayerModal(false)}
      onAddPlayer={handleCreatePlayer}
      existingPlayers={allPlayers}
    />
    </>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function PlayerRow({
  playerId, cost, percentage, onPercentageChange, onRemove,
}: {
  playerId:            string;
  cost:                number;
  percentage:          number;
  onPercentageChange:  (v: string) => void;
  onRemove:            () => void;
}) {
  // Resolve name from Redux store — no names stored in session
  const player = useSelector((s: RootState) => selectPlayerById(s, playerId));
  const name   = player ? [player.firstName, player.lastName].filter(Boolean).join(' ') : playerId;

  return (
    <Row className="mb-1 align-items-center">
      <Col md={6}><span>{name}</span></Col>
      <Col md={5}>
        <InputGroup size="sm">
          <InputGroup.Text>${cost.toFixed(2)}</InputGroup.Text>
          <Form.Control
            type="number" min="0" step="0.25"
            value={percentage}
            onChange={e => onPercentageChange(e.target.value)}
            style={{ maxWidth: 90 }}
          />
          <Button variant="outline-danger" onClick={onRemove}>✕</Button>
        </InputGroup>
      </Col>
    </Row>
  );
}

function CostRow({
  label, value, bold, muted,
}: {
  label: string; value: number; bold?: boolean; muted?: boolean;
}) {
  return (
    <Row className={bold ? 'fw-bold border-top pt-1 mt-1' : muted ? 'text-muted' : ''}>
      <Col xs={7}>{label}</Col>
      <Col xs={5} className="text-end">${value.toFixed(2)}</Col>
    </Row>
  );
}
