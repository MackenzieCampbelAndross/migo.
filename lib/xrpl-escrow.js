import 'server-only';
import * as xrpl from 'xrpl';
import { getClient } from './xrpl-client.js';
import { getIssuerWallet, getXrplConfig } from './xrpl-config.js';
import { signAndSubmit } from './signing/server-signer.js';
import { ensureTrustLine } from './xrpl-wallet.js';

// One value asset moves: the IOU is burned from the sender and minted to the
// claimer on success, or minted back to the sender on refund. The XRPL escrow
// is an issuer-owned 1-drop conditional trigger, not the value itself. This
// avoids the old double-charge (burn IOUs + lock XRP) while keeping the
// on-chain PREIMAGE-SHA-256 claim condition.

export class EscrowError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'EscrowError';
    this.code = code;
  }
}

function safeEscrowMessage(code) {
  if (!code) return 'Escrow operation failed';
  if (code === 'tecUNFUNDED_PAYMENT' || code === 'tecUNFUNDED_OFFER') return 'Insufficient balance';
  if (code === 'tecNO_LINE' || code === 'tecNO_LINE_INSUF_RESERVE') return 'Wallet is not ready for this currency';
  if (code === 'tecNO_PERMISSION' || code === 'tecNO_TARGET') return 'This escrow can no longer be completed';
  if (code === 'tecNO_DST_INSUF_XRP') return 'The escrow service needs more testnet XRP';
  if (code === 'tefMAX_LEDGER' || code === 'tefPAST_SEQ') return 'The transaction expired, please try again';
  return 'Escrow operation failed';
}

function ledgerCodeFromError(error) {
  return error?.data?.error || error?.data?.engine_result || error?.code || null;
}

async function submitAndCheck(wallet, transaction) {
  let result;
  try {
    result = await signAndSubmit(wallet, transaction);
  } catch (error) {
    const code = ledgerCodeFromError(error);
    throw new EscrowError(code || 'SUBMIT_FAILED', safeEscrowMessage(code));
  }

  const code = result.result.meta?.TransactionResult;
  if (code !== 'tesSUCCESS') {
    throw new EscrowError(code || 'FAILED', safeEscrowMessage(code));
  }

  return result;
}

export function escrowSequenceFromResult(result) {
  const sequence =
    result.result.tx_json?.Sequence ??
    result.result.Sequence ??
    result.result.tx_json?.sequence;

  const numeric = Number(sequence);
  if (!Number.isInteger(numeric) || numeric <= 0) {
    throw new EscrowError('MISSING_SEQUENCE', 'Escrow was created but its sequence could not be read');
  }
  return numeric;
}

export async function createTriggerEscrow({
  issuerWallet,
  destinationAddress,
  conditionHex,
  cancelSeconds,
}) {
  if (!xrpl.isValidClassicAddress(destinationAddress)) {
    throw new EscrowError('INVALID_DESTINATION', 'Invalid escrow destination');
  }

  const cancelAfterIso = new Date(Date.now() + (Number(cancelSeconds) + 120) * 1000).toISOString();
  const cancelAfter = xrpl.isoTimeToRippleTime(cancelAfterIso);

  const result = await submitAndCheck(issuerWallet, {
    TransactionType: 'EscrowCreate',
    Account: issuerWallet.address,
    Destination: destinationAddress,
    Amount: '1',
    Condition: conditionHex,
    CancelAfter: cancelAfter,
  });

  return {
    hash: result.result.hash,
    ownerAddress: issuerWallet.address,
    sequence: escrowSequenceFromResult(result),
    cancelAfter: cancelAfterIso,
  };
}

export async function finishTriggerEscrow({
  claimerWallet,
  ownerAddress,
  sequence,
  conditionHex,
  fulfillmentHex,
}) {
  const result = await submitAndCheck(claimerWallet, {
    TransactionType: 'EscrowFinish',
    Account: claimerWallet.address,
    Owner: ownerAddress,
    OfferSequence: Number(sequence),
    Condition: conditionHex,
    Fulfillment: fulfillmentHex,
  });

  return {
    hash: result.result.hash,
    explorerUrl: `${getXrplConfig().explorerUrl}/transactions/${result.result.hash}`,
  };
}

export async function cancelTriggerEscrow({ issuerWallet, sequence }) {
  const result = await submitAndCheck(issuerWallet, {
    TransactionType: 'EscrowCancel',
    Account: issuerWallet.address,
    Owner: issuerWallet.address,
    OfferSequence: Number(sequence),
  });

  return { hash: result.result.hash };
}

export async function burnTokens({ wallet, currency, amount }) {
  const issuerWallet = getIssuerWallet(currency);
  await ensureTrustLine(wallet, currency);

  const result = await submitAndCheck(wallet, {
    TransactionType: 'Payment',
    Account: wallet.address,
    Destination: issuerWallet.address,
    Amount: {
      currency,
      issuer: issuerWallet.address,
      value: String(amount),
    },
  });

  return { hash: result.result.hash };
}

export async function mintTokensTo({ destination, currency, amount }) {
  const issuerWallet = getIssuerWallet(currency);

  const result = await submitAndCheck(issuerWallet, {
    TransactionType: 'Payment',
    Account: issuerWallet.address,
    Destination: destination,
    Amount: {
      currency,
      issuer: issuerWallet.address,
      value: String(amount),
    },
  });

  return { hash: result.result.hash };
}
