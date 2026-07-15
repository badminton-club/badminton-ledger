import React, { useEffect, useState } from 'react';
import { Container, Card, Button, Alert, ListGroup, Badge, Form, InputGroup, Spinner } from 'react-bootstrap';
import type { User } from 'firebase/auth';
import {
  signInWithGoogle,
  signOutUser,
  onAuthStateChangedListener,
  fetchUserClubs,
  addClubToUser,
  removeClubFromUser,
  createClub,
} from '../services/firebase';
import { useAppDispatch, useAppSelector } from '../hooks';
import {
  selectUserClubs,
  selectCurrentClubId,
  setClubs,
  setCurrentClub,
} from '../features/club/clubSlice';

// Accepts a full club link (…?club=abc), a query fragment, or a raw club id.
function parseClubId(input: string): string | null {
  const t = input.trim();
  if (!t) return null;
  try {
    const p = new URL(t).searchParams.get('club');
    if (p) return p;
  } catch { /* not a URL */ }
  const m = t.match(/[?&]club=([^&\s]+)/);
  if (m) return decodeURIComponent(m[1]);
  return t;
}

// club id derived from a display name: "Wed Badminton Club" -> "wed-badminton-club"
function slugify(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export default function AuthPage() {
  const dispatch = useAppDispatch();
  const clubs = useAppSelector(selectUserClubs);
  const currentClubId = useAppSelector(selectCurrentClubId);

  const [user, setUser] = useState<User | null>(null);
  const [error, setError] = useState('');
  const [clubInput, setClubInput] = useState('');
  const [clubError, setClubError] = useState('');
  const [busy, setBusy] = useState(false);

  const [setupName, setSetupName] = useState('Wed Badminton Club');
  const [setupBusy, setSetupBusy] = useState(false);
  const [setupError, setSetupError] = useState('');
  const [setupDone, setSetupDone] = useState('');

  useEffect(() => {
    const unsubscribe = onAuthStateChangedListener(setUser);
    return () => unsubscribe();
  }, []);

  const refreshClubs = async (uid: string) => {
    dispatch(setClubs(await fetchUserClubs(uid)));
  };

  const handleSignIn = async () => {
    setError('');
    try {
      await signInWithGoogle();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Google sign-in failed.');
    }
  };

  const handleSignOut = async () => {
    setError('');
    try {
      await signOutUser();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-out failed.');
    }
  };

  const handleAddClub = async () => {
    if (!user) return;
    setClubError('');
    const clubId = parseClubId(clubInput);
    if (!clubId) { setClubError('Enter a club link or id.'); return; }

    setBusy(true);
    try {
      await addClubToUser(user.uid, clubId);
      await refreshClubs(user.uid);
      dispatch(setCurrentClub(clubId));
      setClubInput('');
    } catch (err) {
      setClubError(err instanceof Error ? err.message : 'Failed to add club.');
    } finally {
      setBusy(false);
    }
  };

  const handleRemoveClub = async (clubId: string) => {
    if (!user) return;
    setClubError('');
    setBusy(true);
    try {
      await removeClubFromUser(user.uid, clubId);
      const next = await fetchUserClubs(user.uid);
      dispatch(setClubs(next));
      if (currentClubId === clubId) {
        dispatch(setCurrentClub(next[0]?.id ?? null));
      }
    } catch (err) {
      setClubError(err instanceof Error ? err.message : 'Failed to remove club.');
    } finally {
      setBusy(false);
    }
  };

  const handleCreateEmptyClub = async () => {
    if (!user) return;
    setSetupError('');
    setSetupDone('');
    const name = setupName.trim();
    const clubId = slugify(name);
    if (!clubId) { setSetupError('Enter a club name.'); return; }

    setSetupBusy(true);
    try {
      await createClub(clubId, name, user.uid);
      dispatch(setClubs(await fetchUserClubs(user.uid)));
      dispatch(setCurrentClub(clubId));
      setSetupDone(`Created "${name}". It's empty and ready to use.`);
    } catch (err) {
      setSetupError(err instanceof Error ? err.message : 'Failed to create club.');
    } finally {
      setSetupBusy(false);
    }
  };

  return (
    <Container className="mt-4" style={{ maxWidth: 520 }}>
      <Card>
        <Card.Body className="text-center">
          <Card.Title>Account</Card.Title>
          {user ? (
            <>
              <p className="mb-3">
                Signed in as <strong>{user.displayName || user.email}</strong>
              </p>
              <p className="text-muted small mb-3">
                Your user ID:<br />
                <code>{user.uid}</code>
              </p>
              <Button variant="outline-secondary" onClick={handleSignOut}>
                Sign out
              </Button>
            </>
          ) : (
            <>
              <p className="mb-3">You are not signed in.</p>
              <Button variant="primary" onClick={handleSignIn}>
                Sign in with Google
              </Button>
            </>
          )}
          {error && (
            <Alert variant="danger" className="mt-3">
              {error}
            </Alert>
          )}
        </Card.Body>
      </Card>

      {user && (
        <Card className="mt-3">
          <Card.Body>
            <Card.Title>Your clubs</Card.Title>
            <Card.Text className="text-muted">
              Select a club to open it. Visiting a club link also adds it here.
            </Card.Text>

            {clubs.length === 0 ? (
              <p className="text-muted">You haven't joined any clubs yet. Add one below.</p>
            ) : (
              <ListGroup className="mb-3">
                {clubs.map((c) => (
                  <ListGroup.Item
                    key={c.id}
                    className="d-flex justify-content-between align-items-center"
                    active={c.id === currentClubId}
                  >
                    <span>
                      {c.name}
                      {c.role ? (
                        <Badge bg={c.role === 'admin' ? 'success' : 'secondary'} className="ms-2">
                          {c.role}
                        </Badge>
                      ) : (
                        <Badge bg="warning" text="dark" className="ms-2">no access</Badge>
                      )}
                    </span>
                    <span className="d-flex gap-2">
                      <Button
                        size="sm"
                        variant={c.id === currentClubId ? 'light' : 'outline-primary'}
                        disabled={busy || c.id === currentClubId}
                        onClick={() => dispatch(setCurrentClub(c.id))}
                      >
                        {c.id === currentClubId ? 'Current' : 'Open'}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline-danger"
                        disabled={busy}
                        onClick={() => handleRemoveClub(c.id)}
                      >
                        Remove
                      </Button>
                    </span>
                  </ListGroup.Item>
                ))}
              </ListGroup>
            )}

            <Form.Label>Add a club</Form.Label>
            <InputGroup>
              <Form.Control
                placeholder="Club link or id"
                value={clubInput}
                onChange={(e) => setClubInput(e.target.value)}
                disabled={busy}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddClub(); } }}
              />
              <Button variant="primary" onClick={handleAddClub} disabled={busy || !clubInput.trim()}>
                {busy ? <Spinner size="sm" animation="border" /> : 'Add'}
              </Button>
            </InputGroup>
            {clubError && <Alert variant="danger" className="mt-2 mb-0 py-2">{clubError}</Alert>}
          </Card.Body>
        </Card>
      )}

      {user && (
        <Card className="mt-3">
          <Card.Body>
            <Card.Title>Create a new club</Card.Title>
            <Card.Text className="text-muted">
              Makes a new, empty club and adds you as its admin.
            </Card.Text>
            <Form.Label>Club name</Form.Label>
            <Form.Control
              value={setupName}
              onChange={(e) => setSetupName(e.target.value)}
              disabled={setupBusy}
            />
            {setupName.trim() && (
              <Form.Text className="text-muted">Club id: {slugify(setupName) || '—'}</Form.Text>
            )}
            <div className="d-flex gap-2 mt-2">
              <Button variant="success" onClick={handleCreateEmptyClub} disabled={setupBusy || !setupName.trim()}>
                {setupBusy ? <Spinner size="sm" animation="border" /> : 'Create new club'}
              </Button>
            </div>
            {setupDone && <Alert variant="success" className="mt-2 mb-0 py-2">{setupDone}</Alert>}
            {setupError && <Alert variant="danger" className="mt-2 mb-0 py-2">{setupError}</Alert>}
          </Card.Body>
        </Card>
      )}
    </Container>
  );
}
