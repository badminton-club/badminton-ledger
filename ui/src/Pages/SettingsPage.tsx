import React, { useState, useEffect, useCallback } from 'react';
import { Container, Card, Button, Form, Alert, Spinner, ListGroup, InputGroup, Badge } from 'react-bootstrap';
import { clearAllData, exportAllData, restoreAllData, CLEARABLE_COLLECTIONS, type ClearSummary, type BackupData } from '../services/firebase/admin';
import { addClubMember, setMemberPlayer, removeClubMember, fetchClubMembers, setClubTabEnabled, deleteClub, fetchUserClubs, fetchLinkRequests, deleteLinkRequest, addPlayer } from '../services/firebase';
import { auth } from '../services/firebase/client';
import { useAppDispatch, useAppSelector } from '../hooks';
import { selectAllPlayers } from '../features/players/playersSlice';
import {
  selectIsClubAdmin,
  selectIsClubSuperAdmin,
  selectCurrentClubId,
  selectDisabledTabs,
  setDisabledTabs,
  setClubs,
  setCurrentClub,
} from '../features/club/clubSlice';
import { TOGGLEABLE_TABS } from '../features/club/tabs';
import type { ClubMember, ClubRole, LinkRequest, Player } from '../types';

const CONFIRM_PHRASE = 'CLEAR ALL DATA';

