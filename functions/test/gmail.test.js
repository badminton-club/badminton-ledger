const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createHandler, createFirestoreStore, cipher, connectionId, validScopes, fromMailbox } = require('../src/gmail');

const scope = 'https://www.googleapis.com/auth/gmail.readonly';
const origin = 'https://stable.example';
const baseTime = 1800000000000;
const config = {
  clientId: 'test-client', clientSecret: 'test-client-secret',
  encryptionKey: Buffer.alloc(32, 7).toString('base64'),
  allowedOrigins: `${origin},https://preview.example`,
  redirectUri: `${origin}/api/gmail/callback`,
};
const digest = (s) => crypto.createHash('sha256').update(s).digest('hex');
const reply = (data, status = 200) => new Response(JSON.stringify(data), { status });

function harness(options = {}) {
  const docs = new Map([
    ['clubs/club/members/admin', { role: 'admin' }],
    ['clubs/club', {}],
  ]);
  const ref = (path) => ({ path, async get() {
    const data = docs.get(path);
    return { exists: data !== undefined, data: () => data && structuredClone(data) };
  } });
  let serial = Promise.resolve();
  const db = {
    doc: ref, collection: (path) => ({ doc: (id) => ref(`${path}/${id}`) }),
    runTransaction(action) {
      const run = serial.then(async () => {
        const writes = [];
        const result = await action({
          get: (reference) => reference.get(),
          set: (reference, data) => writes.push(() => docs.set(reference.path, structuredClone(data))),
          delete: (reference) => writes.push(() => docs.delete(reference.path)),
        });
        writes.forEach((write) => write());
        return result;
      });
      serial = run.catch(() => {});
      return run;
    },
  };
  const calls = [];
  const store = createFirestoreStore(db);
  let clock = baseTime;
  let upstream = options.fetch || (async () => reply({
    access_token: 'access-secret', refresh_token: 'refresh-secret', expires_in: 3600,
    token_type: 'Bearer', scope,
  }));
  const handler = createHandler({
    store, config: { ...config, ...options.config }, now: () => clock, timeoutMs: options.timeoutMs || 100,
    searchTimeoutMs: options.searchTimeoutMs || 1000,
    auth: { async verifyIdToken(token, revoked) {
      calls.push([token, revoked]);
      if (token === 'bad') throw new Error('private auth failure');
      return { uid: token };
    } },
    fetchImpl: (...args) => upstream(...args),
  });
  async function request(action, body = {}, extra = {}) {
    const headers = extra.headers || { Origin: origin, Authorization: ['Bearer', 'admin'].join(' ') };
    const req = {
      path: `/api/gmail/${action}`, method: 'POST', body: { clubId: 'club', ...body },
      query: {}, get: (name) => headers[name],
      is: (type) => !extra.nonJson && type === 'application/json', ...extra,
    };
    const res = {
      headers: {}, statusCode: 200,
      set(key, value) { this.headers[key] = value; return this; },
      status(code) { this.statusCode = code; return this; },
      json(value) { this.body = value; return this; },
      send(value) { this.body = value; return this; },
    };
    await handler(req, res);
    return res;
  }
  async function begin() {
    const response = await request('connect');
    assert.equal(response.statusCode, 200);
    const url = new URL(response.body.authorizationUrl);
    return { state: url.searchParams.get('state'), url };
  }
  const callback = (state, extra = {}) => request('callback', {}, {
    method: 'GET', headers: {}, query: { state, code: 'authorization-code', ...extra },
  });
  async function handoff(state) {
    const response = await callback(state);
    assert.equal(response.statusCode, 303);
    const destination = new URL(response.headers.Location);
    assert.equal(destination.origin, origin);
    assert.equal(destination.pathname, '/auth');
    return destination.searchParams.get('gmailHandoff');
  }
  const confirm = (ticket, extra = {}) => request('confirm', { ticket }, extra);
  async function connect() {
    const { state } = await begin();
    assert.equal((await confirm(await handoff(state))).statusCode, 200);
  }
  return { docs, store, calls, request, begin, callback, handoff, confirm, connect,
    tick: (ms) => { clock += ms; }, setFetch: (fn) => { upstream = fn; } };
}

