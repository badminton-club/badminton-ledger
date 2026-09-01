import { FirebaseError, getApps, initializeApp } from 'firebase/app';
import { GoogleAuthProvider, getAuth, signInWithPopup, signOut, type Auth } from 'firebase/auth';
import { auth, app } from './client';
import { serviceCall } from './utils';
import { exportAllData, restoreAllData, type ClearSummary, type BackupData } from './admin';
import { encryptBackupPayload, decryptBackupPayload, isEncryptedBackupPayload } from '../backupCrypto';

// Drive authorization uses a secondary Firebase Auth instance so the selected
// Google account is independent from the account signed into Badminton Ledger.
const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const DRIVE_AUTH_APP_NAME = 'drive-oauth';
/** Default backup destination folder, used whenever the caller doesn't specify one. */
export const DEFAULT_BACKUP_FOLDER_NAME = 'Badminton Ledger Backups';
const BACKUP_FOLDER_NAME = DEFAULT_BACKUP_FOLDER_NAME;
// Google access tokens are valid for ~1 hour; cache a little conservatively so a
// backup followed by a restore (or a list followed by a restore) in the same
// session doesn't pop the Google consent screen twice in a row.
const TOKEN_TTL_MS = 45 * 60 * 1000;

// Scoped to the signed-in uid it was issued for, and checked on every read —
// this is an SPA where signing out/in doesn't reload the page, so without this
// a second user signing in during the same tab session could otherwise reuse
// the first user's still-valid cached Drive token.
let cachedToken: { value: string; expiresAt: number; uid: string } | null = null;
let pendingTokenRequest: { value: Promise<string>; uid: string } | null = null;

export interface DriveBackupResult {
  fileName: string;
  webViewLink?: string;
}

export interface DriveBackupFile {
  id: string;
  name: string;
  createdTime: string;
  webViewLink?: string;
}

/** The auto-generated backup file name used when the caller doesn't provide one. */
export function defaultBackupFileName(): string {
  return `badminton-ledger-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
}

/**
 * Lazily creates the isolated Auth instance used only for Drive OAuth.
 */
function getDriveAuthInstance(): Auth {
  const existing = getApps().find((candidate) => candidate.name === DRIVE_AUTH_APP_NAME);
  const driveApp = existing ?? initializeApp(app.options, DRIVE_AUTH_APP_NAME);
  return getAuth(driveApp);
}

/**
 * Opens a standalone Google account chooser and returns a Drive access token.
 * The secondary identity is discarded immediately and never changes the app's
 * signed-in Firebase user.
 */
async function getDriveAccessToken(): Promise<string> {
  const user = auth.currentUser;
  if (!user) throw new Error('You must be signed in to use Google Drive backups.');

  if (cachedToken && cachedToken.uid === user.uid && cachedToken.expiresAt > Date.now()) {
    return cachedToken.value;
  }
  if (pendingTokenRequest?.uid === user.uid) return pendingTokenRequest.value;
  if (pendingTokenRequest) {
    await pendingTokenRequest.value.catch(() => undefined);
    return getDriveAccessToken();
  }

  const request = (async () => {
    const driveAuth = getDriveAuthInstance();
    const provider = new GoogleAuthProvider();
    provider.addScope(DRIVE_FILE_SCOPE);
    provider.setCustomParameters({ prompt: 'select_account consent' });

    let result;
    try {
      result = await signInWithPopup(driveAuth, provider);
    } catch (err) {
      if (err instanceof FirebaseError) {
        if (err.code === 'auth/popup-closed-by-user' || err.code === 'auth/cancelled-popup-request') {
          throw new Error('Google Drive authorization was cancelled.');
        }
      }
      throw err;
    }

    const credential = GoogleAuthProvider.credentialFromResult(result);
    await signOut(driveAuth).catch(() => { /* best-effort cleanup */ });
    if (!credential?.accessToken) {
      throw new Error('Failed to get Google Drive access — please try again.');
    }
    cachedToken = { value: credential.accessToken, expiresAt: Date.now() + TOKEN_TTL_MS, uid: user.uid };
    return credential.accessToken;
  })();
  pendingTokenRequest = { value: request, uid: user.uid };

  try {
    return await request;
  } finally {
    if (pendingTokenRequest?.value === request) pendingTokenRequest = null;
  }
}

async function driveFetch<T>(accessToken: string, url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { ...(init.headers ?? {}), Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Google Drive request failed (${res.status}): ${body || res.statusText}`);
  }
  return res.json();
}

/** Escapes a value for safe interpolation into a Drive API `q` search string. */
function escapeDriveQueryValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/** Finds a named folder in the user's Drive, returning null if missing. */
async function findBackupFolder(accessToken: string, folderName: string): Promise<string | null> {
  const q = encodeURIComponent(
    `name='${escapeDriveQueryValue(folderName)}' and mimeType='application/vnd.google-apps.folder' ` +
      `and trashed=false and 'me' in owners`
  );
  const { files } = await driveFetch<{ files: { id: string }[] }>(
    accessToken,
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)&spaces=drive`
  );
  return files?.length > 0 ? files[0].id : null;
}

/** Finds a named folder in the user's Drive, creating it (at Drive root) if missing. */
async function findOrCreateBackupFolder(accessToken: string, folderName: string): Promise<string> {
  const existing = await findBackupFolder(accessToken, folderName);
  if (existing) return existing;

  const created = await driveFetch<{ id: string }>(
    accessToken,
    'https://www.googleapis.com/drive/v3/files?fields=id',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: folderName, mimeType: 'application/vnd.google-apps.folder' }),
    }
  );
  return created.id;
}

/** Uploads a JSON string as a new file in the given Drive folder via a multipart upload. */
async function uploadJsonFile(
  accessToken: string,
  folderId: string,
  fileName: string,
  json: string
): Promise<{ id: string; webViewLink?: string }> {
  const boundary = `batch_backup_${Date.now()}`;
  const metadata = { name: fileName, parents: [folderId], mimeType: 'application/json' };
  const body =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: application/json\r\n\r\n${json}\r\n` +
    `--${boundary}--`;

  return driveFetch<{ id: string; webViewLink?: string }>(
    accessToken,
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink',
    {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    }
  );
}

