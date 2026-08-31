import {
  encryptBackupPayload,
  decryptBackupPayload,
  isEncryptedBackupPayload,
  type EncryptedBackupPayload,
} from '../backupCrypto';

describe('backupCrypto', () => {
  it('round-trips arbitrary JSON text through encrypt/decrypt with the correct passphrase', async () => {
    const original = JSON.stringify({ players: [{ id: 'p1', balance: 12.5 }], note: 'ünïcode ✓' });

    const envelope = await encryptBackupPayload(original, 'correct horse battery staple');

    expect(envelope.__encrypted).toBe(true);
    expect(envelope.version).toBe(1);
    expect(envelope.kdf).toBe('PBKDF2-SHA256');
    expect(envelope.ciphertext).not.toContain(original);

    const decrypted = await decryptBackupPayload(envelope, 'correct horse battery staple');
    expect(decrypted).toBe(original);
  });

  it('produces a different salt/iv/ciphertext each time, even for the same input and passphrase', async () => {
    const json = JSON.stringify({ a: 1 });
    const first = await encryptBackupPayload(json, 'pw');
    const second = await encryptBackupPayload(json, 'pw');

    expect(first.salt).not.toBe(second.salt);
    expect(first.iv).not.toBe(second.iv);
    expect(first.ciphertext).not.toBe(second.ciphertext);

    // Both still decrypt back to the same original text.
    await expect(decryptBackupPayload(first, 'pw')).resolves.toBe(json);
    await expect(decryptBackupPayload(second, 'pw')).resolves.toBe(json);
  });

  it('rejects an incorrect passphrase with a friendly error, never returning garbage plaintext', async () => {
    const envelope = await encryptBackupPayload(JSON.stringify({ a: 1 }), 'right-passphrase');

    await expect(decryptBackupPayload(envelope, 'wrong-passphrase'))
      .rejects.toThrow('Incorrect passphrase, or the backup file is corrupted.');
  });

  it('rejects tampered ciphertext instead of silently decrypting corrupted data', async () => {
    const envelope = await encryptBackupPayload(JSON.stringify({ a: 1 }), 'pw');
    const tampered: EncryptedBackupPayload = {
      ...envelope,
      ciphertext: envelope.ciphertext.slice(0, -4) + (envelope.ciphertext.slice(-4) === 'AAAA' ? 'BBBB' : 'AAAA'),
    };

    await expect(decryptBackupPayload(tampered, 'pw'))
      .rejects.toThrow('Incorrect passphrase, or the backup file is corrupted.');
  });

  it('handles a large backup payload without hitting a call-stack limit', async () => {
    const large = JSON.stringify({ players: Array.from({ length: 20_000 }, (_, i) => ({ id: `p${i}`, balance: i })) });

    const envelope = await encryptBackupPayload(large, 'pw');
    const decrypted = await decryptBackupPayload(envelope, 'pw');

    expect(decrypted).toBe(large);
  });

  describe('isEncryptedBackupPayload', () => {
    it('recognizes a real encrypted envelope', async () => {
      const envelope = await encryptBackupPayload(JSON.stringify({ a: 1 }), 'pw');
      expect(isEncryptedBackupPayload(envelope)).toBe(true);
    });

    it('rejects a plain (unencrypted) backup object', () => {
      expect(isEncryptedBackupPayload({ version: 1, exportedAt: '2026-01-01', collections: {} })).toBe(false);
    });

    it('rejects null, primitives, and near-miss shapes', () => {
      expect(isEncryptedBackupPayload(null)).toBe(false);
      expect(isEncryptedBackupPayload(undefined)).toBe(false);
      expect(isEncryptedBackupPayload('a string')).toBe(false);
      expect(isEncryptedBackupPayload({ __encrypted: true })).toBe(false); // missing salt/iv/ciphertext/iterations
    });
  });
});
