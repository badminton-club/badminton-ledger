import {
  addClubMember,
  addClubToUser,
  createClub,
  deleteClub,
  deleteLinkRequest,
  deleteProfileEditRequest,
  fetchClub,
  fetchClubMembers,
  fetchLinkRequests,
  fetchMemberPlayerId,
  fetchMemberRole,
  fetchMyLinkRequest,
  fetchMyProfileEditRequest,
  fetchProfileEditRequests,
  fetchUserClubs,
  fetchUserProfile,
  removeClubFromUser,
  removeClubMember,
  setClubTabEnabled,
  setClubEtransferSearchAfterDate,
  setClubEtransferSearchWindowDays,
  resetClubEtransferSearchSetting,
  setLastVisitedClub,
  setMemberPlayer,
  submitLinkRequest,
  submitProfileEditRequest,
} from '../clubs';
import {
  resetFirebaseTestState,
  seedClubDoc,
  seedClubMetaDoc,
  seedMemberDoc,
  seedUserDoc,
  TEST_CLUB_ID,
} from '../../../test-utils/firebaseTestHelpers';
import { __getDocData, __seedDoc, Timestamp } from '../../../test-utils/fakeFirestore';

beforeEach(() => {
  resetFirebaseTestState();
});

describe('createClub', () => {
  it('creates the club, owner membership, and updates the owner profile', async () => {
    seedUserDoc('owner-1', { clubs: ['existing-club'], lastVisitedClub: 'existing-club' });

    await createClub('club-a', 'Alpha Club', 'owner-1');

    expect(__getDocData('clubs/club-a')).toMatchObject({
      name: 'Alpha Club',
      ownerUid: 'owner-1',
      createdAt: expect.any(Timestamp),
    });
    expect(__getDocData('clubs/club-a/members/owner-1')).toMatchObject({
      role: 'superAdmin',
      addedAt: expect.any(Timestamp),
    });
    expect(__getDocData('users/owner-1')).toMatchObject({
      clubs: ['existing-club', 'club-a'],
      lastVisitedClub: 'club-a',
    });
  });
});

describe('fetchUserProfile', () => {
  it('creates and returns an empty profile for a first-time user', async () => {
    const profile = await fetchUserProfile('user-1');

    expect(profile).toEqual({ clubs: [], lastVisitedClub: null });
    expect(__getDocData('users/user-1')).toMatchObject({
      clubs: [],
      lastVisitedClub: null,
      createdAt: expect.any(Timestamp),
    });
  });

  it('sanitizes malformed stored profile fields', async () => {
    seedUserDoc('user-1', { clubs: 'not-an-array', lastVisitedClub: undefined });

    await expect(fetchUserProfile('user-1')).resolves.toEqual({
      clubs: [],
      lastVisitedClub: null,
    });
  });
});

describe('fetchClub', () => {
  it('returns the club document when it exists', async () => {
    seedClubMetaDoc('club-a', { name: 'Alpha Club', disabledTabs: ['members'] });

    await expect(fetchClub('club-a')).resolves.toEqual({
      id: 'club-a',
      name: 'Alpha Club',
      disabledTabs: ['members'],
    });
  });

  it('returns null when the club does not exist', async () => {
    await expect(fetchClub('missing-club')).resolves.toBeNull();
  });
});

describe('fetchMemberRole', () => {
  it('returns the stored member role when valid', async () => {
    seedMemberDoc('user-1', { role: 'admin' }, 'club-a');

    await expect(fetchMemberRole('club-a', 'user-1')).resolves.toBe('admin');
  });

  it('returns null for missing or invalid roles', async () => {
    seedMemberDoc('user-1', { role: 'owner' }, 'club-a');

    await expect(fetchMemberRole('club-a', 'user-1')).resolves.toBeNull();
    await expect(fetchMemberRole('club-a', 'missing-user')).resolves.toBeNull();
  });
});

