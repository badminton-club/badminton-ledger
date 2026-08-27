import {
  addPlayer,
  deletePlayer,
  findPlayersByName,
  formatPlayerName,
  updatePlayerProfile,
} from '../players';
import {
  getClubDocData,
  resetFirebaseTestState,
  seedClubDoc,
  TEST_CLUB_ID,
} from '../../../test-utils/firebaseTestHelpers';
import { __getAllPaths, __getDocData, __seedDoc, Timestamp } from '../../../test-utils/fakeFirestore';

beforeEach(() => {
  resetFirebaseTestState();
});

describe('findPlayersByName', () => {
  it('returns an empty array for blank or whitespace-only input', async () => {
    await expect(findPlayersByName('')).resolves.toEqual([]);
    await expect(findPlayersByName('   \n\t  ')).resolves.toEqual([]);
  });

  it('matches a full name case-insensitively and normalizes repeated whitespace', async () => {
    seedClubDoc('players', 'p1', {
      firstName: 'Alice',
      firstNameLower: 'alice',
      lastName: 'Van Buren',
      lastNameLower: 'van buren',
      email: 'alice@example.com',
      balance: 15,
      owed: 0,
      description: '',
      sessionCount: 0,
    });
    seedClubDoc('players', 'p2', {
      firstName: 'Alice',
      firstNameLower: 'alice',
      lastName: 'Chen',
      lastNameLower: 'chen',
      email: 'other@example.com',
      balance: 0,
      owed: 0,
      description: '',
      sessionCount: 0,
    });

    const players = await findPlayersByName('  ALICE   VAN   BUREN  ');

    expect(players.map((player) => player.id)).toEqual(['p1']);
  });

  it('falls back to first-name-only matching when no full-name match exists', async () => {
    seedClubDoc('players', 'p1', {
      firstName: 'Alice',
      firstNameLower: 'alice',
      lastName: 'Chen',
      lastNameLower: 'chen',
      email: null,
      balance: 0,
      owed: 0,
      description: '',
      sessionCount: 0,
    });
    seedClubDoc('players', 'p2', {
      firstName: 'Alice',
      firstNameLower: 'alice',
      lastName: null,
      lastNameLower: null,
      email: null,
      balance: 0,
      owed: 0,
      description: '',
      sessionCount: 0,
    });

    const players = await findPlayersByName('Alice Missing');

    expect(players.map((player) => player.id)).toEqual(['p1', 'p2']);
  });

  it('supports single-name lookups for players with or without a last name', async () => {
    seedClubDoc('players', 'p1', {
      firstName: 'Jamie',
      firstNameLower: 'jamie',
      lastName: 'Lee',
      lastNameLower: 'lee',
      email: null,
      balance: 0,
      owed: 0,
      description: '',
      sessionCount: 0,
    });
    seedClubDoc('players', 'p2', {
      firstName: 'Jamie',
      firstNameLower: 'jamie',
      lastName: null,
      lastNameLower: null,
      email: null,
      balance: 0,
      owed: 0,
      description: '',
      sessionCount: 0,
    });
    seedClubDoc('players', 'p3', {
      firstName: 'Jordan',
      firstNameLower: 'jordan',
      lastName: 'Lee',
      lastNameLower: 'lee',
      email: null,
      balance: 0,
      owed: 0,
      description: '',
      sessionCount: 0,
    });

    const players = await findPlayersByName('Jamie');

    expect(players.map((player) => player.id)).toEqual(['p1', 'p2']);
  });

  it('returns an empty array when no players match', async () => {
    seedClubDoc('players', 'p1', {
      firstName: 'Alice',
      firstNameLower: 'alice',
      lastName: 'Chen',
      lastNameLower: 'chen',
      email: null,
      balance: 0,
      owed: 0,
      description: '',
      sessionCount: 0,
    });

    await expect(findPlayersByName('Bob')).resolves.toEqual([]);
  });
});

describe('addPlayer', () => {
  it('creates a player with normalized search fields and initialized defaults', async () => {
    const playerId = await addPlayer({
      firstName: 'Alice',
      lastName: 'Van Buren',
      email: 'alice@example.com',
      balance: 12,
      description: 'Regular doubles player',
    });

    expect(playerId).toBe('auto-id-1');
    expect(__getAllPaths()).toContain(`clubs/${TEST_CLUB_ID}/players/${playerId}`);
    expect(getClubDocData('players', playerId)).toMatchObject({
      firstName: 'Alice',
      firstNameLower: 'alice',
      lastName: 'Van Buren',
      lastNameLower: 'van buren',
      email: 'alice@example.com',
      balance: 12,
      owed: 0,
      description: 'Regular doubles player',
      sessionCount: 0,
      createdAt: expect.any(Timestamp),
    });
  });

  it('defaults omitted optional fields to null, zero, or empty string', async () => {
    const playerId = await addPlayer({
      firstName: 'Jamie',
      lastName: null,
      email: null,
      balance: undefined,
      description: undefined,
    });

    expect(getClubDocData('players', playerId)).toMatchObject({
      firstName: 'Jamie',
      firstNameLower: 'jamie',
      lastName: null,
      lastNameLower: null,
      email: null,
      balance: 0,
      owed: 0,
      description: '',
      sessionCount: 0,
      createdAt: expect.any(Timestamp),
    });
  });
});

