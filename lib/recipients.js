import 'server-only';
import * as xrpl from 'xrpl';
import { createAdminClient } from './supabase/admin.js';
import { normalizeUsername } from './validation.js';
import { safeLog } from './logger.js';

export async function resolveRecipient(input, { requireRegistered = false } = {}) {
  const value = String(input || '').trim();
  if (!value) return null;

  const admin = createAdminClient();

  if (xrpl.isValidClassicAddress(value)) {
    const { data: wallet, error } = await admin
      .from('wallets')
      .select('user_id, address')
      .eq('address', value)
      .maybeSingle();

    if (error) {
      safeLog('error', 'recipient.address_lookup_failed', { code: error.code });
      return null;
    }

    if (!wallet) {
      return requireRegistered ? null : {
        address: value,
        userId: null,
        username: null,
        displayName: null,
        baseCurrency: null,
      };
    }

    const profile = await getProfileById(wallet.user_id);
    return {
      address: wallet.address,
      userId: wallet.user_id,
      username: profile?.username || null,
      displayName: profile?.display_name || null,
      baseCurrency: profile?.base_currency || null,
    };
  }

  const username = normalizeUsername(value).replace(/^@/, '');
  if (!/^[a-z0-9_]{3,20}$/.test(username)) return null;

  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('id, username, display_name, base_currency')
    .eq('username', username)
    .maybeSingle();

  if (profileError) {
    safeLog('error', 'recipient.username_lookup_failed', { code: profileError.code });
    return null;
  }

  if (!profile) return null;

  const { data: wallet, error: walletError } = await admin
    .from('wallets')
    .select('address')
    .eq('user_id', profile.id)
    .maybeSingle();

  if (walletError) {
    safeLog('error', 'recipient.wallet_lookup_failed', { code: walletError.code });
    return null;
  }

  if (!wallet) return null;

  return {
    address: wallet.address,
    userId: profile.id,
    username: profile.username,
    displayName: profile.display_name,
    baseCurrency: profile.base_currency,
  };
}

async function getProfileById(userId) {
  const admin = createAdminClient();
  const { data } = await admin
    .from('profiles')
    .select('username, display_name, base_currency')
    .eq('id', userId)
    .maybeSingle();
  return data;
}

export async function getRecipientLabel(userId) {
  if (!userId) return null;
  const profile = await getProfileById(userId);
  return profile?.username || null;
}
