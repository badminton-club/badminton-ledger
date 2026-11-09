const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createPlayerLinker } = require('../src/player-linking');

function harness() {
  const docs = new Map();
  const snapshot = (path) => ({
    id: path.split('/').at(-1), ref: ref(path),
    exists: docs.has(path), data: () => structuredClone(docs.get(path)),
  });
  const ref = (path) => ({ path, get: async () => snapshot(path) });
  const query = (predicate) => ({
    get: async () => ({
      docs: [...docs.keys()].filter((path) => predicate(path, docs.get(path))).map(snapshot),
    }),
  });
  let serial = Promise.resolve();
  let beforeTransaction = () => {};
  let failWrite = false;
  const db = {
    doc: ref,
    collectionGroup: (name) => ({
      where: (field, op, value) => query((path, data) => path.split('/').at(-2) === name
        && data[field] === value),
    }),
    collection: (name) => ({
      where: (field, op, value) => query((path, data) => path.startsWith(`${name}/`)
        && path.split('/').length === name.split('/').length + 1 && data[field] === value),
    }),
    runTransaction(action) {
      const run = serial.then(async () => {
        beforeTransaction();
        const writes = [];
        const result = await action({
          get: (target) => target.get(),
          set: (target, data, options) => writes.push(() => {
            const original = docs.get(target.path) ?? {};
            const next = options?.merge ? { ...original } : {};
            for (const [key, value] of Object.entries(data)) {
              next[key] = value?.union
                ? [...new Set([...(original[key] ?? []), ...value.union])]
                : value;
            }
            docs.set(target.path, next);
          }),
        });
        if (failWrite) throw new Error('Firestore unavailable');
        writes.forEach((write) => write());
        return result;
      });
      serial = run.catch(() => {});
      return run;
    },
  };
  const accounts = new Map([['user', { email: 'PLAYER@example.com', emailVerified: true }]]);
  const link = createPlayerLinker({
    db, auth: { getUser: async (uid) => accounts.get(uid) },
    fieldValue: { arrayUnion: (...items) => ({ union: items }), serverTimestamp: () => 'now' },
    error: (code, message) => Object.assign(new Error(message), { code }),
  });
  const request = (uid = 'user', token = {}) => link({
    auth: { uid, token: { email: 'Player@Example.com', email_verified: true, auth_time: 1800000000, ...token } },
    data: { email: 'attacker@example.com', uid: 'attacker', role: 'superAdmin' },
  });
  const seed = (club = 'club', player = 'player', email = 'player@example.com') => {
    docs.set(`clubs/${club}`, { name: club });
    docs.set(`clubs/${club}/players/${player}`, { firstName: 'Player' });
    docs.set(`clubs/${club}/etransferSenderMappings/${email}`, { senderEmail: email, playerId: player });
  };
  return {
    docs, accounts, link, request, seed,
    beforeTransaction: (fn) => { beforeTransaction = fn; },
    failWrites: () => { failWrite = true; },
  };
}

test('joins matching clubs as member using only the authenticated verified email', async () => {
  const h = harness();
  h.seed();
  h.seed('second', 'player-2');
  h.docs.set('users/user', { clubs: ['existing'], username: 'Keep me' });
  assert.deepEqual(await h.request(), { linked: 2, conflicts: 0 });
  assert.deepEqual(h.docs.get('clubs/club/members/user'), {
    role: 'member', playerId: 'player', addedAt: 'now',
  });
  assert.deepEqual(h.docs.get('users/user'), { clubs: ['existing', 'club', 'second'], username: 'Keep me' });
  assert.equal(h.docs.has('clubs/club/members/attacker'), false);
  assert.deepEqual(await h.request(), { linked: 0, conflicts: 0 });
});

test('requires a verified authenticated account and checks the current account record', async () => {
  const h = harness();
  h.seed();
  await assert.rejects(h.link({}), { code: 'unauthenticated' });
  await assert.rejects(h.request('user', { email_verified: false }), { code: 'failed-precondition' });
  await assert.rejects(h.request('user', { email: null }), { code: 'failed-precondition' });
  for (const account of [
    { email: 'player@example.com', emailVerified: false },
    { email: 'other@example.com', emailVerified: true },
    { email: 'player@example.com', emailVerified: true, disabled: true },
    { email: 'player@example.com', emailVerified: true, tokensValidAfterTime: new Date(1800000001000).toUTCString() },
  ]) {
    h.accounts.set('user', account);
    await assert.rejects(h.request(), { code: 'permission-denied' });
  }
  assert.equal(h.docs.has('users/user'), false);
});

