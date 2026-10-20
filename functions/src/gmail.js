const crypto = require('node:crypto');

const READ_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const STATE_TTL = 10 * 60 * 1000;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_UPSTREAM_BYTES = 12 * 1024 * 1024;
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API_URL = 'https://gmail.googleapis.com/gmail/v1/users/me';
const SENDER_EMAIL_PATTERN = /^[a-z0-9](?:[a-z0-9._%+-]*[a-z0-9])?@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i;
const adminRole = (data) => ['admin', 'superAdmin'].includes(data?.role);
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const connectionId = (uid, clubId) => hash(JSON.stringify([uid, clubId]));
const fail = (status, code) => Object.assign(new Error(code), { status, code });
const notConnected = () => fail(409, 'gmail/not-connected');

function createFirestoreStore(db) {
  const connection = (uid, clubId) => db.collection('gmailConnections').doc(connectionId(uid, clubId));
  const member = (uid, clubId) => db.doc(`clubs/${clubId}/members/${uid}`);
  const stateRef = (digest) => db.collection('gmailOAuthStates').doc(digest);
  return {
    async isAdmin(uid, clubId) {
      return adminRole((await member(uid, clubId).get()).data());
    },
    async settings(clubId) {
      const snap = await db.doc(`clubs/${clubId}`).get();
      return snap.data() || {};
    },
    async get(uid, clubId) {
      return (await connection(uid, clubId).get()).data() || { generation: 0 };
    },
    async begin(digest, state) {
      return db.runTransaction(async (tx) => {
        const ref = connection(state.uid, state.clubId);
        const snap = await tx.get(ref);
        const generation = snap.data()?.generation || 0;
        tx.set(stateRef(digest), { ...state, kind: 'authorization', generation,
          expiresAt: new Date(state.expiresAtMillis) });
      });
    },
    async consume(digest, now, kind = 'authorization', owner) {
      return db.runTransaction(async (tx) => {
        const ref = stateRef(digest);
        const snap = await tx.get(ref);
        if (!snap.exists) return null;
        const state = snap.data();
        if (state.kind !== kind) return null;
        if (owner && (state.uid !== owner.uid || state.clubId !== owner.clubId)) return { denied: true };
        const conn = await tx.get(connection(state.uid, state.clubId));
        const membership = await tx.get(member(state.uid, state.clubId));
        tx.delete(ref);
        return state.expiresAtMillis > now &&
          state.generation === (conn.data()?.generation || 0) &&
          adminRole(membership.data()) ? state : null;
      });
    },
    async complete(digest, state) {
      return db.runTransaction(async (tx) => {
        const conn = await tx.get(connection(state.uid, state.clubId));
        const membership = await tx.get(member(state.uid, state.clubId));
        if (state.generation !== (conn.data()?.generation || 0) || !adminRole(membership.data())) return false;
        tx.set(stateRef(digest), { ...state, kind: 'completion',
          expiresAt: new Date(state.expiresAtMillis) });
        return true;
      });
    },
    async save(uid, clubId, generation, tokens, expectedRefresh) {
      return db.runTransaction(async (tx) => {
        const ref = connection(uid, clubId);
        const snap = await tx.get(ref);
        const membership = await tx.get(member(uid, clubId));
        const current = snap.data() || { generation: 0 };
        if (current.generation !== generation || !adminRole(membership.data()) ||
          (expectedRefresh !== undefined && current.refreshToken !== expectedRefresh)) return false;
        tx.set(ref, { generation, ...tokens });
        return true;
      });
    },
    async disconnect(uid, clubId, expectedRefresh) {
      return db.runTransaction(async (tx) => {
        const ref = connection(uid, clubId);
        const snap = await tx.get(ref);
        const current = snap.data() || { generation: 0 };
        if (expectedRefresh !== undefined && current.refreshToken !== expectedRefresh) return null;
        tx.set(ref, { generation: (current.generation || 0) + 1 });
        return current;
      });
    },
  };
}

