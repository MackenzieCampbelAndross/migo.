import { ApiError, readJson, withApi } from '@/lib/api';
import { requireSigningWallet, requireUser } from '@/lib/auth';
import {
  claimEscrow,
  createEscrow,
  listIncomingEscrows,
} from '@/lib/escrow-service';
import { enforceUserAndIpRateLimit } from '@/lib/rate-limit';
import { resolveRecipient } from '@/lib/recipients';
import { getUserSigner } from '@/lib/signing/server-signer';
import { getCurrencyBalance } from '@/lib/xrpl-wallet';
import { escrowClaimSchema, escrowCreateSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function signerFor(userId, walletRecord) {
  try {
    return getUserSigner(userId, walletRecord);
  } catch {
    throw new ApiError(503, 'Signing is temporarily unavailable');
  }
}

export async function POST(req) {
  return withApi(req, async () => {
    const user = await requireUser();
    const wallet = await requireSigningWallet(user.id);

    await enforceUserAndIpRateLimit(req, user.id, 'escrow:create', {
      userLimit: 10,
      ipLimit: 20,
      windowSeconds: 60,
      failClosed: true,
    });

    const body = await readJson(req, escrowCreateSchema, 8 * 1024);

    let recipient = null;
    if (body.to) {
      recipient = await resolveRecipient(body.to, { requireRegistered: true });
      if (!recipient) throw new ApiError(404, 'Recipient not found');
    }

    let balance;
    try {
      balance = await getCurrencyBalance(wallet.address, body.currency);
    } catch {
      throw new ApiError(502, 'Unable to read wallet balance');
    }

    if (Number(balance) < Number(body.amount)) {
      throw new ApiError(400, 'Insufficient balance');
    }

    const signer = signerFor(user.id, wallet);
    const result = await createEscrow({
      ownerUserId: user.id,
      ownerWallet: signer.wallet,
      amount: body.amount,
      currency: body.currency,
      recipient,
      clientRequestId: body.idempotencyKey,
      cancelSeconds: body.cancelSeconds,
    });

    return { success: true, ...result, displayAmount: result.amount };
  });
}

export async function PUT(req) {
  return withApi(req, async () => {
    const user = await requireUser();
    const wallet = await requireSigningWallet(user.id);

    await enforceUserAndIpRateLimit(req, user.id, 'escrow:claim', {
      userLimit: 10,
      ipLimit: 30,
      windowSeconds: 60,
      failClosed: true,
    });

    const body = await readJson(req, escrowClaimSchema, 4 * 1024);
    const signer = signerFor(user.id, wallet);

    const result = await claimEscrow({
      userId: user.id,
      claimerWallet: signer.wallet,
      code: body.code,
      escrowId: body.escrowId,
    });

    return { success: true, ...result };
  });
}

export async function GET(req) {
  return withApi(req, async () => {
    const user = await requireUser();

    await enforceUserAndIpRateLimit(req, user.id, 'escrow:list', {
      userLimit: 60,
      ipLimit: 120,
      windowSeconds: 60,
      failClosed: false,
    });

    const escrows = await listIncomingEscrows(user.id);
    return { success: true, escrows };
  });
}
