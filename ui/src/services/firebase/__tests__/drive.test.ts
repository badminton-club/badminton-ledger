export {}; // marks this file as a module for `isolatedModules` (only `require()`/type-only imports below)

type DriveModule = typeof import('../drive');
type AdminModule = typeof import('../admin');
type HelpersModule = typeof import('../../../test-utils/firebaseTestHelpers');
type FakeAuthModule = typeof import('../../../test-utils/fakeAuth');
type FakeFirestoreModule = typeof import('../../../test-utils/fakeFirestore');
type BackupData = import('../admin').BackupData;

const originalFetch = global.fetch;

let drive: DriveModule;
let admin: AdminModule;
let helpers: HelpersModule;
let fakeAuth: FakeAuthModule;
let fakeFirestore: FakeFirestoreModule;
let firebaseApp: typeof import('firebase/app');

const userOne = { uid: 'user-1', displayName: 'User One', email: 'user1@example.com' };
const userTwo = { uid: 'user-2', displayName: 'User Two', email: 'user2@example.com' };

const jsonResponse = (body: unknown, init: Partial<{ ok: boolean; status: number; statusText: string }> = {}) => ({
  ok: init.ok ?? true,
  status: init.status ?? 200,
  statusText: init.statusText ?? 'OK',
  json: async () => body,
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});

const textResponse = (body: string, init: Partial<{ ok: boolean; status: number; statusText: string }> = {}) => ({
  ok: init.ok ?? true,
  status: init.status ?? 200,
  statusText: init.statusText ?? 'OK',
  json: async () => JSON.parse(body),
  text: async () => body,
});

function fetchMock(): jest.Mock {
  return global.fetch as unknown as jest.Mock;
}

function expectBearerToken(callIndex: number, token: string): void {
  const init = fetchMock().mock.calls[callIndex][1] as RequestInit;
  const headers = init.headers as Record<string, string>;
  expect(headers.Authorization).toBe(`Bearer ${token}`);
}

function emptySummary(): Record<string, number> {
  return Object.fromEntries(admin.CLEARABLE_COLLECTIONS.map(name => [name, 0]));
}

beforeEach(() => {
  jest.resetModules();
  drive = require('../drive');
  admin = require('../admin');
  helpers = require('../../../test-utils/firebaseTestHelpers');
  fakeAuth = require('../../../test-utils/fakeAuth');
  fakeFirestore = require('../../../test-utils/fakeFirestore');
  firebaseApp = require('firebase/app');
  helpers.resetFirebaseTestState();
  global.fetch = jest.fn() as unknown as typeof fetch;
});

afterEach(() => {
  global.fetch = originalFetch as typeof fetch;
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe('defaultBackupFileName', () => {
  it('formats a timestamped json filename without colon or dot characters', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-27T08:45:55.172Z'));

    expect(drive.defaultBackupFileName()).toBe('badminton-ledger-backup-2026-08-27T08-45-55-172Z.json');
  });
});

describe('backupToGoogleDrive', () => {
  it('creates the folder when missing, appends .json, and uploads the exported backup payload', async () => {
    helpers.setCurrentUser(userOne);
    helpers.seedClubDoc('sessions', 'session-1', {
      date: helpers.ts('2026-03-01T10:00:00.000Z'),
      nested: { reopenedAt: helpers.ts('2026-03-02T10:00:00.000Z') },
    });
    const reauth = jest.fn(async (user, provider) => {
      expect(provider.getScopes()).toEqual(['https://www.googleapis.com/auth/drive.file']);
      expect(provider.getCustomParameters()).toEqual({ prompt: 'consent' });
      return { user, __credential: { accessToken: 'drive-token' } };
    });
    fakeAuth.__setReauthImplementation(reauth);
    fetchMock()
      .mockResolvedValueOnce(jsonResponse({ files: [] }))
      .mockResolvedValueOnce(jsonResponse({ id: 'folder-1' }))
      .mockResolvedValueOnce(jsonResponse({ id: 'file-1', webViewLink: 'https://drive.google.com/file/d/file-1/view' }));

    const result = await drive.backupToGoogleDrive({
      fileName: '  season-closeout  ',
      folderName: '  Team Backups  ',
    });

    expect(result).toEqual({
      fileName: 'season-closeout.json',
      webViewLink: 'https://drive.google.com/file/d/file-1/view',
    });
    expect(reauth).toHaveBeenCalledTimes(1);
    expect(decodeURIComponent(fetchMock().mock.calls[0][0] as string)).toContain("name='Team Backups'");
    expect(fetchMock().mock.calls[1][0]).toBe('https://www.googleapis.com/drive/v3/files?fields=id');
    expect(fetchMock().mock.calls[1][1]).toMatchObject({
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer drive-token' },
    });
    expect(JSON.parse((fetchMock().mock.calls[1][1] as RequestInit).body as string)).toEqual({
      name: 'Team Backups',
      mimeType: 'application/vnd.google-apps.folder',
    });

    const uploadRequest = fetchMock().mock.calls[2][1] as RequestInit;
    expect(fetchMock().mock.calls[2][0]).toBe(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink'
    );
    expect(uploadRequest.method).toBe('POST');
    expect((uploadRequest.headers as Record<string, string>)['Content-Type']).toContain('multipart/related; boundary=');
    expect(uploadRequest.body as string).toContain('"name":"season-closeout.json"');
    expect(uploadRequest.body as string).toContain('"parents":["folder-1"]');
    expect(uploadRequest.body as string).toMatch(/"__ts__"\s*:\s*true/);
    expectBearerToken(0, 'drive-token');
    expectBearerToken(1, 'drive-token');
    expectBearerToken(2, 'drive-token');
  });

  it('throws a detailed error when a Drive API call returns a non-ok response', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    helpers.setCurrentUser(userOne);
    fakeAuth.__setReauthImplementation(async user => ({ user, __credential: { accessToken: 'drive-token' } }));
    fetchMock().mockResolvedValueOnce(textResponse('denied', { ok: false, status: 403, statusText: 'Forbidden' }));

    await expect(drive.backupToGoogleDrive()).rejects.toThrow('Google Drive request failed (403): denied');
    expect(consoleSpy).toHaveBeenCalledWith('[backupToGoogleDrive]', expect.any(Error));
  });
});