describe('fetchUserClubs', () => {
  it('resolves saved club ids to names and roles with fallbacks for missing data', async () => {
    seedUserDoc('user-1', { clubs: ['club-a', 'club-b'], lastVisitedClub: 'club-a' });
    seedClubMetaDoc('club-a', { name: 'Alpha Club' });
    seedMemberDoc('user-1', { role: 'admin' }, 'club-a');

    await expect(fetchUserClubs('user-1')).resolves.toEqual([
      { id: 'club-a', name: 'Alpha Club', role: 'admin' },
      { id: 'club-b', name: 'club-b', role: null },
    ]);
  });
});

describe('addClubToUser', () => {
  it('creates the profile if needed and adds the club id only once', async () => {
    await addClubToUser('user-1', 'club-a');
    await addClubToUser('user-1', 'club-a');

    expect(__getDocData('users/user-1')).toMatchObject({
      clubs: ['club-a'],
      lastVisitedClub: null,
    });
  });
});

describe('removeClubFromUser', () => {
  it('removes the club and clears lastVisitedClub when it points to that club', async () => {
    seedUserDoc('user-1', { clubs: ['club-a', 'club-b'], lastVisitedClub: 'club-a' });

    await removeClubFromUser('user-1', 'club-a');

    expect(__getDocData('users/user-1')).toMatchObject({
      clubs: ['club-b'],
      lastVisitedClub: null,
    });
  });

  it('keeps lastVisitedClub when removing a different saved club', async () => {
    seedUserDoc('user-1', { clubs: ['club-a', 'club-b'], lastVisitedClub: 'club-b' });

    await removeClubFromUser('user-1', 'club-a');

    expect(__getDocData('users/user-1')).toMatchObject({
      clubs: ['club-b'],
      lastVisitedClub: 'club-b',
    });
  });
});

describe('setLastVisitedClub', () => {
  it('ensures the profile exists before saving the last visited club', async () => {
    await setLastVisitedClub('user-1', 'club-a');

    expect(__getDocData('users/user-1')).toMatchObject({
      clubs: [],
      lastVisitedClub: 'club-a',
      createdAt: expect.any(Timestamp),
    });
  });
});

describe('addClubMember', () => {
  it('adds or updates the member role without discarding other member fields', async () => {
    seedMemberDoc('user-1', { role: 'member', playerId: 'player-1' }, 'club-a');

    await addClubMember('club-a', 'user-1', 'admin');

    expect(__getDocData('clubs/club-a/members/user-1')).toMatchObject({
      role: 'admin',
      playerId: 'player-1',
      addedAt: expect.any(Timestamp),
    });
  });

  it("saves the club onto the new member's own profile, so it shows up in their club switcher", async () => {
    seedUserDoc('user-1', { clubs: ['other-club'], lastVisitedClub: 'other-club' });

    await addClubMember('club-a', 'user-1', 'member');

    expect(__getDocData('users/user-1')).toMatchObject({
      clubs: ['other-club', 'club-a'],
    });
  });
});

describe('fetchMemberPlayerId', () => {
  it('returns the linked player id when present', async () => {
    seedMemberDoc('user-1', { role: 'member', playerId: 'player-1' }, 'club-a');

    await expect(fetchMemberPlayerId('club-a', 'user-1')).resolves.toBe('player-1');
  });

  it('returns null when the member is missing or unlinked', async () => {
    seedMemberDoc('user-1', { role: 'member', playerId: null }, 'club-a');

    await expect(fetchMemberPlayerId('club-a', 'user-1')).resolves.toBeNull();
    await expect(fetchMemberPlayerId('club-a', 'missing-user')).resolves.toBeNull();
  });
});

describe('fetchClubMembers', () => {
  it('lists members with default fallbacks for missing role or playerId', async () => {
    seedMemberDoc('admin-1', { role: 'admin', playerId: 'player-1' }, 'club-a');
    seedMemberDoc('member-1', {}, 'club-a');

    const members = await fetchClubMembers('club-a');

    expect(members.sort((a, b) => a.uid.localeCompare(b.uid))).toEqual([
      { uid: 'admin-1', role: 'admin', playerId: 'player-1' },
      { uid: 'member-1', role: 'member', playerId: null },
    ]);
  });
});

