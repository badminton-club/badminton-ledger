// jest-dom adds custom jest matchers for asserting on DOM nodes.
// allows you to do things like:
// expect(element).toHaveTextContent(/react/i)
// learn more: https://github.com/testing-library/jest-dom
import '@testing-library/jest-dom';

// jsdom (Jest's default test environment) doesn't expose TextEncoder/TextDecoder,
// which react-router v7 requires at import time. Polyfill from Node's own 'util'
// module, which has provided them since Node 11.
import { TextEncoder, TextDecoder } from 'util';

if (typeof global.TextEncoder === 'undefined') {
  global.TextEncoder = TextEncoder;
}
if (typeof global.TextDecoder === 'undefined') {
  global.TextDecoder = TextDecoder;
}

// jsdom (Jest's default test environment) also doesn't expose the Web Crypto
// API's `crypto.subtle`, which backupCrypto.ts uses to encrypt/decrypt Google
// Drive and local-file backups. Polyfill from Node's own 'crypto' module —
// its `webcrypto` export implements the same standard SubtleCrypto interface
// real browsers provide, so tests exercise the exact same code path as
// production instead of a separate mock.
import { webcrypto } from 'crypto';

if (typeof global.crypto === 'undefined' || typeof global.crypto.subtle === 'undefined') {
  global.crypto = webcrypto;
}
