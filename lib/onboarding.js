import 'server-only';
import { cookies, headers } from 'next/headers';
import { randomBytes, randomUUID } from 'node:crypto';
import { ApiError } from './api.js';
import { createAdminClient } from './supabase/admin.js';
import { createSupabaseServerClient } from './supabase/server.js';
import { hashDeviceCredential, hashPin, issueGrant, readGrant } from './security/device-pin.js';
import { enforceRateLimit } from './rate-limit.js';

export const DEVICE_COOKIE = 'migo_device';
export const ENROLLMENT_COOKIE = 'migo_enrollment';
export const DEVICE_LIFETIME = 30 * 24 * 60 * 60;
export const UNLOCK_LIFETIME = 15 * 60;
const cookieOptions = { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/' };

export async function sessionBinding(userId) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || data?.claims?.sub !== userId || !data.claims.session_id) throw new ApiError(401, 'Please verify your email again');
  return data.claims.session_id;
}

export async function createEnrollmentGrant(userId, sessionId) {
  const store = await cookies();
  store.set(ENROLLMENT_COOKIE, issueGrant('enroll', userId, { sessionId, nonce: randomUUID() }, 30 * 60), { ...cookieOptions, maxAge: 30 * 60 });
}

export async function hasEnrollmentGrant(userId) {
  const store = await cookies();
  const grant = readGrant('enroll', userId, store.get(ENROLLMENT_COOKIE)?.value);
  return Boolean(grant && grant.sessionId === await sessionBinding(userId));
}

export async function requireEnrollment(userId) {
  if (!await hasEnrollmentGrant(userId)) throw new ApiError(403, 'Verify your email again to continue setup');
}

async function consumeEnrollment(userId) {
  await requireEnrollment(userId);
  const grant = readGrant('enroll', userId, (await cookies()).get(ENROLLMENT_COOKIE)?.value);
  if (!grant?.nonce) throw new ApiError(403, 'Verify your email again to continue setup');
  try {
    // The atomic one-use window outlives the enrollment proof, including concurrent requests.
    await enforceRateLimit({ key: `enrollment:${grant.nonce}`, limit: 1, windowSeconds: 3600, failClosed: true });
  } catch (error) {
    if (error.status === 429) throw new ApiError(403, 'This verification was already used. Verify your email again.');
    throw error;
  }
}

export async function getOnboardingDetails(userId) {
  const { data, error } = await createAdminClient().from('onboarding_details').select('phone, phone_verified').eq('user_id', userId).maybeSingle();
  if (error) throw new ApiError(503, 'Account setup is temporarily unavailable');
  return data;
}

export async function requireOnboardingPhone(userId) {
  await requireEnrollment(userId);
  if (!await getOnboardingDetails(userId)) throw new ApiError(403, 'Add your mobile number before creating a wallet');
}

export async function getDevice(userId) {
  const credential = (await cookies()).get(DEVICE_COOKIE)?.value;
  if (!credential || !/^[a-f0-9]{64}$/.test(credential)) return null;
  const { data, error } = await createAdminClient().from('device_pins')
    .select('device_hash, user_id, pin_hash, generation, expires_at')
    .eq('device_hash', hashDeviceCredential(credential)).eq('user_id', userId).maybeSingle();
  if (error) throw new ApiError(503, 'Device verification is temporarily unavailable');
  if (!data || Date.parse(data.expires_at) <= Date.now()) return null;
  return data;
}

export async function isDeviceUnlocked(userId, device) {
  const token = (await headers()).get('x-migo-unlock');
  const grant = readGrant('unlock', userId, token);
  if (!grant || !device || grant.deviceHash !== device.device_hash || grant.generation !== device.generation) return false;
  return grant.sessionId === await sessionBinding(userId);
}

export async function requireDeviceUnlock(userId) {
  if (!await isDeviceUnlocked(userId, await getDevice(userId))) throw new ApiError(423, 'Unlock Migo with your PIN');
}

export async function makeUnlockGrant(userId, device) {
  return issueGrant('unlock', userId, {
    sessionId: await sessionBinding(userId), deviceHash: device.device_hash, generation: device.generation,
  }, UNLOCK_LIFETIME);
}

export async function enrollDevice(userId, pin) {
  await consumeEnrollment(userId);
  const store = await cookies();
  const previous = store.get(DEVICE_COOKIE)?.value;
  const credential = previous && /^[a-f0-9]{64}$/.test(previous) ? previous : randomBytes(32).toString('hex');
  const device = { device_hash: hashDeviceCredential(credential), user_id: userId,
    pin_hash: await hashPin(pin), generation: randomUUID(), expires_at: new Date(Date.now() + DEVICE_LIFETIME * 1000).toISOString() };
  const { error } = await createAdminClient().from('device_pins').upsert(device, { onConflict: 'device_hash' });
  if (error) throw new ApiError(503, 'Unable to save your device PIN');
  const unlockToken = await makeUnlockGrant(userId, device);
  store.set(DEVICE_COOKIE, credential, { ...cookieOptions, maxAge: DEVICE_LIFETIME });
  store.set(ENROLLMENT_COOKIE, '', { ...cookieOptions, maxAge: 0 });
  return unlockToken;
}

export async function clearEnrollment() {
  (await cookies()).set(ENROLLMENT_COOKIE, '', { ...cookieOptions, maxAge: 0 });
}
