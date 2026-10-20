const { execFileSync } = require('node:child_process');
const { writeFileSync } = require('node:fs');

function origin(value) {
  if (typeof value !== 'string' || !value || /[\r\n*]/.test(value)) {
    throw new Error('Expected an exact HTTPS origin, without wildcards');
  }
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.origin !== value) {
    throw new Error(`Invalid HTTPS origin: ${value}`);
  }
  return value;
}

function origins(value) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('GMAIL_ALLOWED_ORIGINS must contain trusted base origins');
  }
  return value.split(',').map((value) => origin(value.trim()));
}

function buildAllowedOrigins({ baseOrigins, previewOrigin, functions, channels, now = Date.now() }) {
  if (!Array.isArray(functions) || !Array.isArray(channels)) {
    throw new Error('Invalid Firebase function or channel listing');
  }
  const allowed = new Set(origins(baseOrigins));
  const active = new Set();
  for (const channel of channels) {
    const value = origin(channel.url);
    if (!/^https:\/\/badminton-ledger--[a-z0-9-]+\.web\.app$/.test(value)) continue;
    const expiresAt = Date.parse(channel.expireTime);
    if (!Number.isFinite(expiresAt)) throw new Error(`Missing channel expiry for ${value}`);
    if (expiresAt > now) active.add(value);
  }
  const deployed = functions.find((fn) => fn.id === 'gmailApi' && fn.region === 'us-central1');
  if (deployed) {
    for (const value of origins(deployed.environmentVariables?.GMAIL_ALLOWED_ORIGINS)) {
      if (active.has(value)) allowed.add(value);
    }
  }
  if (previewOrigin) {
    const value = origin(previewOrigin);
    if (!active.has(value)) throw new Error('Preview origin is not an active development Hosting channel');
    allowed.add(value);
  }
  return [...allowed].join(',');
}

function firebase(command) {
  const output = execFileSync('npx', [
    '--yes', 'firebase-tools@15.28.1', ...command,
    '--project', 'badminton-ledger', '--non-interactive', '--json',
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
  const response = JSON.parse(output);
  if (response.status !== 'success') throw new Error('Firebase listing did not succeed');
  return response.result;
}

function main() {
  const redirect = process.env.GMAIL_OAUTH_REDIRECT_URI;
  if (redirect !== 'https://badminton-ledger.web.app/api/gmail/callback') {
    throw new Error('GMAIL_OAUTH_REDIRECT_URI must use the stable development callback');
  }
  origins(process.env.GMAIL_ALLOWED_ORIGINS);
  const functions = firebase(['functions:list']);
  const { channels } = firebase(['hosting:channel:list', '--site', 'badminton-ledger']);
  const allowed = buildAllowedOrigins({
    baseOrigins: process.env.GMAIL_ALLOWED_ORIGINS,
    previewOrigin: process.env.PREVIEW_ORIGIN,
    functions,
    channels,
  });
  writeFileSync('functions/.env.badminton-ledger',
    `GMAIL_OAUTH_REDIRECT_URI=${redirect}\nGMAIL_ALLOWED_ORIGINS=${allowed}\n`);
  console.log(`Configured development Gmail origins: ${allowed}`);
}

module.exports = { buildAllowedOrigins };
if (require.main === module) main();
