import React, { useEffect, useState } from 'react';
import { Container, Card, Button, Alert, ListGroup, Badge, Form, InputGroup, Spinner } from 'react-bootstrap';
import type { User } from 'firebase/auth';
import {
  signInWithGoogle,
  signUpWithEmail,
  signInWithEmail,
  sendPasswordReset,
  resendVerificationEmail,
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

// Maps common Firebase Auth error codes to messages a user can actually act on.
function mapAuthError(err: unknown): string {
  const code = (err as { code?: string })?.code;
  switch (code) {
    case 'auth/email-already-in-use':
      return 'That email already has an account — try signing in instead.';
    case 'auth/invalid-email':
      return 'Enter a valid email address.';
    case 'auth/weak-password':
      return 'Password should be at least 6 characters.';
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Incorrect email or password.';
    case 'auth/too-many-requests':
      return 'Too many attempts — please wait a bit and try again.';
    case 'auth/operation-not-allowed':
      return 'Email/password sign-in isn\'t enabled for this project yet — ask an admin to enable it in the Firebase console.';
    default:
      return err instanceof Error ? err.message : 'Something went wrong.';
  }
}

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

  const [authMode, setAuthMode] = useState<'signin' | 'signup'>('signin');
  const [emailInput, setEmailInput] = useState('');
  const [usernameInput, setUsernameInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [confirmPasswordInput, setConfirmPasswordInput] = useState('');
  const [emailAuthBusy, setEmailAuthBusy] = useState(false);
  const [emailAuthError, setEmailAuthError] = useState('');
  const [resetSent, setResetSent] = useState('');

  const [resendBusy, setResendBusy] = useState(false);
  const [resendSent, setResendSent] = useState(false);
  const [resendError, setResendError] = useState('');

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

  const resetEmailAuthForm = () => {
    setEmailAuthError('');
    setResetSent('');
    setPasswordInput('');
    setConfirmPasswordInput('');
  };

  const handleEmailSignUp = async () => {
    setEmailAuthError('');
    setResetSent('');
    const email = emailInput.trim();
    const username = usernameInput.trim();
    if (!email) { setEmailAuthError('Enter your email.'); return; }
    if (passwordInput.length < 6) { setEmailAuthError('Password should be at least 6 characters.'); return; }
    if (passwordInput !== confirmPasswordInput) { setEmailAuthError('Passwords do not match.'); return; }

    setEmailAuthBusy(true);
    try {
      await signUpWithEmail(email, username, passwordInput);
    } catch (err) {
      setEmailAuthError(mapAuthError(err));
    } finally {
      setEmailAuthBusy(false);
    }
  };

  const handleEmailSignIn = async () => {
    setEmailAuthError('');
    setResetSent('');
    const email = emailInput.trim();
    if (!email) { setEmailAuthError('Enter your email.'); return; }
    if (!passwordInput) { setEmailAuthError('Enter your password.'); return; }

    setEmailAuthBusy(true);
    try {
      await signInWithEmail(email, passwordInput);
    } catch (err) {
      setEmailAuthError(mapAuthError(err));
    } finally {
      setEmailAuthBusy(false);
    }
  };

  const handleForgotPassword = async () => {
    setEmailAuthError('');
    setResetSent('');
    const email = emailInput.trim();
    if (!email) { setEmailAuthError('Enter your email above first, then click "Forgot password?" again.'); return; }

    setEmailAuthBusy(true);
    try {
      await sendPasswordReset(email);
    } catch (err) {
      // Doesn't matter whether the address is registered — always show the same
      // message, so this can't be used to test which emails have accounts.
      const code = (err as { code?: string })?.code;
      if (code !== 'auth/user-not-found' && code !== 'auth/invalid-email') {
        setEmailAuthError(mapAuthError(err));
        setEmailAuthBusy(false);
        return;
      }
    }
    setResetSent(`If an account exists for ${email}, a password reset link has been sent.`);
    setEmailAuthBusy(false);
  };

  const handleSignOut = async () => {
    setError('');
    try {
      await signOutUser();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-out failed.');
    }
  };

  const handleResendVerification = async () => {
    setResendError('');
    setResendBusy(true);
    try {
      await resendVerificationEmail();
      setResendSent(true);
    } catch (err) {
      setResendError(err instanceof Error ? err.message : 'Failed to resend verification email.');
    } finally {
      setResendBusy(false);
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
              {user.providerData?.some((p) => p.providerId === 'password') && !user.emailVerified && (
                <Alert variant="warning" className="mt-3 mb-0 text-start py-2">
                  Please verify your email address ({user.email}) — check your inbox for the link we sent.
                  <div className="mt-2">
                    <Button
                      variant="outline-secondary"
                      size="sm"
                      onClick={handleResendVerification}
                      disabled={resendBusy}
                    >
                      {resendBusy ? <Spinner size="sm" animation="border" /> : 'Resend verification email'}
                    </Button>
                    {resendSent && <span className="text-success small ms-2">Sent!</span>}
                  </div>
                  {resendError && <div className="text-danger small mt-1">{resendError}</div>}
                </Alert>
              )}
            </>
          ) : (
            <>
              <p className="mb-3">You are not signed in.</p>
              <Button variant="primary" onClick={handleSignIn} className="w-100">
                Sign in with Google
              </Button>

              <div className="d-flex align-items-center my-3">
                <hr className="flex-grow-1" />
                <span className="text-muted small mx-2">or</span>
                <hr className="flex-grow-1" />
              </div>

              <Form
                className="text-start"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (authMode === 'signup') handleEmailSignUp(); else handleEmailSignIn();
                }}
              >
                {authMode === 'signup' && (
                  <Form.Group className="mb-2" controlId="auth-email-username">
                    <Form.Label>Display name (optional)</Form.Label>
                    <Form.Control
                      value={usernameInput}
                      onChange={(e) => setUsernameInput(e.target.value)}
                      disabled={emailAuthBusy}
                      placeholder="Shown instead of your email around the app"
                    />
                  </Form.Group>
                )}
                <Form.Group className="mb-2" controlId="auth-email-email">
                  <Form.Label>Email</Form.Label>
                  <Form.Control
                    type="email"
                    value={emailInput}
                    onChange={(e) => setEmailInput(e.target.value)}
                    disabled={emailAuthBusy}
                  />
                </Form.Group>
                <Form.Group className="mb-2" controlId="auth-email-password">
                  <Form.Label>Password</Form.Label>
                  <Form.Control
                    type="password"
                    value={passwordInput}
                    onChange={(e) => setPasswordInput(e.target.value)}
                    disabled={emailAuthBusy}
                  />
                </Form.Group>
                {authMode === 'signup' && (
                  <Form.Group className="mb-2" controlId="auth-email-confirm-password">
                    <Form.Label>Confirm password</Form.Label>
                    <Form.Control
                      type="password"
                      value={confirmPasswordInput}
                      onChange={(e) => setConfirmPasswordInput(e.target.value)}
                      disabled={emailAuthBusy}
                    />
                  </Form.Group>
                )}
                <Button variant="outline-primary" type="submit" className="w-100" disabled={emailAuthBusy}>
                  {emailAuthBusy
                    ? <Spinner size="sm" animation="border" />
                    : (authMode === 'signup' ? 'Create account' : 'Sign in')}
                </Button>
                <div className="d-flex justify-content-between align-items-center mt-2">
                  <Button
                    variant="link"
                    size="sm"
                    className="p-0"
                    disabled={emailAuthBusy}
                    onClick={() => {
                      setAuthMode(authMode === 'signup' ? 'signin' : 'signup');
                      resetEmailAuthForm();
                    }}
                  >
                    {authMode === 'signup' ? 'Already have an account? Sign in' : 'Need an account? Sign up'}
                  </Button>
                  {authMode === 'signin' && (
                    <Button
                      variant="link"
                      size="sm"
                      className="p-0"
                      onClick={handleForgotPassword}
                      disabled={emailAuthBusy}
                    >
                      Forgot password?
                    </Button>
                  )}
                </div>
                {emailAuthError && <Alert variant="danger" className="mt-2 mb-0 py-2">{emailAuthError}</Alert>}
                {resetSent && <Alert variant="success" className="mt-2 mb-0 py-2">{resetSent}</Alert>}
              </Form>
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