describe('setMemberPlayer', () => {
  it('updates an existing member link without changing the role', async () => {
    seedMemberDoc('user-1', { role: 'admin', playerId: 'old-player' }, 'club-a');

    await setMemberPlayer('club-a', 'user-1', 'new-player');

    expect(__getDocData('clubs/club-a/members/user-1')).toMatchObject({
      role: 'admin',
      playerId: 'new-player',
    });
  });

  it('creates a new member as a regular member when none exists', async () => {
    await setMemberPlayer('club-a', 'user-1', 'player-1');

    expect(__getDocData('clubs/club-a/members/user-1')).toMatchObject({
      role: 'member',
      playerId: 'player-1',
      addedAt: expect.any(Timestamp),
    });
  });
});

describe('removeClubMember', () => {
  it('deletes the member document', async () => {
    seedMemberDoc('user-1', { role: 'member' }, 'club-a');

    await removeClubMember('club-a', 'user-1');

    expect(__getDocData('clubs/club-a/members/user-1')).toBeUndefined();
  });
});

describe('submitLinkRequest', () => {
  it('stores one pending request per user and normalizes empty last names to null', async () => {
    await submitLinkRequest('club-a', 'user-1', 'Jamie', '', 'jamie@example.com');
    await submitLinkRequest('club-a', 'user-1', 'James', 'Smith', 'james@example.com');

    expect(__getDocData('clubs/club-a/linkRequests/user-1')).toMatchObject({
      uid: 'user-1',
      firstName: 'James',
      lastName: 'Smith',
      email: 'james@example.com',
      createdAt: expect.any(Timestamp),
    });
  });
});

describe('fetchLinkRequests', () => {
  it('maps both modern and legacy request shapes', async () => {
    __seedDoc('clubs/club-a/linkRequests/user-1', {
      uid: 'user-1',
      firstName: 'Jamie',
      lastName: 'Lee',
      email: 'jamie@example.com',
    });
    __seedDoc('clubs/club-a/linkRequests/user-2', {
      uid: 'user-2',
      name: 'Legacy',
      lastName: undefined,
      email: undefined,
    });

    const requests = await fetchLinkRequests('club-a');

    expect(requests.sort((a, b) => a.uid.localeCompare(b.uid))).toEqual([
      { uid: 'user-1', firstName: 'Jamie', lastName: 'Lee', email: 'jamie@example.com', createdAt: undefined },
      { uid: 'user-2', firstName: 'Legacy', lastName: null, email: '', createdAt: undefined },
    ]);
  });
});

describe('deleteLinkRequest', () => {
  it('deletes a pending link request', async () => {
    __seedDoc('clubs/club-a/linkRequests/user-1', { uid: 'user-1', firstName: 'Jamie' });

    await deleteLinkRequest('club-a', 'user-1');

    expect(__getDocData('clubs/club-a/linkRequests/user-1')).toBeUndefined();
  });
});

describe('fetchMyLinkRequest', () => {
  it('returns the caller request when present and null otherwise', async () => {
    __seedDoc('clubs/club-a/linkRequests/user-1', {
      uid: 'user-1',
      name: 'Legacy',
      email: 'legacy@example.com',
    });

    await expect(fetchMyLinkRequest('club-a', 'user-1')).resolves.toEqual({
      uid: 'user-1',
      firstName: 'Legacy',
      lastName: null,
      email: 'legacy@example.com',
      createdAt: undefined,
    });
    await expect(fetchMyLinkRequest('club-a', 'missing-user')).resolves.toBeNull();
  });
});

