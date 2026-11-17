import 'server-only';
import * as xrpl from 'xrpl';

export const SUPPORTED_CURRENCIES = ['USD', 'INR', 'EUR', 'NGN'];

let cached = null;

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required server configuration: ${name}`);
  return value;
}

export function getXrplConfig() {
  if (cached) return cached;

  const url = process.env.XRPL_TESTNET_URL || 'wss://s.altnet.rippletest.net:51233';
  if (!/altnet|testnet/i.test(url) && process.env.ALLOW_MAINNET !== 'true') {
    throw new Error('XRPL_TESTNET_URL must point at the testnet');
  }

  const issuers = {};
  for (const currency of SUPPORTED_CURRENCIES) {
    const address = required(`XRPL_ISSUER_${currency}_ADDRESS`);
    const seed = required(`XRPL_ISSUER_${currency}_SEED`);

    if (!xrpl.isValidClassicAddress(address)) {
      throw new Error(`Invalid issuer address for ${currency}`);
    }

    const wallet = xrpl.Wallet.fromSeed(seed);
    if (wallet.address !== address) {
      throw new Error(`Issuer seed/address mismatch for ${currency}`);
    }

    issuers[currency] = { address, wallet };
  }

  cached = {
    url,
    explorerUrl: process.env.XRPL_EXPLORER_URL || 'https://testnet.xrpl.org',
    issuers,
  };

  return cached;
}

export function getIssuerWallet(currency) {
  const issuer = getXrplConfig().issuers[currency];
  if (!issuer) throw new Error(`Unsupported currency: ${currency}`);
  return issuer.wallet;
}

export function getIssuerAddress(currency) {
  const issuer = getXrplConfig().issuers[currency];
  if (!issuer) throw new Error(`Unsupported currency: ${currency}`);
  return issuer.address;
}

export function isSupportedCurrency(currency) {
  return SUPPORTED_CURRENCIES.includes(currency);
}