test('PKCE, hashed state, stable callback and single-use public OAuth completion', async () => {
  const h = harness();
  const { state, url } = await h.begin();
  const pending = h.docs.get(`gmailOAuthStates/${digest(state)}`);
  assert.equal(h.docs.has(`gmailOAuthStates/${state}`), false);
  assert.equal(pending.uid, 'admin');
  assert.equal(pending.clubId, 'club');
  assert.equal(pending.expiresAtMillis, baseTime + 600000);
  assert.equal(url.searchParams.get('code_challenge'),
    crypto.createHash('sha256').update(pending.verifier).digest('base64url'));
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('redirect_uri'), config.redirectUri);
  assert.equal(url.searchParams.get('scope'), scope);
  assert.equal(url.searchParams.get('access_type'), 'offline');
  assert.equal(url.searchParams.get('prompt'), 'consent');
  let posted;
  h.setFetch(async (url, options) => {
    posted = options.body;
    return reply({ access_token: 'access-secret', refresh_token: 'refresh-secret',
      expires_in: 3600, token_type: 'Bearer', scope });
  });
  const result = await h.callback(state);
  assert.equal(result.statusCode, 303);
  assert.equal(posted, undefined);
  assert.deepEqual((await h.request('status')).body, { connected: false });
  const ticket = new URL(result.headers.Location).searchParams.get('gmailHandoff');
  const confirmation = await h.confirm(ticket);
  assert.equal(confirmation.statusCode, 200);
  assert.deepEqual(confirmation.body, { connected: true });
  assert.equal(posted.get('code_verifier'), pending.verifier);
  assert.doesNotMatch(result.headers.Location, /access-secret|refresh-secret|authorization-code/);
  assert.equal(result.headers['Referrer-Policy'], 'no-referrer');
  assert.equal((await h.callback(state)).statusCode, 400);
  const record = await h.store.get('admin', 'club');
  assert.notEqual(record.refreshToken, 'refresh-secret');
  assert.equal(record.expiresAtMillis, baseTime + 3600000);
  assert.deepEqual((await h.request('status')).body, { connected: true });
});

test('OAuth expiry, malformed state, cancellation and replay do not exchange codes', async () => {
  const h = harness({ fetch: () => assert.fail('must not exchange code') });
  const { state } = await h.begin();
  h.tick(600000);
  assert.equal((await h.callback(state)).statusCode, 400);
  assert.equal((await h.callback('bad')).statusCode, 400);
  const next = await h.begin();
  assert.equal((await h.callback(next.state, { error: 'access_denied' })).statusCode, 400);
  assert.equal((await h.callback(next.state)).statusCode, 400);
});

test('uid and club ownership isolate status, search and disconnect', async () => {
  const h = harness();
  await h.connect();
  h.docs.set('clubs/club/members/other', { role: 'superAdmin' });
  h.docs.set('clubs/second/members/admin', { role: 'admin' });
  assert.deepEqual((await h.request('status', {}, {
    headers: { Origin: origin, Authorization: ['Bearer', 'other'].join(' ') },
  })).body, { connected: false });
  assert.equal((await h.request('search', { clubId: 'second', searchAfterDate: '2026-01-01' })).statusCode, 409);
  await h.request('disconnect', {}, {
    headers: { Origin: origin, Authorization: ['Bearer', 'other'].join(' ') },
  });
  assert.equal((await h.request('status')).body.connected, true);
});

test('every operation checks current membership and revoked Firebase tokens', async () => {
  const h = harness();
  for (const action of ['status', 'connect', 'disconnect', 'search', 'confirm']) {
    h.docs.set('clubs/club/members/admin', { role: 'member' });
    assert.equal((await h.request(action)).statusCode, 403);
  }
  assert.ok(h.calls.every(([, checkRevoked]) => checkRevoked === true));
  assert.equal((await h.request('status', {}, {
    headers: { Origin: origin, Authorization: ['Bearer', 'bad'].join(' ') },
  })).statusCode, 401);
  assert.equal((await h.request('status', {}, { headers: { Origin: origin } })).statusCode, 401);
});

test('callback rechecks membership both before exchange and before storage', async () => {
  const h = harness();
  let pending = await h.begin();
  h.docs.delete('clubs/club/members/admin');
  assert.equal((await h.callback(pending.state)).statusCode, 400);
  h.docs.set('clubs/club/members/admin', { role: 'admin' });
  pending = await h.begin();
  h.setFetch(async () => {
    h.docs.delete('clubs/club/members/admin');
    return reply({ access_token: 'private', refresh_token: 'private', expires_in: 3600,
      token_type: 'Bearer', scope });
  });
  assert.equal((await h.confirm(await h.handoff(pending.state))).statusCode, 409);
  assert.equal((await h.store.get('admin', 'club')).refreshToken, undefined);
});

