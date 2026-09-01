import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Container, Card, Button, Form, Alert, Spinner, ListGroup, InputGroup, Badge, Modal, Accordion } from 'react-bootstrap';
import { format } from 'date-fns';
import { clearAllData, exportAllData, restoreAllData, CLEARABLE_COLLECTIONS, type ClearSummary, type BackupData } from '../services/firebase/admin';
import {
  backupToGoogleDrive,
  listGoogleDriveBackups,
  restoreFromGoogleDrive,
  defaultBackupFileName,
  DEFAULT_BACKUP_FOLDER_NAME,
  type DriveBackupResult,
  type DriveBackupFile,
} from '../services/firebase/drive';
import { encryptBackupPayload, decryptBackupPayload, isEncryptedBackupPayload } from '../services/backupCrypto';
import { addClubMember, setMemberPlayer, removeClubMember, fetchClubMembers, setClubTabEnabled, deleteClub, fetchUserClubs, fetchLinkRequests, deleteLinkRequest, addPlayer, fetchProfileEditRequests, deleteProfileEditRequest, updatePlayerProfile } from '../services/firebase';
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
import type { ClubMember, ClubRole, LinkRequest, ProfileEditRequest, Player } from '../types';

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
  const [localBackupPassphrase, setLocalBackupPassphrase] = useState('');
  const [restoreResult, setRestoreResult] = useState<ClearSummary | null>(null);
  const [ioError, setIoError] = useState('');
  const [drivingBackingUp, setDriveBackingUp] = useState(false);
  const [driveResult, setDriveResult] = useState<DriveBackupResult | null>(null);
  const [driveError, setDriveError] = useState('');
  const [showDriveRestore, setShowDriveRestore] = useState(false);
  const [driveBackups, setDriveBackups] = useState<DriveBackupFile[]>([]);
  const [loadingDriveBackups, setLoadingDriveBackups] = useState(false);
  const [restoringDriveFileId, setRestoringDriveFileId] = useState<string | null>(null);
  const [driveRestorePassphrase, setDriveRestorePassphrase] = useState('');
  const [showDriveBackup, setShowDriveBackup] = useState(false);
  const [driveBackupFileName, setDriveBackupFileName] = useState('');
  const [driveBackupFolderName, setDriveBackupFolderName] = useState('');
  const [driveBackupPassphrase, setDriveBackupPassphrase] = useState('');
  const [driveRestoreFolderName, setDriveRestoreFolderName] = useState('');

  const [members, setMembers] = useState<ClubMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [membersError, setMembersError] = useState('');
  const [membersMessage, setMembersMessage] = useState('');
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

  const [editRequests, setEditRequests] = useState<ProfileEditRequest[]>([]);
  const [editRequestsLoading, setEditRequestsLoading] = useState(false);
  const [editRequestsError, setEditRequestsError] = useState('');
  const [processingEditReq, setProcessingEditReq] = useState<string | null>(null);

  const [deleteClubText, setDeleteClubText] = useState('');
  const [deletingClub, setDeletingClub] = useState(false);
  const [deleteClubError, setDeleteClubError] = useState('');

  const loadMembers = useCallback(async () => {
    if (!clubId) { setMembers([]); return; }
    setMembersLoading(true);
    setMembersError('');
    setMembersMessage('');
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
      setMembersMessage('Member access saved. The club will appear the next time they refresh or sign in.');
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

  // Existing members already linked to a player — used to flag a pending request
  // whose suggested/selected match is already claimed by a different member, so
  // an admin doesn't accidentally approve a duplicate link without noticing.
  const linkedPlayerIds = useMemo(
    () => new Set(members.filter((m) => m.playerId).map((m) => m.playerId as string)),
    [members]
  );

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
    if (linkedPlayerIds.has(pid)) {
      const existing = players.find((p) => p.id === pid);
      const name = existing ? playerLabel(existing) : 'This player';
      const ok = window.confirm(
        `${name} is already linked to another member. Linking ${req.firstName} too means both ` +
        'accounts will share that one player record. Continue?'
      );
      if (!ok) return;
    }
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

  const loadEditRequests = useCallback(async () => {
    if (!clubId) { setEditRequests([]); return; }
    setEditRequestsLoading(true);
    setEditRequestsError('');
    try {
      setEditRequests(await fetchProfileEditRequests(clubId));
    } catch (err) {
      setEditRequestsError(err instanceof Error ? err.message : 'Failed to load requests.');
    } finally {
      setEditRequestsLoading(false);
    }
  }, [clubId]);

  useEffect(() => { if (isAdmin && clubId) loadEditRequests(); }, [isAdmin, clubId, loadEditRequests]);

  const handleApproveEditRequest = async (req: ProfileEditRequest) => {
    if (!clubId) return;
    setEditRequestsError('');
    setProcessingEditReq(req.uid);
    try {
      // The linked player may have since been deleted (e.g. by an admin
      // cleaning up test/duplicate data) — updatePlayerProfile would otherwise
      // throw a raw "No document to update" Firestore error. Detect it up
      // front and just clear the now-unfulfillable request instead.
      if (!players.some((p) => p.id === req.playerId)) {
        await deleteProfileEditRequest(clubId, req.uid);
        await loadEditRequests();
        setEditRequestsError('That player no longer exists, so this request was dismissed automatically.');
        return;
      }
      await updatePlayerProfile(req.playerId, { firstName: req.firstName, lastName: req.lastName, email: req.email });
      await deleteProfileEditRequest(clubId, req.uid);
      await loadEditRequests();
    } catch (err) {
      setEditRequestsError(err instanceof Error ? err.message : 'Failed to approve request.');
    } finally {
      setProcessingEditReq(null);
    }
  };

  const handleDismissEditRequest = async (req: ProfileEditRequest) => {
    if (!clubId) return;
    setProcessingEditReq(req.uid);
    try {
      await deleteProfileEditRequest(clubId, req.uid);
      await loadEditRequests();
    } catch (err) {
      setEditRequestsError(err instanceof Error ? err.message : 'Failed to dismiss request.');
    } finally {
      setProcessingEditReq(null);
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
      const json = JSON.stringify(data, null, 2);
      const passphrase = localBackupPassphrase.trim();
      const payload = passphrase ? JSON.stringify(await encryptBackupPayload(json, passphrase)) : json;
      const blob = new Blob([payload], { type: 'application/json' });
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
      const raw = await file.text();
      let parsedRaw: unknown;
      try {
        parsedRaw = JSON.parse(raw);
      } catch {
        throw new Error('The selected file is not a valid backup (invalid JSON).');
      }
      let json = raw;
      if (isEncryptedBackupPayload(parsedRaw)) {
        if (!localBackupPassphrase.trim()) {
          throw new Error('This backup is encrypted — enter its passphrase above, then choose the file again.');
        }
        json = await decryptBackupPayload(parsedRaw, localBackupPassphrase.trim());
      }
      const backup = JSON.parse(json) as BackupData;
      setRestoreResult(await restoreAllData(backup));
    } catch (err) {
      setIoError(err instanceof Error ? err.message : 'Restore failed.');
    } finally {
      setRestoring(false);
    }
  };

  const handleOpenDriveBackup = () => {
    setDriveError('');
    setDriveBackupFileName('');
    setDriveBackupFolderName('');
    setDriveBackupPassphrase('');
    setShowDriveBackup(true);
  };

  const handleDriveBackup = async () => {
    setDriveError('');
    setDriveResult(null);
    setDriveBackingUp(true);
    try {
      setDriveResult(await backupToGoogleDrive({
        fileName: driveBackupFileName,
        folderName: driveBackupFolderName,
        passphrase: driveBackupPassphrase.trim() || undefined,
      }));
      setShowDriveBackup(false);
    } catch (err) {
      setDriveError(err instanceof Error ? err.message : 'Google Drive backup failed.');
    } finally {
      setDriveBackingUp(false);
    }
  };

  const handleOpenDriveRestore = async (folderName?: string) => {
    setDriveError('');
    setShowDriveRestore(true);
    setLoadingDriveBackups(true);
    try {
      setDriveBackups(await listGoogleDriveBackups(folderName));
    } catch (err) {
      setDriveError(err instanceof Error ? err.message : 'Failed to load Google Drive backups.');
    } finally {
      setLoadingDriveBackups(false);
    }
  };

  const handleRestoreDriveFile = async (file: DriveBackupFile) => {
    if (!window.confirm(
      `Restore "${file.name}"? This overwrites any document that shares an ID with the backup. Continue?`
    )) return;

    setDriveError('');
    setRestoringDriveFileId(file.id);
    try {
      setRestoreResult(await restoreFromGoogleDrive(file.id, driveRestorePassphrase.trim() || undefined));
      setShowDriveRestore(false);
    } catch (err) {
      setDriveError(err instanceof Error ? err.message : 'Restore from Google Drive failed.');
    } finally {
      setRestoringDriveFileId(null);
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
    <Container className="mt-4" style={{ maxWidth: 900 }}>
      <h3>Club settings</h3>
      <p className="text-muted mb-1">Settings for the club you currently have open.</p>
      <p className="text-muted">Club ID: <code>{clubId}</code></p>

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
        <Card.Header className="d-flex justify-content-between align-items-center">
          <span>Link requests</span>
          <Button
            size="sm"
            variant="outline-secondary"
            onClick={loadRequests}
            disabled={requestsLoading}
          >
            {requestsLoading ? <Spinner size="sm" animation="border" /> : 'Refresh'}
          </Button>
        </Card.Header>
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
              {requests.map((r) => {
                const selectedPlayerId = reqSel[r.uid];
                const alreadyLinked = !!selectedPlayerId && linkedPlayerIds.has(selectedPlayerId);
                return (
                  <ListGroup.Item key={r.uid} className="d-flex justify-content-between align-items-center gap-2 flex-wrap">
                    <span>
                      <strong>{`${r.firstName} ${r.lastName ?? ''}`.trim() || '(no name)'}</strong>
                      {r.email && <span className="text-muted small ms-2">{r.email}</span>}
                      {alreadyLinked && (
                        <Badge bg="warning" text="dark" className="ms-2">
                          Already linked to another member
                        </Badge>
                      )}
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
                );
              })}
            </ListGroup>
          )}
        </Card.Body>
      </Card>

      <Card className="mt-3">
        <Card.Header className="d-flex justify-content-between align-items-center">
          <span>Profile edit requests</span>
          <Button
            size="sm"
            variant="outline-secondary"
            onClick={loadEditRequests}
            disabled={editRequestsLoading}
          >
            {editRequestsLoading ? <Spinner size="sm" animation="border" /> : 'Refresh'}
          </Button>
        </Card.Header>
        <Card.Body>
          <Card.Text className="text-muted">
            Already-linked members can't edit their own player record directly — proposed name/email
            changes land here for you to approve or dismiss.
          </Card.Text>
          {editRequestsError && <Alert variant="danger" className="py-2">{editRequestsError}</Alert>}
          {editRequestsLoading ? (
            <Spinner animation="border" size="sm" />
          ) : editRequests.length === 0 ? (
            <p className="text-muted mb-0">No pending requests.</p>
          ) : (
            <ListGroup variant="flush">
              {editRequests.map((r) => {
                const currentPlayer = players.find((p) => p.id === r.playerId);
                const currentName = currentPlayer
                  ? `${currentPlayer.firstName} ${currentPlayer.lastName ?? ''}`.trim()
                  : '(unknown player)';
                const proposedName = `${r.firstName} ${r.lastName ?? ''}`.trim();
                return (
                  <ListGroup.Item key={r.uid} className="d-flex justify-content-between align-items-center gap-2 flex-wrap">
                    <span>
                      <span className="text-muted small">{currentName} →</span>{' '}
                      <strong>{proposedName || '(no name)'}</strong>
                      {r.email && <span className="text-muted small ms-2">{r.email}</span>}
                    </span>
                    <span className="d-flex align-items-center gap-2 flex-wrap">
                      <Button
                        size="sm"
                        variant="success"
                        disabled={processingEditReq === r.uid}
                        onClick={() => handleApproveEditRequest(r)}
                      >
                        {processingEditReq === r.uid ? <Spinner size="sm" animation="border" /> : 'Approve'}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline-secondary"
                        disabled={processingEditReq === r.uid}
                        onClick={() => handleDismissEditRequest(r)}
                      >
                        Dismiss
                      </Button>
                    </span>
                  </ListGroup.Item>
                );
              })}
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
          <Card.Text className="text-muted small">
            Admins manage day-to-day club data. Super admins can also grant admin access, remove
            members, clear all data, and delete the club.
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
          {membersMessage && <Alert variant="success" className="py-2">{membersMessage}</Alert>}

          {membersLoading ? (
            <Spinner animation="border" size="sm" />
          ) : members.length === 0 ? (
            <p className="text-muted mb-0">No members yet.</p>
          ) : (
            <ListGroup variant="flush">
              {members.map((m) => (
                <ListGroup.Item key={m.uid} className="d-flex justify-content-between align-items-center gap-2 flex-wrap">
                  <span title={m.uid} style={{ minWidth: 0 }}>
                    <code style={{ wordBreak: 'break-all' }}>{m.uid}</code>
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
            Download a JSON snapshot of all data, back it up straight to Google Drive, or restore
            one from a file or from a previous Drive backup. Restore upserts documents by their
            original ID.
          </Card.Text>
          <div className="d-flex gap-2 align-items-center flex-wrap">
            <Button variant="primary" onClick={handleBackup} disabled={backingUp || restoring || drivingBackingUp}>
              {backingUp ? (
                <>
                  <Spinner as="span" animation="border" size="sm" className="me-2" />
                  Preparing…
                </>
              ) : (
                'Download backup'
              )}
            </Button>
            <Button
              variant="outline-primary"
              onClick={handleOpenDriveBackup}
              disabled={backingUp || restoring || drivingBackingUp}
            >
              Backup to Google Drive
            </Button>
            <Form.Label className="btn btn-outline-secondary mb-0">
              {restoring ? 'Restoring…' : 'Restore from file'}
              <Form.Control
                type="file"
                accept="application/json,.json"
                hidden
                disabled={backingUp || restoring || drivingBackingUp}
                onChange={handleRestoreFile}
              />
            </Form.Label>
            <Button
              variant="outline-secondary"
              onClick={() => { setDriveRestoreFolderName(''); setDriveRestorePassphrase(''); handleOpenDriveRestore(); }}
              disabled={backingUp || restoring || drivingBackingUp}
            >
              Restore from Google Drive
            </Button>
          </div>
          <Form.Group className="mt-2" controlId="local-backup-passphrase" style={{ maxWidth: 340 }}>
            <Form.Label className="small mb-1">Passphrase (optional)</Form.Label>
            <Form.Control
              type="password"
              size="sm"
              placeholder="Leave blank for no encryption"
              autoComplete="new-password"
              value={localBackupPassphrase}
              onChange={(e) => setLocalBackupPassphrase(e.target.value)}
              disabled={backingUp || restoring || drivingBackingUp}
            />
            <Form.Text className="text-muted">
              Encrypts "Download backup" with AES-256 when set, and is used to decrypt "Restore
              from file" if the chosen file turns out to be encrypted. There's no way to recover a
              forgotten passphrase — nothing about it is ever stored.
            </Form.Text>
          </Form.Group>
          <Form.Text className="text-muted d-block mt-2">
            Drive backups default to a "{DEFAULT_BACKUP_FOLDER_NAME}" folder in your own Google
            Drive, but you can name the file and choose a different folder when backing up.
            You'll be asked to grant access the first time — sign in with the same Google account
            you use for this app.
          </Form.Text>

          {ioError && (
            <Alert variant="danger" className="mt-3">
              {ioError}
            </Alert>
          )}
          {driveError && (
            <Alert variant="danger" className="mt-3" onClose={() => setDriveError('')} dismissible>
              {driveError}
            </Alert>
          )}
          {driveResult && (
            <Alert variant="success" className="mt-3" onClose={() => setDriveResult(null)} dismissible>
              Saved <strong>{driveResult.fileName}</strong> to Google Drive.{' '}
              {driveResult.webViewLink && (
                <a href={driveResult.webViewLink} target="_blank" rel="noreferrer">Open in Drive</a>
              )}
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

      <Modal show={showDriveRestore} onHide={() => setShowDriveRestore(false)} centered>
        <Modal.Header closeButton>
          <Modal.Title>Restore from Google Drive</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form
            className="d-flex gap-2 align-items-end mb-3"
            onSubmit={(e) => { e.preventDefault(); handleOpenDriveRestore(driveRestoreFolderName); }}
          >
            <Form.Group className="flex-grow-1" controlId="drive-restore-folder">
              <Form.Label className="small mb-1">Folder</Form.Label>
              <Form.Control
                size="sm"
                placeholder={DEFAULT_BACKUP_FOLDER_NAME}
                value={driveRestoreFolderName}
                onChange={(e) => setDriveRestoreFolderName(e.target.value)}
                disabled={loadingDriveBackups || restoringDriveFileId !== null}
              />
            </Form.Group>
            <Button
              size="sm"
              variant="outline-secondary"
              type="submit"
              disabled={loadingDriveBackups || restoringDriveFileId !== null}
            >
              Load
            </Button>
          </Form>

          <Form.Group className="mb-3" controlId="drive-restore-passphrase">
            <Form.Label className="small mb-1">Passphrase (only needed for an encrypted backup)</Form.Label>
            <Form.Control
              type="password"
              size="sm"
              autoComplete="new-password"
              value={driveRestorePassphrase}
              onChange={(e) => setDriveRestorePassphrase(e.target.value)}
              disabled={loadingDriveBackups || restoringDriveFileId !== null}
            />
          </Form.Group>

          {loadingDriveBackups ? (
            <div className="text-center py-3"><Spinner animation="border" size="sm" /></div>
          ) : driveBackups.length === 0 ? (
            <p className="text-muted mb-0">
              No backups found in the "{driveRestoreFolderName.trim() || DEFAULT_BACKUP_FOLDER_NAME}" Drive
              folder. Use "Backup to Google Drive" to create one first, or check the folder name above.
            </p>
          ) : (
            <ListGroup>
              {driveBackups.map((file) => (
                <ListGroup.Item key={file.id} className="d-flex justify-content-between align-items-center">
                  <div>
                    <div>{format(new Date(file.createdTime), 'MMM d, yyyy h:mm a')}</div>
                    <div className="text-muted small">{file.name}</div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline-danger"
                    disabled={restoringDriveFileId !== null}
                    onClick={() => handleRestoreDriveFile(file)}
                  >
                    {restoringDriveFileId === file.id ? (
                      <Spinner as="span" animation="border" size="sm" />
                    ) : (
                      'Restore'
                    )}
                  </Button>
                </ListGroup.Item>
              ))}
            </ListGroup>
          )}
          {driveError && (
            <Alert variant="danger" className="mt-3 mb-0">{driveError}</Alert>
          )}
        </Modal.Body>
      </Modal>

      <Modal show={showDriveBackup} onHide={() => setShowDriveBackup(false)} centered>
        <Modal.Header closeButton>
          <Modal.Title>Backup to Google Drive</Modal.Title>
        </Modal.Header>
        <Form onSubmit={(e) => { e.preventDefault(); handleDriveBackup(); }}>
          <Modal.Body>
            <Form.Group className="mb-3" controlId="drive-backup-file-name">
              <Form.Label>File name</Form.Label>
              <Form.Control
                placeholder={defaultBackupFileName()}
                value={driveBackupFileName}
                onChange={(e) => setDriveBackupFileName(e.target.value)}
                disabled={drivingBackingUp}
              />
              <Form.Text className="text-muted">Leave blank to use the default name shown above.</Form.Text>
            </Form.Group>
            <Form.Group className="mb-3" controlId="drive-backup-folder-name">
              <Form.Label>Folder</Form.Label>
              <Form.Control
                placeholder={DEFAULT_BACKUP_FOLDER_NAME}
                value={driveBackupFolderName}
                onChange={(e) => setDriveBackupFolderName(e.target.value)}
                disabled={drivingBackingUp}
              />
              <Form.Text className="text-muted">
                Created in your Drive root if it doesn't already exist.
              </Form.Text>
            </Form.Group>
            <Form.Group className="mb-3" controlId="drive-backup-passphrase">
              <Form.Label>Passphrase (optional)</Form.Label>
              <Form.Control
                type="password"
                autoComplete="new-password"
                value={driveBackupPassphrase}
                onChange={(e) => setDriveBackupPassphrase(e.target.value)}
                disabled={drivingBackingUp}
              />
              <Form.Text className="text-muted">
                Encrypts this backup with AES-256 so it's unreadable to anyone who can see this
                Drive folder without the passphrase. The same passphrase is required to restore
                it — there's no way to recover a forgotten one.
              </Form.Text>
            </Form.Group>
            {driveError && <Alert variant="danger" className="mb-0">{driveError}</Alert>}
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={() => setShowDriveBackup(false)} disabled={drivingBackingUp}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" disabled={drivingBackingUp}>
              {drivingBackingUp ? (
                <>
                  <Spinner as="span" animation="border" size="sm" className="me-2" />
                  Backing up…
                </>
              ) : (
                'Backup'
              )}
            </Button>
          </Modal.Footer>
        </Form>
      </Modal>

      {isSuperAdmin && (
        <Accordion className="mt-3 mb-4">
          <Accordion.Item eventKey="danger-zone" className="border-danger">
            <Accordion.Header>
              <span className="text-danger fw-semibold">⚠ Danger zone</span>
            </Accordion.Header>
            <Accordion.Body>
              <h5>Clear all data</h5>
              <p>
                Permanently deletes every document from the collections below. The collections
                themselves are left in place.
              </p>
              <ListGroup variant="flush" className="mb-3">
                {CLEARABLE_COLLECTIONS.map((name) => (
                  <ListGroup.Item key={name}>{name}</ListGroup.Item>
                ))}
              </ListGroup>

              <Form.Group className="mb-3" controlId="settings-clear-all-confirm">
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

              <hr />

              <h5>Delete this club</h5>
              <p>
                Permanently deletes this club and its membership roster. Only allowed once every
                data collection above is empty — use <strong>Clear all data</strong> first. Type
                the club id <strong>{clubId}</strong> to confirm.
              </p>
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
            </Accordion.Body>
          </Accordion.Item>
        </Accordion>
      )}
    </Container>
  );
}
