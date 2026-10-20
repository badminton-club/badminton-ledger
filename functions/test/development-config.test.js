const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildAllowedOrigins } = require('../../.github/scripts/configure-gmail-development.cjs');

const base = 'https://badminton-ledger.web.app';
const first = 'https://badminton-ledger--pr36-example-a.web.app';
const second = 'https://badminton-ledger--pr37-example-b.web.app';
const other = 'https://other-project--pr38-example.web.app';
const now = Date.parse('2026-10-20T00:00:00Z');
const channel = (url, expireTime = '2026-10-27T00:00:00Z') => ({ url, expireTime });
const deployed = (allowed) => [{
  id: 'gmailApi', region: 'us-central1', environmentVariables: { GMAIL_ALLOWED_ORIGINS: allowed },
}];
const configure = (overrides = {}) => buildAllowedOrigins({
  baseOrigins: base, functions: [], channels: [], now, ...overrides,
});

test('first deployment registers the exact published preview and keeps the base origin', () => {
  assert.equal(configure({ previewOrigin: first, channels: [channel(first)] }), `${base},${first}`);
});

test('a later preview preserves previously registered active previews without trusting other channels', () => {
  assert.equal(configure({
    functions: deployed(`${base},${first}`),
    previewOrigin: second,
    channels: [channel(first), channel(second), channel(other)],
  }), `${base},${first},${second}`);
  assert.equal(configure({ channels: [channel(first)] }), base);
});

test('manual deployment retains registered active previews and removes expired or deleted ones', () => {
  assert.equal(configure({
    functions: deployed(`${base},${first},${second}`),
    channels: [channel(first)],
  }), `${base},${first}`);
  assert.equal(configure({
    functions: deployed(`${base},${first}`),
    channels: [channel(first, '2026-10-19T00:00:00Z')],
  }), base);
});

test('base custom domains are retained and duplicate preview origins are removed', () => {
  assert.equal(configure({
    baseOrigins: `${base},https://trusted.example`,
    previewOrigin: first,
    functions: deployed(`${base},${first}`),
    channels: [channel(base, undefined), channel(first)],
  }), `${base},https://trusted.example,${first}`);
});

test('an unpublished, expired, or foreign-project preview is rejected', () => {
  for (const options of [
    { previewOrigin: first },
    { previewOrigin: first, channels: [channel(first, '2026-10-19T00:00:00Z')] },
    { previewOrigin: other, channels: [channel(other)] },
    { previewOrigin: `${first}.evil.example`, channels: [channel(`${first}.evil.example`)] },
  ]) assert.throws(() => configure(options), /not an active/);
});

test('invalid base origins cannot inject dotenv values or enable wildcards', () => {
  for (const value of ['', undefined, 'http://example.com', `${base}/`, `${base}?x=1`,
    'https://*.web.app', `${base}\nINJECTED=value`, 'https://user:password@example.com']) {
    assert.throws(() => configure({ baseOrigins: value }));
  }
});

test('malformed listings, missing deployed configuration, and invalid expiry fail explicitly', () => {
  for (const options of [
    { functions: {} },
    { channels: {} },
    { functions: [{ id: 'gmailApi', region: 'us-central1' }] },
    { channels: [channel(first, 'invalid')] },
  ]) assert.throws(() => configure(options));
});