test('disconnect invalidates all pending callbacks and an in-flight exchange', async () => {
  const h = harness();
  const one = await h.begin();
  const two = await h.begin();
  await h.request('disconnect');
  assert.equal((await h.callback(one.state)).statusCode, 400);
  assert.equal((await h.callback(two.state)).statusCode, 400);
  const three = await h.begin();
  h.setFetch(async () => {
    await h.request('disconnect');
    return reply({ access_token: 'private', refresh_token: 'private', expires_in: 3600,
      token_type: 'Bearer', scope });
  });
  assert.equal((await h.confirm(await h.handoff(three.state))).statusCode, 409);
  assert.deepEqual((await h.request('status')).body, { connected: false });
});

test('simultaneous OAuth callbacks mint one completion; simultaneous confirms exchange once', async () => {
  let exchanges = 0;
  const h = harness({ fetch: async () => {
    exchanges++;
    return reply({ access_token: 'private', refresh_token: 'private', expires_in: 3600,
      token_type: 'Bearer', scope });
  } });
  const { state } = await h.begin();
  const responses = await Promise.all([h.callback(state), h.callback(state)]);
  assert.deepEqual(responses.map((r) => r.statusCode).sort(), [303, 400]);
  assert.equal(exchanges, 0);
  const ticket = new URL(responses.find((r) => r.statusCode === 303).headers.Location)
    .searchParams.get('gmailHandoff');
  const confirmations = await Promise.all([h.confirm(ticket), h.confirm(ticket)]);
  assert.deepEqual(confirmations.map((r) => r.statusCode).sort(), [200, 400]);
  assert.equal(exchanges, 1);
});

test('CORS exact allowlist, explicit Origin, safe preflight and JSON/method validation', async () => {
  const h = harness();
  for (const bad of ['https://stable.example.evil', 'null', undefined]) {
    const res = await h.request('status', {}, { headers: { Origin: bad } });
    assert.equal(res.statusCode, 403);
    assert.equal(res.headers['Access-Control-Allow-Origin'], undefined);
  }
  assert.equal((await h.request('status', {}, { headers: { Origin: 'https://preview.example' },
    method: 'OPTIONS' })).statusCode, 204);
  assert.equal((await h.request('status', {}, { headers: {}, method: 'OPTIONS' })).statusCode, 403);
  assert.equal((await h.request('status', {}, { nonJson: true })).statusCode, 400);
  assert.equal((await h.request('status', {}, { method: 'GET' })).statusCode, 405);
  assert.equal((await h.request('proxy')).statusCode, 404);
  assert.equal((await h.request('status', { clubId: '../club' })).statusCode, 400);
});

test('new grants require readonly scope, refresh token and bounded valid tokens', async () => {
  for (const changes of [
    { scope: '' }, { scope: `${scope} https://mail.google.com/` },
    { scope: `${scope} https://www.googleapis.com/auth/gmail.modify` },
    { refresh_token: undefined }, { expires_in: 0 }, { token_type: 'other' },
  ]) {
    const h = harness({ fetch: async () => reply({
      access_token: 'access', refresh_token: 'refresh', expires_in: 3600,
      token_type: 'Bearer', scope, ...changes,
    }) });
    const { state } = await h.begin();
    assert.equal((await h.confirm(await h.handoff(state))).statusCode, 502);
    assert.equal((await h.request('status')).body.connected, false);
  }
  assert.equal(validScopes(`${scope} openid email`), true);
});

test('search refreshes encrypted credentials and projects only raw required message fields', async () => {
  const h = harness();
  await h.connect();
  h.tick(3600000);
  const urls = [];
  h.setFetch(async (url, options) => {
    urls.push(url);
    if (url.includes('/token')) {
      assert.equal(options.body.get('refresh_token'), 'refresh-secret');
      return reply({ access_token: 'new-access', expires_in: 3600, token_type: 'Bearer' });
    }
    assert.equal(options.headers.Authorization, ['Bearer', 'new-access'].join(' '));
    if (url.includes('/messages?')) return reply({ messages: [{ id: '1' }, { id: '2' }] });
    return reply({ id: url.includes('/1?') ? '1' : '2', threadId: 'thread', internalDate: '1800000000000',
      snippet: 'omit', labelIds: ['omit'], payload: {
        mimeType: 'text/plain', headers: [{ name: 'From', value: url.includes('/1?') ?
          'Interac <NOTIFY@payments.interac.ca>' : 'attacker@example.com' }],
        body: { size: 3, data: 'YWJj', untrusted: 'omit' },
      } });
  });
  const result = await h.request('search', { searchAfterDate: '2026-01-01',
    customGmailQuery: 'subject:payment OR subject:transfer' });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.messages.length, 1);
  assert.deepEqual(Object.keys(result.body.messages[0]).sort(), ['id', 'threadId', 'internalDate', 'payload'].sort());
  assert.equal(result.body.messages[0].payload.body.untrusted, undefined);
  const query = new URL(urls.find((url) => url.includes('/messages?'))).searchParams.get('q');
  assert.match(query, /\(from:notify@payments.interac.ca\)/);
  assert.match(query, /\(subject:payment OR subject:transfer\)/);
  assert.doesNotMatch(JSON.stringify(result.body), /new-access|refresh-secret/);
  assert.equal((await h.request('status')).body.connected, true);
});

