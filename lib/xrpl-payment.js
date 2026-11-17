import 'server-only';
import * as xrpl from 'xrpl';
import { getClient } from './xrpl-client.js';
import { getXrplConfig, SUPPORTED_CURRENCIES } from './xrpl-config.js';
import { signAndSubmit } from './signing/server-signer.js';
import { ensureTrustLine, ensureTrustLineForAddress } from './xrpl-wallet.js';
import { calculateMinReceived, DEFAULT_SLIPPAGE_BPS, deliveredAtLeast } from './payment/slippage.js';

const MID_RATES_TO_XRP = { USD: 1.36, INR: 125, EUR: 1.17, NGN: 1878 };
const CURRENCY_SYMBOLS = { USD: '$', INR: '\u20b9', EUR: '\u20ac', NGN: '\u20a6' };

export class PaymentError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'PaymentError';
    this.code = code;
  }
}

function requireCurrency(currency) {
  if (!SUPPORTED_CURRENCIES.includes(currency)) {
    throw new PaymentError('UNSUPPORTED_CURRENCY', 'Unsupported currency');
  }
}

function safeLedgerMessage(code) {
  if (!code) return 'Payment failed';
  if (code === 'tecUNFUNDED_PAYMENT' || code === 'tecUNFUNDED_OFFER') return 'Insufficient balance';
  if (code === 'tecPATH_DRY') return 'No liquidity for this currency pair';
  if (code === 'tecPATH_PARTIAL') return 'The exchange rate moved before sending. Review the new quote and try again';
  if (code === 'tecNO_LINE' || code === 'tecNO_LINE_INSUF_RESERVE') return 'Wallet is not ready for this currency';
  if (code === 'tecNO_PERMISSION' || code === 'tecNO_TARGET') return 'This transfer can no longer be completed';
  if (code === 'tefMAX_LEDGER' || code === 'tefPAST_SEQ') return 'The transaction expired, please try again';
  if (code === 'terQUEUED' || code === 'terPRE_SEQ') return 'The transaction is still pending';
  return 'Payment failed';
}

// The default (direct order book) path is always tried as well, so this adds the
// XRP bridge on top of it. All testnet liquidity is paired against XRP.
const BRIDGE_PATHS = [[{ currency: 'XRP' }]];

function ledgerCodeFromError(error) {
  // xrpl.js rejects tem* results with only a message, e.g. "Transaction failed, temBAD_PATH: ...".
  return error?.data?.error || error?.data?.engine_result || error?.code
    || String(error?.message || '').match(/\b(te[cfmlr][A-Z_]+)\b/)?.[1] || null;
}

function issuedAmount(currency, value) {
  return { currency, issuer: getXrplConfig().issuers[currency].address, value: String(value) };
}

async function lineBalance(client, address, currency) {
  const issuer = getXrplConfig().issuers[currency].address;
  const lines = await client.request({ command: 'account_lines', account: address, peer: issuer });
  const line = lines.result.lines.find((entry) => entry.currency === currency);
  return line ? Number(line.balance) : null;
}

async function requireFunds(client, address, currency, amount) {
  const balance = await lineBalance(client, address, currency);
  if (balance === null || balance + 1e-9 < Number(amount)) {
    throw new PaymentError('INSUFFICIENT_FUNDS', 'Insufficient balance');
  }
}

// Dry-runs the exact payment on the ledger to learn how much would really be
// delivered. Nothing is submitted. Unprepared recipients are priced against the
// issuer, which crosses the same order books.
async function simulateDelivery(client, { senderAddress, receiverAddress, fromCurrency, toCurrency, amount }) {
  const destination = await lineBalance(client, receiverAddress, toCurrency) === null
    ? getXrplConfig().issuers[toCurrency].address
    : receiverAddress;

  const transaction = await client.autofill({
    TransactionType: 'Payment',
    Account: senderAddress,
    Destination: destination,
    Amount: issuedAmount(toCurrency, '1000000000'),
    SendMax: issuedAmount(fromCurrency, amount),
    DeliverMin: issuedAmount(toCurrency, '0.000001'),
    Flags: xrpl.PaymentFlags.tfPartialPayment,
    Paths: BRIDGE_PATHS,
  });

  const { result } = await client.request({ command: 'simulate', tx_json: transaction });
  const delivered = Number(result.meta?.delivered_amount?.value);
  if (result.engine_result !== 'tesSUCCESS' || !Number.isFinite(delivered) || delivered <= 0) {
    throw new PaymentError('NO_LIQUIDITY', 'No liquidity for this currency pair right now');
  }
  return delivered;
}