test('does not use name-only mappings, player profile emails, or other senders', async () => {
  const h = harness();
  h.seed('club', 'player', 'other@example.com');
  h.docs.set('clubs/club/players/player', { email: 'player@example.com' });
  h.docs.set('clubs/club/etransferSenderMappings/name:player', { senderEmail: null, playerId: 'player' });
  assert.deepEqual(await h.request(), { linked: 0, conflicts: 0 });
});

test('preserves elevated roles and existing membership fields when linking an unlinked member', async () => {
  const h = harness();
  h.seed();
  h.docs.set('clubs/club/members/user', { role: 'superAdmin', addedAt: 'original', playerId: null });
  await h.request();
  assert.deepEqual(h.docs.get('clubs/club/members/user'), {
    role: 'superAdmin', addedAt: 'original', playerId: 'player',
  });
});

test('restores an already-linked club missing from the saved profile without changing membership', async () => {
  const h = harness();
  h.seed();
  h.docs.set('clubs/club/members/user', { role: 'admin', playerId: 'player', addedAt: 'original' });
  assert.deepEqual(await h.request(), { linked: 1, conflicts: 0 });
  assert.deepEqual(h.docs.get('users/user'), { clubs: ['club'] });
  assert.deepEqual(h.docs.get('clubs/club/members/user'), {
    role: 'admin', playerId: 'player', addedAt: 'original',
  });
});

test('does not replace an existing player link or claim a player linked to another account', async () => {
  for (const [uid, playerId] of [['user', 'different-player'], ['other-user', 'player']]) {
    const h = harness();
    h.seed();
    h.docs.set(`clubs/club/members/${uid}`, { role: 'member', playerId });
    assert.deepEqual(await h.request(), { linked: 0, conflicts: 1 });
    assert.equal(h.docs.get(`clubs/club/members/${uid}`).playerId, playerId);
    assert.equal(h.docs.has('users/user'), false);
  }
});

test('rejects missing clubs, missing players, and malformed player references', async () => {
  for (const path of ['clubs/club', 'clubs/club/players/player']) {
    const h = harness();
    h.seed();
    h.docs.delete(path);
    assert.deepEqual(await h.request(), { linked: 0, conflicts: 1 });
  }
  const h = harness();
  h.seed('club', 'nested/player');
  assert.deepEqual(await h.request(), { linked: 0, conflicts: 1 });
});

test('rechecks mappings inside the transaction so deleted or changed matches do not grant access', async () => {
  for (const action of ['delete', 'change']) {
    const h = harness();
    h.seed();
    h.beforeTransaction(() => {
      const path = 'clubs/club/etransferSenderMappings/player@example.com';
      if (action === 'delete') h.docs.delete(path);
      else h.docs.set(path, { senderEmail: 'other@example.com', playerId: 'player' });
    });
    assert.deepEqual(await h.request(), { linked: 0, conflicts: 0 });
    assert.equal(h.docs.has('users/user'), false);
  }
});

test('ignores noncanonical mapping paths rather than granting arbitrary club access', async () => {
  const h = harness();
  h.docs.set('other/club/etransferSenderMappings/player@example.com', {
    senderEmail: 'player@example.com', playerId: 'player',
  });
  assert.deepEqual(await h.request(), { linked: 0, conflicts: 0 });
});

test('two accounts sharing an email cannot simultaneously claim the same player', async () => {
  const h = harness();
  h.seed();
  h.accounts.set('second-user', { email: 'player@example.com', emailVerified: true });
  const results = await Promise.all([h.request(), h.request('second-user')]);
  assert.deepEqual(results, [{ linked: 1, conflicts: 0 }, { linked: 0, conflicts: 1 }]);
});

test('transaction failures surface and do not leave partial membership or profile writes', async () => {
  const h = harness();
  h.seed();
  h.failWrites();
  await assert.rejects(h.request(), /Firestore unavailable/);
  assert.equal(h.docs.has('clubs/club/members/user'), false);
  assert.equal(h.docs.has('users/user'), false);
});