export default function SettingsPage() {
  const dispatch = useAppDispatch();
  const isAdmin = useAppSelector(selectIsClubAdmin);
  const isSuperAdmin = useAppSelector(selectIsClubSuperAdmin);
  const clubId = useAppSelector(selectCurrentClubId);
  const disabledTabs = useAppSelector(selectDisabledTabs);
  const players = useAppSelector(selectAllPlayers);
  const uid = auth.currentUser?.uid ?? null;
  const checkingAdmin = false;
  const [confirmText, setConfirmText] = useState('');
  const [clearing, setClearing] = useState(false);
  const [result, setResult] = useState<ClearSummary | null>(null);
  const [error, setError] = useState('');
  const [backingUp, setBackingUp] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [restoreResult, setRestoreResult] = useState<ClearSummary | null>(null);
  const [ioError, setIoError] = useState('');

  const [members, setMembers] = useState<ClubMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [membersError, setMembersError] = useState('');
  const [newMemberUid, setNewMemberUid] = useState('');
  const [newMemberRole, setNewMemberRole] = useState<ClubRole>('member');
  const [addingMember, setAddingMember] = useState(false);
  const [assigningUid, setAssigningUid] = useState<string | null>(null);
  const [togglingTab, setTogglingTab] = useState<string | null>(null);
  const [tabsError, setTabsError] = useState('');

  const [requests, setRequests] = useState<LinkRequest[]>([]);
  const [requestsLoading, setRequestsLoading] = useState(false);
  const [requestsError, setRequestsError] = useState('');
  const [reqSel, setReqSel] = useState<Record<string, string>>({});
  const [processingReq, setProcessingReq] = useState<string | null>(null);

  const [deleteClubText, setDeleteClubText] = useState('');
  const [deletingClub, setDeletingClub] = useState(false);
  const [deleteClubError, setDeleteClubError] = useState('');

  const loadMembers = useCallback(async () => {
    if (!clubId) { setMembers([]); return; }
    setMembersLoading(true);
    setMembersError('');
    try {
      setMembers(await fetchClubMembers(clubId));
    } catch (err) {
      setMembersError(err instanceof Error ? err.message : 'Failed to load members.');
    } finally {
      setMembersLoading(false);
    }
  }, [clubId]);

  useEffect(() => { if (isAdmin && clubId) loadMembers(); }, [isAdmin, clubId, loadMembers]);

  const handleAddMember = async () => {
    if (!clubId) return;
    const target = newMemberUid.trim();
    if (!target) { setMembersError('Enter a user ID.'); return; }
    setMembersError('');
    setAddingMember(true);
    try {
      await addClubMember(clubId, target, newMemberRole);
      setNewMemberUid('');
      await loadMembers();
    } catch (err) {
      setMembersError(err instanceof Error ? err.message : 'Failed to add member.');
    } finally {
      setAddingMember(false);
    }
  };

  const handleAssignPlayer = async (memberUid: string, pid: string | null) => {
    if (!clubId) return;
    setMembersError('');
    setAssigningUid(memberUid);
    try {
      await setMemberPlayer(clubId, memberUid, pid);
      await loadMembers();
    } catch (err) {
      setMembersError(err instanceof Error ? err.message : 'Failed to link player.');
    } finally {
      setAssigningUid(null);
    }
  };

  const handleRemoveMember = async (memberUid: string) => {
    if (!clubId) return;
    if (!window.confirm('Remove this member from the club?')) return;
    setMembersError('');
    setAssigningUid(memberUid);
    try {
      await removeClubMember(clubId, memberUid);
      await loadMembers();
    } catch (err) {
      setMembersError(err instanceof Error ? err.message : 'Failed to remove member.');
    } finally {
      setAssigningUid(null);
    }
  };

  const loadRequests = useCallback(async () => {
    if (!clubId) { setRequests([]); return; }
    setRequestsLoading(true);
    setRequestsError('');
    try {
      const reqs = await fetchLinkRequests(clubId);
      setRequests(reqs);
      // Auto-suggest a matching player by email, then by full name.
      const suggestions: Record<string, string> = {};
      reqs.forEach((r) => {
        const match = players.find(
          (p) =>
            (!!p.email && !!r.email && p.email.toLowerCase() === r.email.toLowerCase()) ||
            `${p.firstName} ${p.lastName ?? ''}`.trim().toLowerCase() ===
              `${r.firstName} ${r.lastName ?? ''}`.trim().toLowerCase()
        );
        if (match) suggestions[r.uid] = match.id;
      });
      setReqSel((prev) => ({ ...suggestions, ...prev }));
    } catch (err) {
      setRequestsError(err instanceof Error ? err.message : 'Failed to load requests.');
    } finally {
      setRequestsLoading(false);
    }
  }, [clubId, players]);

  useEffect(() => { if (isAdmin && clubId) loadRequests(); }, [isAdmin, clubId, loadRequests]);

  const handleApproveRequest = async (req: LinkRequest) => {
    if (!clubId) return;
    const pid = reqSel[req.uid];
    if (!pid) { setRequestsError('Pick a player to link, or create a new one.'); return; }
    setRequestsError('');
    setProcessingReq(req.uid);
    try {
      await setMemberPlayer(clubId, req.uid, pid);
      await deleteLinkRequest(clubId, req.uid);
      await Promise.all([loadRequests(), loadMembers()]);
    } catch (err) {
      setRequestsError(err instanceof Error ? err.message : 'Failed to approve request.');
    } finally {
      setProcessingReq(null);
    }
  };

  const handleCreateAndLink = async (req: LinkRequest) => {
    if (!clubId) return;
    setRequestsError('');
    setProcessingReq(req.uid);
    try {
      const playerId = await addPlayer({ firstName: req.firstName, lastName: req.lastName, email: req.email || null, balance: 0, description: '' });
      await setMemberPlayer(clubId, req.uid, playerId);
      await deleteLinkRequest(clubId, req.uid);
      await Promise.all([loadRequests(), loadMembers()]);
    } catch (err) {
      setRequestsError(err instanceof Error ? err.message : 'Failed to create player.');
    } finally {
      setProcessingReq(null);
    }
  };

  const handleDismissRequest = async (req: LinkRequest) => {
    if (!clubId) return;
    setProcessingReq(req.uid);
    try {
      await deleteLinkRequest(clubId, req.uid);
      await loadRequests();
    } catch (err) {
      setRequestsError(err instanceof Error ? err.message : 'Failed to dismiss request.');
    } finally {
      setProcessingReq(null);
    }
  };

  const handleToggleTab = async (tabKey: string, enabled: boolean) => {
    if (!clubId) return;
    setTabsError('');
    setTogglingTab(tabKey);
    try {
      await setClubTabEnabled(clubId, tabKey, enabled);
      const next = enabled
        ? disabledTabs.filter((k) => k !== tabKey)
        : [...disabledTabs, tabKey];
      dispatch(setDisabledTabs(next));
    } catch (err) {
      setTabsError(err instanceof Error ? err.message : 'Failed to update the tab.');
    } finally {
      setTogglingTab(null);
    }
  };

  const handleDeleteClub = async () => {
    if (!clubId || !uid || deleteClubText !== clubId) return;
    if (!window.confirm(`Permanently delete the club "${clubId}"? This cannot be undone.`)) return;
    setDeleteClubError('');
    setDeletingClub(true);
    try {
      await deleteClub(clubId, uid);
      const next = await fetchUserClubs(uid);
      dispatch(setClubs(next));
      dispatch(setCurrentClub(next[0]?.id ?? null));
      setDeleteClubText('');
    } catch (err) {
      setDeleteClubError(err instanceof Error ? err.message : 'Failed to delete club.');
    } finally {
      setDeletingClub(false);
    }
  };

  const handleClear = async () => {
    setError('');
    setResult(null);
    if (confirmText !== CONFIRM_PHRASE) return;

    const confirmed = window.confirm(
      'This permanently deletes ALL sessions, players, inventory, credits, adjustments, and transactions. This cannot be undone. Continue?'
    );
    if (!confirmed) return;

    setClearing(true);
    try {
      const summary = await clearAllData();
      setResult(summary);
      setConfirmText('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to clear data.');
    } finally {
      setClearing(false);
    }
  };

  const handleBackup = async () => {
    setIoError('');
    setBackingUp(true);
    try {
      const data = await exportAllData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `badminton-ledger-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setIoError(err instanceof Error ? err.message : 'Backup failed.');
    } finally {
      setBackingUp(false);
    }
  };

  const handleRestoreFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!window.confirm('Restore overwrites any document that shares an ID with the backup. Continue?')) return;

    setIoError('');
    setRestoreResult(null);
    setRestoring(true);
    try {
      const backup = JSON.parse(await file.text()) as BackupData;
      setRestoreResult(await restoreAllData(backup));
    } catch (err) {
      setIoError(err instanceof Error ? err.message : 'Restore failed.');
    } finally {
      setRestoring(false);
    }
  };

  // Distinguish players who share a display name (append email, else a short id).
  const playerLabel = (p: Player) => {
    const name = `${p.firstName} ${p.lastName ?? ''}`.trim();
    const dup = players.filter(
      (x) => `${x.firstName} ${x.lastName ?? ''}`.trim().toLowerCase() === name.toLowerCase()
    ).length > 1;
    if (!dup) return name || p.id;
    return `${name || p.id} ${p.email ? `(${p.email})` : `#${p.id.slice(0, 4)}`}`;
  };

  if (checkingAdmin) {
    return (
      <Container className="mt-4 text-center">
        <Spinner animation="border" role="status" />
      </Container>
    );
  }

  if (!isAdmin) {
    return (
      <Container className="mt-4">
        <Alert variant="danger">You do not have permission to view this page.</Alert>
      </Container>
    );
  }

  return (
    <Container className="mt-4" style={{ maxWidth: 640 }}>
      <h3>Club settings</h3>
      <p className="text-muted">Settings for the club you currently have open.</p>

      <Card className="mt-3">
        <Card.Header>Tabs</Card.Header>
        <Card.Body>
          <Card.Text className="text-muted">
            Show or hide navbar tabs for this club. Settings, Account, and the calendar are always
            available.
          </Card.Text>
          {TOGGLEABLE_TABS.map((t) => (
            <Form.Check
              key={t.key}
              type="switch"
              id={`tab-toggle-${t.key}`}
              label={`Show the ${t.label} tab`}
              checked={!disabledTabs.includes(t.key)}
              disabled={togglingTab === t.key || !clubId}
              onChange={(e) => handleToggleTab(t.key, e.target.checked)}
            />
          ))}
          {tabsError && <Alert variant="danger" className="mt-2 mb-0 py-2">{tabsError}</Alert>}
        </Card.Body>
      </Card>

      <Card className="mt-3">
        <Card.Header>Link requests</Card.Header>
        <Card.Body>
          <Card.Text className="text-muted">
            People who asked to be linked to a player. Match each to an existing player, or create a
            new player record from their details.
          </Card.Text>
          {requestsError && <Alert variant="danger" className="py-2">{requestsError}</Alert>}
          {requestsLoading ? (
            <Spinner animation="border" size="sm" />
          ) : requests.length === 0 ? (
            <p className="text-muted mb-0">No pending requests.</p>
          ) : (
            <ListGroup variant="flush">
              {requests.map((r) => (
                <ListGroup.Item key={r.uid} className="d-flex justify-content-between align-items-center gap-2 flex-wrap">
                  <span>
                    <strong>{`${r.firstName} ${r.lastName ?? ''}`.trim() || '(no name)'}</strong>
                    {r.email && <span className="text-muted small ms-2">{r.email}</span>}
                  </span>
                  <span className="d-flex align-items-center gap-2 flex-wrap">
                    <Form.Select
                      size="sm"
                      value={reqSel[r.uid] ?? ''}
                      onChange={(e) => setReqSel((prev) => ({ ...prev, [r.uid]: e.target.value }))}
                      disabled={processingReq === r.uid}
                      style={{ minWidth: 160 }}
                    >
                      <option value="">— match a player —</option>
                      {players.map((p) => (
                        <option key={p.id} value={p.id}>{playerLabel(p)}</option>
                      ))}
                    </Form.Select>
                    <Button size="sm" variant="success" disabled={processingReq === r.uid || !reqSel[r.uid]} onClick={() => handleApproveRequest(r)}>
                      {processingReq === r.uid ? <Spinner size="sm" animation="border" /> : 'Approve'}
                    </Button>
                    <Button size="sm" variant="outline-primary" disabled={processingReq === r.uid} onClick={() => handleCreateAndLink(r)}>
                      Create player
                    </Button>
                    <Button size="sm" variant="outline-secondary" disabled={processingReq === r.uid} onClick={() => handleDismissRequest(r)}>
                      Dismiss
                    </Button>
                  </span>
                </ListGroup.Item>
              ))}
            </ListGroup>
          )}
        </Card.Body>
      </Card>

      <Card className="mt-3">
        <Card.Header>Members &amp; player links</Card.Header>
        <Card.Body>
          <Card.Text className="text-muted">
            Add people by their user ID (shown on their Account page) and link each to a player so
            they can see their own attendance.
          </Card.Text>

          <InputGroup className="mb-3">
            <Form.Control
              placeholder="User ID"
              value={newMemberUid}
              onChange={(e) => setNewMemberUid(e.target.value)}
              disabled={addingMember}
            />
            <Form.Select
              value={newMemberRole}
              onChange={(e) => setNewMemberRole(e.target.value as ClubRole)}
              disabled={addingMember}
              style={{ maxWidth: 130 }}
            >
              <option value="member">Member</option>
              {isSuperAdmin && <option value="admin">Admin</option>}
            </Form.Select>
            <Button variant="primary" onClick={handleAddMember} disabled={addingMember || !newMemberUid.trim()}>
              {addingMember ? <Spinner size="sm" animation="border" /> : 'Add'}
            </Button>
          </InputGroup>

          {membersError && <Alert variant="danger" className="py-2">{membersError}</Alert>}

          {membersLoading ? (
            <Spinner animation="border" size="sm" />
          ) : members.length === 0 ? (
            <p className="text-muted mb-0">No members yet.</p>
          ) : (
            <ListGroup variant="flush">
              {members.map((m) => (
                <ListGroup.Item key={m.uid} className="d-flex justify-content-between align-items-center gap-2 flex-wrap">
                  <span className="text-truncate" style={{ maxWidth: 180 }} title={m.uid}>
                    <code>{m.uid.slice(0, 10)}…</code>
                    <Badge bg={m.role === 'member' ? 'secondary' : 'success'} className="ms-2">{m.role}</Badge>
                  </span>
                  <span className="d-flex align-items-center gap-2">
                    <Form.Select
                      size="sm"
                      value={m.playerId ?? ''}
                      onChange={(e) => handleAssignPlayer(m.uid, e.target.value || null)}
                      disabled={assigningUid === m.uid}
                      style={{ minWidth: 160 }}
                    >
                      <option value="">— not linked —</option>
                      {players.map((p) => (
                        <option key={p.id} value={p.id}>{playerLabel(p)}</option>
                      ))}
                    </Form.Select>
                    {isSuperAdmin && (
                      <Button size="sm" variant="outline-danger" disabled={assigningUid === m.uid} onClick={() => handleRemoveMember(m.uid)}>
                        Remove
                      </Button>
                    )}
                  </span>
                </ListGroup.Item>
              ))}
            </ListGroup>
          )}
        </Card.Body>
      </Card>

      <Card className="mt-3">
        <Card.Header>Backup &amp; restore</Card.Header>
        <Card.Body>
          <Card.Text>
            Download a JSON snapshot of all data, or restore one from a file. Restore upserts
            documents by their original ID.
          </Card.Text>
          <div className="d-flex gap-2 align-items-center flex-wrap">
            <Button variant="primary" onClick={handleBackup} disabled={backingUp || restoring}>
              {backingUp ? (
                <>
                  <Spinner as="span" animation="border" size="sm" className="me-2" />
                  Preparing…
                </>
              ) : (
                'Download backup'
              )}
            </Button>
            <Form.Label className="btn btn-outline-secondary mb-0">
              {restoring ? 'Restoring…' : 'Restore from file'}
              <Form.Control
                type="file"
                accept="application/json,.json"
                hidden
                disabled={backingUp || restoring}
                onChange={handleRestoreFile}
              />
            </Form.Label>
          </div>

          {ioError && (
            <Alert variant="danger" className="mt-3">
              {ioError}
            </Alert>
          )}
          {restoreResult && (
            <Alert variant="success" className="mt-3">
              <div>Restore complete.</div>
              <ul className="mb-0 mt-2">
                {Object.entries(restoreResult).map(([name, count]) => (
                  <li key={name}>
                    {name}: {count} document{count === 1 ? '' : 's'} written
                  </li>
                ))}
              </ul>
            </Alert>
          )}
        </Card.Body>
      </Card>

      {isSuperAdmin && (
      <>
      <Card border="danger" className="mt-3">
        <Card.Header className="bg-danger text-white">Danger zone</Card.Header>
        <Card.Body>
          <Card.Title>Clear all data</Card.Title>
          <Card.Text>
            Permanently deletes every document from the collections below. The collections
            themselves are left in place.
          </Card.Text>
          <ListGroup variant="flush" className="mb-3">
            {CLEARABLE_COLLECTIONS.map((name) => (
              <ListGroup.Item key={name}>{name}</ListGroup.Item>
            ))}
          </ListGroup>

          <Form.Group className="mb-3">
            <Form.Label>
              Type <strong>{CONFIRM_PHRASE}</strong> to enable the button.
            </Form.Label>
            <Form.Control
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={CONFIRM_PHRASE}
              disabled={clearing}
            />
          </Form.Group>

          <Button
            variant="danger"
            onClick={handleClear}
            disabled={confirmText !== CONFIRM_PHRASE || clearing}
          >
            {clearing ? (
              <>
                <Spinner as="span" animation="border" size="sm" className="me-2" />
                Clearing...
              </>
            ) : (
              'Clear all data'
            )}
          </Button>

          {error && (
            <Alert variant="danger" className="mt-3">
              {error}
            </Alert>
          )}

          {result && (
            <Alert variant="success" className="mt-3">
              <div>Data cleared successfully.</div>
              <ul className="mb-0 mt-2">
                {Object.entries(result).map(([name, count]) => (
                  <li key={name}>
                    {name}: {count} document{count === 1 ? '' : 's'} deleted
                  </li>
                ))}
              </ul>
            </Alert>
          )}
        </Card.Body>
      </Card>

      <Card border="danger" className="mt-3">
        <Card.Header className="bg-danger text-white">Delete this club</Card.Header>
        <Card.Body>
          <Card.Text>
            Permanently deletes this club and its membership roster. Only allowed once every data
            collection above is empty — use <strong>Clear all data</strong> first. Type the club id{' '}
            <strong>{clubId}</strong> to confirm.
          </Card.Text>
          <Form.Control
            className="mb-3"
            value={deleteClubText}
            onChange={(e) => setDeleteClubText(e.target.value)}
            placeholder={clubId ?? ''}
            disabled={deletingClub}
          />
          <Button
            variant="danger"
            onClick={handleDeleteClub}
            disabled={deletingClub || !clubId || deleteClubText !== clubId}
          >
            {deletingClub ? (
              <>
                <Spinner as="span" animation="border" size="sm" className="me-2" />
                Deleting…
              </>
            ) : (
              'Delete club'
            )}
          </Button>
          {deleteClubError && (
            <Alert variant="danger" className="mt-3">
              {deleteClubError}
            </Alert>
          )}
        </Card.Body>
      </Card>
      </>
      )}
    </Container>
  );
}