test('invalid_grant disconnects, later searches require reconnect; other upstream failures stay generic', async () => {
  const h = harness();
  await h.connect();
  h.tick(3600000);
  h.setFetch(async () => reply({ error: 'invalid_grant', error_description: 'private' }, 400));
  let res = await h.request('search', { searchAfterDate: '2026-01-01' });
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error.code, 'gmail/not-connected');
  assert.equal((await h.request('status')).body.connected, false);
  assert.equal((await h.request('search', { searchAfterDate: '2026-01-01' })).statusCode, 409);
  h.setFetch(async () => reply({ error: 'private error details' }, 500));
  const { state } = await h.begin();
  res = await h.confirm(await h.handoff(state));
  assert.equal(res.statusCode, 502);
  assert.doesNotMatch(JSON.stringify(res.body), /private error details/);
});

test('refresh cannot restore a disconnected or replaced connection', async () => {
  const h = harness();
  await h.connect();
  h.tick(3600000);
  h.setFetch(async (url) => {
    if (url.includes('/revoke')) return reply({});
    await h.request('disconnect');
    return reply({ access_token: 'refreshed', expires_in: 3600, token_type: 'Bearer' });
  });
  assert.equal((await h.request('search', { searchAfterDate: '2026-01-01' })).statusCode, 409);
  assert.equal((await h.request('status')).body.connected, false);
});

test('disconnect revokes only server-side and tolerates revocation failure', async () => {
  const h = harness();
  await h.connect();
  h.setFetch(async (url, options) => {
    assert.equal(url, 'https://oauth2.googleapis.com/revoke');
    assert.equal(options.body.get('token'), 'refresh-secret');
    throw new Error('private upstream failure');
  });
  const result = await h.request('disconnect');
  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.body, { connected: false });
});

test('date and custom-query validation reject malformed inputs before contacting Gmail', async () => {
  const h = harness({ fetch: () => assert.fail('should reject before fetch') });
  for (const body of [
    { searchAfterDate: '2026-02-30' }, { searchAfterDate: '2026-1-1' },
    { searchAfterDate: '2026-01-01', customGmailQuery: ') OR from:evil@example.com (' },
    { searchAfterDate: '2026-01-01', customGmailQuery: '"broken' },
    { searchAfterDate: '2026-01-01', customGmailQuery: '\n' },
    { searchAfterDate: '2026-01-01', customGmailQuery: {} },
  ]) assert.equal((await h.request('search', body)).statusCode, 400);
});

test('sender settings come from club and actual From is exact, not display name or suffix', async () => {
  const h = harness();
  await h.connect();
  h.docs.set('clubs/club', { etransferSenderAddresses: ['bank@example.com'] });
  let query;
  h.setFetch(async (url) => {
    if (url.includes('/messages?')) {
      query = new URL(url).searchParams.get('q');
      return reply({ messages: [{ id: '1' }] });
    }
    return reply({ id: '1', payload: { headers: [{ name: 'From', value: 'bank@example.com.evil' }] } });
  });
  const res = await h.request('search', { searchAfterDate: '2026-01-01',
    etransferSenderAddresses: ['attacker@example.com'] });
  assert.equal(res.body.messages.length, 0);
  assert.match(query, /from:bank@example.com/);
  for (const value of ['"bank@example.com" <evil@example.com>', 'a@example.com,bank@example.com',
    'bank@example.com (comment)', '<bank@example.com>, <evil@example.com>',
    'evil@example.com, <bank@example.com>']) {
    assert.notEqual(fromMailbox({ headers: [{ name: 'From', value }] }), 'bank@example.com');
  }
  assert.equal(fromMailbox({ headers: [{ name: 'From', value: 'bank@example.com' },
    { name: 'From', value: 'evil@example.com' }] }), null);
});

