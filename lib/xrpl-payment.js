import 'server-only';
import * as xrpl from 'xrpl';
import { getClient } from './xrpl-client.js';
import { getXrplConfig, SUPPORTED_CURRENCIES } from './xrpl-config.js';
import { signAndSubmit } from './signing/server-signer.js';
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
  if (code === 'tecPATH_DRY' || code === 'tecPATH_PARTIAL') return 'No liquidity for this currency pair';
  if (code === 'tecNO_LINE' || code === 'tecNO_LINE_INSUF_RESERVE') return 'Wallet is not ready for this currency';
  if (code === 'tecNO_PERMISSION' || code === 'tecNO_TARGET') return 'This transfer can no longer be completed';
  if (code === 'tefMAX_LEDGER' || code === 'tefPAST_SEQ') return 'The transaction expired, please try again';
  if (code === 'terQUEUED' || code === 'terPRE_SEQ') return 'The transaction is still pending';
  return 'Payment failed';
}

function ledgerCodeFromError(error) {
  return error?.data?.error || error?.data?.engine_result || error?.code || null;
}

async function findPath(client, sourceAddress, destAddress, destAmount) {
  try {
    const result = await client.request({
      command: 'ripple_path_find',
      source_account: sourceAddress,
      destination_account: destAddress,
      destination_amount: destAmount,
    });

    const alternatives = result.result.alternatives || [];
    if (alternatives.length === 0) return null;

    return {
      sourceAmount: alternatives[0].source_amount,
      paths: alternatives[0].paths_computed,
    };
  } catch {
    return null;
  }
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

  const config = getXrplConfig();
  const fromIssuer = config.issuers[fromCurrency];
  const toIssuer = config.issuers[toCurrency];

  const fromPerXrp = MID_RATES_TO_XRP[fromCurrency];
  const toPerXrp = MID_RATES_TO_XRP[toCurrency];
  const fallbackRate = toPerXrp / fromPerXrp;
  const fallbackReceive = (numericAmount * fallbackRate).toFixed(6);

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

  let estimatedReceive = fallbackReceive;
  let rateSource = 'fallback';

  if (senderAddress && receiverAddress) {
    const pathData = await findPathFromAddresses(
      senderAddress,
      receiverAddress,
      toCurrency,
      toIssuer.address,
      fallbackReceive
    );

    if (pathData) {
      let costInSenderCurrency;
      if (typeof pathData.sourceAmount === 'string') {
        const xrpCost = Number(xrpl.dropsToXrp(pathData.sourceAmount));
        costInSenderCurrency = xrpCost * fromPerXrp;
      } else {
        costInSenderCurrency = Number(pathData.sourceAmount.value);
      }

      if (Number.isFinite(costInSenderCurrency) && costInSenderCurrency > 0) {
        const liveReceive = numericAmount * (Number(fallbackReceive) / costInSenderCurrency);
        if (Number.isFinite(liveReceive) && liveReceive > 0) {
          estimatedReceive = liveReceive.toFixed(6);
          rateSource = 'pathfind';
        }
      }
    }
  }

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

async function findPathFromAddresses(senderAddress, receiverAddress, toCurrency, toIssuer, value) {
  const client = await getClient();
  return findPath(client, senderAddress, receiverAddress, {
    currency: toCurrency,
    issuer: toIssuer,
    value,
  });
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

  const client = await getClient();

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

  const destinationAmount = {
    currency: destCurrency,
    issuer: getXrplConfig().issuers[destCurrency].address,
    value: String(destAmount),
  };

  const pathData = await findPath(client, senderWallet.address, destAddress, destinationAmount);
  const attempts = [];

  if (pathData) {
    attempts.push(buildPayment({
      senderWallet,
      destAddress,
      sendMaxCurrency,
      destCurrency,
      sendAmount,
      destAmount,
      minimumReceived,
      paths: pathData.paths,
    }));
  }

  attempts.push(buildPayment({
    senderWallet,
    destAddress,
    sendMaxCurrency,
    destCurrency,
    sendAmount,
    destAmount,
    minimumReceived,
    paths: [[{ currency: 'XRP' }]],
  }));

  // Only retry a different path strategy on a definitive path/liquidity
  // failure. Retrying after an unknown submit error could double-submit.
  const retryable = new Set([
    'tecPATH_DRY',
    'tecPATH_PARTIAL',
    'tecNO_LINE',
    'tecNO_LINE_INSUF_RESERVE',
  ]);

  let lastCode = null;

  for (const payment of attempts) {
    let result;
    try {
      result = await signAndSubmit(senderWallet, payment);
    } catch (error) {
      lastCode = ledgerCodeFromError(error);
      if (!retryable.has(lastCode)) {
        throw new PaymentError(lastCode || 'PAYMENT_FAILED', safeLedgerMessage(lastCode));
      }
      continue;
    }

    const resultCode = result.result.meta?.TransactionResult;
    if (resultCode === 'tesSUCCESS') {
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

    lastCode = resultCode;
    if (!retryable.has(resultCode)) {
      throw new PaymentError(resultCode || 'PAYMENT_FAILED', safeLedgerMessage(resultCode));
    }
  }

  throw new PaymentError(lastCode || 'PAYMENT_FAILED', safeLedgerMessage(lastCode));
}