/**
 * Exports all club data (the same snapshot the manual JSON download uses) and
 * uploads it into a Google Drive folder in the signed-in user's own Drive. Both
 * the file name and destination folder can be customized; if omitted, the file
 * gets a timestamped default name and lands in the standard
 * "Badminton Ledger Backups" folder (created if it doesn't exist yet). No
 * server/Cloud Function required — the browser talks directly to the Drive API
 * with a scoped OAuth token obtained via Firebase's existing Google sign-in.
 *
 * If `passphrase` is given, the JSON is encrypted (AES-256-GCM) before upload
 * — see backupCrypto.ts. Anyone with access to the Drive folder can otherwise
 * read the backup's full contents (player names, emails, balances, ledger),
 * so this is the recommended way to protect it. There's no way to recover a
 * forgotten passphrase; the same one must be supplied to restore.
 */
export async function backupToGoogleDrive(options?: {
  fileName?: string;
  folderName?: string;
  passphrase?: string;
}): Promise<DriveBackupResult> {
  return serviceCall('backupToGoogleDrive', async () => {
    const accessToken = await getDriveAccessToken();
    const data = await exportAllData();
    const folderName = options?.folderName?.trim() || BACKUP_FOLDER_NAME;
    const folderId = await findOrCreateBackupFolder(accessToken, folderName);
    const rawFileName = options?.fileName?.trim() || defaultBackupFileName();
    const fileName = /\.json$/i.test(rawFileName) ? rawFileName : `${rawFileName}.json`;
    const json = JSON.stringify(data, null, 2);
    const passphrase = options?.passphrase?.trim();
    const payload = passphrase ? JSON.stringify(await encryptBackupPayload(json, passphrase)) : json;
    const file = await uploadJsonFile(accessToken, folderId, fileName, payload);
    return { fileName, webViewLink: file.webViewLink };
  });
}

// Drive returns at most 1000 files per page (100 by default without an
// explicit pageSize) and can paginate further via nextPageToken — without
// following it, a club with more backups than fit on one page would only
// ever see/restore from the newest page, with older backups invisible.
const DRIVE_LIST_MAX_PAGES = 20;

/**
 * Lists the JSON backups in the given Drive folder (the standard
 * "Badminton Ledger Backups" folder by default), newest first. Returns an empty
 * array if the folder doesn't exist yet (nothing has been backed up there).
 */
export async function listGoogleDriveBackups(folderName?: string): Promise<DriveBackupFile[]> {
  return serviceCall('listGoogleDriveBackups', async () => {
    const accessToken = await getDriveAccessToken();
    const folderId = await findBackupFolder(accessToken, folderName?.trim() || BACKUP_FOLDER_NAME);
    if (!folderId) return [];

    const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
    const files: DriveBackupFile[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < DRIVE_LIST_MAX_PAGES; page++) {
      const url = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,createdTime,webViewLink),nextPageToken` +
        `&orderBy=createdTime desc&spaces=drive&pageSize=100`
        + (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '');
      const { files: pageFiles, nextPageToken } = await driveFetch<{ files: DriveBackupFile[]; nextPageToken?: string }>(
        accessToken,
        url
      );
      if (pageFiles?.length) files.push(...pageFiles);
      if (!nextPageToken) break;
      pageToken = nextPageToken;
    }
    return files;
  });
}

/** Downloads a Drive file's raw content as text. */
async function downloadDriveFile(accessToken: string, fileId: string): Promise<string> {
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Failed to download backup from Drive (${res.status}): ${body || res.statusText}`);
  }
  return res.text();
}

/**
 * Downloads the given backup file from Google Drive and restores it into
 * Firestore, upserting documents by their original ID — the same semantics as
 * the manual "Restore from file" flow, just sourced from Drive instead of a
 * local file picker. Returns a per-collection write count.
 *
 * If the downloaded file is an encrypted envelope (see backupCrypto.ts), the
 * matching `passphrase` must be supplied — throws a clear error either way
 * (missing entirely, or wrong/corrupted) rather than a raw decryption error.
 * A `passphrase` given for a backup that ISN'T encrypted is simply ignored.
 */
export async function restoreFromGoogleDrive(fileId: string, passphrase?: string): Promise<ClearSummary> {
  return serviceCall('restoreFromGoogleDrive', async () => {
    const accessToken = await getDriveAccessToken();
    const raw = await downloadDriveFile(accessToken, fileId);

    let parsedRaw: unknown;
    try {
      parsedRaw = JSON.parse(raw);
    } catch {
      throw new Error('The selected Drive file is not a valid backup (invalid JSON).');
    }

    let json = raw;
    if (isEncryptedBackupPayload(parsedRaw)) {
      if (!passphrase?.trim()) {
        throw new Error('This backup is encrypted — enter its passphrase to restore.');
      }
      json = await decryptBackupPayload(parsedRaw, passphrase.trim());
    }

    let backup: BackupData;
    try {
      backup = JSON.parse(json) as BackupData;
    } catch {
      throw new Error('The selected Drive file is not a valid backup (invalid JSON).');
    }
    return restoreAllData(backup);
  });
}
