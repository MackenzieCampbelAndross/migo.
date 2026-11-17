import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hashDeviceCredential, hashPin, issueGrant, readGrant, verifyPin } from '../lib/security/device-pin.js';

const userId = '00000000-0000-4000-8000-000000000001';
const otherUser = '00000000-0000-4000-8000-000000000002';

beforeEach(() => {
  vi.useRealTimers();
  process.env.WALLET_ENCRYPTION_KEY = Buffer.alloc(32, 11).toString('base64');
});

describe('device PIN storage', () => {
  it('uses independently salted hashes and verifies without plaintext storage', async () => {
    const first = await hashPin('1837');
    const second = await hashPin('1837');
    expect(first).not.toBe(second);
    expect(await verifyPin('1837', first)).toBe(true);
    expect(await verifyPin('1838', first)).toBe(false);
    expect(first).toMatch(/^s1\.[a-f0-9]{32}\.[a-f0-9]{64}$/);
  });

  it('rejects malformed PINs and hashes', async () => {
    await expect(hashPin('123')).rejects.toThrow();
    await expect(hashPin('abcd')).rejects.toThrow();
    expect(await verifyPin('1837', 'plaintext')).toBe(false);
    expect(await verifyPin('18370', await hashPin('1837'))).toBe(false);
  });

  it('requires a server pepper in addition to the database hash', async () => {
    const hashed = await hashPin('1837');
    process.env.WALLET_ENCRYPTION_KEY = Buffer.alloc(32, 12).toString('base64');
    expect(await verifyPin('1837', hashed)).toBe(false);
    delete process.env.WALLET_ENCRYPTION_KEY;
    await expect(hashPin('1837')).rejects.toThrow();
  });

  it('stores a digest instead of the device credential', () => {
    const credential = 'a'.repeat(64);
    expect(hashDeviceCredential(credential)).toHaveLength(64);
    expect(hashDeviceCredential(credential)).not.toBe(credential);
  });
});

describe('bound short-lived grants', () => {
  it('binds each encrypted grant to its owner and purpose', () => {
    const payload = { sessionId: 'session-a', deviceHash: 'device-a', generation: 'generation-a' };
    const grant = issueGrant('unlock', userId, payload, 900);
    expect(readGrant('unlock', userId, grant)).toMatchObject(payload);
    expect(readGrant('unlock', otherUser, grant)).toBeNull();
    expect(readGrant('enroll', userId, grant)).toBeNull();
    expect(grant).not.toContain('session-a');
  });

  it('rejects expired, altered and malformed tokens', () => {
    const grant = issueGrant('unlock', userId, { sessionId: 'session-a' }, 1);
    const parts = grant.split('.');
    const bytes = Buffer.from(parts[3], 'base64url');
    bytes[0] ^= 1;
    parts[3] = bytes.toString('base64url');
    expect(readGrant('unlock', userId, parts.join('.'))).toBeNull();
    expect(readGrant('unlock', userId, undefined)).toBeNull();
    expect(readGrant('unlock', userId, 'bad')).toBeNull();
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 2000);
    expect(readGrant('unlock', userId, grant)).toBeNull();
    vi.useRealTimers();
  });
});
