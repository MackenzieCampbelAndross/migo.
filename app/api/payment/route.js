import { ApiError, readJson, readQuery, withApi } from '@/lib/api';
import { requireSigningWallet, requireUser, requireWallet } from '@/lib/auth';
import { executePayment } from '@/lib/payment-service';
import { enforceUserAndIpRateLimit } from '@/lib/rate-limit';
import { resolveRecipient } from '@/lib/recipients';
import { getQuote, PaymentError } from '@/lib/xrpl-payment';
import { paymentSchema, quoteQuerySchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

async function resolveDestination(input) {
  const recipient = await resolveRecipient(input, { requireRegistered: false });
  if (!recipient) throw new ApiError(404, 'Recipient not found');
  return recipient;
}

export async function GET(req) {
  return withApi(req, async () => {
    const user = await requireUser();
    const wallet = await requireWallet(user.id);

    await enforceUserAndIpRateLimit(req, user.id, 'payment:quote', {
      userLimit: 60,
      ipLimit: 120,
      windowSeconds: 60,
      failClosed: false,
    });

    const query = readQuery(new URL(req.url).searchParams, quoteQuerySchema);
    const recipient = await resolveDestination(query.recipient);

    if (recipient.address === wallet.address) {
      throw new ApiError(400, 'You cannot send money to yourself');
    }

    let quote;
    try {
      quote = await getQuote({
        fromCurrency: query.fromCurrency,
        toCurrency: query.toCurrency,
        amount: query.amount,
        senderAddress: wallet.address,
        receiverAddress: recipient.address,
      });
    } catch (error) {
      if (error instanceof PaymentError) {
        throw new ApiError(400, error.message);
      }
      throw error;
    }

    return {
      success: true,
      ...quote,
      recipient: {
        address: recipient.address,
        username: recipient.username,
        displayName: recipient.displayName,
      },
    };
  });
}

export async function POST(req) {
  return withApi(req, async () => {
    const user = await requireUser();
    const wallet = await requireSigningWallet(user.id);

    await enforceUserAndIpRateLimit(req, user.id, 'payment:send', {
      userLimit: 20,
      ipLimit: 40,
      windowSeconds: 60,
      failClosed: true,
    });

    const body = await readJson(req, paymentSchema, 8 * 1024);
    const recipient = await resolveDestination(body.to);

    if (recipient.address === wallet.address) {
      throw new ApiError(400, 'You cannot send money to yourself');
    }

    const result = await executePayment({
      userId: user.id,
      walletRecord: wallet,
      toAddress: recipient.address,
      amount: body.amount,
      fromCurrency: body.fromCurrency,
      toCurrency: body.toCurrency,
      idempotencyKey: body.idempotencyKey,
    });

    return {
      success: true,
      ...result,
      receiver: recipient.address,
    };
  });
}