describe('submitProfileEditRequest', () => {
  it('stores a pending edit request keyed by uid, normalizing an empty last name to null', async () => {
    await submitProfileEditRequest('club-a', 'user-1', 'player-1', 'Jamie', '', 'jamie@example.com');

    expect(__getDocData('clubs/club-a/profileEditRequests/user-1')).toMatchObject({
      uid: 'user-1',
      playerId: 'player-1',
      firstName: 'Jamie',
      lastName: null,
      email: 'jamie@example.com',
      createdAt: expect.any(Timestamp),
    });
  });

  it('resubmitting overwrites the previous pending request for the same user', async () => {
    await submitProfileEditRequest('club-a', 'user-1', 'player-1', 'Jamie', 'Lee', 'jamie@example.com');
    await submitProfileEditRequest('club-a', 'user-1', 'player-1', 'James', 'Lee-Smith', null);

    expect(__getDocData('clubs/club-a/profileEditRequests/user-1')).toMatchObject({
      firstName: 'James',
      lastName: 'Lee-Smith',
      email: null,
    });
  });
});

describe('fetchProfileEditRequests', () => {
  it('lists every pending profile-edit request for a club', async () => {
    __seedDoc('clubs/club-a/profileEditRequests/user-1', {
      uid: 'user-1', playerId: 'player-1', firstName: 'Jamie', lastName: 'Lee', email: 'jamie@example.com',
    });
    __seedDoc('clubs/club-a/profileEditRequests/user-2', {
      uid: 'user-2', playerId: 'player-2', firstName: 'Ada', lastName: null, email: null,
    });

    const requests = await fetchProfileEditRequests('club-a');

    expect(requests.sort((a, b) => a.uid.localeCompare(b.uid))).toEqual([
      { uid: 'user-1', playerId: 'player-1', firstName: 'Jamie', lastName: 'Lee', email: 'jamie@example.com', createdAt: undefined },
      { uid: 'user-2', playerId: 'player-2', firstName: 'Ada', lastName: null, email: null, createdAt: undefined },
    ]);
  });
});

describe('fetchMyProfileEditRequest', () => {
  it('returns the caller\'s own pending edit request when present and null otherwise', async () => {
    __seedDoc('clubs/club-a/profileEditRequests/user-1', {
      uid: 'user-1', playerId: 'player-1', firstName: 'Jamie', lastName: 'Lee', email: 'jamie@example.com',
    });

    await expect(fetchMyProfileEditRequest('club-a', 'user-1')).resolves.toEqual({
      uid: 'user-1', playerId: 'player-1', firstName: 'Jamie', lastName: 'Lee', email: 'jamie@example.com', createdAt: undefined,
    });
    await expect(fetchMyProfileEditRequest('club-a', 'missing-user')).resolves.toBeNull();
  });
});

describe('deleteProfileEditRequest', () => {
  it('deletes a pending profile-edit request', async () => {
    __seedDoc('clubs/club-a/profileEditRequests/user-1', { uid: 'user-1', playerId: 'player-1', firstName: 'Jamie' });

    await deleteProfileEditRequest('club-a', 'user-1');

    expect(__getDocData('clubs/club-a/profileEditRequests/user-1')).toBeUndefined();
  });
});

describe('setClubTabEnabled', () => {
  it('adds disabled tabs idempotently and removes them again when re-enabled', async () => {
    seedClubMetaDoc('club-a', { name: 'Alpha Club', disabledTabs: ['ledger'] });

    await setClubTabEnabled('club-a', 'members', false);
    await setClubTabEnabled('club-a', 'members', false);
    await setClubTabEnabled('club-a', 'members', true);

    expect(__getDocData('clubs/club-a')).toMatchObject({
      name: 'Alpha Club',
      disabledTabs: ['ledger'],
    });
  });
});