export async function getQuote({
  fromCurrency,
  toCurrency,
  amount,
  senderAddress,
  receiverAddress,
}) {
  requireCurrency(fromCurrency);
  requireCurrency(toCurrency);

  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    throw new PaymentError('INVALID_AMOUNT', 'Invalid amount');
  }

  const fallbackRate = MID_RATES_TO_XRP[toCurrency] / MID_RATES_TO_XRP[fromCurrency];
  const client = await getClient();
  await requireFunds(client, senderAddress, fromCurrency, numericAmount);

  if (fromCurrency === toCurrency) {
    return {
      fromCurrency,
      toCurrency,
      amount: String(amount),
      estimatedReceive: numericAmount.toFixed(6),
      minReceived: numericAmount.toFixed(6),
      rate: 1,
      rateSource: 'direct',
      networkFee: '0.000012 XRP',
      fee: `${CURRENCY_SYMBOLS[fromCurrency] || ''}0.00`,
      xenmoFee: '0.00',
      slippageBps: 0,
      quoteExpiresAt: new Date(Date.now() + 30_000).toISOString(),
      competitors: buildCompetitors(numericAmount, 0, fromCurrency),
    };
  }

  const delivered = await simulateDelivery(client, {
    senderAddress, receiverAddress, fromCurrency, toCurrency, amount: numericAmount,
  });
  const estimatedReceive = (Math.floor(delivered * 1e6) / 1e6).toFixed(6);
  const rateSource = 'pathfind';

  const midMarketReceive = numericAmount * fallbackRate;
  const spreadLoss = midMarketReceive - Number(estimatedReceive);
  const feeInSender = fallbackRate > 0 ? Math.max(0, spreadLoss / fallbackRate) : 0;

  return {
    fromCurrency,
    toCurrency,
    amount: String(amount),
    estimatedReceive,
    minReceived: calculateMinReceived(estimatedReceive, DEFAULT_SLIPPAGE_BPS),
    rate: Number(estimatedReceive) / numericAmount,
    rateSource,
    networkFee: '0.000012 XRP',
    fee: `${CURRENCY_SYMBOLS[fromCurrency] || ''}${feeInSender.toFixed(2)}`,
    xenmoFee: feeInSender.toFixed(2),
    slippageBps: DEFAULT_SLIPPAGE_BPS,
    quoteExpiresAt: new Date(Date.now() + 30_000).toISOString(),
    competitors: buildCompetitors(numericAmount, feeInSender, fromCurrency),
  };
}

function buildCompetitors(amount, xenmoFee, fromCurrency) {
  return {
    westernUnion: { fee: 12, fxMarkup: 0.04, total: (amount * 0.04 + 12).toFixed(2) },
    wise: { fee: 1.5, fxMarkup: 0.005, total: (amount * 0.005 + 1.5).toFixed(2) },
    bankWire: { fee: 35, fxMarkup: 0.03, total: (amount * 0.03 + 35).toFixed(2) },
    remitx: {
      fee: 0,
      fxMarkup: 0,
      total: xenmoFee.toFixed(2),
      currency: fromCurrency,
    },
  };
}

function formatResult(result, senderWallet, destAddress, sendMaxCurrency, destCurrency, sendAmount, minimumReceived) {
  const meta = result.result.meta;
  const delivered = meta.delivered_amount;
  const balanceChanges = xrpl.getBalanceChanges(meta);
  const hash = result.result.hash;

  const deliveredValue = typeof delivered === 'string'
    ? xrpl.dropsToXrp(delivered)
    : delivered?.value || '0';

  if (!deliveredAtLeast(deliveredValue, minimumReceived)) {
    throw new PaymentError('SLIPPAGE_EXCEEDED', 'The transfer delivered less than the protected minimum');
  }

  let actualCost = String(sendAmount);
  const senderChanges = balanceChanges.find((change) => change.account === senderWallet.address);
  if (senderChanges) {
    const nonXrpChange = senderChanges.balances.find(
      (balance) => balance.currency !== 'XRP' && Number(balance.value) < 0
    );
    if (nonXrpChange) {
      actualCost = Math.abs(Number(nonXrpChange.value)).toFixed(6);
    } else {
      const xrpChange = senderChanges.balances.find(
        (balance) => balance.currency === 'XRP' && Number(balance.value) < 0
      );
      if (xrpChange) {
        actualCost = (
          Math.abs(Number(xrpChange.value)) * (MID_RATES_TO_XRP[sendMaxCurrency] || 1)
        ).toFixed(6);
      }
    }
  }

  const midRate = MID_RATES_TO_XRP[destCurrency] / MID_RATES_TO_XRP[sendMaxCurrency];
  const midMarketReceive = Number(actualCost) * midRate;
  const spreadLoss = midMarketReceive - Number(deliveredValue);
  const feeInSender = midRate > 0 ? Math.max(0, spreadLoss / midRate) : 0;

  return {
    hash,
    explorerUrl: `${getXrplConfig().explorerUrl}/transactions/${hash}`,
    sender: senderWallet.address,
    receiver: destAddress,
    amountSent: Number(actualCost).toFixed(2),
    currencySent: sendMaxCurrency,
    amountReceived: Number(deliveredValue).toFixed(6),
    currencyReceived: destCurrency,
    effectiveRate: Number(actualCost) > 0
      ? (Number(deliveredValue) / Number(actualCost)).toFixed(6)
      : '0',
    fee: `${CURRENCY_SYMBOLS[sendMaxCurrency] || ''}${feeInSender.toFixed(2)}`,
    minReceived: String(minimumReceived),
    status: 'CONFIRMED',
  };
}

