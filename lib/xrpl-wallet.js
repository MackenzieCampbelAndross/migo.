import 'server-only';
import * as xrpl from 'xrpl';
import { getClient } from './xrpl-client.js';
import { getIssuerWallet, getXrplConfig, SUPPORTED_CURRENCIES } from './xrpl-config.js';
import { getUserSigner, signAndSubmit, walletFromSeed } from './signing/server-signer.js';
import { createAdminClient } from './supabase/admin.js';

const TRUST_LINE_LIMIT = '999999999';
const trustLineLocks = new Map();

export const STARTING_BALANCES = {
  USD: '500',
  INR: '25000',
  EUR: '400',
  NGN: '100000',
};

async function existingCurrencies(client, address) {
  const lines = await client.request({
    command: 'account_lines',
    account: address,
  });
  return new Set(lines.result.lines.map((line) => line.currency));
}

// Creates a trust line only when a currency is first used. This keeps wallet
// creation to one trust line instead of four.
export async function ensureTrustLine(wallet, currency) {
  if (!SUPPORTED_CURRENCIES.includes(currency)) {
    throw new Error(`Unsupported currency: ${currency}`);
  }

  const issuer = getXrplConfig().issuers[currency];
  if (!issuer) throw new Error(`No issuer configured for ${currency}`);

  const key = `${wallet.address}:${currency}`;
  if (trustLineLocks.has(key)) return trustLineLocks.get(key);

  const task = (async () => {
    const client = await getClient();
    const existing = await existingCurrencies(client, wallet.address);
    if (existing.has(currency)) return;

    const result = await signAndSubmit(wallet, {
      TransactionType: 'TrustSet',
      Account: wallet.address,
      LimitAmount: {
        currency,
        issuer: issuer.address,
        value: TRUST_LINE_LIMIT,
      },
    });

    if (result.result.meta?.TransactionResult !== 'tesSUCCESS') {
      throw new Error(`Unable to prepare ${currency} trust line`);
    }
  })().finally(() => trustLineLocks.delete(key));

  trustLineLocks.set(key, task);
  return task;
}

// Prepares a registered recipient's line using their encrypted server-side
// wallet. External addresses cannot be prepared and return false.
export async function ensureTrustLineForAddress(address, currency) {
  if (!SUPPORTED_CURRENCIES.includes(currency)) return false;

  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from('wallets')
      .select('user_id, address, encrypted_seed')
      .eq('address', address)
      .maybeSingle();

    if (error || !data) return false;

    const signer = getUserSigner(data.user_id, data);
    await ensureTrustLine(signer.wallet, currency);
    return true;
  } catch {
    return false;
  }
}

// Create a brand new wallet funded via testnet faucet.
// Only the selected base currency trust line is created up front.
export async function createWallet(baseCurrency = 'USD') {
  const client = await getClient();
  const { wallet, balance } = await client.fundWallet();
  await ensureTrustLine(wallet, baseCurrency);

  return {
    address: wallet.address,
    seed: wallet.seed,
    xrpBalance: balance,
  };
}

// Restore wallet from seed and ensure the selected base currency line exists.
export async function importWallet(seed, baseCurrency = 'USD') {
  const wallet = walletFromSeed(seed);
  const client = await getClient();

  try {
    await client.request({
      command: 'account_info',
      account: wallet.address,
      ledger_index: 'validated',
    });
  } catch {
    throw new Error('Wallet was not found on the XRPL testnet');
  }

  await ensureTrustLine(wallet, baseCurrency);
  return { address: wallet.address };
}

export async function getBalances(address) {
  const client = await getClient();

  let accountData;
  try {
    const accountInfo = await client.request({
      command: 'account_info',
      account: address,
      ledger_index: 'validated',
    });
    accountData = accountInfo.result.account_data;
  } catch {
    throw new Error('Wallet was not found on the XRPL testnet');
  }

  const lines = await client.request({
    command: 'account_lines',
    account: address,
  });

  const balances = { XRP: xrpl.dropsToXrp(accountData.Balance) };
  for (const currency of SUPPORTED_CURRENCIES) {
    const issuer = getXrplConfig().issuers[currency];
    const line = lines.result.lines.find(
      (entry) => entry.currency === currency && entry.account === issuer.address
    );
    balances[currency] = line ? line.balance : '0';
  }

  return balances;
}

export async function getCurrencyBalance(address, currency) {
  const balances = await getBalances(address);
  return Number(balances[currency] || 0);
}

export async function mintTokens(userAddress, currency, amount) {
  const issuerWallet = getIssuerWallet(currency);

  const result = await signAndSubmit(issuerWallet, {
    TransactionType: 'Payment',
    Account: issuerWallet.address,
    Destination: userAddress,
    Amount: {
      currency,
      issuer: issuerWallet.address,
      value: String(amount),
    },
  });

  if (result.result.meta?.TransactionResult !== 'tesSUCCESS') {
    throw new Error('Unable to fund wallet');
  }

  return { hash: result.result.hash };
}
