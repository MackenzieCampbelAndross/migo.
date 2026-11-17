import 'server-only';
import { ApiError } from './api.js';
import { safeLog } from './logger.js';
import { createSupabaseServerClient } from './supabase/server.js';
import { createAdminClient } from './supabase/admin.js';

export async function getAuthUser() {
  let supabase;
  try {
    supabase = await createSupabaseServerClient();
  } catch {
    safeLog('error', 'auth.not_configured', {});
    throw new ApiError(503, 'Authentication is temporarily unavailable');
  }

  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user) return null;
  return data.user;
}

export async function requireUser() {
  const user = await getAuthUser();
  if (!user) throw new ApiError(401, 'Authentication required');
  return user;
}

export async function getProfile(userId) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('profiles')
    .select('id, username, display_name, base_currency')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    safeLog('error', 'profile.read_failed', { userId, code: error.code });
    throw new ApiError(500, 'Unable to load profile');
  }

  return data;
}

export async function requireProfile(userId) {
  const profile = await getProfile(userId);
  if (!profile) throw new ApiError(403, 'Profile not found');
  return profile;
}

export async function requireWallet(userId) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('wallets')
    .select('id, user_id, address')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    safeLog('error', 'wallet.read_failed', { userId, code: error.code });
    throw new ApiError(500, 'Unable to load wallet');
  }

  if (!data) throw new ApiError(403, 'Wallet not found');
  return data;
}

export async function requireSigningWallet(userId) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('wallets')
    .select('id, user_id, address, encrypted_seed')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    safeLog('error', 'wallet.read_failed', { userId, code: error.code });
    throw new ApiError(500, 'Unable to load wallet');
  }

  if (!data) throw new ApiError(403, 'Wallet not found');
  return data;
}

export async function requireAuthContext({ withProfile = true, withWallet = true } = {}) {
  const user = await requireUser();

  const [profile, wallet] = await Promise.all([
    withProfile ? requireProfile(user.id) : Promise.resolve(null),
    withWallet ? requireWallet(user.id) : Promise.resolve(null),
  ]);

  return { user, profile, wallet };
}

export async function getWalletByUserId(userId) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('wallets')
    .select('user_id, address')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    safeLog('error', 'wallet.read_failed', { userId, code: error.code });
    return null;
  }

  return data;
}
