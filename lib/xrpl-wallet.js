import 'server-only';
import * as xrpl from 'xrpl';
import { getClient } from './xrpl-client.js';
import { getIssuerWallet, getXrplConfig, SUPPORTED_CURRENCIES } from './xrpl-config.js';
import { signAndSubmit, walletFromSeed } from './signing/server-signer.js';

const TRUST_LINE_LIMIT = '999999999';

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

async function ensureTrustLines(wallet) {
  const client = await getClient();
  const existing = await existingCurrencies(client, wallet.address);
  const created = [];

  for (const currency of SUPPORTED_CURRENCIES) {
    if (existing.has(currency)) continue;

    const issuer = getXrplConfig().issuers[currency];
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

    created.push(currency);
  }

  return created;
}

export async function createWallet() {
  const client = await getClient();
  const { wallet, balance } = await client.fundWallet();
  await ensureTrustLines(wallet);

  return {
    address: wallet.address,
    seed: wallet.seed,
    xrpBalance: balance,
  };
}

export async function importWallet(seed) {
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

  await ensureTrustLines(wallet);
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