function buildPayment({ senderWallet, destAddress, sendMaxCurrency, destCurrency, sendAmount, destAmount, minimumReceived, paths }) {
  const config = getXrplConfig();
  const srcIssuer = config.issuers[sendMaxCurrency].address;
  const destIssuer = config.issuers[destCurrency].address;

  const payment = {
    TransactionType: 'Payment',
    Account: senderWallet.address,
    Destination: destAddress,
    Amount: {
      currency: destCurrency,
      issuer: destIssuer,
      value: String(destAmount),
    },
    SendMax: {
      currency: sendMaxCurrency,
      issuer: srcIssuer,
      value: String(sendAmount),
    },
    DeliverMin: {
      currency: destCurrency,
      issuer: destIssuer,
      value: String(minimumReceived),
    },
    Flags: xrpl.PaymentFlags.tfPartialPayment,
  };

  if (paths) payment.Paths = paths;
  return payment;
}

export async function sendPayment({
  senderWallet,
  destAddress,
  sendAmount,
  sendMaxCurrency,
  destCurrency,
  destAmount,
  minimumReceived,
}) {
  if (!xrpl.isValidClassicAddress(destAddress)) {
    throw new PaymentError('INVALID_DESTINATION', 'Invalid destination address');
  }
  if (destAddress === senderWallet.address) {
    throw new PaymentError('SELF_PAYMENT', 'You cannot send money to yourself');
  }
  if (!SUPPORTED_CURRENCIES.includes(sendMaxCurrency) || !SUPPORTED_CURRENCIES.includes(destCurrency)) {
    throw new PaymentError('UNSUPPORTED_CURRENCY', 'Unsupported currency');
  }
  if (!Number.isFinite(Number(sendAmount)) || Number(sendAmount) <= 0) {
    throw new PaymentError('INVALID_AMOUNT', 'Invalid amount');
  }

  // Lazy trust lines: prepare the sender's source currency and the recipient's
  // destination currency only when they are actually needed.
  await ensureTrustLine(senderWallet, sendMaxCurrency);
  await ensureTrustLineForAddress(destAddress, destCurrency);

  if (sendMaxCurrency === destCurrency) {
    let result;
    try {
      result = await signAndSubmit(senderWallet, {
        TransactionType: 'Payment',
        Account: senderWallet.address,
        Destination: destAddress,
        Amount: {
          currency: destCurrency,
          issuer: getXrplConfig().issuers[destCurrency].address,
          value: String(sendAmount),
        },
      });
    } catch (error) {
      const code = ledgerCodeFromError(error);
      throw new PaymentError(code || 'SUBMIT_FAILED', safeLedgerMessage(code));
    }

    if (result.result.meta?.TransactionResult !== 'tesSUCCESS') {
      const code = result.result.meta?.TransactionResult;
      throw new PaymentError(code || 'FAILED', safeLedgerMessage(code));
    }

    return formatResult(
      result,
      senderWallet,
      destAddress,
      sendMaxCurrency,
      destCurrency,
      sendAmount,
      sendAmount
    );
  }

  let result;
  try {
    result = await signAndSubmit(senderWallet, buildPayment({
      senderWallet,
      destAddress,
      sendMaxCurrency,
      destCurrency,
      sendAmount,
      destAmount,
      minimumReceived,
      paths: BRIDGE_PATHS,
    }));
  } catch (error) {
    const code = ledgerCodeFromError(error);
    throw new PaymentError(code || 'SUBMIT_FAILED', safeLedgerMessage(code));
  }

  const resultCode = result.result.meta?.TransactionResult;
  if (resultCode !== 'tesSUCCESS') {
    throw new PaymentError(resultCode || 'FAILED', safeLedgerMessage(resultCode));
  }

  return formatResult(
    result,
    senderWallet,
    destAddress,
    sendMaxCurrency,
    destCurrency,
    sendAmount,
    minimumReceived
  );
}