test('pagination capped at twenty pages and fetch concurrency capped at five', async () => {
  const h = harness();
  await h.connect();
  let pages = 0;
  let active = 0;
  let peak = 0;
  h.setFetch(async (url) => {
    if (url.includes('/messages?')) {
      pages++;
      return reply({ messages: [{ id: String(pages) }], ...(pages < 20 ? { nextPageToken: String(pages) } : {}) });
    }
    active++;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 1));
    active--;
    return reply({ id: 'id', payload: { headers: [{ name: 'From', value: 'notify@payments.interac.ca' }] } });
  });
  assert.equal((await h.request('search', { searchAfterDate: '2026-01-01' })).statusCode, 200);
  assert.equal(pages, 20);
  assert.equal(peak, 5);
});

test('OAuth and Gmail fetch timeout aborts; upstream 401 produces reconnect code', async () => {
  const h = harness({ timeoutMs: 5 });
  let aborted = false;
  h.setFetch((url, { signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => {
    aborted = true;
    reject(new Error('private timeout'));
  })));
  const { state } = await h.begin();
  assert.equal((await h.confirm(await h.handoff(state))).statusCode, 502);
  assert.equal(aborted, true);
  h.setFetch(async () => reply({ access_token: 'a', refresh_token: 'r',
    expires_in: 3600, token_type: 'Bearer', scope }));
  await h.connect();
  h.setFetch(async () => reply({ error: 'private expired credentials' }, 401));
  const res = await h.request('search', { searchAfterDate: '2026-01-01' });
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error.code, 'gmail/not-connected');
  assert.doesNotMatch(JSON.stringify(res.body), /private expired/);
  assert.equal((await h.request('status')).body.connected, false);
});

test('encrypted tokens authenticate their owner and detect ciphertext tampering', () => {
  const encryption = cipher(config.encryptionKey);
  const owner = connectionId('admin', 'club');
  const encrypted = encryption.encrypt('private-refresh', owner);
  assert.equal(encryption.decrypt(encrypted, owner), 'private-refresh');
  assert.throws(() => encryption.decrypt(encrypted, connectionId('other', 'club')));
  const changed = Buffer.from(encrypted, 'base64');
  changed[29] ^= 1;
  assert.throws(() => encryption.decrypt(changed.toString('base64'), owner));
  assert.throws(() => cipher('bad-key'));
});

test('response size budget fails closed without returning partial messages', async () => {
  const h = harness();
  await h.connect();
  h.setFetch(async (url) => url.includes('/messages?') ? reply({ messages: [{ id: '1' }] }) :
    reply({ id: '1', payload: { headers: [{ name: 'From', value: 'notify@payments.interac.ca' }],
      body: { data: 'x'.repeat(9 * 1024 * 1024) } } }));
  const result = await h.request('search', { searchAfterDate: '2026-01-01' });
  assert.equal(result.statusCode, 502);
  assert.equal(result.body.error.code, 'gmail/response-too-large');
  assert.equal(result.body.messages, undefined);
});

test('legacy sender settings work, and empty or invalid sender lists fail closed', async () => {
  const h = harness();
  await h.connect();
  h.docs.set('clubs/club', { etransferSenderAddress: ' Bank@Example.com ' });
  h.setFetch(async (url) => {
    assert.match(new URL(url).searchParams.get('q'), /from:bank@example.com/);
    return reply({});
  });
  assert.equal((await h.request('search', { searchAfterDate: '2026-01-01' })).statusCode, 200);
  for (const value of [[], ['not an email'], ['from:evil@example.com OR anything']]) {
    h.docs.set('clubs/club', { etransferSenderAddresses: value });
    assert.equal((await h.request('search', { searchAfterDate: '2026-01-01' })).statusCode, 400);
  }
});

test('production Firestore store reads sender settings from root club document', async () => {
  const paths = [];
  const root = {
    name: 'Club',
    etransferSenderAddresses: ['root@example.com'],
    etransferSenderAddress: 'legacy@example.com',
    settings: { etransferSenderAddresses: ['incorrect-nested@example.com'] },
  };
  const store = createFirestoreStore({
    doc(path) {
      paths.push(path);
      return { get: async () => ({ data: () => root }) };
    },
  });
  const settings = await store.settings('production-club');
  assert.deepEqual(paths, ['clubs/production-club']);
  assert.equal(settings, root);
  assert.deepEqual(settings.etransferSenderAddresses, ['root@example.com']);
  assert.equal(settings.etransferSenderAddress, 'legacy@example.com');
});

