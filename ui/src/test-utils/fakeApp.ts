/**
 * Minimal fake of `firebase/app`, wired in for all tests via the
 * `moduleNameMapper` override in package.json's "jest" config. Only what
 * `services/firebase/client.ts` needs at import time.
 */

export function initializeApp(): Record<string, never> {
  return {};
}

export class FirebaseError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = 'FirebaseError';
  }
}
