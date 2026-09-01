/**
 * Minimal fake of `firebase/app`, wired in for all tests via the
 * `moduleNameMapper` override in package.json's "jest" config. Only what
 * `services/firebase/client.ts` (and `gmail.ts`'s secondary auth app — see
 * `getApps()` below) needs at import time.
 */

export interface FakeApp {
  name: string;
  options?: unknown;
}

const DEFAULT_APP: FakeApp = { name: '[DEFAULT]' };
const apps: FakeApp[] = [DEFAULT_APP];

export function initializeApp(options?: unknown, name: string = '[DEFAULT]'): FakeApp {
  const existing = apps.find(a => a.name === name);
  if (existing) return existing;
  const app: FakeApp = { name, options };
  apps.push(app);
  return app;
}

/** Used by gmail.ts to look up (rather than re-create) its secondary app. */
export function getApps(): FakeApp[] {
  return apps;
}

export class FirebaseError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = 'FirebaseError';
  }
}
