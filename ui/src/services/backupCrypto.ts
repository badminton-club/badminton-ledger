/**
 * Client-side encryption for exported club-data backups (Google Drive and
 * local-file), using the standard Web Crypto API (AES-256-GCM with a
 * PBKDF2-derived key) — no new dependencies, and the exact same code path
 * runs in the browser and under Jest (see setupTests.js's Node `webcrypto`
 * polyfill for `crypto.subtle`, which isn't natively available in jsdom).
 *
 * A backup is only as safe as wherever it ends up stored (a Google Drive
 * folder, a downloaded file on a laptop) — this lets an admin optionally
 * protect that content with a passphrase so it's unreadable to anyone who
 * gains access to the storage location but doesn't know the passphrase.
 * There is deliberately no way to recover a forgotten passphrase — nothing
 * about it is ever stored anywhere, including by this app.
 */

const PBKDF2_ITERATIONS = 250_000;
const SALT_BYTES = 16;
const IV_BYTES = 12; // recommended length for AES-GCM

/** A self-describing encrypted backup envelope — this is what actually gets
 *  written to Drive/disk in place of the plain backup JSON when a passphrase
 *  is supplied. `iterations` is stored per-payload (not just read from the
 *  constant above) so a later change to the default doesn't break decrypting
 *  older backups. */
export interface EncryptedBackupPayload {
  __encrypted: true;
  version: 1;
  kdf: 'PBKDF2-SHA256';
  iterations: number;
  salt: string;       // base64
  iv: string;          // base64
  ciphertext: string;  // base64
}

/** True if a parsed JSON value looks like an encrypted backup envelope, as opposed to a plain BackupData object. */
export function isEncryptedBackupPayload(value: unknown): value is EncryptedBackupPayload {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return v.__encrypted === true
    && typeof v.salt === 'string'
    && typeof v.iv === 'string'
    && typeof v.ciphertext === 'string'
    && typeof v.iterations === 'number';
}

// Avoid `String.fromCharCode(...bytes)` (spread), which can blow the call
// stack on a backup large enough to matter — build the binary string in
// bounded chunks instead.
const CHUNK_SIZE = 0x8000;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK_SIZE));
  }
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function deriveKey(
  passphrase: string,
  salt: Uint8Array,
  iterations: number,
  usage: 'encrypt' | 'decrypt'
): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    [usage]
  );
}

/** Encrypts a backup's JSON text with a passphrase into a self-describing envelope. */
export async function encryptBackupPayload(json: string, passphrase: string): Promise<EncryptedBackupPayload> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(passphrase, salt, PBKDF2_ITERATIONS, 'encrypt');
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, new TextEncoder().encode(json));
  return {
    __encrypted: true,
    version: 1,
    kdf: 'PBKDF2-SHA256',
    iterations: PBKDF2_ITERATIONS,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
  };
}

/**
 * Decrypts an envelope back into the original backup JSON text. Throws one
 * friendly error for either a wrong passphrase or corrupted/tampered data —
 * AES-GCM's built-in authentication tag means an incorrect key or altered
 * ciphertext always fails to decrypt rather than silently returning garbage,
 * so there's no reliable way (or need) to tell those two cases apart.
 */
export async function decryptBackupPayload(payload: EncryptedBackupPayload, passphrase: string): Promise<string> {
  try {
    const salt = base64ToBytes(payload.salt);
    const iv = base64ToBytes(payload.iv);
    const key = await deriveKey(passphrase, salt, payload.iterations, 'decrypt');
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      key,
      base64ToBytes(payload.ciphertext) as BufferSource
    );
    return new TextDecoder().decode(plaintext);
  } catch {
    throw new Error('Incorrect passphrase, or the backup file is corrupted.');
  }
}
