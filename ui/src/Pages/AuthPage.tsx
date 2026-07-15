import React, { useEffect, useState } from 'react';
import { Container, Card, Button, Alert } from 'react-bootstrap';
import type { User } from 'firebase/auth';
import { signInWithGoogle, signOutUser, onAuthStateChangedListener } from '../services/firebase/auth';

export default function AuthPage() {
  const [user, setUser] = useState<User | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const unsubscribe = onAuthStateChangedListener(setUser);
    return () => unsubscribe();
  }, []);

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

  return (
    <Container className="mt-4" style={{ maxWidth: 420 }}>
      <Card>
        <Card.Body className="text-center">
          <Card.Title>Account</Card.Title>
          {user ? (
            <>
              <p className="mb-3">
                Signed in as <strong>{user.displayName || user.email}</strong>
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
    </Container>
  );
}