test('default query preserves autodeposit subject and UTC epoch cutoff', async () => {
  const h = harness();
  await h.connect();
  h.setFetch(async (url) => {
    const query = new URL(url).searchParams.get('q');
    assert.equal(query, '(from:notify@payments.interac.ca) subject:"automatically deposited" after:1767225600');
    return reply({});
  });
  assert.equal((await h.request('search', { searchAfterDate: '2026-01-01' })).statusCode, 200);
  assert.equal((await h.request('search', {
    searchAfterDate: '2026-01-01', customGmailQuery: '   ',
  })).statusCode, 200);
});

test('custom query replaces date and subject, permits empty date, and enforces grouped senders', async () => {
  const h = harness();
  await h.connect();
  h.docs.set('clubs/club', { etransferSenderAddresses: ['bank@example.com', 'forwarder@example.com'] });
  h.setFetch(async (url) => {
    const query = new URL(url).searchParams.get('q');
    assert.equal(query, '((from:bank@example.com OR from:forwarder@example.com)) AND (label:forwarded OR subject:payment)');
    assert.doesNotMatch(query, /after:|automatically deposited/);
    return reply({});
  });
  for (const searchAfterDate of ['', undefined, null, 'invalid']) {
    assert.equal((await h.request('search', { searchAfterDate,
      customGmailQuery: ' label:forwarded OR subject:payment ' })).statusCode, 200);
  }
  assert.equal((await h.request('search', {
    searchAfterDate: '', customGmailQuery: ' ',
  })).statusCode, 400);
});

test('From parsing matches strict mailbox semantics including quoted comma display names', () => {
  const parse = (value) => fromMailbox({ headers: [{ name: 'From', value }] });
  assert.equal(parse('"Notify, Interac" <notify@payments.interac.ca>'), 'notify@payments.interac.ca');
  assert.equal(parse('Notify < notify@payments.interac.ca >'), 'notify@payments.interac.ca');
  for (const value of ['evil@x, Notify <notify@payments.interac.ca>',
    'evil@example.com <notify@payments.interac.ca>',
    'Notify, Interac <notify@payments.interac.ca>']) assert.equal(parse(value), null);
});

test('nullable optional custom query uses the normal default date and subject filters', async () => {
  const h = harness();
  await h.connect();
  h.setFetch(async (url) => {
    const query = new URL(url).searchParams.get('q');
    assert.match(query, /subject:"automatically deposited" after:1767225600/);
    return reply({});
  });
  const result = await h.request('search', {
    searchAfterDate: '2026-01-01', customGmailQuery: null,
  });
  assert.equal(result.statusCode, 200);
  assert.equal((await h.request('search', {
    searchAfterDate: null, customGmailQuery: null,
  })).statusCode, 400);
});

test('upstream failures are generic 502 and do not unnecessarily delete a connection', async () => {
  const h = harness();
  await h.connect();
  h.setFetch(async () => reply({ error: { message: 'private Google detail' } }, 500));
  let result = await h.request('search', { searchAfterDate: '2026-01-01' });
  assert.equal(result.statusCode, 502);
  assert.doesNotMatch(JSON.stringify(result.body), /private Google/);
  assert.equal((await h.request('status')).body.connected, true);
  h.tick(3600000);
  result = await h.request('search', { searchAfterDate: '2026-01-01' });
  assert.equal(result.statusCode, 502);
  assert.equal((await h.request('status')).body.connected, true);
});

test('refresh scope expansion requires reconnect and refreshed tokens never escape', async () => {
  const h = harness();
  await h.connect();
  h.tick(3600000);
  h.setFetch(async () => reply({ access_token: 'private-new', expires_in: 3600,
    token_type: 'Bearer', scope: `${scope} https://www.googleapis.com/auth/gmail.modify` }));
  const res = await h.request('search', { searchAfterDate: '2026-01-01' });
  assert.equal(res.statusCode, 409);
  assert.doesNotMatch(JSON.stringify(res.body), /private-new/);
  assert.equal((await h.request('status')).body.connected, false);
});

test('disconnect or membership removal during a search prevents its result from escaping', async () => {
  for (const removeMembership of [false, true]) {
    const h = harness();
    await h.connect();
    h.setFetch(async (url) => {
      if (url.includes('/revoke')) return reply({});
      if (removeMembership) h.docs.delete('clubs/club/members/admin');
      else await h.request('disconnect');
      return reply({});
    });
    const res = await h.request('search', { searchAfterDate: '2026-01-01' });
    assert.equal(res.statusCode, removeMembership ? 403 : 409);
    assert.equal(res.body.messages, undefined);
  }
});

