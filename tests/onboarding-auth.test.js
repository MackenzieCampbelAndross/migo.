import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  cookie: vi.fn(), header: vi.fn(), claims: vi.fn(), user: vi.fn(), device: vi.fn(), setCookie: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: mocks.cookie, set: mocks.setCookie }), headers: async () => ({ get: mocks.header }) }));
vi.mock('../lib/supabase/server.js', () => ({ createSupabaseServerClient: async () => ({ auth: { getClaims: mocks.claims, getUser: mocks.user } }) }));
vi.mock('../lib/supabase/admin.js', () => ({ createAdminClient: () => ({ from: () => {
  const query = { select: () => query, eq: () => query, maybeSingle: mocks.device };
  return query;
} }) }));

import { requireUser } from '../lib/auth.js';
import { ENROLLMENT_COOKIE, DEVICE_COOKIE, requireEnrollment, requireDeviceUnlock } from '../lib/onboarding.js';
import { hashDeviceCredential, issueGrant } from '../lib/security/device-pin.js';

const userId = '00000000-0000-4000-8000-000000000001';
const credential = 'b'.repeat(64);
const deviceHash = hashDeviceCredential(credential);
const generation = 'generation-a';

beforeEach(() => {
  vi.clearAllMocks();
  process.env.WALLET_ENCRYPTION_KEY = Buffer.alloc(32, 11).toString('base64');
  mocks.user.mockResolvedValue({ data: { user: { id: userId } } });
  mocks.claims.mockResolvedValue({ data: { claims: { sub: userId, session_id: 'session-a' } } });
  mocks.cookie.mockImplementation(name => name === DEVICE_COOKIE ? { value: credential } : undefined);
  mocks.header.mockReturnValue(null);
  mocks.device.mockResolvedValue({ data: { user_id: userId, device_hash: deviceHash, generation, expires_at: new Date(Date.now() + 60000).toISOString() } });
});

function grant(overrides = {}) {
  return issueGrant('unlock', userId, { sessionId: 'session-a', deviceHash, generation, ...overrides }, 900);
}

describe('server-side unlock enforcement', () => {
  it('does not accept a Supabase session alone on protected APIs', async () => {
    await expect(requireUser()).rejects.toMatchObject({ status: 423 });
    await expect(requireUser({ allowLocked: true })).resolves.toMatchObject({ id: userId });
  });

  it('always requires an authenticated identity, even during onboarding', async () => {
    mocks.user.mockResolvedValue({ data: { user: null } });
    await expect(requireUser({ allowLocked: true })).rejects.toMatchObject({ status: 401 });
  });

  it('accepts only a grant bound to the current user, device, generation and session', async () => {
    mocks.header.mockReturnValue(grant());
    await expect(requireDeviceUnlock(userId)).resolves.toBeUndefined();
    for (const change of [{ deviceHash: 'another-device' }, { generation: 'revoked-generation' }, { sessionId: 'another-session' }]) {
      mocks.header.mockReturnValue(grant(change));
      await expect(requireDeviceUnlock(userId)).rejects.toMatchObject({ status: 423 });
    }
  });

  it('rejects grants without their HttpOnly device credential', async () => {
    mocks.header.mockReturnValue(grant());
    mocks.cookie.mockReturnValue(undefined);
    await expect(requireDeviceUnlock(userId)).rejects.toMatchObject({ status: 423 });
  });

  it('fails closed when device storage is unavailable', async () => {
    mocks.device.mockResolvedValue({ data: null, error: { code: 'connection-failed' } });
    await expect(requireDeviceUnlock(userId)).rejects.toMatchObject({ status: 503 });
  });

  it('rejects an expired device registration', async () => {
    mocks.header.mockReturnValue(grant());
    mocks.device.mockResolvedValue({ data: { device_hash: deviceHash, generation, expires_at: new Date(0).toISOString() } });
    await expect(requireDeviceUnlock(userId)).rejects.toMatchObject({ status: 423 });
  });
});

describe('PIN enrollment authorization', () => {
  it('does not treat an existing email session as fresh verification', async () => {
    await expect(requireEnrollment(userId)).rejects.toMatchObject({ status: 403 });
  });

  it('requires a server-created enrollment proof bound to the current session', async () => {
    const fresh = issueGrant('enroll', userId, { sessionId: 'session-a' }, 1800);
    mocks.cookie.mockImplementation(name => name === ENROLLMENT_COOKIE ? { value: fresh } : undefined);
    await expect(requireEnrollment(userId)).resolves.toBeUndefined();
    mocks.claims.mockResolvedValue({ data: { claims: { sub: userId, session_id: 'session-b' } } });
    await expect(requireEnrollment(userId)).rejects.toMatchObject({ status: 403 });
  });
});
