import { ApiError, readJson, withApi } from '@/lib/api';
import { requireUser, requireWallet } from '@/lib/auth';
import { safeLog } from '@/lib/logger';
import { enforceUserAndIpRateLimit } from '@/lib/rate-limit';
import { encryptSeed } from '@/lib/security/seed-vault';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  createWallet as createTestnetWallet,
  getBalances,
  importWallet,
  mintTokens,
  STARTING_BALANCES,
} from '@/lib/xrpl-wallet';
import { createWalletSchema, importWalletSchema } from '@/lib/validation';
import { requireOnboardingPhone } from '@/lib/onboarding';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

async function reserveWalletCreation(userId) {
  const admin = createAdminClient();
  const key = `wallet:creation-lock:${userId}`;
  const startedAt = new Date().toISOString();
  const { error: cleanupError } = await admin.from('rate_limits').delete().eq('rate_key', key)
    .lt('window_start', new Date(Date.now() - 10 * 60 * 1000).toISOString());
  if (cleanupError) throw new ApiError(503, 'Wallet creation is temporarily unavailable');
  const { error } = await admin.from('rate_limits').insert({ rate_key: key, window_start: startedAt, count: 1 });
  if (error?.code === '23505') throw new ApiError(409, 'Your wallet is already being created. Please wait.');
  if (error) throw new ApiError(503, 'Wallet creation is temporarily unavailable');
  return async () => {
    const { error: releaseError } = await admin.from('rate_limits').delete().eq('rate_key', key).eq('window_start', startedAt);
    if (releaseError) safeLog('error', 'wallet.creation_lock_release_failed', { userId });
  };
}

async function getWalletRow(userId) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('wallets')
    .select('id, address')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    safeLog('error', 'wallet.lookup_failed', { userId, code: error.code });
    throw new ApiError(500, 'Unable to load wallet');
  }

  return data;
}

async function getProfileRow(userId) {
  const admin = createAdminClient();
  const { data } = await admin
    .from('profiles')
    .select('id, username, display_name, base_currency')
    .eq('id', userId)
    .maybeSingle();
  return data;
}

async function ensureProfile(userId, body) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('profiles')
    .upsert({
      id: userId,
      username: body.username,
      display_name: body.displayName,
      base_currency: body.baseCurrency,
    })
    .select('id, username, display_name, base_currency')
    .single();

  if (error) {
    if (error.code === '23505') {
      throw new ApiError(409, 'That username is unavailable');
    }
    safeLog('error', 'profile.create_failed', { userId, code: error.code });
    throw new ApiError(500, 'Unable to create profile');
  }

  return data;
}

async function insertWallet(userId, address, encryptedSeed) {
  const admin = createAdminClient();
  const { error } = await admin.from('wallets').insert({
    user_id: userId,
    address,
    encrypted_seed: encryptedSeed,
  });

  if (error) {
    if (error.code === '23505') {
      throw new ApiError(409, 'This account already has a wallet');
    }
    safeLog('error', 'wallet.insert_failed', { userId, code: error.code });
    throw new ApiError(500, 'Unable to save wallet');
  }
}

export async function POST(req) {
  return withApi(req, async () => {
    const user = await requireUser({ allowLocked: true });
    await requireOnboardingPhone(user.id);
    await enforceUserAndIpRateLimit(req, user.id, 'wallet:create', {
      userLimit: 3,
      ipLimit: 10,
      windowSeconds: 60 * 60,
      failClosed: true,
    });

    const release = await reserveWalletCreation(user.id);
    try {
    if (await getWalletRow(user.id)) {
      throw new ApiError(409, 'This account already has a wallet');
    }

    const body = await readJson(req, createWalletSchema.refine(value => value.displayName.length > 0), 8 * 1024);
    const profile = await ensureProfile(user.id, body);

    let created;
    try {
      created = await createTestnetWallet(profile.base_currency);
    } catch (error) {
      safeLog('error', 'wallet.testnet_create_failed', {
        userId: user.id,
        code: error?.code || error?.name,
      });
      throw new ApiError(502, 'Unable to create a testnet wallet right now');
    }

    let encryptedSeed;
    try {
      encryptedSeed = encryptSeed(created.seed, user.id);
    } catch {
      safeLog('error', 'wallet.encryption_failed', { userId: user.id });
      throw new ApiError(503, 'Wallet signing is not configured');
    }

    await insertWallet(user.id, created.address, encryptedSeed);

    const startingAmount = STARTING_BALANCES[profile.base_currency];
    let funded = false;
    if (startingAmount) {
      try {
        await mintTokens(created.address, profile.base_currency, startingAmount);
        funded = true;
      } catch (error) {
        safeLog('error', 'wallet.starting_balance_failed', {
          userId: user.id,
          currency: profile.base_currency,
          code: error?.code || error?.name,
        });
      }
    }

    return {
      success: true,
      address: created.address,
      username: profile.username,
      baseCurrency: profile.base_currency,
      startingBalance: funded ? startingAmount : null,
    };
    } finally {
      await release();
    }
  });
}

export async function PUT(req) {
  return withApi(req, async () => {
    const user = await requireUser();
    await enforceUserAndIpRateLimit(req, user.id, 'wallet:import', {
      userLimit: 3,
      ipLimit: 10,
      windowSeconds: 60 * 60,
      failClosed: true,
    });

    if (await getWalletRow(user.id)) {
      throw new ApiError(409, 'This account already has a wallet');
    }

    const body = await readJson(req, importWalletSchema, 8 * 1024);
    const existingProfile = await getProfileRow(user.id);

    if (!existingProfile && !body.username) {
      throw new ApiError(400, 'A username is required for a new account');
    }

    const profile = existingProfile
      ? existingProfile
      : await ensureProfile(user.id, {
          username: body.username,
          displayName: body.displayName,
          baseCurrency: body.baseCurrency,
        });

    let imported;
    try {
      imported = await importWallet(body.seed, profile.base_currency);
    } catch (error) {
      if (error?.message === 'Invalid wallet seed' || error?.message === 'Wallet was not found on the XRPL testnet') {
        throw new ApiError(400, error.message);
      }
      safeLog('error', 'wallet.import_failed', {
        userId: user.id,
        code: error?.code || error?.name,
      });
      throw new ApiError(502, 'Unable to import this wallet right now');
    }

    let encryptedSeed;
    try {
      encryptedSeed = encryptSeed(body.seed.trim(), user.id);
    } catch {
      safeLog('error', 'wallet.encryption_failed', { userId: user.id });
      throw new ApiError(503, 'Wallet signing is not configured');
    }

    await insertWallet(user.id, imported.address, encryptedSeed);

    return {
      success: true,
      address: imported.address,
      username: profile.username,
      baseCurrency: profile.base_currency,
    };
  });
}

export async function GET(req) {
  return withApi(req, async () => {
    const user = await requireUser();
    await enforceUserAndIpRateLimit(req, user.id, 'wallet:balances', {
      userLimit: 120,
      ipLimit: 240,
      windowSeconds: 60,
      failClosed: false,
    });

    const wallet = await requireWallet(user.id);

    let balances;
    try {
      balances = await getBalances(wallet.address);
    } catch (error) {
      safeLog('error', 'wallet.balance_read_failed', {
        userId: user.id,
        code: error?.code || error?.name,
      });
      throw new ApiError(502, 'Unable to read wallet balance');
    }

    return { success: true, balances };
  });
}
