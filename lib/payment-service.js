import 'server-only';
import { ApiError } from './api.js';
import { safeLog } from './logger.js';
import { createAdminClient } from './supabase/admin.js';
import { getQuote, PaymentError, sendPayment } from './xrpl-payment.js';
import { getUserSigner } from './signing/server-signer.js';
import { getXrplConfig } from './xrpl-config.js';

function ledgerStatus(code) {
  if (!code) return 502;
  if (code.startsWith('tecUNFUNDED')) return 400;
  if (code === 'tecNO_LINE' || code === 'tecNO_LINE_INSUF_RESERVE') return 400;
  if (code === 'tecPATH_DRY' || code === 'tecPATH_PARTIAL') return 409;
  if (code.startsWith('tecNO_')) return 409;
  return 502;
}

function mapPaymentError(error) {
  if (error instanceof ApiError) return error;

  if (error instanceof PaymentError) {
    if (['INVALID_DESTINATION', 'SELF_PAYMENT', 'UNSUPPORTED_CURRENCY', 'INVALID_AMOUNT'].includes(error.code)) {
      return new ApiError(400, error.message);
    }
    if (error.code === 'SLIPPAGE_EXCEEDED') {
      return new ApiError(409, error.message);
    }
    if (error.code === 'NO_LIQUIDITY') {
      return new ApiError(409, error.message);
    }
    return new ApiError(ledgerStatus(error.code), error.message);
  }

  safeLog('error', 'payment.unexpected_error', { code: error?.name || 'UnknownError' });
  return new ApiError(500, 'Payment failed');
}

function duplicateResponse(payment) {
  if (payment.status === 'CONFIRMED') {
    return {
      duplicate: true,
      paymentId: payment.id,
      status: 'CONFIRMED',
      hash: payment.tx_hash,
      explorerUrl: `${getXrplConfig().explorerUrl}/transactions/${payment.tx_hash}`,
      sender: null,
      receiver: payment.dest_address,
      amountSent: String(payment.actual_sent_amount ?? payment.send_amount),
      currencySent: payment.send_max_currency,
      amountReceived: String(payment.delivered_amount ?? payment.amount),
      currencyReceived: payment.currency,
      effectiveRate: String(payment.effective_rate ?? ''),
      fee: payment.fee_display || '',
      minReceived: String(payment.min_received),
    };
  }

  if (payment.status === 'FAILED') {
    throw new ApiError(409, 'This payment already failed; start a new payment');
  }

  throw new ApiError(409, 'This payment is already being processed');
}

async function findPayment(userId, idempotencyKey) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('payments')
    .select('*')
    .eq('user_id', userId)
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle();

  if (error) {
    safeLog('error', 'payment.idempotency_read_failed', { code: error.code });
    throw new ApiError(500, 'Payment failed');
  }

  return data;
}

export async function executePayment({
  userId,
  walletRecord,
  toAddress,
  amount,
  fromCurrency,
  toCurrency,
  idempotencyKey,
}) {
  const admin = createAdminClient();

  const existing = await findPayment(userId, idempotencyKey);
  if (existing) return duplicateResponse(existing);

  let quote;
  try {
    quote = await getQuote({
      fromCurrency,
      toCurrency,
      amount,
      senderAddress: walletRecord.address,
      receiverAddress: toAddress,
    });
  } catch (error) {
    throw mapPaymentError(error);
  }

  const { data: payment, error: insertError } = await admin
    .from('payments')
    .insert({
      user_id: userId,
      idempotency_key: idempotencyKey,
      dest_address: toAddress,
      amount: quote.estimatedReceive,
      currency: toCurrency,
      send_max_currency: fromCurrency,
      send_amount: amount,
      quoted_receive: quote.estimatedReceive,
      min_received: quote.minReceived,
      status: 'CREATED',
    })
    .select('*')
    .single();

  if (insertError) {
    if (insertError.code === '23505') {
      const duplicate = await findPayment(userId, idempotencyKey);
      if (duplicate) return duplicateResponse(duplicate);
    }

    safeLog('error', 'payment.insert_failed', { code: insertError.code });
    throw new ApiError(500, 'Payment failed');
  }

  const { data: authorized, error: stateError } = await admin
    .from('payments')
    .update({ status: 'AUTHORIZED' })
    .eq('id', payment.id)
    .eq('status', 'CREATED')
    .select('*')
    .maybeSingle();

  if (stateError) {
    safeLog('error', 'payment.state_failed', { paymentId: payment.id, code: stateError.code });
    throw new ApiError(500, 'Payment failed');
  }

  if (!authorized) {
    const duplicate = await findPayment(userId, idempotencyKey);
    if (duplicate) return duplicateResponse(duplicate);
    throw new ApiError(409, 'This payment is already being processed');
  }

  let signer;
  try {
    signer = getUserSigner(userId, walletRecord);
  } catch {
    safeLog('error', 'payment.signer_unavailable', { userId });
    await admin
      .from('payments')
      .update({ status: 'FAILED', result_code: 'SIGNER_UNAVAILABLE' })
      .eq('id', payment.id)
      .eq('status', 'AUTHORIZED');
    throw new ApiError(503, 'Signing is temporarily unavailable');
  }

  let result;
  try {
    result = await sendPayment({
      senderWallet: signer.wallet,
      destAddress: toAddress,
      sendAmount: amount,
      sendMaxCurrency: fromCurrency,
      destCurrency: toCurrency,
      destAmount: quote.estimatedReceive,
      minimumReceived: quote.minReceived,
    });
  } catch (error) {
    const apiError = mapPaymentError(error);

    await admin
      .from('payments')
      .update({
        status: 'FAILED',
        result_code: error instanceof PaymentError ? error.code : 'PAYMENT_FAILED',
      })
      .eq('id', payment.id)
      .eq('status', 'AUTHORIZED');

    throw apiError;
  }

  const { error: confirmError } = await admin
    .from('payments')
    .update({
      status: 'CONFIRMED',
      tx_hash: result.hash,
      result_code: 'tesSUCCESS',
      delivered_amount: result.amountReceived,
      actual_sent_amount: result.amountSent,
      effective_rate: result.effectiveRate,
      fee_display: result.fee,
    })
    .eq('id', payment.id)
    .eq('status', 'AUTHORIZED');

  if (confirmError) {
    safeLog('error', 'payment.confirm_update_failed', {
      paymentId: payment.id,
      hash: result.hash,
      code: confirmError.code,
    });
  }

  return {
    duplicate: false,
    paymentId: payment.id,
    ...result,
    sender: signer.address,
  };
}
