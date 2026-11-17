import { beforeEach, describe, expect, it } from 'vitest';
import { decryptSeed, encryptSeed } from '../lib/security/seed-vault.js';

const USER_ID = '00000000-0000-4000-8000-000000000001';
const OTHER_USER = '00000000-0000-4000-8000-000000000002';
const SEED = 'TESTNET-ONLY-SEED-PLACEHOLDER-1234567890';

describe('seed vault', () => {
  beforeEach(() => {
    process.env.WALLET_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
  });

  it('round-trips a seed for the same user', () => {
    const encrypted = encryptSeed(SEED, USER_ID);
    expect(encrypted).not.toContain(SEED);
    expect(decryptSeed(encrypted, USER_ID)).toBe(SEED);
  });

  it('binds ciphertext to the owning user', () => {
    const encrypted = encryptSeed(SEED, USER_ID);
    expect(() => decryptSeed(encrypted, OTHER_USER)).toThrow();
  });

  it('detects tampering', () => {
    const encrypted = encryptSeed(SEED, USER_ID);
    const parts = encrypted.split('.');
    const ciphertext = Buffer.from(parts[3], 'base64url');
    ciphertext[0] ^= 1;
    parts[3] = ciphertext.toString('base64url');

    expect(() => decryptSeed(parts.join('.'), USER_ID)).toThrow();
  });

  it('fails closed when the encryption key is missing', () => {
    delete process.env.WALLET_ENCRYPTION_KEY;
    expect(() => encryptSeed(SEED, USER_ID)).toThrow();
  });
});