function cipher(keyText) {
  const key = Buffer.from(keyText, 'base64');
  if (key.length !== 32) throw fail(500, 'gmail/configuration');
  return {
    encrypt(text, owner) {
      const iv = crypto.randomBytes(12);
      const enc = crypto.createCipheriv('aes-256-gcm', key, iv);
      enc.setAAD(Buffer.from(owner));
      const encrypted = Buffer.concat([enc.update(text, 'utf8'), enc.final()]);
      return Buffer.concat([iv, enc.getAuthTag(), encrypted]).toString('base64');
    },
    decrypt(text, owner) {
      const bytes = Buffer.from(text, 'base64');
      const dec = crypto.createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
      dec.setAAD(Buffer.from(owner));
      dec.setAuthTag(bytes.subarray(12, 28));
      return Buffer.concat([dec.update(bytes.subarray(28)), dec.final()]).toString('utf8');
    },
  };
}

function validScopes(scope) {
  const scopes = typeof scope === 'string' ? scope.split(/\s+/) : [];
  return scopes.includes(READ_SCOPE) &&
    !scopes.some((s) => s === 'https://mail.google.com/' ||
      (s.startsWith('https://www.googleapis.com/auth/gmail.') && s !== READ_SCOPE));
}

function sendersFrom(settings) {
  const configured = settings.etransferSenderAddresses ?? settings.etransferSenderAddress ??
    'notify@payments.interac.ca';
  const senders = (Array.isArray(configured) ? configured :
    typeof configured === 'string' ? configured.split(/[,\n]/) : [configured])
    .map((s) => typeof s === 'string' ? s.trim().toLowerCase() : '');
  if (!senders.length || senders.length > 30 ||
    senders.some((s) => !SENDER_EMAIL_PATTERN.test(s))) {
    throw fail(400, 'gmail/invalid-senders');
  }
  return [...new Set(senders)];
}

function fromMailbox(payload) {
  const headers = payload?.headers;
  if (!Array.isArray(headers)) return null;
  const from = headers.filter((h) => h.name?.toLowerCase() === 'from');
  if (from.length !== 1 || typeof from[0].value !== 'string') return null;
  const value = from[0].value.trim();
  // Reject lists, comments and malformed addresses rather than guessing at a sender.
  const namedMailbox = value.match(/^(?:"[^"\r\n]*"|[^"<>,@\r\n]*)\s*<([^<>\r\n]+)>$/)?.[1]?.trim().toLowerCase();
  const mailbox = SENDER_EMAIL_PATTERN.test(value) ? value.toLowerCase() : namedMailbox;
  return mailbox && SENDER_EMAIL_PATTERN.test(mailbox) ? mailbox : null;
}

function balancedQuery(query) {
  const stack = [];
  let quoted = false;
  for (const char of query) {
    if (char === '\\') return false;
    if (char === '"') quoted = !quoted;
    if (quoted) continue;
    if (char === '(' || char === '{') stack.push(char);
    if ((char === ')' && stack.pop() !== '(') || (char === '}' && stack.pop() !== '{')) return false;
  }
  return !quoted && stack.length === 0;
}

function projectPayload(payload, depth = 0) {
  if (!payload || depth > 20) return {};
  const result = {};
  for (const key of ['partId', 'mimeType', 'filename']) {
    if (typeof payload[key] === 'string') result[key] = payload[key];
  }
  if (Array.isArray(payload.headers)) {
    result.headers = payload.headers
      .filter((h) => typeof h.name === 'string' && typeof h.value === 'string')
      .map(({ name, value }) => ({ name, value }));
  }
  if (payload.body && typeof payload.body === 'object') {
    result.body = {};
    for (const key of ['size', 'data', 'attachmentId']) {
      if (typeof payload.body[key] === (key === 'size' ? 'number' : 'string')) result.body[key] = payload.body[key];
    }
  }
  if (Array.isArray(payload.parts)) result.parts = payload.parts.map((p) => projectPayload(p, depth + 1));
  return result;
}

