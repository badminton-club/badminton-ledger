import React, { useEffect, useState } from 'react';
import { Container, Card, Button, Form, Alert, Spinner, ListGroup } from 'react-bootstrap';
import { clearAllData, exportAllData, restoreAllData, CLEARABLE_COLLECTIONS, type ClearSummary, type BackupData } from '../services/firebase/admin';
import { onAuthStateChangedListener, checkIfAdmin } from '../services/firebase/auth';

const CONFIRM_PHRASE = 'CLEAR ALL DATA';

export default function SettingsPage() {
  const [isAdmin, setIsAdmin] = useState(false);
  const [checkingAdmin, setCheckingAdmin] = useState(true);
  const [confirmText, setConfirmText] = useState('');
  const [clearing, setClearing] = useState(false);
  const [result, setResult] = useState<ClearSummary | null>(null);
  const [error, setError] = useState('');
  const [backingUp, setBackingUp] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [restoreResult, setRestoreResult] = useState<ClearSummary | null>(null);
  const [ioError, setIoError] = useState('');

  useEffect(() => {
    const unsubscribe = onAuthStateChangedListener(async (user) => {
      setIsAdmin(await checkIfAdmin(user?.uid ?? null));
      setCheckingAdmin(false);
    });
    return () => unsubscribe();
  }, []);

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
      <h3>Settings</h3>

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
    </Container>
  );
}
