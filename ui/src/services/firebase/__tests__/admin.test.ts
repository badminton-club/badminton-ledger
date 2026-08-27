import {
  clearAllData,
  exportAllData,
  restoreAllData,
  setUpClubFromExistingData,
  CLEARABLE_COLLECTIONS,
  type BackupData,
} from '../admin';
import {
  resetFirebaseTestState,
  seedClubDoc,
  getClubDocData,
  seedClubMetaDoc,
  seedMemberDoc,
  seedUserDoc,
  ts,
  TEST_CLUB_ID,
} from '../../../test-utils/firebaseTestHelpers';
import { __getAllPaths, __getDocData, __seedDoc, Timestamp } from '../../../test-utils/fakeFirestore';

const emptySummary = () =>
  Object.fromEntries(CLEARABLE_COLLECTIONS.map(name => [name, 0])) as Record<(typeof CLEARABLE_COLLECTIONS)[number], number>;

const emptyCollections = (): BackupData['collections'] =>
  Object.fromEntries(CLEARABLE_COLLECTIONS.map(name => [name, []])) as BackupData['collections'];

beforeEach(() => {
  resetFirebaseTestState();
});

describe('clearAllData', () => {
  it('deletes only the current club data collections and leaves auth/other-club docs intact', async () => {
    seedClubDoc('sessions', 'session-1', { note: 'current club session' });
    seedClubDoc('players', 'player-1', { name: 'Jamie' });
    seedClubDoc('balanceLedger', 'ledger-1', { delta: 10 });
    seedClubMetaDoc(TEST_CLUB_ID, { name: 'Home Club' });
    seedMemberDoc('admin-1', { role: 'admin' });
    seedUserDoc('admin-1', { clubs: [TEST_CLUB_ID], lastVisitedClub: TEST_CLUB_ID });
    __seedDoc('clubs/other-club/sessions/session-9', { note: 'other club session' });

    const summary = await clearAllData();

    expect(summary).toEqual({
      ...emptySummary(),
      sessions: 1,
      players: 1,
      balanceLedger: 1,
    });
    expect(getClubDocData('sessions', 'session-1')).toBeUndefined();
    expect(getClubDocData('players', 'player-1')).toBeUndefined();
    expect(getClubDocData('balanceLedger', 'ledger-1')).toBeUndefined();
    expect(__getDocData('clubs/other-club/sessions/session-9')).toEqual({ note: 'other club session' });
    expect(__getDocData(`clubs/${TEST_CLUB_ID}`)).toEqual({ name: 'Home Club' });
    expect(__getDocData(`clubs/${TEST_CLUB_ID}/members/admin-1`)).toEqual({ role: 'admin' });
    expect(__getDocData('users/admin-1')).toEqual({ clubs: [TEST_CLUB_ID], lastVisitedClub: TEST_CLUB_ID });
  });

  it('deletes more than 500 documents from a collection by committing multiple batches', async () => {
    for (let i = 0; i < 501; i += 1) {
      seedClubDoc('sessions', `session-${i}`, { index: i });
    }

    const summary = await clearAllData();

    expect(summary.sessions).toBe(501);
    expect(__getAllPaths().filter(path => path.startsWith(`clubs/${TEST_CLUB_ID}/sessions/`))).toHaveLength(0);
  });
});