describe('formatPlayerName', () => {
  it('joins first and last name for display', () => {
    expect(formatPlayerName({ firstName: 'Alice', lastName: 'Chen' })).toBe('Alice Chen');
  });

  it('omits a missing last name', () => {
    expect(formatPlayerName({ firstName: 'Alice', lastName: null })).toBe('Alice');
  });
});

describe('updatePlayerProfile', () => {
  it('updates names and email while keeping lowercase search fields in sync', async () => {
    seedClubDoc('players', 'p1', {
      firstName: 'Old',
      firstNameLower: 'old',
      lastName: 'Name',
      lastNameLower: 'name',
      email: 'old@example.com',
      balance: 44,
      owed: 3,
      description: 'Keep me',
      sessionCount: 8,
    });

    await updatePlayerProfile('p1', {
      firstName: 'Jamie',
      lastName: 'Van Dyke',
      email: 'jamie@example.com',
    });

    expect(getClubDocData('players', 'p1')).toMatchObject({
      firstName: 'Jamie',
      firstNameLower: 'jamie',
      lastName: 'Van Dyke',
      lastNameLower: 'van dyke',
      email: 'jamie@example.com',
      balance: 44,
      owed: 3,
      description: 'Keep me',
      sessionCount: 8,
    });
  });

  it('allows clearing last name and email back to null', async () => {
    seedClubDoc('players', 'p1', {
      firstName: 'Jamie',
      firstNameLower: 'jamie',
      lastName: 'Lee',
      lastNameLower: 'lee',
      email: 'jamie@example.com',
      balance: 10,
      owed: 0,
      description: '',
      sessionCount: 1,
    });

    await updatePlayerProfile('p1', {
      firstName: 'Jamie',
      lastName: null,
      email: null,
    });

    expect(getClubDocData('players', 'p1')).toMatchObject({
      firstName: 'Jamie',
      firstNameLower: 'jamie',
      lastName: null,
      lastNameLower: null,
      email: null,
      balance: 10,
      owed: 0,
      description: '',
      sessionCount: 1,
    });
  });
});

describe('deletePlayer', () => {
  it('deletes the player and unlinks any members pointing at them', async () => {
    seedClubDoc('players', 'p1', { firstName: 'Jamie' });
    __seedDoc(`clubs/${TEST_CLUB_ID}/members/member-1`, { role: 'member', playerId: 'p1' });
    __seedDoc(`clubs/${TEST_CLUB_ID}/members/member-2`, { role: 'member', playerId: 'p2' }); // unrelated — must survive untouched

    await deletePlayer('p1');

    expect(getClubDocData('players', 'p1')).toBeUndefined();
    expect(__getDocData(`clubs/${TEST_CLUB_ID}/members/member-1`)).toMatchObject({ role: 'member', playerId: null });
    expect(__getDocData(`clubs/${TEST_CLUB_ID}/members/member-2`)).toMatchObject({ role: 'member', playerId: 'p2' });
  });

  it('removes any pending profile-edit request for the deleted player', async () => {
    seedClubDoc('players', 'p1', { firstName: 'Jamie' });
    __seedDoc(`clubs/${TEST_CLUB_ID}/profileEditRequests/member-1`, {
      uid: 'member-1', playerId: 'p1', firstName: 'Jamie Lee',
    });
    __seedDoc(`clubs/${TEST_CLUB_ID}/profileEditRequests/member-2`, {
      uid: 'member-2', playerId: 'p2', firstName: 'Someone Else', // unrelated — must survive
    });

    await deletePlayer('p1');

    expect(__getDocData(`clubs/${TEST_CLUB_ID}/profileEditRequests/member-1`)).toBeUndefined();
    expect(__getDocData(`clubs/${TEST_CLUB_ID}/profileEditRequests/member-2`)).toBeDefined();
  });

  it('throws a clear error when no club is selected', async () => {
    const { setCurrentClubId } = await import('../client');
    setCurrentClubId(null);
    await expect(deletePlayer('p1')).rejects.toThrow('No club selected');
    setCurrentClubId(TEST_CLUB_ID); // restore for any tests that run after this file
  });
});