describe('listGoogleDriveBackups', () => {
  it('reuses a cached token across repeated calls for the same signed-in user', async () => {
    helpers.setCurrentUser(userOne);
    const reauth = jest.fn(async user => ({ user, __credential: { accessToken: 'cached-token' } }));
    fakeAuth.__setReauthImplementation(reauth);
    fetchMock().mockResolvedValue(jsonResponse({ files: [] }));

    await expect(drive.listGoogleDriveBackups('   ')).resolves.toEqual([]);
    await expect(drive.listGoogleDriveBackups('   ')).resolves.toEqual([]);

    expect(reauth).toHaveBeenCalledTimes(1);
    expect(fetchMock()).toHaveBeenCalledTimes(2);
    expect(decodeURIComponent(fetchMock().mock.calls[0][0] as string)).toContain(drive.DEFAULT_BACKUP_FOLDER_NAME);
    expectBearerToken(0, 'cached-token');
    expectBearerToken(1, 'cached-token');
  });

  it('invalidates the cached token when the signed-in uid changes', async () => {
    helpers.setCurrentUser(userOne);
    const reauth = jest.fn(async user => ({ user, __credential: { accessToken: `token-for-${user.uid}` } }));
    fakeAuth.__setReauthImplementation(reauth);
    fetchMock().mockResolvedValue(jsonResponse({ files: [] }));

    await drive.listGoogleDriveBackups('Shared Folder');
    helpers.setCurrentUser(userTwo);
    await drive.listGoogleDriveBackups('Shared Folder');

    expect(reauth).toHaveBeenCalledTimes(2);
    expect(reauth.mock.calls[0][0]).toMatchObject({ uid: 'user-1' });
    expect(reauth.mock.calls[1][0]).toMatchObject({ uid: 'user-2' });
    expectBearerToken(0, 'token-for-user-1');
    expectBearerToken(1, 'token-for-user-2');
  });

  it('returns the files in the Drive folder when one exists', async () => {
    helpers.setCurrentUser(userOne);
    fakeAuth.__setReauthImplementation(async user => ({ user, __credential: { accessToken: 'drive-token' } }));
    fetchMock()
      .mockResolvedValueOnce(jsonResponse({ files: [{ id: 'folder-1' }] }))
      .mockResolvedValueOnce(
        jsonResponse({
          files: [
            { id: 'b2', name: 'backup-2.json', createdTime: '2026-07-02T12:00:00Z', webViewLink: 'https://b2' },
            { id: 'b1', name: 'backup-1.json', createdTime: '2026-07-01T12:00:00Z' },
          ],
        })
      );

    await expect(drive.listGoogleDriveBackups('Club Backups')).resolves.toEqual([
      { id: 'b2', name: 'backup-2.json', createdTime: '2026-07-02T12:00:00Z', webViewLink: 'https://b2' },
      { id: 'b1', name: 'backup-1.json', createdTime: '2026-07-01T12:00:00Z' },
    ]);
    expect(decodeURIComponent(fetchMock().mock.calls[1][0] as string)).toContain("'folder-1' in parents and trashed=false");
  });

  it('maps auth/user-mismatch into a friendly account-selection error', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    helpers.setCurrentUser(userOne);
    fakeAuth.__setReauthImplementation(async () => {
      throw new firebaseApp.FirebaseError('auth/user-mismatch', 'wrong account');
    });

    await expect(drive.listGoogleDriveBackups()).rejects.toThrow(
      "Select the same Google account you're signed in with."
    );
    expect(consoleSpy).toHaveBeenCalledWith('[listGoogleDriveBackups]', expect.any(Error));
  });

  it.each(['auth/popup-closed-by-user', 'auth/cancelled-popup-request'])(
    'maps %s into a cancelled-authorization error',
    async code => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      helpers.setCurrentUser(userOne);
      fakeAuth.__setReauthImplementation(async () => {
        throw new firebaseApp.FirebaseError(code, 'cancelled');
      });

      await expect(drive.listGoogleDriveBackups()).rejects.toThrow('Google Drive authorization was cancelled.');
      expect(consoleSpy).toHaveBeenCalledWith('[listGoogleDriveBackups]', expect.any(Error));
    }
  );

  it('rejects when reauthentication returns no Drive access token', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    helpers.setCurrentUser(userOne);
    fakeAuth.__setReauthImplementation(async user => ({ user }));

    await expect(drive.listGoogleDriveBackups()).rejects.toThrow('Failed to get Google Drive access — please try again.');
    expect(consoleSpy).toHaveBeenCalledWith('[listGoogleDriveBackups]', expect.any(Error));
  });
});