test('unbounded upstream bodies are cancelled and malformed upstream JSON stays private', async () => {
  const h = harness();
  await h.connect();
  h.setFetch(async () => reply({ privateData: 'x'.repeat(13 * 1024 * 1024) }));
  let res = await h.request('search', { searchAfterDate: '2026-01-01' });
  assert.equal(res.statusCode, 502);
  h.setFetch(async () => new Response('private invalid JSON'));
  res = await h.request('search', { searchAfterDate: '2026-01-01' });
  assert.equal(res.statusCode, 502);
  assert.doesNotMatch(JSON.stringify(res.body), /private invalid JSON/);
});

test('pagination cap fails explicitly instead of returning partial messages', async () => {
  const h = harness();
  await h.connect();
  let pages = 0;
  h.setFetch(async (url) => {
    assert.match(url, /\/messages\?/);
    pages++;
    return reply({ messages: [{ id: String(pages) }], nextPageToken: 'more' });
  });
  const result = await h.request('search', { searchAfterDate: '2026-01-01' });
  assert.equal(pages, 20);
  assert.equal(result.statusCode, 502);
  assert.equal(result.body.error.code, 'gmail/search-too-large');
  assert.equal(result.body.messages, undefined);
});

test('overall search deadline aborts all in-flight messages and never returns partial results', async () => {
  const h = harness({ searchTimeoutMs: 15, timeoutMs: 1000 });
  await h.connect();
  let aborted = 0;
  h.setFetch(async (url, { signal }) => {
    if (url.includes('/messages?')) return reply({ messages:
      Array.from({ length: 10 }, (_, id) => ({ id: String(id) })) });
    return new Promise((resolve, reject) => signal.addEventListener('abort', () => {
      aborted++;
      reject(new Error('cancelled'));
    }, { once: true }));
  });
  const result = await h.request('search', { searchAfterDate: '2026-01-01' });
  assert.equal(result.statusCode, 502);
  assert.equal(result.body.error.code, 'gmail/search-timeout');
  assert.equal(result.body.messages, undefined);
  assert.equal(aborted, 5);
});

test('a failed message request cancels sibling requests rather than continuing the batch', async () => {
  const h = harness();
  await h.connect();
  let aborted = 0;
  let fetched = 0;
  h.setFetch(async (url, { signal }) => {
    if (url.includes('/messages?')) return reply({ messages:
      Array.from({ length: 10 }, (_, id) => ({ id: String(id) })) });
    fetched++;
    if (url.includes('/0?')) return reply({ error: 'private failure' }, 500);
    return new Promise((resolve, reject) => signal.addEventListener('abort', () => {
      aborted++;
      reject(new Error('cancelled'));
    }, { once: true }));
  });
  const result = await h.request('search', { searchAfterDate: '2026-01-01' });
  assert.equal(result.statusCode, 502);
  assert.equal(fetched, 5);
  assert.equal(aborted, 4);
  assert.equal(result.body.messages, undefined);
});

test('an unauthorized old search cannot disconnect concurrently replaced credentials', async () => {
  const h = harness();
  await h.connect();
  h.setFetch(async () => {
    const current = await h.store.get('admin', 'club');
    const encryption = cipher(config.encryptionKey);
    const owner = connectionId('admin', 'club');
    await h.store.save('admin', 'club', current.generation, {
      accessToken: encryption.encrypt('replacement-access', owner),
      refreshToken: encryption.encrypt('replacement-refresh', owner),
      expiresAtMillis: baseTime + 3600000,
    });
    return reply({ error: 'old credential rejected' }, 401);
  });
  const response = await h.request('search', { searchAfterDate: '2026-01-01' });
  assert.equal(response.statusCode, 409);
  assert.equal((await h.request('status')).body.connected, true);
});

test('forwarded OAuth link cannot attach a victim mailbox to the initiating attacker account', async () => {
  let exchanges = 0;
  const h = harness({ fetch: async () => {
    exchanges++;
    return reply({ access_token: 'victim-mailbox-access', refresh_token: 'victim-mailbox-refresh',
      expires_in: 3600, token_type: 'Bearer', scope });
  } });
  h.docs.set('clubs/club/members/victim', { role: 'admin' });
  const { state, url } = await h.begin();
  const ticket = await h.handoff(state);
  assert.equal(exchanges, 0);
  assert.equal((await h.request('status')).body.connected, false);
  assert.doesNotMatch(JSON.stringify((await h.request('status')).body), new RegExp(ticket));
  assert.equal(url.searchParams.has('gmailHandoff'), false);
  const victim = await h.confirm(ticket, {
    headers: { Origin: origin, Authorization: ['Bearer', 'victim'].join(' ') },
  });
  assert.equal(victim.statusCode, 403);
  assert.equal(exchanges, 0);
  assert.equal(h.docs.has(`gmailOAuthStates/${digest(ticket)}`), true);
  assert.equal((await h.store.get('admin', 'club')).refreshToken, undefined);
  assert.equal((await h.store.get('victim', 'club')).refreshToken, undefined);
});

