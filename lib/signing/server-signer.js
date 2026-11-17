import 'server-only';
import * as xrpl from 'xrpl';
import { getClient } from '../xrpl-client.js';
import { decryptSeed } from '../security/seed-vault.js';
import { getIssuerWallet } from '../xrpl-config.js';

// TESTNET-ONLY INTERIM SIGNER.
// Seeds are encrypted at rest with WALLET_ENCRYPTION_KEY and only decrypted
// inside this module. Replace this module with client-side signing / Xaman /
// MPC / KMS without changing the API or escrow services.

export function walletFromSeed(seed) {
  try {
    return xrpl.Wallet.fromSeed(String(seed).trim());
  } catch {
    throw new Error('Invalid wallet seed');
  }
}

export function getUserSigner(userId, walletRecord) {
  const seed = decryptSeed(walletRecord.encrypted_seed, userId);
  const wallet = walletFromSeed(seed);

  if (wallet.address !== walletRecord.address) {
    throw new Error('Wallet signer does not match stored address');
  }

  return { address: wallet.address, wallet };
}

export function getIssuerSigner(currency) {
  return getIssuerWallet(currency);
}

export async function signAndSubmit(wallet, transaction, options = {}) {
  const client = await getClient();
  return client.submitAndWait(transaction, {
    autofill: true,
    wallet,
    ...options,
  });
}