describe('e-Transfer search cutoff settings', () => {
  it('setClubEtransferSearchWindowDays saves the rolling window and clears any custom date', async () => {
    seedClubMetaDoc('club-a', { name: 'Alpha Club', etransferSearchAfterDate: '2026-01-01' });

    await setClubEtransferSearchWindowDays('club-a', 14);

    expect(__getDocData('clubs/club-a')).toMatchObject({
      etransferSearchWindowDays: 14,
      etransferSearchAfterDate: null,
    });
  });

  it('setClubEtransferSearchAfterDate saves a custom date and clears any rolling window', async () => {
    seedClubMetaDoc('club-a', { name: 'Alpha Club', etransferSearchWindowDays: 30 });

    await setClubEtransferSearchAfterDate('club-a', '2026-05-01');

    expect(__getDocData('clubs/club-a')).toMatchObject({
      etransferSearchAfterDate: '2026-05-01',
      etransferSearchWindowDays: null,
    });
  });

  it('resetClubEtransferSearchSetting clears both, reverting to the default rolling window', async () => {
    seedClubMetaDoc('club-a', {
      name: 'Alpha Club',
      etransferSearchWindowDays: 30,
      etransferSearchAfterDate: '2026-05-01',
    });

    await resetClubEtransferSearchSetting('club-a');

    expect(__getDocData('clubs/club-a')).toMatchObject({
      etransferSearchWindowDays: null,
      etransferSearchAfterDate: null,
    });
  });
});

describe('deleteClub', () => {
  it('refuses to delete while any club-scoped data collection still has documents', async () => {
    seedClubMetaDoc('club-a', { name: 'Alpha Club' });
    seedMemberDoc('owner-1', { role: 'superAdmin' }, 'club-a');
    seedUserDoc('owner-1', { clubs: ['club-a'], lastVisitedClub: 'club-a' });
    __seedDoc('clubs/club-a/players/player-1', { firstName: 'Jamie' });

    await expect(deleteClub('club-a', 'owner-1')).rejects.toThrow(
      'Clear all club data first — "players" still has 1 document(s).'
    );

    expect(__getDocData('clubs/club-a')).toMatchObject({ name: 'Alpha Club' });
    expect(__getDocData('clubs/club-a/members/owner-1')).toMatchObject({ role: 'superAdmin' });
    expect(__getDocData('users/owner-1')).toMatchObject({
      clubs: ['club-a'],
      lastVisitedClub: 'club-a',
    });
  });

  it('deletes the club doc and memberships, then removes it from the caller profile', async () => {
    seedClubMetaDoc('club-a', { name: 'Alpha Club' });
    seedMemberDoc('owner-1', { role: 'superAdmin' }, 'club-a');
    seedMemberDoc('member-1', { role: 'member' }, 'club-a');
    seedUserDoc('owner-1', { clubs: ['club-a', TEST_CLUB_ID], lastVisitedClub: 'club-a' });

    await deleteClub('club-a', 'owner-1');

    expect(__getDocData('clubs/club-a')).toBeUndefined();
    expect(__getDocData('clubs/club-a/members/owner-1')).toBeUndefined();
    expect(__getDocData('clubs/club-a/members/member-1')).toBeUndefined();
    expect(__getDocData('users/owner-1')).toMatchObject({
      clubs: [TEST_CLUB_ID],
      lastVisitedClub: null,
    });
  });

  it('also deletes any pending link requests, leaving nothing orphaned', async () => {
    seedClubMetaDoc('club-a', { name: 'Alpha Club' });
    seedMemberDoc('owner-1', { role: 'superAdmin' }, 'club-a');
    seedUserDoc('owner-1', { clubs: ['club-a'], lastVisitedClub: 'club-a' });
    __seedDoc('clubs/club-a/linkRequests/pending-uid', { uid: 'pending-uid', firstName: 'Jamie', lastName: null, email: '' });
    __seedDoc('clubs/club-a/profileEditRequests/pending-uid-2', { uid: 'pending-uid-2', playerId: 'p1', firstName: 'Ada' });

    await deleteClub('club-a', 'owner-1');

    expect(__getDocData('clubs/club-a/linkRequests/pending-uid')).toBeUndefined();
    expect(__getDocData('clubs/club-a/profileEditRequests/pending-uid-2')).toBeUndefined();
  });
});