test('completion requires authenticated owner, exact club and Origin; wrong callers cannot consume it', async () => {
  const h = harness();
  const { state } = await h.begin();
  const ticket = await h.handoff(state);
  h.docs.set('clubs/other/members/admin', { role: 'admin' });
  assert.equal((await h.confirm(ticket, { headers: { Origin: origin } })).statusCode, 401);
  assert.equal((await h.confirm(ticket, { headers: { Origin: 'https://evil.example' } })).statusCode, 403);
  assert.equal((await h.request('confirm', { clubId: 'other', ticket })).statusCode, 403);
  assert.equal(h.docs.has(`gmailOAuthStates/${digest(ticket)}`), true);
  assert.equal((await h.confirm(ticket)).statusCode, 200);
  assert.equal((await h.confirm(ticket)).statusCode, 400);
  assert.equal((await h.request('status')).body.connected, true);
});

test('completion stores encrypted code and verifier, and public redirect carries no credentials', async () => {
  const h = harness({ fetch: () => assert.fail('callback must not exchange credentials') });
  const { state } = await h.begin();
  const verifier = h.docs.get(`gmailOAuthStates/${digest(state)}`).verifier;
  const response = await h.callback(state);
  assert.equal(response.statusCode, 303);
  const destination = new URL(response.headers.Location);
  assert.deepEqual([...destination.searchParams.keys()].sort(), ['gmailClub', 'gmailHandoff']);
  assert.equal(destination.searchParams.get('gmailClub'), 'club');
  const ticket = destination.searchParams.get('gmailHandoff');
  const stored = h.docs.get(`gmailOAuthStates/${digest(ticket)}`);
  assert.equal(stored.kind, 'completion');
  assert.equal(stored.expiresAtMillis, baseTime + 300000);
  assert.equal(h.docs.has(`gmailOAuthStates/${ticket}`), false);
  assert.doesNotMatch(JSON.stringify(stored), /authorization-code/);
  assert.equal(JSON.stringify(stored).includes(verifier), false);
  assert.doesNotMatch(response.headers.Location, /authorization-code|code_verifier|access_token|refresh_token/);
  assert.equal((await h.callback(ticket)).statusCode, 400);
  assert.equal(h.docs.has(`gmailOAuthStates/${digest(ticket)}`), true);
});

test('completion expires within five minutes and never outlives original authorization state', async () => {
  for (const initialDelay of [0, 9 * 60000]) {
    const h = harness({ fetch: () => assert.fail('expired ticket must not exchange') });
    const { state } = await h.begin();
    h.tick(initialDelay);
    const ticket = await h.handoff(state);
    h.tick(initialDelay ? 60000 : 300000);
    assert.equal((await h.confirm(ticket)).statusCode, 400);
    assert.equal(h.docs.has(`gmailOAuthStates/${digest(ticket)}`), false);
  }
});

test('disconnect invalidates unconfirmed completion, and callback creation cannot race it', async () => {
  const h = harness({ fetch: () => assert.fail('disconnected completion must not exchange') });
  const first = await h.begin();
  const ticket = await h.handoff(first.state);
  await h.request('disconnect');
  assert.equal((await h.confirm(ticket)).statusCode, 400);
  const second = await h.begin();
  const complete = h.store.complete;
  h.store.complete = async (...args) => {
    await h.store.disconnect('admin', 'club');
    return complete(...args);
  };
  const response = await h.callback(second.state);
  assert.equal(response.statusCode, 400);
  assert.equal(response.headers.Location, undefined);
  assert.equal((await h.request('status')).body.connected, false);
});

test('current membership is required at explicit confirmation, not merely at OAuth callback', async () => {
  const h = harness({ fetch: () => assert.fail('removed admin must not exchange') });
  const { state } = await h.begin();
  const ticket = await h.handoff(state);
  h.docs.set('clubs/club/members/admin', { role: 'member' });
  assert.equal((await h.confirm(ticket)).statusCode, 403);
  assert.equal((await h.store.get('admin', 'club')).refreshToken, undefined);
});