describe('exportAllData / restoreAllData', () => {
  it('round-trips Firestore Timestamps through backup JSON serialization', async () => {
    const playedAt = ts('2026-04-01T10:11:12.123Z');
    const reopenedAt = ts('2026-04-02T03:04:05.456Z');
    const nestedAt = ts('2026-04-03T06:07:08.789Z');

    seedClubDoc('sessions', 'session-1', {
      date: playedAt,
      nested: { reopenedAt },
      history: [nestedAt, { finalAt: reopenedAt }],
      note: 'timestamp rich session',
    });

    const backup = await exportAllData();
    const exported = backup.collections.sessions[0].data as {
      date: Record<string, unknown>;
      nested: { reopenedAt: Record<string, unknown> };
      history: Array<Record<string, unknown>>;
    };

    expect(backup.version).toBe(1);
    expect(exported.date).toMatchObject({ __ts__: true, seconds: playedAt.seconds, nanoseconds: playedAt.nanoseconds });
    expect(exported.nested.reopenedAt).toMatchObject({
      __ts__: true,
      seconds: reopenedAt.seconds,
      nanoseconds: reopenedAt.nanoseconds,
    });
    expect(exported.history[0]).toMatchObject({
      __ts__: true,
      seconds: nestedAt.seconds,
      nanoseconds: nestedAt.nanoseconds,
    });

    await clearAllData();
    const summary = await restoreAllData(JSON.parse(JSON.stringify(backup)) as BackupData);
    const restored = getClubDocData('sessions', 'session-1') as {
      date: Timestamp;
      nested: { reopenedAt: Timestamp };
      history: [Timestamp, { finalAt: Timestamp }];
      note: string;
    };

    expect(summary).toEqual({ ...emptySummary(), sessions: 1 });
    expect(restored.note).toBe('timestamp rich session');
    expect(restored.date).toBeInstanceOf(Timestamp);
    expect(restored.nested.reopenedAt).toBeInstanceOf(Timestamp);
    expect(restored.history[0]).toBeInstanceOf(Timestamp);
    expect(restored.history[1].finalAt).toBeInstanceOf(Timestamp);
    expect(restored.date.toMillis()).toBe(playedAt.toMillis());
    expect(restored.nested.reopenedAt.toMillis()).toBe(reopenedAt.toMillis());
    expect(restored.history[0].toMillis()).toBe(nestedAt.toMillis());
  });

  it('rejects malformed or unsupported backups', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    await expect(restoreAllData(null as unknown as BackupData)).rejects.toThrow('Invalid or unsupported backup file.');
    await expect(
      restoreAllData({ version: 2, exportedAt: '2026-01-01T00:00:00.000Z', collections: emptyCollections() } as unknown as BackupData)
    ).rejects.toThrow('Invalid or unsupported backup file.');
    await expect(
      restoreAllData({
        version: 1,
        exportedAt: '2026-01-01T00:00:00.000Z',
        collections: 'bad-shape' as unknown as BackupData['collections'],
      })
    ).rejects.toThrow('Invalid or unsupported backup file.');

    expect(consoleSpy).toHaveBeenCalledTimes(3);
  });

  it('upserts documents by original id without deleting unrelated docs', async () => {
    seedClubDoc('sessions', 'session-1', { note: 'old value' });
    seedClubDoc('players', 'keep-me', { name: 'Already here' });

    const backup: BackupData = {
      version: 1,
      exportedAt: '2026-05-01T00:00:00.000Z',
      collections: {
        ...emptyCollections(),
        sessions: [{ id: 'session-1', data: { note: 'new value', migrated: true } }],
        players: [{ id: 'player-2', data: { name: 'New player' } }],
      },
    };

    const summary = await restoreAllData(backup);

    expect(summary).toEqual({ ...emptySummary(), sessions: 1, players: 1 });
    expect(getClubDocData('sessions', 'session-1')).toEqual({ note: 'new value', migrated: true });
    expect(getClubDocData('players', 'player-2')).toEqual({ name: 'New player' });
    expect(getClubDocData('players', 'keep-me')).toEqual({ name: 'Already here' });
  });
});

describe('setUpClubFromExistingData', () => {
  it('creates the club/admin records and copies legacy top-level data non-destructively', async () => {
    seedUserDoc('owner-1', { clubs: ['existing-club'], lastVisitedClub: 'existing-club' });
    __seedDoc('sessions/session-1', { date: ts('2026-06-01T08:00:00.000Z'), court: 2 });
    __seedDoc('players/player-1', { name: 'Jamie', balance: 14 });

    const summary = await setUpClubFromExistingData('club-a', 'Alpha Club', 'owner-1');

    expect(summary).toEqual({ ...emptySummary(), sessions: 1, players: 1 });
    expect(__getDocData('clubs/club-a')).toMatchObject({
      name: 'Alpha Club',
      ownerUid: 'owner-1',
      createdAt: expect.any(Timestamp),
    });
    expect(__getDocData('clubs/club-a/members/owner-1')).toMatchObject({
      role: 'admin',
      addedAt: expect.any(Timestamp),
    });
    expect(__getDocData('users/owner-1')).toEqual({
      clubs: ['existing-club', 'club-a'],
      lastVisitedClub: 'club-a',
    });
    expect(__getDocData('clubs/club-a/sessions/session-1')).toEqual(__getDocData('sessions/session-1'));
    expect(__getDocData('clubs/club-a/players/player-1')).toEqual(__getDocData('players/player-1'));
    expect(__getDocData('sessions/session-1')).toEqual({ date: ts('2026-06-01T08:00:00.000Z'), court: 2 });
    expect(__getDocData('players/player-1')).toEqual({ name: 'Jamie', balance: 14 });
  });
});