describe('restoreFromGoogleDrive', () => {
  it('downloads a backup file and restores it with the admin restore flow', async () => {
    helpers.seedClubDoc('sessions', 'session-1', {
      date: helpers.ts('2026-08-01T08:00:00.000Z'),
      nested: { restoredAt: helpers.ts('2026-08-02T09:00:00.000Z') },
    });
    helpers.seedClubDoc('players', 'player-1', { name: 'Jamie' });
    const backup = await admin.exportAllData();
    await admin.clearAllData();

    helpers.setCurrentUser(userOne);
    fakeAuth.__setReauthImplementation(async user => ({ user, __credential: { accessToken: 'restore-token' } }));
    fetchMock().mockResolvedValueOnce(textResponse(JSON.stringify(backup)));

    const summary = await drive.restoreFromGoogleDrive('drive-file-1');
    const restoredSession = helpers.getClubDocData('sessions', 'session-1') as {
      date: InstanceType<typeof fakeFirestore.Timestamp>;
      nested: { restoredAt: InstanceType<typeof fakeFirestore.Timestamp> };
    };

    expect(summary).toEqual({ ...emptySummary(), sessions: 1, players: 1 });
    expect(restoredSession.date).toBeInstanceOf(fakeFirestore.Timestamp);
    expect(restoredSession.nested.restoredAt).toBeInstanceOf(fakeFirestore.Timestamp);
    expect(helpers.getClubDocData('players', 'player-1')).toEqual({ name: 'Jamie' });
    expect(fetchMock().mock.calls[0][0]).toBe('https://www.googleapis.com/drive/v3/files/drive-file-1?alt=media');
    expectBearerToken(0, 'restore-token');
  });

  it('rejects invalid JSON files with a backup-specific error', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    helpers.setCurrentUser(userOne);
    fakeAuth.__setReauthImplementation(async user => ({ user, __credential: { accessToken: 'restore-token' } }));
    fetchMock().mockResolvedValueOnce(textResponse('not valid json'));

    await expect(drive.restoreFromGoogleDrive('drive-file-2')).rejects.toThrow(
      'The selected Drive file is not a valid backup (invalid JSON).'
    );
    expect(consoleSpy).toHaveBeenCalledWith('[restoreFromGoogleDrive]', expect.any(Error));
  });

  it('includes status/body context when Drive download fails', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    helpers.setCurrentUser(userOne);
    fakeAuth.__setReauthImplementation(async user => ({ user, __credential: { accessToken: 'restore-token' } }));
    fetchMock().mockResolvedValueOnce(textResponse('missing', { ok: false, status: 404, statusText: 'Not Found' }));

    await expect(drive.restoreFromGoogleDrive('missing-file')).rejects.toThrow(
      'Failed to download backup from Drive (404): missing'
    );
    expect(consoleSpy).toHaveBeenCalledWith('[restoreFromGoogleDrive]', expect.any(Error));
  });
});
