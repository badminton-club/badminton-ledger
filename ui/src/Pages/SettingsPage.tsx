import React, { useState } from 'react';
import { Container, Card, Button, Form, Alert, Spinner, ListGroup } from 'react-bootstrap';
import { clearAllData, CLEARABLE_COLLECTIONS, type ClearSummary } from '../services/firebase/admin';

const CONFIRM_PHRASE = 'CLEAR ALL DATA';

export default function SettingsPage() {
  const [confirmText, setConfirmText] = useState('');
  const [clearing, setClearing] = useState(false);
  const [result, setResult] = useState<ClearSummary | null>(null);
  const [error, setError] = useState('');

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

  return (
    <Container className="mt-4" style={{ maxWidth: 640 }}>
      <h3>Settings</h3>
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
