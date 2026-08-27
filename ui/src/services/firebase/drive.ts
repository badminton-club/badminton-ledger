import { FirebaseError } from 'firebase/app';
import { GoogleAuthProvider, reauthenticateWithPopup } from 'firebase/auth';
import { auth } from './client';
import { serviceCall } from './utils';
import { exportAllData, restoreAllData, type ClearSummary, type BackupData } from './admin';

// This app only supports Google sign-in, so every signed-in user already has a
// Google identity linked to their Firebase account. Re-authenticating with an
// added Drive scope reuses that same Google OAuth client — no separate Google
// Cloud project/credentials need to be configured for this feature.
const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
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
 * Re-authenticates the current user with the Drive "file" scope added and returns
 * a fresh OAuth access token. `prompt: 'consent'` forces a new token to be issued
 * (rather than silently reusing one that may lack Drive access). Cached briefly so
 * a sequence of Drive actions (e.g. list backups, then restore one) only prompts
 * once.
 */
async function getDriveAccessToken(): Promise<string> {
  const user = auth.currentUser;
  if (!user) throw new Error('You must be signed in to use Google Drive backups.');

  if (cachedToken && cachedToken.uid === user.uid && cachedToken.expiresAt > Date.now()) {
    return cachedToken.value;
  }

  const provider = new GoogleAuthProvider();
  provider.addScope(DRIVE_FILE_SCOPE);
  provider.setCustomParameters({ prompt: 'consent' });

  let result;
  try {
    result = await reauthenticateWithPopup(user, provider);
  } catch (err) {
    if (err instanceof FirebaseError) {
      if (err.code === 'auth/user-mismatch') {
        throw new Error("Select the same Google account you're signed in with.");
      }
      if (err.code === 'auth/popup-closed-by-user' || err.code === 'auth/cancelled-popup-request') {
        throw new Error('Google Drive authorization was cancelled.');
      }
    }
    throw err;
  }

  const credential = GoogleAuthProvider.credentialFromResult(result);
  if (!credential?.accessToken) {
    throw new Error('Failed to get Google Drive access — please try again.');
  }
  cachedToken = { value: credential.accessToken, expiresAt: Date.now() + TOKEN_TTL_MS, uid: user.uid };
  return credential.accessToken;
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
 */
export async function backupToGoogleDrive(options?: {
  fileName?: string;
  folderName?: string;
}): Promise<DriveBackupResult> {
  return serviceCall('backupToGoogleDrive', async () => {
    const accessToken = await getDriveAccessToken();
    const data = await exportAllData();
    const folderName = options?.folderName?.trim() || BACKUP_FOLDER_NAME;
    const folderId = await findOrCreateBackupFolder(accessToken, folderName);
    const rawFileName = options?.fileName?.trim() || defaultBackupFileName();
    const fileName = /\.json$/i.test(rawFileName) ? rawFileName : `${rawFileName}.json`;
    const file = await uploadJsonFile(accessToken, folderId, fileName, JSON.stringify(data, null, 2));
    return { fileName, webViewLink: file.webViewLink };
  });
}

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
    const { files } = await driveFetch<{ files: DriveBackupFile[] }>(
      accessToken,
      `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,createdTime,webViewLink)` +
        `&orderBy=createdTime desc&spaces=drive`
    );
    return files ?? [];
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
 */
export async function restoreFromGoogleDrive(fileId: string): Promise<ClearSummary> {
  return serviceCall('restoreFromGoogleDrive', async () => {
    const accessToken = await getDriveAccessToken();
    const json = await downloadDriveFile(accessToken, fileId);

    let backup: BackupData;
    try {
      backup = JSON.parse(json) as BackupData;
    } catch {
      throw new Error('The selected Drive file is not a valid backup (invalid JSON).');
    }
    return restoreAllData(backup);
  });
}