function createHandler({
  auth, store, config, fetchImpl = fetch, now = Date.now,
  timeoutMs = 15000, searchTimeoutMs = 48000,
}) {
  const allowedOrigins = new Set(config.allowedOrigins.split(',').map((s) => s.trim()).filter(Boolean));
  async function upstream(url, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const abort = () => controller.abort();
    options.signal?.addEventListener('abort', abort, { once: true });
    try {
      if (options.signal?.aborted) throw fail(502, 'gmail/upstream');
      const response = await fetchImpl(url, { ...options, signal: controller.signal, redirect: 'error' });
      const reader = response.body?.getReader();
      let bytes = 0;
      const chunks = [];
      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.length;
          if (bytes > MAX_UPSTREAM_BYTES) {
            await reader.cancel();
            throw fail(502, 'gmail/upstream');
          }
          chunks.push(Buffer.from(value));
        }
      }
      const data = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      return { ok: response.ok, status: response.status, data };
    } catch {
      throw fail(502, 'gmail/upstream');
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
    }
  }
  const oauth = (params, signal) => upstream(TOKEN_URL, {
    signal,
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, ...params }),
  });
  async function revoke(record, uid, clubId) {
    if (!record?.refreshToken) return;
    try {
      const token = cipher(config.encryptionKey).decrypt(record.refreshToken, connectionId(uid, clubId));
      await upstream('https://oauth2.googleapis.com/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token }),
      });
    } catch { /* Revocation is best effort; local invalidation always wins. */ }
  }
  function encryptedTokens(data, uid, clubId, refreshToken) {
    if (typeof data.access_token !== 'string' || !data.access_token ||
      typeof refreshToken !== 'string' || !refreshToken ||
      !Number.isFinite(data.expires_in) || data.expires_in <= 0 ||
      data.token_type?.toLowerCase() !== 'bearer') throw fail(502, 'gmail/upstream');
    const owner = connectionId(uid, clubId);
    const encryption = cipher(config.encryptionKey);
    return {
      accessToken: encryption.encrypt(data.access_token, owner),
      refreshToken: encryption.encrypt(refreshToken, owner),
      expiresAtMillis: now() + Math.min(data.expires_in, 86400) * 1000,
    };
  }
  async function access(uid, clubId, signal) {
    let record = await store.get(uid, clubId);
    signal?.throwIfAborted();
    if (!record.refreshToken || !record.accessToken) throw notConnected();
    const encryption = cipher(config.encryptionKey);
    const owner = connectionId(uid, clubId);
    if (record.expiresAtMillis <= now() + 60000) {
      const refreshToken = encryption.decrypt(record.refreshToken, owner);
      const result = await oauth({ grant_type: 'refresh_token', refresh_token: refreshToken }, signal);
      signal?.throwIfAborted();
      if (!result.ok) {
        if (result.data.error === 'invalid_grant') {
          await store.disconnect(uid, clubId, record.refreshToken);
          throw notConnected();
        }
        throw fail(502, 'gmail/upstream');
      }
      if (result.data.scope !== undefined && !validScopes(result.data.scope)) {
        await store.disconnect(uid, clubId, record.refreshToken);
        throw notConnected();
      }
      const tokens = encryptedTokens(result.data, uid, clubId, result.data.refresh_token || refreshToken);
      if (!await store.save(uid, clubId, record.generation, tokens, record.refreshToken)) {
        record = await store.get(uid, clubId);
        if (!record.refreshToken || record.expiresAtMillis <= now() + 60000) throw notConnected();
      } else record = { ...record, ...tokens };
    }
    return { token: encryption.decrypt(record.accessToken, owner), generation: record.generation,
      refreshToken: record.refreshToken };
  }
  async function search(uid, clubId, body, signal) {
    if (body.customGmailQuery !== undefined && body.customGmailQuery !== null &&
      (typeof body.customGmailQuery !== 'string' ||
        body.customGmailQuery.length > 2000 || /[\x00-\x1f]/.test(body.customGmailQuery) ||
        !balancedQuery(body.customGmailQuery))) {
      throw fail(400, 'gmail/invalid-input');
    }
    const customQuery = body.customGmailQuery?.trim();
    let after;
    if (!customQuery) {
      const date = body.searchAfterDate;
      const match = typeof date === 'string' && /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
      if (!match) throw fail(400, 'gmail/invalid-input');
      const [, year, month, day] = match.map(Number);
      const timestamp = Date.UTC(year, month - 1, day);
      const parsed = new Date(timestamp);
      if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 ||
        parsed.getUTCDate() !== day) throw fail(400, 'gmail/invalid-input');
      after = Math.floor(timestamp / 1000);
    }
    const senders = sendersFrom(await store.settings(clubId));
    signal.throwIfAborted();
    // The independent From check below is authoritative, including for custom OR queries.
    const senderClause = `(${senders.map((s) => `from:${s}`).join(' OR ')})`;
    const q = customQuery ? `(${senderClause}) AND (${customQuery})` :
      `${senderClause} subject:"automatically deposited" after:${after}`;
    const session = await access(uid, clubId, signal);
    async function gmail(path) {
      const result = await upstream(`${API_URL}${path}`, {
        signal,
        headers: { Authorization: ['Bearer', session.token].join(' ') },
      });
      if (result.status === 401 || result.status === 403) {
        await store.disconnect(uid, clubId, session.refreshToken);
        throw notConnected();
      }
      if (!result.ok) throw fail(502, 'gmail/upstream');
      return result.data;
    }
    const ids = new Set();
    let pageToken;
    for (let page = 0; page < 20; page++) {
      const query = new URLSearchParams({ q, maxResults: '100' });
      if (pageToken) query.set('pageToken', pageToken);
      const result = await gmail(`/messages?${query}`);
      for (const message of (result.messages || []).slice(0, 100)) {
        if (typeof message.id === 'string' && /^[a-zA-Z0-9_-]{1,200}$/.test(message.id)) ids.add(message.id);
      }
      pageToken = result.nextPageToken;
      if (!pageToken) break;
      if (typeof pageToken !== 'string' || pageToken.length > 4096) throw fail(502, 'gmail/upstream');
    }
    if (pageToken) throw fail(502, 'gmail/search-too-large');
    const messages = [];
    let cursor = 0;
    let size = 32;
    let stopped = false;
    const list = [...ids];
    await Promise.all(Array.from({ length: Math.min(5, list.length) }, async () => {
      try {
        while (!stopped && cursor < list.length) {
          const id = list[cursor++];
          const raw = await gmail(`/messages/${encodeURIComponent(id)}?format=full`);
          if (!senders.includes(fromMailbox(raw.payload))) continue;
          const message = { id: raw.id, threadId: raw.threadId, internalDate: raw.internalDate,
            payload: projectPayload(raw.payload) };
          size += Buffer.byteLength(JSON.stringify(message)) + 1;
          if (size > MAX_RESPONSE_BYTES) throw fail(502, 'gmail/response-too-large');
          messages.push(message);
        }
      } catch (error) {
        stopped = true;
        throw error;
      }
    }));
    const current = await store.get(uid, clubId);
    if (current.generation !== session.generation || !current.refreshToken) throw notConnected();
    if (!await store.isAdmin(uid, clubId)) throw fail(403, 'gmail/permission-denied');
    return { messages };
  }
  async function boundedSearch(uid, clubId, body) {
    const controller = new AbortController();
    let timer;
    const deadline = new Promise((resolve, reject) => {
      timer = setTimeout(() => {
        reject(fail(502, 'gmail/search-timeout'));
        controller.abort();
      }, searchTimeoutMs);
    });
    try {
      return await Promise.race([search(uid, clubId, body, controller.signal), deadline]);
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  }
  async function callback(req, res) {
    try {
      const { state, code, error } = req.query || {};
      if (typeof state !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(state)) throw fail(400, 'gmail/invalid-state');
      const pending = await store.consume(hash(state), now());
      if (!pending || error || typeof code !== 'string' || !code || code.length > 4096) {
        throw fail(400, 'gmail/invalid-state');
      }
      const ticket = crypto.randomBytes(32).toString('base64url');
      const ticketHash = hash(ticket);
      const authorization = cipher(config.encryptionKey).encrypt(
        JSON.stringify({ code, verifier: pending.verifier }),
        `${connectionId(pending.uid, pending.clubId)}:${ticketHash}`,
      );
      if (!await store.complete(ticketHash, {
        uid: pending.uid, clubId: pending.clubId, generation: pending.generation,
        authorization, expiresAtMillis: Math.min(pending.expiresAtMillis, now() + 5 * 60 * 1000),
      })) throw fail(400, 'gmail/invalid-state');
      const destination = new URL('/auth', config.redirectUri);
      destination.searchParams.set('gmailHandoff', ticket);
      destination.searchParams.set('gmailClub', pending.clubId);
      res.set('Referrer-Policy', 'no-referrer');
      res.set('Location', destination.toString());
      return res.status(303).send('');
    } catch { /* Never expose authorization codes, state, or upstream errors. */ }
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.set('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    res.set('Referrer-Policy', 'no-referrer');
    res.status(400).send('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Gmail connection</title><body><h1>Gmail connection not completed</h1><p>Return to your Home Screen app. You can try connecting again there.</p></body></html>');
  }
  return async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Vary', 'Origin');
    const path = req.path || '';
    const origin = req.get('Origin');
    if (origin && allowedOrigins.has(origin)) {
      res.set('Access-Control-Allow-Origin', origin);
      res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    }
    if (path === '/api/gmail/callback' && req.method === 'GET') return callback(req, res);
    if (req.method === 'OPTIONS') return res.status(origin && allowedOrigins.has(origin) ? 204 : 403).send('');
    try {
      if (!['/api/gmail/status', '/api/gmail/connect', '/api/gmail/search', '/api/gmail/disconnect',
        '/api/gmail/confirm'].includes(path)) {
        throw fail(404, 'gmail/not-found');
      }
      if (req.method !== 'POST') throw fail(405, 'gmail/method-not-allowed');
      if (!origin || !allowedOrigins.has(origin)) throw fail(403, 'gmail/origin-denied');
      if (!req.is('application/json')) throw fail(400, 'gmail/invalid-input');
      const body = req.body;
      if (!body || typeof body !== 'object' || Array.isArray(body) ||
        typeof body.clubId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(body.clubId)) {
        throw fail(400, 'gmail/invalid-input');
      }
      const authorization = req.get('Authorization') || '';
      const match = authorization.match(new RegExp('^' + 'Bearer' + ' ([^\\s]+)$'));
      if (!match) throw fail(401, 'gmail/unauthenticated');
      let user;
      try { user = await auth.verifyIdToken(match[1], true); }
      catch { throw fail(401, 'gmail/unauthenticated'); }
      const uid = user.uid;
      const clubId = body.clubId;
      if (!await store.isAdmin(uid, clubId)) throw fail(403, 'gmail/permission-denied');
      let result;
      if (path.endsWith('/status')) {
        result = { connected: Boolean((await store.get(uid, clubId)).refreshToken) };
      } else if (path.endsWith('/connect')) {
        const redirect = new URL(config.redirectUri);
        if (redirect.protocol !== 'https:' || redirect.search || redirect.hash ||
          redirect.pathname !== '/api/gmail/callback') throw fail(500, 'gmail/configuration');
        const state = crypto.randomBytes(32).toString('base64url');
        const verifier = crypto.randomBytes(32).toString('base64url');
        await store.begin(hash(state), { uid, clubId, verifier, expiresAtMillis: now() + STATE_TTL });
        const params = new URLSearchParams({
          client_id: config.clientId, redirect_uri: config.redirectUri, response_type: 'code',
          scope: READ_SCOPE, access_type: 'offline', prompt: 'consent', state,
          code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url'),
          code_challenge_method: 'S256',
        });
        result = { authorizationUrl: `https://accounts.google.com/o/oauth2/v2/auth?${params}` };
      } else if (path.endsWith('/confirm')) {
        if (typeof body.ticket !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(body.ticket)) {
          throw fail(400, 'gmail/invalid-handoff');
        }
        const ticketHash = hash(body.ticket);
        const pending = await store.consume(ticketHash, now(), 'completion', { uid, clubId });
        if (pending?.denied) throw fail(403, 'gmail/permission-denied');
        if (!pending) throw fail(400, 'gmail/invalid-handoff');
        const authorization = JSON.parse(cipher(config.encryptionKey).decrypt(pending.authorization,
          `${connectionId(uid, clubId)}:${ticketHash}`));
        const exchange = await oauth({
          grant_type: 'authorization_code', code: authorization.code, redirect_uri: config.redirectUri,
          code_verifier: authorization.verifier,
        });
        if (!exchange.ok || !validScopes(exchange.data.scope)) throw fail(502, 'gmail/upstream');
        const tokens = encryptedTokens(exchange.data, uid, clubId, exchange.data.refresh_token);
        if (!await store.save(uid, clubId, pending.generation, tokens)) throw notConnected();
        result = { connected: true };
      } else if (path.endsWith('/disconnect')) {
        const old = await store.disconnect(uid, clubId);
        await revoke(old, uid, clubId);
        result = { connected: false };
      } else result = await boundedSearch(uid, clubId, body);
      return res.status(200).json(result);
    } catch (error) {
      const status = error.status || 500;
      return res.status(status).json({
        error: { code: error.code?.startsWith('gmail/') ? error.code : 'gmail/internal',
          message: status === 409 ? 'Connect Gmail again to continue.' : 'Unable to complete Gmail request.' },
      });
    }
  };
}

module.exports = { createHandler, createFirestoreStore, cipher, connectionId, validScopes, fromMailbox };
